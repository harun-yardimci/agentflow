import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Writable } from 'stream';
import { createTestDb } from './helpers/test-db.js';

let db: Database.Database;
let mockFiles: Array<{
  originalname: string;
  filename: string;
  mimetype: string;
  size: number;
  path: string;
}> = [];

vi.mock('../server/db/connection.js', () => ({
  getDb: () => db,
  closeDb: () => {
    db?.close();
  },
}));

vi.mock('multer', () => {
  const MB = 1024 * 1024;
  const multer = () => ({
    array: () => (req: { files?: unknown[] }, _res: unknown, next: (err?: Error) => void) => {
      // Simulate multer's LIMIT_FILE_SIZE error for oversized files
      const oversized = mockFiles.some((f) => f.size > 10 * MB);
      if (oversized) {
        const err = Object.assign(new Error('File too large'), { code: 'LIMIT_FILE_SIZE' });
        next(err);
        return;
      }
      req.files = mockFiles;
      next();
    },
  });

  return {
    default: Object.assign(multer, {
      diskStorage: (config: unknown) => config,
    }),
  };
});

const { default: uploadRoutes } = await import('../server/routes/uploads.js');
const { errorHandler } = await import('../server/middleware/error-handler.js');

class MockResponse extends Writable {
  statusCode = 200;
  headers = new Map<string, string>();
  body = Buffer.alloc(0);
  private chunks: Buffer[] = [];
  private doneResolver!: () => void;
  done = new Promise<void>((resolve) => {
    this.doneResolver = resolve;
  });

  // eslint-disable-next-line @typescript-eslint/class-methods-use-this
  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  json(payload: unknown): this {
    this.setHeader('content-type', 'application/json');
    this.end(Buffer.from(JSON.stringify(payload)));
    return this;
  }

  override end(chunk?: string | Buffer): this {
    if (chunk) {
      this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    this.body = Buffer.concat(this.chunks);
    super.end();
    this.doneResolver();
    return this;
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    callback();
  }
}

function seedPipeline(): void {
  db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)')
    .run('p1', 'Pipeline', 'queued', '2024-01-01');
}

function seedTask(status = 'queued'): void {
  db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)')
    .run('agent-1', 'QA Agent', 'prompt');
  db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)')
    .run('p1', 'Pipeline', 'queued', '2024-01-01');
  db.prepare(
    'INSERT INTO tasks (id, pipeline_id, name, agent_id, model, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('t1', 'p1', 'Attachment Task', 'agent-1', 'claude', 'auto', status, 0, 'input', 0);
}

function uploadRoot(): string {
  return join(process.cwd(), 'data', 'uploads');
}

function stageMockFile(
  filename: string,
  body: string | Uint8Array,
  contentType: string,
): void {
  const stagingPath = join(uploadRoot(), '_staging', filename);
  mkdirSync(join(uploadRoot(), '_staging'), { recursive: true });
  writeFileSync(stagingPath, body);
  mockFiles = [
    {
      originalname: filename,
      filename,
      mimetype: contentType,
      size: typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength,
      path: stagingPath,
    },
  ];
}

function getHandlers(method: 'delete' | 'get' | 'post', path: string): Array<(...args: unknown[]) => unknown> {
  const layer = (
    uploadRoutes as unknown as {
      stack: Array<{
        route?: {
          path: string;
          methods: Record<string, boolean>;
          stack: Array<{ handle: (...args: unknown[]) => unknown }>;
        };
      }>;
    }
  ).stack.find((item) => item.route?.path === path && item.route.methods[method]);

  if (!layer?.route) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }

  return layer.route.stack.map((item) => item.handle);
}

async function invokeRoute(
  method: 'delete' | 'get' | 'post',
  path: string,
  req: {
    body?: Record<string, unknown>;
    files?: unknown[];
    params?: Record<string, string>;
    query?: Record<string, string>;
  },
): Promise<MockResponse> {
  const handlers = getHandlers(method, path);
  const res = new MockResponse();
  const request = {
    body: {},
    files: [],
    params: {},
    query: {},
    ...req,
  };

  for (const handler of handlers) {
    let nextCalled = false;

    try {
      const maybePromise = handler(
        request,
        res,
        (err?: Error) => {
          nextCalled = true;
          if (err) {
            errorHandler(err, request as never, res as never, (() => undefined) as never);
          }
        },
      );

      if (maybePromise && typeof (maybePromise as Promise<unknown>).then === 'function') {
        await maybePromise;
      }
    } catch (error) {
      errorHandler(error as Error, request as never, res as never, (() => undefined) as never);
    }

    if (!nextCalled || res.writableEnded) {
      break;
    }
  }

  if (!res.writableEnded) {
    await res.done;
  }

  return res;
}

