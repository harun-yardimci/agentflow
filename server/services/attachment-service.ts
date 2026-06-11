import { existsSync, mkdirSync, copyFileSync, renameSync, unlinkSync, readFileSync, readdirSync, rmSync } from 'fs';
import { join, extname, basename } from 'path';
import { randomUUID } from 'crypto';
import { getDb } from '../db/connection.js';
import { AppError } from '../middleware/error-handler.js';
import { logTimestamp } from '../lib/log-timestamp.js';

/**
 * Strip any path components from a user-supplied filename so it can never
 * escape the `.attachments/` directory. Defends against path traversal
 * (e.g. "../../.git/hooks/pre-commit") in the uploaded file's original name.
 */
export function sanitizeAttachmentName(name: string): string {
  // basename() drops directory segments on both posix/win separators after
  // normalizing backslashes; fall back to a safe default if nothing remains.
  const stripped = basename(name.replace(/\\/g, '/')).replace(/^\.+/, '');
  const cleaned = stripped.replace(/[/\0]/g, '').trim();
  return cleaned || 'attachment';
}

export interface AttachmentRow {
  id: string;
  target_type: string;
  target_id: string;
  pipeline_id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

/** Query attachments for a given target (task, message, or pipeline) */
export function getAttachmentsByTarget(
  targetType: 'task' | 'message' | 'pipeline',
  targetId: string,
): AttachmentRow[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM attachments WHERE target_type = ? AND target_id = ? ORDER BY created_at ASC'
  ).all(targetType, targetId) as AttachmentRow[];
}

/** Resolve the uploads directory path for a pipeline */
function uploadsDir(pipelineId: string): string {
  return join(process.cwd(), 'data', 'uploads', pipelineId);
}

/**
 * Copy task attachments into the worktree's `.attachments/` directory.
 * Uses original filenames for agent readability.
 * Returns the absolute path to the `.attachments/` directory.
 */
export function copyToWorktree(
  taskId: string,
  worktreePath: string,
): { dir: string; files: AttachmentRow[] } {
  const attachments = getAttachmentsByTarget('task', taskId);
  if (attachments.length === 0) {
    return { dir: '', files: [] };
  }

  const attachDir = join(worktreePath, '.attachments');
  if (!existsSync(attachDir)) {
    mkdirSync(attachDir, { recursive: true });
  }

  for (const att of attachments) {
    const src = join(uploadsDir(att.pipeline_id), att.filename);
    // Use original name for agent readability; sanitize to keep it inside
    // attachDir, then handle collisions with a suffix.
    let destName = sanitizeAttachmentName(att.original_name);
    let destPath = join(attachDir, destName);

    if (existsSync(destPath)) {
      const ext = extname(destName);
      const base = destName.slice(0, destName.length - ext.length);
      destName = `${base}_${att.id.slice(0, 8)}${ext}`;
      destPath = join(attachDir, destName);
    }

    if (existsSync(src)) {
      copyFileSync(src, destPath);
    }
  }

  return { dir: attachDir, files: attachments };
}

/**
 * Copy message-level attachments into an existing `.attachments/` directory.
 * Used during interactive mode when user responds with file attachments.
 * Returns the list of copied attachment rows.
 */
export function copyMessageAttachmentsToWorktree(
  controlRequestId: string,
  worktreePath: string,
): AttachmentRow[] {
  const attachments = getAttachmentsByTarget('message', controlRequestId);
  if (attachments.length === 0) return [];

  const attachDir = join(worktreePath, '.attachments');
  if (!existsSync(attachDir)) {
    mkdirSync(attachDir, { recursive: true });
  }

  for (const att of attachments) {
    const src = join(uploadsDir(att.pipeline_id), att.filename);
    let destName = sanitizeAttachmentName(att.original_name);
    let destPath = join(attachDir, destName);

    if (existsSync(destPath)) {
      const ext = extname(destName);
      const base = destName.slice(0, destName.length - ext.length);
      destName = `${base}_${att.id.slice(0, 8)}${ext}`;
      destPath = join(attachDir, destName);
    }

    if (existsSync(src)) {
      copyFileSync(src, destPath);
    }
  }

  return attachments;
}

/** Check if a MIME type is an image type */
export function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/** Format bytes to human-readable string */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Format a file reference path per provider conventions */
export function formatFileReference(originalName: string, provider: string): string {
  // Sanitize so the reference matches the on-disk copy and can't point outside
  // the worktree's `.attachments/` directory.
  const safe = sanitizeAttachmentName(originalName);
  // Gemini uses @path syntax to inject file content into prompt
  if (provider === 'gemini') {
    return `@.attachments/${safe}`;
  }
  // Claude and Codex just reference the path — agents read files from cwd
  return `.attachments/${safe}`;
}

