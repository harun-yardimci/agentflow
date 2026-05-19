import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { createTestDb } from './helpers/test-db.js';

let db: Database.Database;

// Mock fs functions — must be hoisted before module under test is imported
const { mockExistsSync, mockUnlinkSync, mockMkdirSync, mockCopyFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockCopyFileSync: vi.fn(),
}));

vi.mock('../server/db/connection.js', () => ({
  getDb: () => db,
  closeDb: () => { db?.close(); },
}));

// BUG 6 fix: mock 'fs' (not 'node:fs') with named exports (not default)
// BUG 7 fix: mock copyFileSync (not cpSync)
vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  unlinkSync: mockUnlinkSync,
  mkdirSync: mockMkdirSync,
  copyFileSync: mockCopyFileSync,
  renameSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const {
  saveAttachments,
  listAttachments,
  getAttachment,
  deleteAttachment,
  deleteByTarget,
  deleteByPipeline,
  copyToWorktree,
  copyMessageAttachmentsToWorktree,
} = await import('../server/services/attachment-service.js');

const UPLOAD_BASE = join(process.cwd(), 'data', 'uploads');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// BUG 2 fix: multer-compatible interface (no `id` — generated internally)
interface FileInput {
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
  path: string;
}

function makeFile(overrides: Partial<FileInput> = {}): FileInput {
  return {
    filename: overrides.filename ?? 'disk_abc123.jpg',
    originalname: overrides.originalname ?? 'photo.jpg',
    mimetype: overrides.mimetype ?? 'image/jpeg',
    size: overrides.size ?? 1024,
    path: overrides.path ?? '/tmp/staging/disk_abc123.jpg',
  };
}

