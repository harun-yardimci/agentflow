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

// Mock pipeline-runner to avoid worker pool initialization
vi.mock('../server/engine/pipeline-runner.js', () => ({
  resumeTask: () => undefined,
}));

const { default: taskRoutes } = await import('../server/routes/tasks.js');
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

// Use a unique pipeline ID to avoid filesystem races with uploads-routes.test.ts
const PIPELINE_ID = 'p_ta';

function seedTask(status = 'queued'): void {
  db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)')
    .run('agent-1', 'QA Agent', 'prompt');
  db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)')
    .run(PIPELINE_ID, 'Pipeline', 'queued', '2024-01-01');
  db.prepare(
    'INSERT INTO tasks (id, pipeline_id, name, agent_id, model, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('t1', PIPELINE_ID, 'Test Task', 'agent-1', 'claude', 'auto', status, 0, 'input', 0);
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

function stageMockFiles(
  files: Array<{ name: string; body: string | Uint8Array; mime: string }>,
): void {
  mockFiles = files.map((f) => {
    const stagingPath = join(uploadRoot(), '_staging', f.name);
    mkdirSync(join(uploadRoot(), '_staging'), { recursive: true });
    writeFileSync(stagingPath, f.body);
    return {
      originalname: f.name,
      filename: f.name,
      mimetype: f.mime,
      size: typeof f.body === 'string' ? Buffer.byteLength(f.body) : f.body.byteLength,
      path: stagingPath,
    };
  });
}

function getHandlers(method: 'delete' | 'get' | 'post', path: string): Array<(...args: unknown[]) => unknown> {
  const layer = (
    taskRoutes as unknown as {
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

describe('Task Attachment Routes', () => {
  beforeEach(() => {
    db = createTestDb();
    // Only clean our own pipeline directory — avoid deleting _staging/ shared with parallel test files
    rmSync(join(uploadRoot(), PIPELINE_ID), { recursive: true, force: true });
    mockFiles = [];
  });

  afterEach(() => {
    db.close();
    rmSync(join(uploadRoot(), PIPELINE_ID), { recursive: true, force: true });
  });

  // ── GET /tasks/:id/attachments ───────────────────────────────────────────

  describe('GET /tasks/:id/attachments', () => {
    it('returns empty array for a task with no attachments', async () => {
      seedTask();
      const res = await invokeRoute('get', '/tasks/:id/attachments', {
        params: { id: 't1' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body.toString('utf8')) as { attachments: unknown[] };
      expect(body.attachments).toHaveLength(0);
    });

    it('returns 404 for a non-existent task', async () => {
      const res = await invokeRoute('get', '/tasks/:id/attachments', {
        params: { id: 'nonexistent' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('lists attachments after upload', async () => {
      seedTask();
      stageMockFile('readme.md', '# Hello', 'text/markdown');

      await invokeRoute('post', '/tasks/:id/attachments', {
        params: { id: 't1' },
      });

      const res = await invokeRoute('get', '/tasks/:id/attachments', {
        params: { id: 't1' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body.toString('utf8')) as {
        attachments: Array<{ originalName: string; targetType: string; targetId: string }>;
      };
      expect(body.attachments).toHaveLength(1);
      expect(body.attachments[0]?.originalName).toBe('readme.md');
      expect(body.attachments[0]?.targetType).toBe('task');
      expect(body.attachments[0]?.targetId).toBe('t1');
    });
  });

  // ── POST /tasks/:id/attachments ──────────────────────────────────────────

  describe('POST /tasks/:id/attachments', () => {
    it('uploads a file to a task and returns 201', async () => {
      seedTask();
      stageMockFile('spec.txt', 'Build a feature', 'text/plain');

      const res = await invokeRoute('post', '/tasks/:id/attachments', {
        params: { id: 't1' },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body.toString('utf8')) as {
        attachments: Array<{ id: string; originalName: string; mimeType: string }>;
      };
      expect(body.attachments).toHaveLength(1);
      expect(body.attachments[0]?.originalName).toBe('spec.txt');
      expect(body.attachments[0]?.mimeType).toBe('text/plain');
    });

    it('stores the file on disk in the pipeline directory', async () => {
      seedTask();
      stageMockFile('data.csv', 'a,b,c\n1,2,3', 'text/csv');

      const res = await invokeRoute('post', '/tasks/:id/attachments', {
        params: { id: 't1' },
      });

      const body = JSON.parse(res.body.toString('utf8')) as {
        attachments: Array<{ filename: string }>;
      };
      const storedPath = join(uploadRoot(), PIPELINE_ID, body.attachments[0]!.filename);
      expect(existsSync(storedPath)).toBe(true);
      expect(readFileSync(storedPath, 'utf8')).toBe('a,b,c\n1,2,3');
    });

    it('returns 404 for a non-existent task', async () => {
      seedTask();
      stageMockFile('file.txt', 'content', 'text/plain');

      const res = await invokeRoute('post', '/tasks/:id/attachments', {
        params: { id: 'nonexistent' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 409 for a running task', async () => {
      seedTask('running');
      stageMockFile('file.txt', 'content', 'text/plain');

      const res = await invokeRoute('post', '/tasks/:id/attachments', {
        params: { id: 't1' },
      });

      expect(res.statusCode).toBe(409);
    });

    it('returns 400 when no files are provided', async () => {
      seedTask();
      mockFiles = [];

      const res = await invokeRoute('post', '/tasks/:id/attachments', {
        params: { id: 't1' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 415 for blocked MIME type (executable)', async () => {
      seedTask();
      stageMockFile('malware.exe', 'MZ...', 'application/x-msdownload');

      const res = await invokeRoute('post', '/tasks/:id/attachments', {
        params: { id: 't1' },
      });

      expect(res.statusCode).toBe(415);
      const body = JSON.parse(res.body.toString('utf8')) as { error: string };
      expect(body.error).toMatch(/unsupported file type/i);
    });

    it('returns 413 when aggregate size exceeds 50 MB task limit', async () => {
      seedTask();

      // Insert a large existing attachment (49 MB)
      db.prepare(
        'INSERT INTO attachments (id, target_type, target_id, pipeline_id, filename, original_name, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run('att-existing', 'task', 't1', PIPELINE_ID, 'big.bin', 'big.bin', 'application/octet-stream', 49 * 1024 * 1024, '2024-01-01');

      // Try to upload another 2 MB (would exceed 50 MB)
      const twoMB = new Uint8Array(2 * 1024 * 1024);
      twoMB.fill(65);
      stageMockFile('extra.bin', twoMB, 'application/octet-stream');

      const res = await invokeRoute('post', '/tasks/:id/attachments', {
        params: { id: 't1' },
      });

      expect(res.statusCode).toBe(413);
      const body = JSON.parse(res.body.toString('utf8')) as { error: string };
      expect(body.error).toMatch(/50 mb/i);
    });

    it('returns 413 when a single file exceeds the 10 MB per-file limit', async () => {
      seedTask();
      stageMockFile(
        'too-large.bin',
        new Uint8Array(11 * 1024 * 1024),
        'application/octet-stream',
      );

      const res = await invokeRoute('post', '/tasks/:id/attachments', {
        params: { id: 't1' },
      });

      expect(res.statusCode).toBe(413);
      const body = JSON.parse(res.body.toString('utf8')) as { error: string };
      expect(body.error).toMatch(/10 mb per-file limit/i);
    });

    it('accepts multiple files in a single upload', async () => {
      seedTask();
      stageMockFiles([
        { name: 'file1.txt', body: 'content 1', mime: 'text/plain' },
        { name: 'file2.md', body: '# Title', mime: 'text/markdown' },
      ]);

      const res = await invokeRoute('post', '/tasks/:id/attachments', {
        params: { id: 't1' },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body.toString('utf8')) as {
        attachments: Array<{ originalName: string }>;
      };
      expect(body.attachments).toHaveLength(2);
    });
  });

  // ── DELETE /tasks/:id/attachments/:attId ─────────────────────────────────

  describe('DELETE /tasks/:id/attachments/:attId', () => {
    it('deletes an attachment belonging to the task', async () => {
      seedTask();
      stageMockFile('to-delete.txt', 'delete me', 'text/plain');

      const uploadRes = await invokeRoute('post', '/tasks/:id/attachments', {
        params: { id: 't1' },
      });
      const { attachments } = JSON.parse(uploadRes.body.toString('utf8')) as {
        attachments: Array<{ id: string; filename: string }>;
      };
      const attId = attachments[0]!.id;

      const deleteRes = await invokeRoute('delete', '/tasks/:id/attachments/:attId', {
        params: { id: 't1', attId },
      });

      expect(deleteRes.statusCode).toBe(200);
      const body = JSON.parse(deleteRes.body.toString('utf8')) as { deleted: boolean };
      expect(body.deleted).toBe(true);

      // Verify it's gone from the list
      const listRes = await invokeRoute('get', '/tasks/:id/attachments', {
        params: { id: 't1' },
      });
      const listBody = JSON.parse(listRes.body.toString('utf8')) as { attachments: unknown[] };
      expect(listBody.attachments).toHaveLength(0);
    });

    it('returns 404 for a non-existent attachment', async () => {
      seedTask();

      const res = await invokeRoute('delete', '/tasks/:id/attachments/:attId', {
        params: { id: 't1', attId: 'nonexistent' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 404 when attachment belongs to a different task', async () => {
      seedTask();

      // Create a second task
      db.prepare(
        'INSERT INTO tasks (id, pipeline_id, name, agent_id, model, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('t2', PIPELINE_ID, 'Other Task', 'agent-1', 'claude', 'auto', 'queued', 0, 'input', 1);

      // Upload to t2
      stageMockFile('other.txt', 'belongs to t2', 'text/plain');
      const uploadRes = await invokeRoute('post', '/tasks/:id/attachments', {
        params: { id: 't2' },
      });
      const { attachments } = JSON.parse(uploadRes.body.toString('utf8')) as {
        attachments: Array<{ id: string }>;
      };

      // Try to delete via t1 (wrong task)
      const deleteRes = await invokeRoute('delete', '/tasks/:id/attachments/:attId', {
        params: { id: 't1', attId: attachments[0]!.id },
      });

      expect(deleteRes.statusCode).toBe(404);
      const body = JSON.parse(deleteRes.body.toString('utf8')) as { error: string };
      expect(body.error).toMatch(/not found on this task/i);
    });
  });

  // ── GET /attachments/:id/download ────────────────────────────────────────

  describe('GET /attachments/:id/download', () => {
    it('streams the file back with Content-Disposition: attachment', async () => {
      seedTask();
      stageMockFile('report.txt', 'Hello download', 'text/plain');

      const uploadRes = await invokeRoute('post', '/tasks/:id/attachments', {
        params: { id: 't1' },
      });
      const { attachments } = JSON.parse(uploadRes.body.toString('utf8')) as {
        attachments: Array<{ id: string }>;
      };

      const downloadRes = await invokeRoute('get', '/attachments/:id/download', {
        params: { id: attachments[0]!.id },
      });

      await downloadRes.done;
      expect(downloadRes.statusCode).toBe(200);
      expect(downloadRes.headers.get('content-type')).toContain('text/plain');
      expect(downloadRes.headers.get('content-disposition')).toContain('attachment');
      expect(downloadRes.headers.get('content-disposition')).toContain('report.txt');
      expect(downloadRes.body.toString('utf8')).toBe('Hello download');
    });

    it('preserves special characters in attachment names during upload and download', async () => {
      seedTask();
      stageMockFile('Sprint Plan (Final)_v2.md', '# Final plan', 'text/markdown');

      const uploadRes = await invokeRoute('post', '/tasks/:id/attachments', {
        params: { id: 't1' },
      });
      const { attachments } = JSON.parse(uploadRes.body.toString('utf8')) as {
        attachments: Array<{ id: string; originalName: string }>;
      };

      expect(attachments[0]?.originalName).toBe('Sprint Plan (Final)_v2.md');

      const downloadRes = await invokeRoute('get', '/attachments/:id/download', {
        params: { id: attachments[0]!.id },
      });

      await downloadRes.done;
      expect(downloadRes.statusCode).toBe(200);
      expect(downloadRes.headers.get('content-disposition')).toContain(
        'Sprint Plan (Final)_v2.md',
      );
      expect(downloadRes.body.toString('utf8')).toBe('# Final plan');
    });

    it('returns 404 for a non-existent attachment', async () => {
      const res = await invokeRoute('get', '/attachments/:id/download', {
        params: { id: 'nonexistent' },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('task deletion cleanup', () => {
    it('removes task attachments once the task is deleted', async () => {
      seedTask();
      stageMockFile('cleanup.txt', 'temporary', 'text/plain');

      const uploadRes = await invokeRoute('post', '/tasks/:id/attachments', {
        params: { id: 't1' },
      });
      const { attachments } = JSON.parse(uploadRes.body.toString('utf8')) as {
        attachments: Array<{ id: string }>;
      };

      const deleteTaskRes = await invokeRoute('delete', '/tasks/:id', {
        params: { id: 't1' },
      });

      expect(deleteTaskRes.statusCode).toBe(200);

      const listRes = await invokeRoute('get', '/tasks/:id/attachments', {
        params: { id: 't1' },
      });
      expect(listRes.statusCode).toBe(404);

      const downloadRes = await invokeRoute('get', '/attachments/:id/download', {
        params: { id: attachments[0]!.id },
      });
      expect(downloadRes.statusCode).toBe(404);
    });
  });
});

// ── Attachment Service Validation Tests ────────────────────────────────────

describe('Attachment Service Validation', () => {
  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('isAllowedMime blocks executable MIME types', async () => {
    const { isAllowedMime } = await import('../server/services/attachment-service.js');

    expect(isAllowedMime('application/x-msdownload')).toBe(false);
    expect(isAllowedMime('application/x-dosexec')).toBe(false);
    expect(isAllowedMime('application/x-executable')).toBe(false);
    expect(isAllowedMime('application/x-mach-binary')).toBe(false);
  });

  it('isAllowedMime allows common file types', async () => {
    const { isAllowedMime } = await import('../server/services/attachment-service.js');

    expect(isAllowedMime('text/plain')).toBe(true);
    expect(isAllowedMime('text/markdown')).toBe(true);
    expect(isAllowedMime('image/png')).toBe(true);
    expect(isAllowedMime('application/json')).toBe(true);
    expect(isAllowedMime('application/pdf')).toBe(true);
    expect(isAllowedMime('application/octet-stream')).toBe(true);
  });

  it('getTargetTotalSize sums attachment sizes for a target', async () => {
    const { getTargetTotalSize } = await import('../server/services/attachment-service.js');

    db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)')
      .run('p1', 'Pipeline', 'queued', '2024-01-01');

    db.prepare(
      'INSERT INTO attachments (id, target_type, target_id, pipeline_id, filename, original_name, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('att-1', 'task', 't1', 'p1', 'f1.txt', 'f1.txt', 'text/plain', 1000, '2024-01-01');

    db.prepare(
      'INSERT INTO attachments (id, target_type, target_id, pipeline_id, filename, original_name, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('att-2', 'task', 't1', 'p1', 'f2.txt', 'f2.txt', 'text/plain', 2000, '2024-01-01');

    expect(getTargetTotalSize('task', 't1')).toBe(3000);
  });

  it('getTargetTotalSize returns 0 for target with no attachments', async () => {
    const { getTargetTotalSize } = await import('../server/services/attachment-service.js');

    expect(getTargetTotalSize('task', 'nonexistent')).toBe(0);
  });
});