/** Build a prompt with attachment context prepended, per provider conventions */
export function buildPromptWithAttachments(
  taskInput: string,
  attachments: AttachmentRow[],
  provider: string,
): string {
  if (attachments.length === 0) return taskInput;

  const fileList = attachments.map((a) => {
    const ref = formatFileReference(a.original_name, provider);
    return `- ${ref} (${a.mime_type}, ${formatBytes(a.size_bytes)})`;
  }).join('\n');

  const dirNote = provider === 'gemini'
    ? 'The following files are attached:'
    : 'The following files are attached in the .attachments/ directory:';

  return `${dirNote}\n${fileList}\n\n${taskInput}`;
}

/** Extract image file paths from attachments (relative to worktree) for --image flags */
export function getImageFilePaths(attachments: AttachmentRow[]): string[] {
  return attachments
    .filter((a) => isImageMime(a.mime_type))
    .map((a) => `.attachments/${a.original_name}`);
}

// ─── MIME & Size Validation ───

/** Blocked MIME types that should never be uploaded */
const BLOCKED_MIME_TYPES = [
  'application/x-msdownload',   // .exe
  'application/x-dosexec',      // .exe variant
  'application/x-msdos-program', // .com
  'application/x-msi',          // .msi
  'application/vnd.microsoft.portable-executable', // PE
  'application/x-sharedlib',    // .so
  'application/x-executable',   // Linux binary
  'application/x-mach-binary',  // macOS binary
];

/** Check if a MIME type is allowed for upload */
export function isAllowedMime(mimeType: string): boolean {
  return !BLOCKED_MIME_TYPES.includes(mimeType);
}

/** Max total attachment size per task: 50 MB */
export const MAX_TASK_TOTAL_SIZE = 50 * 1024 * 1024;

/** Max total attachment size per pipeline: 100 MB */
export const MAX_PIPELINE_TOTAL_SIZE = 100 * 1024 * 1024;

/** Get total attachment size in bytes for a given target */
export function getTargetTotalSize(targetType: string, targetId: string): number {
  const db = getDb();
  const row = db.prepare(
    'SELECT COALESCE(SUM(size_bytes), 0) as total FROM attachments WHERE target_type = ? AND target_id = ?'
  ).get(targetType, targetId) as { total: number };
  return row.total;
}

// ─── Upload CRUD (used by routes/uploads.ts) ───

/** Staging directory for multer temp files before they're moved to pipeline dir */
function stagingDir(): string {
  return join(process.cwd(), 'data', 'uploads', '_staging');
}

/** Get multer disk storage config — stores files in staging first */
export function getMulterStorageConfig(): multer.DiskStorageOptions {
  return {
    destination(_req, _file, cb) {
      const dir = stagingDir();
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      cb(null, dir);
    },
    filename(_req, file, cb) {
      const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const ext = extname(file.originalname);
      cb(null, `${uniqueSuffix}${ext}`);
    },
  };
}

// Type stub for multer's DiskStorageOptions (used only for return type annotation)
declare namespace multer {
  interface DiskStorageOptions {
    destination?: (
      req: unknown,
      file: unknown,
      cb: (error: Error | null, destination: string) => void,
    ) => void;
    filename?: (
      req: unknown,
      file: { originalname: string },
      cb: (error: Error | null, filename: string) => void,
    ) => void;
  }
}

/** Move a file from staging to the pipeline's upload directory */
export function moveFromStaging(filename: string, pipelineId: string): void {
  const src = join(stagingDir(), filename);
  const destDir = uploadsDir(pipelineId);
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }
  renameSync(src, join(destDir, filename));
}

/** Resolve the absolute file path for an uploaded attachment */
export function getFilePath(pipelineId: string, filename: string): string {
  return join(uploadsDir(pipelineId), filename);
}

interface FileInput {
  originalname: string;
  filename: string;
  mimetype: string;
  size: number;
  path: string;
}

