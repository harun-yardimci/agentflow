import { Router } from 'express';
import { existsSync, createReadStream } from 'fs';
import multer from 'multer';
import { validate } from '../middleware/validate.js';
import { CreateTaskSchema, UpdateTaskSchema, MoveTaskSchema } from '../types/api.js';
import * as taskService from '../services/task-service.js';
import * as attachmentService from '../services/attachment-service.js';
import { resumeTask } from '../engine/pipeline-runner.js';
import { getDb } from '../db/connection.js';
import { AppError } from '../middleware/error-handler.js';

const router = Router();
const getParam = (value: string | string[]): string =>
  Array.isArray(value) ? value[0] ?? '' : value;

// Multer config for task attachment uploads
const upload = multer({
  storage: multer.diskStorage(attachmentService.getMulterStorageConfig()),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB per file
    files: 10,
  },
});

// List tasks for a pipeline
router.get('/pipelines/:pid/tasks', (req, res) => {
  res.json(taskService.listTasks(getParam(req.params.pid)));
});

// Create task in a pipeline
router.post('/pipelines/:pid/tasks', validate(CreateTaskSchema), (req, res) => {
  res.status(201).json(taskService.createTask(getParam(req.params.pid), req.body));
});

// Update a task
router.put('/tasks/:id', validate(UpdateTaskSchema), (req, res) => {
  res.json(taskService.updateTask(getParam(req.params.id), req.body));
});

// Delete a task
router.delete('/tasks/:id', (req, res) => {
  res.json(taskService.deleteTask(getParam(req.params.id)));
});

// Move task to a different status
router.post('/tasks/:id/move', validate(MoveTaskSchema), (req, res) => {
  const taskId = getParam(req.params.id);
  const result = taskService.moveTask(taskId, req.body.status);

  // M1: Enqueue cascaded tasks into the worker pool
  if (result.cascaded) {
    for (const cascadedId of result.cascaded) {
      try {
        resumeTask(cascadedId);
      } catch (err) {
        console.warn(`[Tasks] Could not enqueue cascaded task ${cascadedId}:`, (err as Error).message);
      }
    }
  }

  res.json(result);
});

// Approve a pending task → enqueue for real execution
router.post('/tasks/:id/approve', (req, res) => {
  const taskId = getParam(req.params.id);
  const result = taskService.approveTask(taskId);
  // Enqueue the approved task for execution in worker pool
  try {
    resumeTask(taskId);
  } catch (err) {
    console.warn(`[Tasks] Could not enqueue approved task ${taskId}:`, (err as Error).message);
  }
  res.json(result);
});

// Reject a task
router.post('/tasks/:id/reject', (req, res) => {
  res.json(taskService.rejectTask(getParam(req.params.id)));
});

// ─── Task Attachment Routes ───

/**
 * GET /api/tasks/:id/attachments
 * List all attachments for a task.
 */
router.get('/tasks/:id/attachments', (req, res) => {
  const taskId = getParam(req.params.id);
  const db = getDb();
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId) as { id: string } | undefined;
  if (!task) {
    throw new AppError(404, 'Task not found');
  }
  const attachments = attachmentService.listAttachments('task', taskId);
  res.json({ attachments });
});

/**
 * POST /api/tasks/:id/attachments
 * Upload files to a task. Content-Type: multipart/form-data (field: "files")
 */
router.post('/tasks/:id/attachments', upload.array('files', 10), (req, res) => {
  const taskId = getParam(req.params.id);
  const db = getDb();

  // Validate task exists and is not running
  const task = db.prepare('SELECT id, status, pipeline_id FROM tasks WHERE id = ?').get(taskId) as
    { id: string; status: string; pipeline_id: string } | undefined;
  if (!task) {
    throw new AppError(404, 'Task not found');
  }
  if (task.status === 'running') {
    throw new AppError(409, 'Cannot upload attachments to a running task');
  }

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

  // Aggregate size check
  const currentSize = attachmentService.getTargetTotalSize('task', taskId);
  const newSize = files.reduce((sum, f) => sum + f.size, 0);
  if (currentSize + newSize > attachmentService.MAX_TASK_TOTAL_SIZE) {
    throw new AppError(413, `Total attachment size would exceed 50 MB limit (current: ${attachmentService.formatBytes(currentSize)}, adding: ${attachmentService.formatBytes(newSize)})`);
  }

  // Move files from staging to pipeline directory
  for (const file of files) {
    attachmentService.moveFromStaging(file.filename, task.pipeline_id);
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
    'task',
    taskId,
    task.pipeline_id,
  );

  res.status(201).json({ attachments });
});

/**
 * DELETE /api/tasks/:id/attachments/:attId
 * Delete a specific attachment from a task (with ownership check).
 */
router.delete('/tasks/:id/attachments/:attId', (req, res) => {
  const taskId = getParam(req.params.id);
  const attId = getParam(req.params.attId);

  // Verify attachment belongs to this task
  const attachment = attachmentService.getAttachment(attId);
  if (attachment.targetType !== 'task' || attachment.targetId !== taskId) {
    throw new AppError(404, 'Attachment not found on this task');
  }

  res.json(attachmentService.deleteAttachment(attId));
});

/**
 * GET /api/attachments/:id/download
 * Download an attachment file by ID.
 */
router.get('/attachments/:id/download', (req, res) => {
  const attachment = attachmentService.getAttachment(getParam(req.params.id));
  const filePath = attachmentService.getFilePath(attachment.pipelineId, attachment.filename);

  if (!existsSync(filePath)) {
    throw new AppError(404, 'File not found on disk');
  }

  res.setHeader('Content-Type', attachment.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${attachment.originalName}"`);

  const stream = createReadStream(filePath);
  stream.pipe(res);
});

// Archive a task
router.post('/tasks/:id/archive', (req, res) => {
  res.json(taskService.archiveTask(getParam(req.params.id)));
});

// Unarchive a task
router.post('/tasks/:id/unarchive', (req, res) => {
  res.json(taskService.unarchiveTask(getParam(req.params.id)));
});

// List archived tasks for a pipeline
router.get('/pipelines/:pid/tasks/archived', (req, res) => {
  res.json(taskService.listArchivedTasks(getParam(req.params.pid)));
});

// Archive all completed/failed/rejected tasks in a pipeline
router.post('/pipelines/:pid/tasks/archive-all', (req, res) => {
  res.json(taskService.archiveAllDone(getParam(req.params.pid)));
});

export default router;
