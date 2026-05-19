import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { SetMemorySchema } from '../types/api.js';
import * as memoryService from '../services/memory-service.js';

const router = Router();
const getParam = (value: string | string[]): string =>
  Array.isArray(value) ? value[0] ?? '' : value;

// GET /api/pipelines/:pid/memory?layer=...&key=...
router.get('/pipelines/:pid/memory', (req, res) => {
  const layer = typeof req.query.layer === 'string' ? req.query.layer : undefined;
  const key = typeof req.query.key === 'string' ? req.query.key : undefined;
  res.json(memoryService.getMemory(getParam(req.params.pid), layer, key));
});

// PUT /api/pipelines/:pid/memory
router.put('/pipelines/:pid/memory', validate(SetMemorySchema), (req, res) => {
  const { layer, key, value, createdByTask, expiresAt } = req.body;
  res.json(
    memoryService.setMemory(
      getParam(req.params.pid),
      layer,
      key,
      value,
      createdByTask,
      expiresAt,
    ),
  );
});

// DELETE /api/pipelines/:pid/memory/:layer/:key
router.delete('/pipelines/:pid/memory/:layer/:key', (req, res) => {
  res.json(
    memoryService.deleteMemory(
      getParam(req.params.pid),
      getParam(req.params.layer),
      getParam(req.params.key),
    ),
  );
});

// GET /api/pipelines/:pid/memory/messages/:taskId
router.get('/pipelines/:pid/memory/messages/:taskId', (req, res) => {
  res.json(
    memoryService.getShortTermForTask(
      getParam(req.params.pid),
      getParam(req.params.taskId),
    ),
  );
});

export default router;