describe('Upload Routes', () => {
  beforeEach(() => {
    db = createTestDb();
    // Only clean our own pipeline directory — avoid deleting _staging/ shared with parallel test files
    rmSync(join(uploadRoot(), 'p1'), { recursive: true, force: true });
    mockFiles = [];
  });

  afterEach(() => {
    db.close();
    rmSync(join(uploadRoot(), 'p1'), { recursive: true, force: true });
  });

  it('uploads a file, persists metadata, and streams it back', async () => {
    seedTask();
    stageMockFile('report-final.txt', 'hello upload', 'text/plain');

    const uploadRes = await invokeRoute('post', '/uploads', {
      body: {
        targetType: 'task',
        targetId: 't1',
        pipelineId: 'p1',
      },
    });

    expect(uploadRes.statusCode).toBe(201);
    const payload = JSON.parse(uploadRes.body.toString('utf8')) as {
      attachments: Array<{
        id: string;
        filename: string;
        originalName: string;
        mimeType: string;
      }>;
    };

    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0]?.originalName).toBe('report-final.txt');
    expect(payload.attachments[0]?.mimeType).toBe('text/plain');

    const storedFile = join(uploadRoot(), 'p1', payload.attachments[0]!.filename);
    expect(existsSync(storedFile)).toBe(true);
    expect(readFileSync(storedFile, 'utf8')).toBe('hello upload');

    const listRes = await invokeRoute('get', '/uploads', {
      query: { targetType: 'task', targetId: 't1' },
    });
    const listPayload = JSON.parse(listRes.body.toString('utf8')) as {
      attachments: Array<{ id: string }>;
    };

    expect(listPayload.attachments).toHaveLength(1);
    expect(listPayload.attachments[0]?.id).toBe(payload.attachments[0]?.id);

    const downloadRes = await invokeRoute('get', '/uploads/:id', {
      params: { id: payload.attachments[0]!.id },
      query: { download: 'true' },
    });

    expect(downloadRes.statusCode).toBe(200);
    expect(downloadRes.headers.get('content-type')).toContain('text/plain');
    expect(downloadRes.headers.get('content-disposition')).toContain(
      'attachment; filename="report-final.txt"',
    );
    expect(downloadRes.body.toString('utf8')).toBe('hello upload');
  });

  it('rejects uploads for missing task ids', async () => {
    db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)')
      .run('p1', 'Pipeline', 'queued', '2024-01-01');
    stageMockFile('missing-task.txt', 'hello upload', 'text/plain');

    const res = await invokeRoute('post', '/uploads', {
      body: {
        targetType: 'task',
        targetId: 'missing-task',
        pipelineId: 'p1',
      },
    });

    expect(res.statusCode).toBe(404);
  });

  it('blocks uploads when the task is already running', async () => {
    seedTask('running');
    stageMockFile('running.txt', 'hello upload', 'text/plain');

    const res = await invokeRoute('post', '/uploads', {
      body: {
        targetType: 'task',
        targetId: 't1',
        pipelineId: 'p1',
      },
    });

    expect(res.statusCode).toBe(409);
  });

  it('returns a clear 413 response for oversized uploads', async () => {
    seedTask();
    const bigPayload = new Uint8Array(10 * 1024 * 1024 + 1);
    bigPayload.fill(65);
    stageMockFile('too-large.bin', bigPayload, 'application/octet-stream');

    const res = await invokeRoute('post', '/uploads', {
      body: {
        targetType: 'task',
        targetId: 't1',
        pipelineId: 'p1',
      },
    });

    expect(res.statusCode).toBe(413);
    const body = JSON.parse(res.body.toString('utf8')) as { error: string };
    expect(body.error).toMatch(/too large|10 mb/i);
  });

  // ── Pipeline upload tests ──────────────────────────────────────────────────

  it('rejects pipeline upload when the pipeline does not exist', async () => {
    stageMockFile('plan.md', '# Plan', 'text/markdown');

    const res = await invokeRoute('post', '/uploads', {
      body: {
        targetType: 'pipeline',
        targetId: 'nonexistent-pipeline',
        pipelineId: 'nonexistent-pipeline',
      },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body.toString('utf8')) as { error: string };
    expect(body.error).toMatch(/pipeline not found/i);
  });

  it('accepts a pipeline upload and returns 201 with attachment metadata', async () => {
    seedPipeline();
    stageMockFile('spec.md', '# Spec\n\nBuild it.', 'text/markdown');

    const res = await invokeRoute('post', '/uploads', {
      body: {
        targetType: 'pipeline',
        targetId: 'p1',
        pipelineId: 'p1',
      },
    });

    expect(res.statusCode).toBe(201);
    const payload = JSON.parse(res.body.toString('utf8')) as {
      attachments: Array<{ id: string; targetType: string; targetId: string; originalName: string }>;
    };
    expect(payload.attachments).toHaveLength(1);
    expect(payload.attachments[0]?.targetType).toBe('pipeline');
    expect(payload.attachments[0]?.targetId).toBe('p1');
    expect(payload.attachments[0]?.originalName).toBe('spec.md');
  });

  it('stores the pipeline attachment file on disk after upload', async () => {
    seedPipeline();
    stageMockFile('notes.txt', 'hello pipeline', 'text/plain');

    const res = await invokeRoute('post', '/uploads', {
      body: {
        targetType: 'pipeline',
        targetId: 'p1',
        pipelineId: 'p1',
      },
    });

    const payload = JSON.parse(res.body.toString('utf8')) as {
      attachments: Array<{ filename: string }>;
    };
    const storedFile = join(uploadRoot(), 'p1', payload.attachments[0]!.filename);
    expect(existsSync(storedFile)).toBe(true);
    expect(readFileSync(storedFile, 'utf8')).toBe('hello pipeline');
  });

  // ── GET /api/uploads/:id/content tests ────────────────────────────────────

  it('GET /uploads/:id/content returns text content for a text attachment', async () => {
    seedPipeline();
    const textBody = '# My Requirements\n\nDo stuff.';
    stageMockFile('req.md', textBody, 'text/markdown');

    const uploadRes = await invokeRoute('post', '/uploads', {
      body: { targetType: 'pipeline', targetId: 'p1', pipelineId: 'p1' },
    });
    const { attachments } = JSON.parse(uploadRes.body.toString('utf8')) as {
      attachments: Array<{ id: string }>;
    };
    const attachmentId = attachments[0]!.id;

    const contentRes = await invokeRoute('get', '/uploads/:id/content', {
      params: { id: attachmentId },
    });

    expect(contentRes.statusCode).toBe(200);
    const payload = JSON.parse(contentRes.body.toString('utf8')) as {
      id: string;
      content: string;
      truncated: boolean;
      originalName: string;
    };
    expect(payload.id).toBe(attachmentId);
    expect(payload.content).toBe(textBody);
    expect(payload.truncated).toBe(false);
    expect(payload.originalName).toBe('req.md');
  });

  it('GET /uploads/:id/content returns null content and note for an image', async () => {
    seedPipeline();
    stageMockFile('logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'image/png');

    const uploadRes = await invokeRoute('post', '/uploads', {
      body: { targetType: 'pipeline', targetId: 'p1', pipelineId: 'p1' },
    });
    const { attachments } = JSON.parse(uploadRes.body.toString('utf8')) as {
      attachments: Array<{ id: string }>;
    };

    const contentRes = await invokeRoute('get', '/uploads/:id/content', {
      params: { id: attachments[0]!.id },
    });

    expect(contentRes.statusCode).toBe(200);
    const payload = JSON.parse(contentRes.body.toString('utf8')) as {
      content: null;
      note: string;
    };
    expect(payload.content).toBeNull();
    expect(payload.note).toMatch(/image/i);
  });

  it('GET /uploads/:id/content returns 404 for a non-existent attachment', async () => {
    const res = await invokeRoute('get', '/uploads/:id/content', {
      params: { id: 'does-not-exist' },
    });
    expect(res.statusCode).toBe(404);
  });
});
