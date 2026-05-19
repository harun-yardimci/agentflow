import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { CreatePipelineSchema, UpdatePipelineSchema, PipelineStageSchema } from '../types/api.js';
import * as pipelineService from '../services/pipeline-service.js';
import * as attachmentService from '../services/attachment-service.js';

const router = Router();
const getParam = (value: string | string[]): string =>
  Array.isArray(value) ? value[0] ?? '' : value;

router.get('/', (_req, res) => {
  res.json(pipelineService.listPipelines());
});

router.post('/', validate(CreatePipelineSchema), (req, res) => {
  res.status(201).json(pipelineService.createPipeline(req.body));
});

router.get('/:id', (req, res) => {
  res.json(pipelineService.getPipeline(getParam(req.params.id)));
});

router.put('/:id', validate(UpdatePipelineSchema), (req, res) => {
  res.json(pipelineService.updatePipeline(getParam(req.params.id), req.body));
});

router.delete('/:id', (req, res) => {
  res.json(pipelineService.deletePipeline(getParam(req.params.id)));
});

// ─── Attachment Routes ───

/**
 * GET /api/pipelines/:id/attachments
 * Returns ALL attachments belonging to this pipeline (task, pipeline, and message scoped).
 * Used by the planner to discover files from any source within the pipeline.
 */
router.get('/:id/attachments', (req, res) => {
  const pipelineId = getParam(req.params.id);
  // Verify pipeline exists
  pipelineService.getPipeline(pipelineId);
  const attachments = attachmentService.listAllPipelineAttachments(pipelineId);
  res.json({ attachments });
});

// ─── Stage Routes ───

router.get('/:id/stages', (req, res) => {
  res.json(pipelineService.listStages(getParam(req.params.id)));
});

router.post('/:id/stages', validate(PipelineStageSchema), (req, res) => {
  res.status(201).json(pipelineService.createStage(getParam(req.params.id), req.body));
});

router.put('/:id/stages/:sid', (req, res) => {
  res.json(
    pipelineService.updateStage(
      getParam(req.params.id),
      getParam(req.params.sid),
      req.body,
    ),
  );
});

router.delete('/:id/stages/:sid', (req, res) => {
  res.json(
    pipelineService.deleteStage(getParam(req.params.id), getParam(req.params.sid)),
  );
});

export default router;
