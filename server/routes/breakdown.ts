import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { BreakdownRequestSchema, BatchCreateTasksSchema } from '../types/api.js';
import { generateBreakdown } from '../services/breakdown-service.js';
import { batchCreateTasks } from '../services/task-service.js';
import { getDb } from '../db/connection.js';
import { logTimestamp } from '../lib/log-timestamp.js';

const router = Router();
const getParam = (value: string | string[]): string =>
  Array.isArray(value) ? value[0] ?? '' : value;

// Generate breakdown plan from description
router.post('/breakdown', validate(BreakdownRequestSchema), async (req, res, next) => {
  try {
    const { description, agentIds, model, attachmentIds, pipelineId } = req.body as {
      description: string;
      agentIds: string[];
      model?: string;
      attachmentIds?: string[];
      pipelineId?: string;
    };
    const plan = await generateBreakdown(description, agentIds, model, undefined, undefined, attachmentIds, pipelineId);
    res.json(plan);
  } catch (err) {
    next(err);
  }
});

// SSE streaming breakdown — streams agent output chunks in real-time
router.post('/breakdown/stream', validate(BreakdownRequestSchema), async (req, res) => {
  const { description, agentIds, model, attachmentIds, pipelineId } = req.body as {
    description: string;
    agentIds: string[];
    model?: string;
    attachmentIds?: string[];
    pipelineId?: string;
  };
  const startedAt = Date.now();
  const abortController = new AbortController();
  let clientDisconnected = false;

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sendEvent = (event: string, data: unknown) => {
    try {
      if (!res.writableEnded) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    } catch {
      // Client disconnected, ignore write errors
    }
  };

  const heartbeat = setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
    sendEvent('chunk', { text: `[breakdown] running... ${elapsedSec}s\n` });
  }, 5000);

  res.on('close', () => {
    clientDisconnected = true;
    abortController.abort();
    clearInterval(heartbeat);
  });

  try {
    const plan = await generateBreakdown(description, agentIds, model, (text) => {
      sendEvent('chunk', { text });
    }, abortController.signal, attachmentIds, pipelineId);
    if (clientDisconnected || abortController.signal.aborted || res.writableEnded) return;
    sendEvent('plan', plan);
  } catch (err) {
    if (clientDisconnected || abortController.signal.aborted || res.writableEnded) return;
    const message = err instanceof Error ? err.message : 'Breakdown failed';
    sendEvent('error', { message });
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) {
      sendEvent('done', {});
      res.end();
    }
  }
});

// Batch create tasks in a pipeline
router.post(
  '/pipelines/:pid/tasks/batch',
  validate(BatchCreateTasksSchema),
  (req, res) => {
    const { tasks } = req.body as {
      tasks: {
        name: string;
        agentId: string;
        model: string;
        approval: string;
        stage: number;
        dependsOnIndices: number[];
        input: string;
        priority?: string | null;
        timeoutMs?: number;
        tags?: string[];
      }[];
    };
    const created = batchCreateTasks(getParam(req.params.pid), tasks);
    res.status(201).json(created);
  },
);

// ─── Breakdown Drafts ───

// Get draft for a pipeline
router.get('/pipelines/:pid/breakdown-draft', (req, res) => {
  const db = getDb();
  const pipelineId = getParam(req.params.pid);
  const row = db.prepare(
    'SELECT * FROM breakdown_drafts WHERE pipeline_id = ? ORDER BY updated_at DESC LIMIT 1'
  ).get(pipelineId) as { id: string; pipeline_id: string; description: string; selected_agents: string; plan_json: string | null; created_at: string; updated_at: string } | undefined;

  if (!row) {
    res.json(null);
    return;
  }

  res.json({
    id: row.id,
    pipelineId: row.pipeline_id,
    description: row.description,
    selectedAgents: JSON.parse(row.selected_agents),
    plan: row.plan_json ? JSON.parse(row.plan_json) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
});

// Save/update draft
router.put('/pipelines/:pid/breakdown-draft', (req, res) => {
  const db = getDb();
  const { description, selectedAgents, plan } = req.body as {
    description: string;
    selectedAgents: string[];
    plan: unknown | null;
  };
  const now = logTimestamp();
  const pipelineId = getParam(req.params.pid);

  // Upsert: one draft per pipeline
  const existing = db.prepare(
    'SELECT id FROM breakdown_drafts WHERE pipeline_id = ?'
  ).get(pipelineId) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      'UPDATE breakdown_drafts SET description = ?, selected_agents = ?, plan_json = ?, updated_at = ? WHERE id = ?'
    ).run(description, JSON.stringify(selectedAgents), plan ? JSON.stringify(plan) : null, now, existing.id);
    res.json({ id: existing.id, updated: true });
  } else {
    const id = `bd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(
      'INSERT INTO breakdown_drafts (id, pipeline_id, description, selected_agents, plan_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, pipelineId, description, JSON.stringify(selectedAgents), plan ? JSON.stringify(plan) : null, now, now);
    res.status(201).json({ id, created: true });
  }
});

// Delete draft
router.delete('/pipelines/:pid/breakdown-draft', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM breakdown_drafts WHERE pipeline_id = ?').run(getParam(req.params.pid));
  res.json({ deleted: true });
});

export default router;