/** Save attachment metadata to DB and return camelCase rows */
export function saveAttachments(
  files: FileInput[],
  targetType: string,
  targetId: string,
  pipelineId: string,
): AttachmentResponse[] {
  const db = getDb();
  const now = logTimestamp();
  const insert = db.prepare(
    'INSERT INTO attachments (id, target_type, target_id, pipeline_id, filename, original_name, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );

  const results: AttachmentResponse[] = [];
  for (const f of files) {
    const id = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const originalName = sanitizeAttachmentName(f.originalname);
    insert.run(id, targetType, targetId, pipelineId, f.filename, originalName, f.mimetype, f.size, now);
    results.push({
      id,
      targetType,
      targetId,
      pipelineId,
      filename: f.filename,
      originalName,
      mimeType: f.mimetype,
      sizeBytes: f.size,
      createdAt: now,
    });
  }

  return results;
}

export interface AttachmentResponse {
  id: string;
  targetType: string;
  targetId: string;
  pipelineId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

/** Convert a DB row to camelCase response */
function toCamelCase(row: AttachmentRow): AttachmentResponse {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    pipelineId: row.pipeline_id,
    filename: row.filename,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

/** List attachments for a target, returned in camelCase */
export function listAttachments(
  targetType: string,
  targetId: string,
): AttachmentResponse[] {
  const rows = getAttachmentsByTarget(
    targetType as 'task' | 'message' | 'pipeline',
    targetId,
  );
  return rows.map(toCamelCase);
}

/** List ALL attachments belonging to a pipeline (task + pipeline + message scoped) */
export function listAllPipelineAttachments(pipelineId: string): AttachmentResponse[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM attachments WHERE pipeline_id = ? ORDER BY created_at ASC'
  ).all(pipelineId) as AttachmentRow[];
  return rows.map(toCamelCase);
}

/** Get a single attachment by ID, camelCase */
export function getAttachment(id: string): AttachmentResponse {
  const db = getDb();
  const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as AttachmentRow | undefined;
  if (!row) throw new AppError(404, 'Attachment not found');
  return toCamelCase(row);
}

/** Delete an attachment — removes DB row and file from disk */
export function deleteAttachment(id: string): { deleted: true } {
  const db = getDb();
  const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as AttachmentRow | undefined;
  if (!row) throw new AppError(404, 'Attachment not found');

  // Remove file from disk
  const filePath = getFilePath(row.pipeline_id, row.filename);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }


  db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
  return { deleted: true };
}

/** Delete all attachments for a specific target (e.g. when deleting a task) */
export function deleteByTarget(targetType: string, targetId: string): void {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM attachments WHERE target_type = ? AND target_id = ?'
  ).all(targetType, targetId) as AttachmentRow[];

  for (const row of rows) {
    const filePath = getFilePath(row.pipeline_id, row.filename);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }

  db.prepare('DELETE FROM attachments WHERE target_type = ? AND target_id = ?').run(targetType, targetId);
}

/** Delete all attachments for an entire pipeline (used on pipeline deletion) */
export function deleteByPipeline(pipelineId: string): void {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM attachments WHERE pipeline_id = ?'
  ).all(pipelineId) as AttachmentRow[];

  for (const row of rows) {
    const filePath = getFilePath(row.pipeline_id, row.filename);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }

  // Remove pipeline uploads directory
  const dir = uploadsDir(pipelineId);
  try { if (existsSync(dir)) rmSync(dir, { recursive: true }); } catch { /* */ }

  db.prepare('DELETE FROM attachments WHERE pipeline_id = ?').run(pipelineId);
}

// ─── Text Content Extraction (used by /api/uploads/:id/content) ───

const TEXT_MIME_TYPES = [
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
  'application/x-yaml',
  'application/toml',
  'application/sql',
  'application/graphql',
  'application/x-sh',
];

/** Check if a MIME type represents a text-readable file */
export function isTextMime(mimeType: string): boolean {
  if (mimeType.startsWith('text/')) return true;
  return TEXT_MIME_TYPES.includes(mimeType);
}

const MAX_TEXT_SIZE = 32 * 1024; // 32KB per file

export interface TextContentResponse {
  id: string;
  originalName: string;
  mimeType: string;
  content: string | null;
  truncated: boolean;
  note?: string;
}

/** Read the text content of an attachment for prompt injection */
export function getTextContent(id: string): TextContentResponse {
  const att = getAttachment(id);
  const filePath = getFilePath(att.pipelineId, att.filename);

  if (!existsSync(filePath)) {
    throw new AppError(404, 'File not found on disk');
  }

  if (isTextMime(att.mimeType)) {
    const raw = readFileSync(filePath, 'utf-8');
    const truncated = raw.length > MAX_TEXT_SIZE;
    const content = truncated ? raw.slice(0, MAX_TEXT_SIZE) : raw;
    return {
      id: att.id,
      originalName: att.originalName,
      mimeType: att.mimeType,
      content,
      truncated,
    };
  }

  if (isImageMime(att.mimeType)) {
    return {
      id: att.id,
      originalName: att.originalName,
      mimeType: att.mimeType,
      content: null,
      truncated: false,
      note: 'Image file — will be copied to worktree for agent access',
    };
  }

  return {
    id: att.id,
    originalName: att.originalName,
    mimeType: att.mimeType,
    content: null,
    truncated: false,
    note: 'Binary file — not readable as text',
  };
}
