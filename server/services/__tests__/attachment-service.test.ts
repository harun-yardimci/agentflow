/**
 * Integration tests for pipeline attachment feature — new functions:
 *   - isTextMime: MIME-type detection for text-readable files
 *   - getTextContent: read up to 32 KB from text attachments for prompt injection
 *
 * These tests use an in-memory SQLite DB (via createTestDb) and write real files
 * into a temporary directory under data/uploads/<PIPELINE_ID>/ which is cleaned
 * up after every test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { createTestDb } from '../../../tests/helpers/test-db.js';

// ─── DB mock — must be hoisted before the service module is imported ──────────
let db: ReturnType<typeof createTestDb>;

vi.mock('../../db/connection.js', () => ({
  getDb: () => db,
  closeDb: () => db?.close(),
}));

// Dynamic import so the mock is in place first
const { isTextMime, getTextContent } = await import('../attachment-service.js');

// ─── Constants ────────────────────────────────────────────────────────────────
const PIPELINE_ID = 'p-content-qa';
const UPLOAD_DIR = join(process.cwd(), 'data', 'uploads', PIPELINE_ID);

// ─── Seed helpers ─────────────────────────────────────────────────────────────
function seedPipeline(d: Database.Database): void {
  d.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)')
    .run(PIPELINE_ID, 'Content QA Pipeline', 'queued', new Date().toISOString());
}

function insertAttachmentRow(
  d: Database.Database,
  opts: {
    id: string;
    filename: string;
    originalName: string;
    mimeType: string;
    targetType?: string;
    targetId?: string;
  },
): void {
  d.prepare(
    `INSERT INTO attachments
       (id, target_type, target_id, pipeline_id, filename, original_name, mime_type, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.id,
    opts.targetType ?? 'pipeline',
    opts.targetId ?? PIPELINE_ID,
    PIPELINE_ID,
    opts.filename,
    opts.originalName,
    opts.mimeType,
    1024,
    new Date().toISOString(),
  );
}

// ─── isTextMime ───────────────────────────────────────────────────────────────
describe('isTextMime()', () => {
  it.each([
    ['text/plain'],
    ['text/markdown'],
    ['text/html'],
    ['text/csv'],
    ['text/css'],
    ['text/xml'],
    ['text/x-python'],
    ['text/x-typescript'],
  ])('returns true for %s (text/* wildcard)', (mime) => {
    expect(isTextMime(mime)).toBe(true);
  });

  it.each([
    ['application/json'],
    ['application/xml'],
    ['application/javascript'],
    ['application/typescript'],
    ['application/x-yaml'],
    ['application/toml'],
    ['application/sql'],
    ['application/graphql'],
    ['application/x-sh'],
  ])('returns true for explicit allowlist type %s', (mime) => {
    expect(isTextMime(mime)).toBe(true);
  });

  it.each([
    ['image/png'],
    ['image/jpeg'],
    ['image/gif'],
    ['image/webp'],
    ['image/svg+xml'],
    ['application/octet-stream'],
    ['application/pdf'],
    ['application/zip'],
    ['application/gzip'],
    ['video/mp4'],
    ['audio/mpeg'],
  ])('returns false for %s', (mime) => {
    expect(isTextMime(mime)).toBe(false);
  });
});

// ─── getTextContent ───────────────────────────────────────────────────────────
describe('getTextContent()', () => {
  beforeEach(() => {
    db = createTestDb();
    seedPipeline(db);
    mkdirSync(UPLOAD_DIR, { recursive: true });
  });

  afterEach(() => {
    db.close();
    rmSync(UPLOAD_DIR, { recursive: true, force: true });
  });

  it('returns full content for a text file within the 32 KB limit', () => {
    const filename = 'requirements_abc123.md';
    const content = '# Requirements\n\nDo the thing.';
    writeFileSync(join(UPLOAD_DIR, filename), content, 'utf-8');
    insertAttachmentRow(db, {
      id: 'att-txt-1',
      filename,
      originalName: 'requirements.md',
      mimeType: 'text/markdown',
    });

    const result = getTextContent('att-txt-1');

    expect(result.id).toBe('att-txt-1');
    expect(result.originalName).toBe('requirements.md');
    expect(result.mimeType).toBe('text/markdown');
    expect(result.content).toBe(content);
    expect(result.truncated).toBe(false);
    expect(result.note).toBeUndefined();
  });

  it('truncates at 32 KB and sets truncated=true when file exceeds limit', () => {
    const filename = 'big_abc123.txt';
    const bigContent = 'x'.repeat(40 * 1024); // 40 KB
    writeFileSync(join(UPLOAD_DIR, filename), bigContent, 'utf-8');
    insertAttachmentRow(db, {
      id: 'att-big-1',
      filename,
      originalName: 'big.txt',
      mimeType: 'text/plain',
    });

    const result = getTextContent('att-big-1');

    expect(result.content).toHaveLength(32 * 1024);
    expect(result.truncated).toBe(true);
  });

  it('returns exactly 32 KB when file is precisely at the limit (not truncated)', () => {
    const filename = 'exact_abc123.txt';
    const exactContent = 'y'.repeat(32 * 1024); // exactly 32 KB
    writeFileSync(join(UPLOAD_DIR, filename), exactContent, 'utf-8');
    insertAttachmentRow(db, {
      id: 'att-exact-1',
      filename,
      originalName: 'exact.txt',
      mimeType: 'text/plain',
    });

    const result = getTextContent('att-exact-1');

    expect(result.content).toHaveLength(32 * 1024);
    expect(result.truncated).toBe(false);
  });

  it('returns application/json content as text (not truncated for small files)', () => {
    const filename = 'config_abc123.json';
    const jsonContent = '{"key": "value", "number": 42}';
    writeFileSync(join(UPLOAD_DIR, filename), jsonContent, 'utf-8');
    insertAttachmentRow(db, {
      id: 'att-json-1',
      filename,
      originalName: 'config.json',
      mimeType: 'application/json',
    });

    const result = getTextContent('att-json-1');

    expect(result.content).toBe(jsonContent);
    expect(result.truncated).toBe(false);
    expect(result.note).toBeUndefined();
  });

  it('returns null content and a worktree note for image files', () => {
    const filename = 'screenshot_abc123.png';
    writeFileSync(join(UPLOAD_DIR, filename), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    insertAttachmentRow(db, {
      id: 'att-img-1',
      filename,
      originalName: 'screenshot.png',
      mimeType: 'image/png',
    });

    const result = getTextContent('att-img-1');

    expect(result.id).toBe('att-img-1');
    expect(result.content).toBeNull();
    expect(result.truncated).toBe(false);
    expect(result.note).toMatch(/image/i);
    expect(result.note).toMatch(/worktree/i);
  });

  it('returns null content and a binary note for octet-stream files', () => {
    const filename = 'data_abc123.bin';
    writeFileSync(join(UPLOAD_DIR, filename), Buffer.from([0x00, 0x01, 0x02, 0x03]));
    insertAttachmentRow(db, {
      id: 'att-bin-1',
      filename,
      originalName: 'data.bin',
      mimeType: 'application/octet-stream',
    });

    const result = getTextContent('att-bin-1');

    expect(result.content).toBeNull();
    expect(result.truncated).toBe(false);
    expect(result.note).toMatch(/binary/i);
  });

  it('returns null content and a binary note for PDF files', () => {
    const filename = 'report_abc123.pdf';
    writeFileSync(join(UPLOAD_DIR, filename), Buffer.from('%PDF-1.4'));
    insertAttachmentRow(db, {
      id: 'att-pdf-1',
      filename,
      originalName: 'report.pdf',
      mimeType: 'application/pdf',
    });

    const result = getTextContent('att-pdf-1');

    expect(result.content).toBeNull();
    expect(result.note).toMatch(/binary/i);
  });

  it('throws 404 AppError when attachment ID does not exist in DB', () => {
    let caughtErr: unknown;
    try {
      getTextContent('nonexistent-id');
    } catch (err) {
      caughtErr = err;
    }
    expect(caughtErr).toBeDefined();
    expect((caughtErr as { statusCode: number }).statusCode).toBe(404);
    expect((caughtErr as Error).message).toMatch(/not found/i);
  });

  it('throws 404 AppError when attachment exists in DB but file is missing from disk', () => {
    // Insert DB row but do NOT create the actual file
    insertAttachmentRow(db, {
      id: 'att-ghost-1',
      filename: 'ghost_abc123.txt',
      originalName: 'ghost.txt',
      mimeType: 'text/plain',
    });

    let caughtErr: unknown;
    try {
      getTextContent('att-ghost-1');
    } catch (err) {
      caughtErr = err;
    }
    expect(caughtErr).toBeDefined();
    expect((caughtErr as { statusCode: number }).statusCode).toBe(404);
    expect((caughtErr as Error).message).toMatch(/not found/i);
  });
});