function insertAttachmentRow(
  d: Database.Database,
  fields: {
    id: string;
    targetType: 'task' | 'message';
    targetId: string;
    pipelineId: string;
    filename?: string;
    originalName?: string;
    sizeBytes?: number;
    createdAt?: string;
  },
): void {
  d.prepare(`
    INSERT INTO attachments
      (id, target_type, target_id, pipeline_id, filename, original_name, mime_type, size_bytes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fields.id,
    fields.targetType,
    fields.targetId,
    fields.pipelineId,
    fields.filename ?? 'file.jpg',
    fields.originalName ?? 'file.jpg',
    'image/jpeg',
    fields.sizeBytes ?? 1024,
    fields.createdAt ?? new Date().toISOString(),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Attachment Service', () => {
  beforeEach(() => {
    db = createTestDb();
    vi.clearAllMocks();
    // Default: existsSync returns true for upload paths, false for .attachments paths
    // This ensures delete tests call unlinkSync (file "exists") and copyToWorktree
    // creates the .attachments dir (doesn't "exist") while copying source files (they "exist")
    mockExistsSync.mockImplementation((p: unknown) => !String(p).includes('.attachments'));
    db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run('agent-1', 'Agent', 'prompt');
    db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run('p1', 'Pipeline 1', 'queued', new Date().toISOString());
    db.prepare(
      'INSERT INTO tasks (id, pipeline_id, name, agent_id, model, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('t1', 'p1', 'Task 1', 'agent-1', 'claude', 'auto', 'queued', 0, 'do it', 0);
  });

  afterEach(() => {
    db.close();
  });

  // -------------------------------------------------------------------------
  // BUG 1 fix: arg order is (files, targetType, targetId, pipelineId)
  // BUG 3 fix: removed 8 tests that assert validation living in the route layer
  // -------------------------------------------------------------------------
  describe('saveAttachments()', () => {
    it('saves metadata to DB and returns formatted attachments', () => {
      const result = saveAttachments([makeFile()], 'task', 't1', 'p1');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        targetType: 'task',
        targetId: 't1',
        pipelineId: 'p1',
        filename: 'disk_abc123.jpg',
        originalName: 'photo.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024,
      });
      expect(result[0]?.id).toMatch(/^att_/);
      expect(result[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    });

    it('persists rows in the attachments table', () => {
      const [att] = saveAttachments([makeFile()], 'task', 't1', 'p1');
      const row = db.prepare('SELECT id FROM attachments WHERE id = ?').get(att.id);
      expect(row).toBeTruthy();
    });

    it('saves multiple files in a single transactional call', () => {
      const files = [
        makeFile({ filename: 'a.jpg', originalname: 'a.jpg' }),
        makeFile({ filename: 'b.jpg', originalname: 'b.jpg' }),
      ];
      const result = saveAttachments(files, 'task', 't1', 'p1');
      expect(result).toHaveLength(2);
      const count = (db.prepare('SELECT COUNT(*) AS n FROM attachments').get() as { n: number }).n;
      expect(count).toBe(2);
    });

    it('returns empty array for empty files input', () => {
      expect(saveAttachments([], 'task', 't1', 'p1')).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('listAttachments()', () => {
    it('returns empty array when no attachments exist', () => {
      expect(listAttachments('task', 't1')).toHaveLength(0);
    });

    it('returns attachments for the target', () => {
      const [saved] = saveAttachments([makeFile()], 'task', 't1', 'p1');
      const result = listAttachments('task', 't1');
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(saved.id);
    });

    it('filters by targetType — task vs message are independent', () => {
      saveAttachments([makeFile()], 'task', 't1', 'p1');
      saveAttachments([makeFile({ filename: 'b.jpg' })], 'message', 'msg-1', 'p1');

      expect(listAttachments('task', 't1')).toHaveLength(1);
      expect(listAttachments('message', 'msg-1')).toHaveLength(1);
    });

    it('filters by targetId — different tasks do not bleed', () => {
      db.prepare(
        'INSERT INTO tasks (id, pipeline_id, name, agent_id, model, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('t2', 'p1', 'Task 2', 'agent-1', 'claude', 'auto', 'queued', 0, 'other', 1);

      const [att1] = saveAttachments([makeFile()], 'task', 't1', 'p1');
      saveAttachments([makeFile({ filename: 'b.jpg' })], 'task', 't2', 'p1');

      expect(listAttachments('task', 't1')).toHaveLength(1);
      expect(listAttachments('task', 't2')).toHaveLength(1);
      expect(listAttachments('task', 't1')[0]?.id).toBe(att1.id);
    });

    it('returns attachments ordered by created_at ASC', () => {
      insertAttachmentRow(db, { id: 'att-first', targetType: 'task', targetId: 't1', pipelineId: 'p1', createdAt: '2024-01-01T00:00:00.000Z' });
      insertAttachmentRow(db, { id: 'att-second', targetType: 'task', targetId: 't1', pipelineId: 'p1', createdAt: '2024-01-02T00:00:00.000Z' });

      const result = listAttachments('task', 't1');
      expect(result[0]?.id).toBe('att-first');
      expect(result[1]?.id).toBe('att-second');
    });

    it('maps snake_case DB columns to camelCase fields', () => {
      saveAttachments([makeFile()], 'task', 't1', 'p1');
      const [att] = listAttachments('task', 't1');
      expect(att).toHaveProperty('targetType');
      expect(att).toHaveProperty('targetId');
      expect(att).toHaveProperty('pipelineId');
      expect(att).toHaveProperty('originalName');
      expect(att).toHaveProperty('mimeType');
      expect(att).toHaveProperty('sizeBytes');
      expect(att).toHaveProperty('createdAt');
    });
  });

  // -------------------------------------------------------------------------
  describe('getAttachment()', () => {
    it('returns the attachment by ID', () => {
      const [saved] = saveAttachments([makeFile()], 'task', 't1', 'p1');
      const result = getAttachment(saved.id);
      expect(result.id).toBe(saved.id);
      expect(result.targetType).toBe('task');
      expect(result.pipelineId).toBe('p1');
    });

    it('throws 404 when attachment does not exist', () => {
      expect(() => getAttachment('nonexistent')).toThrow('not found');
    });

    it('throws AppError with statusCode 404', () => {
      try {
        getAttachment('missing');
        expect.fail('should have thrown');
      } catch (err: unknown) {
        expect((err as { statusCode: number }).statusCode).toBe(404);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('deleteAttachment()', () => {
    it('removes the DB row and returns { deleted: true }', () => {
      const [saved] = saveAttachments([makeFile()], 'task', 't1', 'p1');
      const result = deleteAttachment(saved.id);
      expect(result).toEqual({ deleted: true });
      expect(db.prepare('SELECT id FROM attachments WHERE id = ?').get(saved.id)).toBeUndefined();
    });

    it('calls fs.unlinkSync with the correct absolute path', () => {
      const [saved] = saveAttachments([makeFile({ filename: 'some_file.jpg' })], 'task', 't1', 'p1');
      deleteAttachment(saved.id);
      expect(mockUnlinkSync).toHaveBeenCalledOnce();
      expect(mockUnlinkSync).toHaveBeenCalledWith(join(UPLOAD_BASE, 'p1', 'some_file.jpg'));
    });

    it('does not call unlinkSync when the file is already gone from disk', () => {
      const [saved] = saveAttachments([makeFile()], 'task', 't1', 'p1');
      mockExistsSync.mockReturnValue(false);
      expect(() => deleteAttachment(saved.id)).not.toThrow();
      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });

    it('still removes the DB row when the file does not exist on disk', () => {
      const [saved] = saveAttachments([makeFile()], 'task', 't1', 'p1');
      mockExistsSync.mockReturnValue(false);
      deleteAttachment(saved.id);
      expect(db.prepare('SELECT id FROM attachments WHERE id = ?').get(saved.id)).toBeUndefined();
    });

    it('throws 404 when attachment is not in DB', () => {
      expect(() => deleteAttachment('nonexistent')).toThrow('not found');
    });

    it('throws AppError with statusCode 404 for missing attachment', () => {
      try {
        deleteAttachment('missing');
        expect.fail('should have thrown');
      } catch (err: unknown) {
        expect((err as { statusCode: number }).statusCode).toBe(404);
      }
    });

    it('does not call fs.unlinkSync when attachment is not found in DB', () => {
      try { deleteAttachment('missing'); } catch { /* expected */ }
      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('deleteByTarget()', () => {
    it('removes all DB rows for the target', () => {
      saveAttachments([
        makeFile({ filename: 'a.jpg' }),
        makeFile({ filename: 'b.jpg' }),
      ], 'task', 't1', 'p1');

      deleteByTarget('task', 't1');

      const count = (db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE target_id = ?').get('t1') as { n: number }).n;
      expect(count).toBe(0);
    });

    it('calls fs.unlinkSync once per file', () => {
      saveAttachments([
        makeFile({ filename: 'a.jpg' }),
        makeFile({ filename: 'b.jpg' }),
      ], 'task', 't1', 'p1');

      deleteByTarget('task', 't1');

      expect(mockUnlinkSync).toHaveBeenCalledTimes(2);
      expect(mockUnlinkSync).toHaveBeenCalledWith(join(UPLOAD_BASE, 'p1', 'a.jpg'));
      expect(mockUnlinkSync).toHaveBeenCalledWith(join(UPLOAD_BASE, 'p1', 'b.jpg'));
    });

    it('skips unlinkSync when files do not exist on disk', () => {
      saveAttachments([makeFile()], 'task', 't1', 'p1');
      mockExistsSync.mockReturnValue(false);
      expect(() => deleteByTarget('task', 't1')).not.toThrow();
      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });

    it('does not affect attachments belonging to other targets', () => {
      db.prepare(
        'INSERT INTO tasks (id, pipeline_id, name, agent_id, model, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('t2', 'p1', 'Task 2', 'agent-1', 'claude', 'auto', 'queued', 0, 'other', 1);

      saveAttachments([makeFile()], 'task', 't1', 'p1');
      const [att2] = saveAttachments([makeFile({ filename: 'b.jpg' })], 'task', 't2', 'p1');

      deleteByTarget('task', 't1');

      const remaining = db.prepare('SELECT id FROM attachments').all() as { id: string }[];
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.id).toBe(att2.id);
    });

    it('does nothing and does not throw when target has no attachments', () => {
      expect(() => deleteByTarget('task', 'no-such-task')).not.toThrow();
      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });

    it('distinguishes between task and message target types', () => {
      saveAttachments([makeFile()], 'task', 't1', 'p1');
      const [msgAtt] = saveAttachments([makeFile({ filename: 'b.jpg' })], 'message', 't1', 'p1');

      deleteByTarget('task', 't1');

      const remaining = db.prepare('SELECT id FROM attachments').all() as { id: string }[];
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.id).toBe(msgAtt.id);
    });
  });

  // -------------------------------------------------------------------------
  // BUG 4 fix: implementation uses unlinkSync per file, not rmSync on directory
  // -------------------------------------------------------------------------
  describe('deleteByPipeline()', () => {
    it('removes all DB rows for the pipeline', () => {
      saveAttachments([makeFile()], 'task', 't1', 'p1');
      deleteByPipeline('p1');
      const count = (db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE pipeline_id = ?').get('p1') as { n: number }).n;
      expect(count).toBe(0);
    });

    it('calls fs.unlinkSync for each file in the pipeline', () => {
      saveAttachments([
        makeFile({ filename: 'a.jpg' }),
        makeFile({ filename: 'b.jpg' }),
      ], 'task', 't1', 'p1');

      deleteByPipeline('p1');

      expect(mockUnlinkSync).toHaveBeenCalledTimes(2);
      expect(mockUnlinkSync).toHaveBeenCalledWith(join(UPLOAD_BASE, 'p1', 'a.jpg'));
      expect(mockUnlinkSync).toHaveBeenCalledWith(join(UPLOAD_BASE, 'p1', 'b.jpg'));
    });

    it('does not throw when files do not exist on disk', () => {
      saveAttachments([makeFile()], 'task', 't1', 'p1');
      mockExistsSync.mockReturnValue(false);
      expect(() => deleteByPipeline('p1')).not.toThrow();
      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });

    it('deletes rows across multiple targets in the same pipeline', () => {
      saveAttachments([makeFile()], 'task', 't1', 'p1');
      saveAttachments([makeFile({ filename: 'b.jpg' })], 'message', 'msg-1', 'p1');

      deleteByPipeline('p1');

      const count = (db.prepare('SELECT COUNT(*) AS n FROM attachments').get() as { n: number }).n;
      expect(count).toBe(0);
    });

    it('does nothing when pipeline has no attachments', () => {
      expect(() => deleteByPipeline('p1')).not.toThrow();
      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // BUG 5 fix: copyToWorktree(taskId, worktreePath) — 2 args, returns { dir, files }
  // -------------------------------------------------------------------------
  describe('copyToWorktree()', () => {
    it('returns { dir: "", files: [] } when task has no attachments', () => {
      const result = copyToWorktree('t1', '/tmp/worktree');
      expect(result).toEqual({ dir: '', files: [] });
    });

    it('does not touch the filesystem when there are no attachments', () => {
      copyToWorktree('t1', '/tmp/worktree');
      expect(mockMkdirSync).not.toHaveBeenCalled();
      expect(mockCopyFileSync).not.toHaveBeenCalled();
    });

    it('creates the .attachments directory with recursive flag', () => {
      saveAttachments([makeFile()], 'task', 't1', 'p1');
      copyToWorktree('t1', '/tmp/worktree');
      expect(mockMkdirSync).toHaveBeenCalledWith(join('/tmp/worktree', '.attachments'), { recursive: true });
    });

    it('copies file from upload storage using the original filename as destination', () => {
      saveAttachments([makeFile({ filename: 'disk_deadbeef.jpg', originalname: 'my-photo.jpg' })], 'task', 't1', 'p1');
      copyToWorktree('t1', '/tmp/worktree');

      expect(mockCopyFileSync).toHaveBeenCalledOnce();
      expect(mockCopyFileSync).toHaveBeenCalledWith(
        join(UPLOAD_BASE, 'p1', 'disk_deadbeef.jpg'),
        join('/tmp/worktree', '.attachments', 'my-photo.jpg'),
      );
    });

    it('copies all attachments when multiple files are present', () => {
      saveAttachments([
        makeFile({ filename: 'disk_a.jpg', originalname: 'report.jpg' }),
        makeFile({ filename: 'disk_b.pdf', originalname: 'notes.pdf' }),
      ], 'task', 't1', 'p1');

      copyToWorktree('t1', '/tmp/worktree');

      expect(mockCopyFileSync).toHaveBeenCalledTimes(2);
      expect(mockCopyFileSync).toHaveBeenCalledWith(
        join(UPLOAD_BASE, 'p1', 'disk_a.jpg'),
        join('/tmp/worktree', '.attachments', 'report.jpg'),
      );
      expect(mockCopyFileSync).toHaveBeenCalledWith(
        join(UPLOAD_BASE, 'p1', 'disk_b.pdf'),
        join('/tmp/worktree', '.attachments', 'notes.pdf'),
      );
    });

    it('returns the absolute path to the .attachments directory and file list', () => {
      saveAttachments([makeFile()], 'task', 't1', 'p1');
      const result = copyToWorktree('t1', '/my/worktree');
      expect(result.dir).toBe(join('/my/worktree', '.attachments'));
      expect(result.files).toHaveLength(1);
    });

    it('copies message attachments via copyMessageAttachmentsToWorktree', () => {
      saveAttachments([makeFile({ filename: 'disk_msg.png', originalname: 'screenshot.png' })], 'message', 'msg-1', 'p1');
      const result = copyMessageAttachmentsToWorktree('msg-1', '/tmp/worktree');
      expect(result).toHaveLength(1);
      expect(mockCopyFileSync).toHaveBeenCalledWith(
        join(UPLOAD_BASE, 'p1', 'disk_msg.png'),
        join('/tmp/worktree', '.attachments', 'screenshot.png'),
      );
    });

    it('only copies attachments belonging to the specified task', () => {
      db.prepare(
        'INSERT INTO tasks (id, pipeline_id, name, agent_id, model, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run('t2', 'p1', 'Task 2', 'agent-1', 'claude', 'auto', 'queued', 0, 'other', 1);

      saveAttachments([makeFile({ filename: 'for_t1.jpg', originalname: 'for_t1.jpg' })], 'task', 't1', 'p1');
      saveAttachments([makeFile({ filename: 'for_t2.jpg', originalname: 'for_t2.jpg' })], 'task', 't2', 'p1');

      copyToWorktree('t1', '/tmp/worktree');

      expect(mockCopyFileSync).toHaveBeenCalledOnce();
      expect(mockCopyFileSync).toHaveBeenCalledWith(
        join(UPLOAD_BASE, 'p1', 'for_t1.jpg'),
        join('/tmp/worktree', '.attachments', 'for_t1.jpg'),
      );
    });
  });
});
