import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb } from './helpers/test-db.js';

let db: Database.Database;

const { mockReadFileSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
}));

vi.mock('../server/db/connection.js', () => ({
  getDb: () => db,
  closeDb: () => { db?.close(); },
}));

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
}));

const { isTextMime, buildAttachmentContext } = await import(
  '../server/services/breakdown-service.js'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function insertPipeline(id = 'p1') {
  db.prepare(
    'INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)'
  ).run(id, 'Test', 'running', '2024-01-01');
}

function insertAttachment(overrides: Partial<{
  id: string;
  targetType: string;
  targetId: string;
  pipelineId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}> = {}) {
  const row = {
    id: overrides.id ?? 'att-1',
    target_type: overrides.targetType ?? 'pipeline',
    target_id: overrides.targetId ?? 'p1',
    pipeline_id: overrides.pipelineId ?? 'p1',
    filename: overrides.filename ?? 'disk_abc.txt',
    original_name: overrides.originalName ?? 'readme.txt',
    mime_type: overrides.mimeType ?? 'text/plain',
    size_bytes: overrides.sizeBytes ?? 100,
    created_at: '2024-01-01T00:00:00Z',
  };
  db.prepare(
    `INSERT INTO attachments (id, target_type, target_id, pipeline_id, filename, original_name, mime_type, size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(row.id, row.target_type, row.target_id, row.pipeline_id, row.filename, row.original_name, row.mime_type, row.size_bytes, row.created_at);
  return row;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isTextMime', () => {
  it('returns true for text/* types', () => {
    expect(isTextMime('text/plain')).toBe(true);
    expect(isTextMime('text/html')).toBe(true);
    expect(isTextMime('text/csv')).toBe(true);
    expect(isTextMime('text/markdown')).toBe(true);
  });

  it('returns true for application text types', () => {
    expect(isTextMime('application/json')).toBe(true);
    expect(isTextMime('application/xml')).toBe(true);
    expect(isTextMime('application/javascript')).toBe(true);
    expect(isTextMime('application/typescript')).toBe(true);
    expect(isTextMime('application/x-yaml')).toBe(true);
    expect(isTextMime('application/toml')).toBe(true);
    expect(isTextMime('application/sql')).toBe(true);
    expect(isTextMime('application/graphql')).toBe(true);
    expect(isTextMime('application/x-sh')).toBe(true);
  });

  it('returns false for image types', () => {
    expect(isTextMime('image/png')).toBe(false);
    expect(isTextMime('image/jpeg')).toBe(false);
  });

  it('returns false for binary types', () => {
    expect(isTextMime('application/octet-stream')).toBe(false);
    expect(isTextMime('application/pdf')).toBe(false);
    expect(isTextMime('application/zip')).toBe(false);
  });
});

describe('buildAttachmentContext', () => {
  beforeEach(() => {
    db = createTestDb();
    insertPipeline();
    mockReadFileSync.mockReset();
  });

  afterEach(() => {
    db?.close();
  });

  it('returns empty string for empty array', () => {
    expect(buildAttachmentContext([])).toBe('');
  });

  it('returns empty string when no attachment IDs match', () => {
    expect(buildAttachmentContext(['nonexistent'])).toBe('');
  });

  it('injects text file content with code fences', () => {
    insertAttachment({ id: 'att-txt', mimeType: 'text/plain', originalName: 'notes.txt', sizeBytes: 42 });
    mockReadFileSync.mockReturnValue('Hello, world!');

    const result = buildAttachmentContext(['att-txt']);

    expect(result).toContain('## Attached Reference Files');
    expect(result).toContain('### notes.txt (text/plain, 42 B)');
    expect(result).toContain('```\nHello, world!\n```');
    expect(result).not.toContain('(truncated)');
  });

  it('preserves special characters in attachment labels', () => {
    insertAttachment({
      id: 'att-special',
      mimeType: 'text/markdown',
      originalName: 'Sprint Plan (Final)_v2.md',
      sizeBytes: 42,
    });
    mockReadFileSync.mockReturnValue('# Plan');

    const result = buildAttachmentContext(['att-special']);

    expect(result).toContain('### Sprint Plan (Final)_v2.md (text/markdown, 42 B)');
    expect(result).toContain('```\n# Plan\n```');
  });

  it('truncates text files exceeding 32KB per-file limit', () => {
    insertAttachment({ id: 'att-big', mimeType: 'text/plain', originalName: 'big.txt', sizeBytes: 50000 });
    const bigContent = 'x'.repeat(50000);
    mockReadFileSync.mockReturnValue(bigContent);

    const result = buildAttachmentContext(['att-big']);

    expect(result).toContain('(truncated)');
    // Content should be sliced to 32KB
    const codeBlockMatch = result.match(/```\n([\s\S]*?)\n```/);
    expect(codeBlockMatch).toBeTruthy();
    expect(codeBlockMatch![1].length).toBe(32 * 1024);
  });

  it('enforces 128KB total budget across multiple files', () => {
    // Create 5 files of 30KB each = 150KB total, should stop after 128KB
    for (let i = 0; i < 5; i++) {
      insertAttachment({
        id: `att-${i}`,
        filename: `f${i}.txt`,
        originalName: `file${i}.txt`,
        mimeType: 'text/plain',
        sizeBytes: 30000,
      });
    }
    mockReadFileSync.mockReturnValue('y'.repeat(30000));

    const result = buildAttachmentContext(['att-0', 'att-1', 'att-2', 'att-3', 'att-4']);

    // First 4 files: 4*30KB = 120KB, 5th gets remaining 8KB (128-120)
    // Count section headers to verify all 5 files are present
    const headers = result.match(/### file\d\.txt/g);
    expect(headers).toBeTruthy();
    expect(headers!.length).toBe(5);
    // Last file should be truncated
    expect(result).toContain('(truncated)');
  });

  it('handles image attachments with runtime access note', () => {
    insertAttachment({ id: 'att-img', mimeType: 'image/png', originalName: 'screenshot.png', sizeBytes: 204800 });

    const result = buildAttachmentContext(['att-img']);

    expect(result).toContain('### screenshot.png (image/png, 200.0 KB)');
    expect(result).toContain('.attachments/ directory at runtime');
    expect(result).not.toContain('```');
  });

  it('handles binary attachments with filename only', () => {
    insertAttachment({ id: 'att-bin', mimeType: 'application/pdf', originalName: 'spec.pdf', sizeBytes: 1048576 });

    const result = buildAttachmentContext(['att-bin']);

    expect(result).toContain('### spec.pdf (application/pdf, 1.0 MB)');
    expect(result).toContain('Binary file');
    expect(result).not.toContain('```');
  });

  it('handles mixed attachment types', () => {
    insertAttachment({ id: 'att-t', mimeType: 'application/json', originalName: 'config.json', sizeBytes: 256 });
    insertAttachment({ id: 'att-i', mimeType: 'image/jpeg', originalName: 'photo.jpg', sizeBytes: 500000 });
    insertAttachment({ id: 'att-b', mimeType: 'application/zip', originalName: 'archive.zip', sizeBytes: 2000000 });
    mockReadFileSync.mockReturnValue('{"key": "value"}');

    const result = buildAttachmentContext(['att-t', 'att-i', 'att-b']);

    expect(result).toContain('## Attached Reference Files');
    expect(result).toContain('config.json');
    expect(result).toContain('```\n{"key": "value"}\n```');
    expect(result).toContain('photo.jpg');
    expect(result).toContain('Image file');
    expect(result).toContain('archive.zip');
    expect(result).toContain('Binary file');
    expect(result).toContain('---');
  });

  it('handles file read errors gracefully', () => {
    insertAttachment({ id: 'att-err', mimeType: 'text/plain', originalName: 'missing.txt', sizeBytes: 100 });
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const result = buildAttachmentContext(['att-err']);

    expect(result).toContain('### missing.txt');
    expect(result).toContain('[File could not be read]');
  });
});
