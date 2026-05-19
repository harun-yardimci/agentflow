import { Router } from 'express';
import { existsSync, createReadStream } from 'fs';
import multer from 'multer';
import { UploadQuerySchema, ListAttachmentsSchema } from '../types/api.js';
import * as attachmentService from '../services/attachment-service.js';
import { getDb } from '../db/connection.js';
import { AppError } from '../middleware/error-handler.js';

const router = Router();

// Configure multer with disk storage (staging directory)
const upload = multer({
  storage: multer.diskStorage(attachmentService.getMulterStorageConfig()),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB per file
    files: 10, // max 10 files per request
  },
});

/**
 * POST /api/uploads
 * Upload files for a task or message.
 * Content-Type: multipart/form-data
 * Fields: files (File[]), targetType, targetId, pipelineId
 */
router.post('/uploads', upload.array('files', 10), (req, res) => {
  // Validate form fields
  const parseResult = UploadQuerySchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: 'Validation failed',
      details: parseResult.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
    return;
  }

  const { targetType, targetId, pipelineId } = parseResult.data;
  const files = req.files as Express.Multer.File[];

  if (!files || files.length === 0) {
    res.status(400).json({ error: 'No files provided' });
    return;
  }

  // MIME type validation
  for (const file of files) {
    if (!attachmentService.isAllowedMime(file.mimetype)) {
      throw new AppError(415, `Unsupported file type: ${file.mimetype}`);
    }
  }

  // Validate target exists and is in an uploadable state
  const db = getDb();
  if (targetType === 'task') {
    const task = db.prepare('SELECT id, status FROM tasks WHERE id = ?').get(targetId) as { id: string; status: string } | undefined;
    if (!task) {
      throw new AppError(404, 'Task not found');
    }
    if (task.status === 'running') {
      throw new AppError(409, 'Cannot upload attachments to a running task');
    }
    // Aggregate task size check (50 MB)
    const currentSize = attachmentService.getTargetTotalSize('task', targetId);
    const newSize = files.reduce((sum, f) => sum + f.size, 0);
    if (currentSize + newSize > attachmentService.MAX_TASK_TOTAL_SIZE) {
      throw new AppError(413, `Total attachment size would exceed 50 MB task limit`);
    }
  } else if (targetType === 'pipeline') {
    const pipeline = db.prepare('SELECT id FROM pipelines WHERE id = ?').get(targetId) as { id: string } | undefined;
    if (!pipeline) {
      throw new AppError(404, 'Pipeline not found');
    }
    // Aggregate pipeline size check (100 MB)
    const currentSize = attachmentService.getTargetTotalSize('pipeline', targetId);
    const newSize = files.reduce((sum, f) => sum + f.size, 0);
    if (currentSize + newSize > attachmentService.MAX_PIPELINE_TOTAL_SIZE) {
      throw new AppError(413, `Total attachment size would exceed 100 MB pipeline limit`);
    }
  }

  // Move files from staging to pipeline directory
  for (const file of files) {
    attachmentService.moveFromStaging(file.filename, pipelineId);
  }

  // Save metadata to DB
  const attachments = attachmentService.saveAttachments(
    files.map((f) => ({
      originalname: f.originalname,
      filename: f.filename,
      mimetype: f.mimetype,
      size: f.size,
      path: f.path,
    })),
    targetType,
    targetId,
    pipelineId,
  );

  res.status(201).json({ attachments });
});

/**
 * GET /api/uploads?targetType=task&targetId=xxx
 * List attachments for a target.
 */
router.get('/uploads', (req, res) => {
  const parseResult = ListAttachmentsSchema.safeParse(req.query);
  if (!parseResult.success) {
    res.status(400).json({
      error: 'Validation failed',
      details: parseResult.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
    return;
  }

  const { targetType, targetId } = parseResult.data;
  const attachments = attachmentService.listAttachments(targetType, targetId);
  res.json({ attachments });
});

/**
 * GET /api/uploads/:id/content
 * Returns text content of an attachment for prompt injection.
 * Text files: returns content (up to 32KB). Images/binary: returns null with a note.
 */
router.get('/uploads/:id/content', (req, res) => {
  const result = attachmentService.getTextContent(req.params.id!);
  res.json(result);
});

/**
 * GET /api/uploads/:id
 * Download/view a specific attachment.
 * Query param ?download=true sets Content-Disposition: attachment
 */
router.get('/uploads/:id', (req, res) => {
  const attachment = attachmentService.getAttachment(req.params.id!);
  const filePath = attachmentService.getFilePath(attachment.pipelineId, attachment.filename);

  if (!existsSync(filePath)) {
    res.status(404).json({ error: 'File not found on disk' });
    return;
  }

  res.setHeader('Content-Type', attachment.mimeType);

  if (req.query.download === 'true') {
    res.setHeader('Content-Disposition', `attachment; filename="${attachment.originalName}"`);
  } else {
    res.setHeader('Content-Disposition', 'inline');
  }

  const stream = createReadStream(filePath);
  stream.pipe(res);
});

/**
 * DELETE /api/uploads/:id
 * Delete a specific attachment (DB row + file).
 */
router.delete('/uploads/:id', (req, res) => {
  res.json(attachmentService.deleteAttachment(req.params.id!));
});

export default router;
