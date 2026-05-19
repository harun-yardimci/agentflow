import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { AppError } from '../middleware/error-handler.js';
import { completeAndCascade } from '../services/task-service.js';
import { startPipeline, pausePipeline, resumeTask, retryTask, abortTask, startSingleTask, restartTaskFresh } from '../engine/pipeline-runner.js';
import { triggerSpawnFromOutput, extractLiveStreamText } from '../engine/task-runner.js';
import { workerPool } from '../engine/worker-pool.js';
import { buildAllowResponse, buildDenyResponse } from '../executor/control-protocol.js';
import { copyMessageAttachmentsToWorktree, formatBytes } from '../services/attachment-service.js';
import { getContextPacket } from '../services/context-packet-service.js';
import { listCycleAttempts, listCycleMessages, listTaskCycles } from '../services/task-cycle-service.js';

const router = Router();

/**
 * Run a pipeline: start all ready tasks via the real execution engine.
 */
router.post('/execution/:pid/run', (req, res) => {
  const pid = req.params.pid as string;
  const db = getDb();
  const pipeline = db.prepare('SELECT id FROM pipelines WHERE id = ?').get(pid);
  if (!pipeline) throw new AppError(404, 'Pipeline not found');

  const result = startPipeline(pid);
  res.json({
    started: result.started,
    pending: result.pending,
    blocked: result.blocked,
    message: result.blocked
      ?? `${result.started.length} task(s) started, ${result.pending.length} awaiting approval`,
  });
});

/**
 * Pause a pipeline: abort running tasks and reset to queued.
 */
router.post('/execution/:pid/pause', (req, res) => {
  const pid = req.params.pid as string;
  const db = getDb();
  const pipeline = db.prepare('SELECT id FROM pipelines WHERE id = ?').get(pid);
  if (!pipeline) throw new AppError(404, 'Pipeline not found');

  const paused = pausePipeline(pid);
  res.json({ paused, message: `${paused} task(s) paused` });
});

/**
 * Complete a task manually (for demo/testing or MCP-driven completion).
 */
router.post('/execution/tasks/:id/complete', (req, res) => {
  const taskId = req.params.id as string;
  const body = req.body as { output?: string; duration?: string; tokens?: number } | undefined;
  const output = body?.output ?? 'Task completed.';
  const duration = body?.duration ?? '0s';
  const tokens = body?.tokens ?? 0;
  const result = completeAndCascade(taskId, output, duration, tokens);

  // Enqueue cascaded tasks into the worker pool
  for (const cascadedId of result.cascaded) {
    try {
      resumeTask(cascadedId);
    } catch (err) {
      console.warn(`[Execution] Could not enqueue cascaded task ${cascadedId}:`, (err as Error).message);
    }
  }

  res.json(result);
});

/**
 * Abort a running task.
 */
router.post('/execution/tasks/:id/abort', (req, res) => {
  const taskId = req.params.id as string;
  const aborted = abortTask(taskId);
  if (!aborted) throw new AppError(404, 'Task not running or not found in pool');
  res.json({ aborted: true, taskId });
});

/**
 * Retry a failed task with optional user guidance.
 */
router.post('/execution/tasks/:id/retry', (req, res) => {
  const taskId = req.params.id as string;
  const followUpPrompt = (req.body as { followUpPrompt?: string } | undefined)?.followUpPrompt;

  try {
    retryTask(taskId, followUpPrompt);
    res.json({ retried: true, taskId });
  } catch (err) {
    throw new AppError(400, (err as Error).message);
  }
});

/**
 * Restart a task fresh — no session resume, optionally with a new model.
 */
router.post('/execution/tasks/:id/restart-fresh', (req, res) => {
  const taskId = req.params.id as string;
  const body = req.body as { model?: string; followUpPrompt?: string } | undefined;

  try {
    restartTaskFresh(taskId, body?.model, body?.followUpPrompt);
    res.json({ restarted: true, taskId });
  } catch (err) {
    throw new AppError(400, (err as Error).message);
  }
});

/**
 * Get all execution runs (attempts) for a task.
 */
router.get('/execution/tasks/:id/runs', (req, res) => {
  const taskId = req.params.id as string;
  const db = getDb();

  const runs = db.prepare(
    'SELECT * FROM execution_runs WHERE task_id = ? ORDER BY COALESCE(attempt_number, attempt) ASC, started_at ASC'
  ).all(taskId) as Array<{
    id: string; task_id: string; attempt: number; status: string;
    started_at: string; completed_at: string | null;
    stdout: string; stderr: string;
    tokens_used: number; duration_ms: number; exit_code: number | null;
    input_tokens: number | null; output_tokens: number | null;
    cache_read_input_tokens: number | null;
    cache_creation_input_tokens: number | null;
    cost_usd: number | null;
    pricing_source: string | null;
    pricing_snapshot_json: string | null;
    executor_type: string | null; model_used: string | null;
    error_message: string | null; worktree_path: string | null;
    follow_up_prompt: string | null; is_follow_up: number;
    session_id: string | null; provider_session_id: string | null;
    parsed_output: string | null;
    cycle_id: string | null; attempt_number: number | null;
    parent_run_id: string | null; trigger_type: string | null;
    agent_id: string | null; provider: string | null; metadata_json: string | null;
  }>;

  res.json(runs.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    attempt: r.attempt,
    cycleId: r.cycle_id,
    attemptNumber: r.attempt_number ?? r.attempt,
    parentRunId: r.parent_run_id,
    triggerType: r.trigger_type ?? 'initial',
    status: r.status,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    stdout: r.stdout ?? '',
    stderr: r.stderr,
    tokens: r.tokens_used,
    inputTokens: r.input_tokens,
    outputTokens: r.output_tokens,
    cacheReadInputTokens: r.cache_read_input_tokens,
    cacheCreationInputTokens: r.cache_creation_input_tokens,
    costUsd: r.cost_usd,
    pricingSource: r.pricing_source,
    pricingSnapshot: r.pricing_snapshot_json ? JSON.parse(r.pricing_snapshot_json) : null,
    durationMs: r.duration_ms,
    exitCode: r.exit_code,
    executorType: r.executor_type,
    model: r.model_used,
    error: r.error_message,
    followUpPrompt: r.follow_up_prompt,
    isFollowUp: r.is_follow_up === 1,
    sessionId: r.provider_session_id ?? r.session_id,
    providerSessionId: r.provider_session_id ?? r.session_id,
    agentId: r.agent_id,
    provider: r.provider,
    metadata: r.metadata_json ? JSON.parse(r.metadata_json) : {},
    parsedOutput: r.parsed_output ?? null,
  })));
});

router.get('/execution/tasks/:id/cycles', (req, res) => {
  res.json(listTaskCycles(req.params.id!));
});

router.get('/execution/tasks/:id/cycles/:cycleId/attempts', (req, res) => {
  const attempts = listCycleAttempts(req.params.id!, req.params.cycleId!);
  res.json(attempts.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    cycleId: r.cycle_id,
    attempt: r.attempt ?? 0,
    attemptNumber: r.attempt_number ?? r.attempt ?? 0,
    status: r.status,
    startedAt: r.started_at ?? '',
    completedAt: r.completed_at ?? null,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    tokens: r.tokens_used ?? 0,
    inputTokens: r.input_tokens ?? null,
    outputTokens: r.output_tokens ?? null,
    cacheReadInputTokens: r.cache_read_input_tokens ?? null,
    cacheCreationInputTokens: r.cache_creation_input_tokens ?? null,
    costUsd: r.cost_usd ?? null,
    pricingSource: r.pricing_source ?? null,
    pricingSnapshot: r.pricing_snapshot_json
      ? JSON.parse(r.pricing_snapshot_json)
      : null,
    durationMs: r.duration_ms ?? 0,
    exitCode: r.exit_code ?? null,
    followUpPrompt: r.follow_up_prompt,
    agentId: r.agent_id,
    provider: r.provider,
    model: r.model_used,
    providerSessionId: r.provider_session_id
      ?? r.session_id
      ?? null,
    triggerType: r.trigger_type ?? 'initial',
    parentRunId: r.parent_run_id ?? null,
    parsedOutput: r.parsed_output ?? null,
  })));
});

router.get('/execution/tasks/:id/cycles/:cycleId/messages', (req, res) => {
  res.json(listCycleMessages(req.params.id!, req.params.cycleId!));
});

router.get('/execution/context-packets/:id', (req, res) => {
  const packet = getContextPacket(req.params.id!);
  res.json(packet);
});

/**
 * Update user_note on a task (comments / guidance).
 */
router.put('/execution/tasks/:id/note', (req, res) => {
  const taskId = req.params.id as string;
  const { note } = req.body as { note: string };
  const db = getDb();

  const existing = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
  if (!existing) throw new AppError(404, 'Task not found');

  db.prepare('UPDATE tasks SET user_note = ? WHERE id = ?').run(note ?? '', taskId);
  res.json({ ok: true, taskId });
});

/**
 * Get live output of a running/completed task.
 */
router.get('/execution/tasks/:id/output', (req, res) => {
  const taskId = req.params.id as string;
  const db = getDb();

  // Get latest execution run
  const run = db.prepare(
    'SELECT * FROM execution_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT 1'
  ).get(taskId) as {
    id: string; status: string; stdout: string; stderr: string;
    tokens_used: number; duration_ms: number; exit_code: number | null;
    input_tokens: number | null; output_tokens: number | null;
    cost_usd: number | null;
    started_at: string; completed_at: string | null; attempt: number;
  } | undefined;

  if (!run) {
    res.json({ taskId, output: null, message: 'No execution found' });
    return;
  }

  // Parse stream-json into readable text for live display
  const stream = run.stdout
    ? extractLiveStreamText(run.stdout)
    : '';

  // Count pending control requests for this task
  const pendingRow = db.prepare(
    "SELECT COUNT(*) as cnt FROM control_requests WHERE task_id = ? AND status = 'pending'"
  ).get(taskId) as { cnt: number } | undefined;

  res.json({
    taskId,
    runId: run.id,
    status: run.status,
    stream,
    stdout: run.stdout,
    stderr: run.stderr,
    tokens: run.tokens_used,
    inputTokens: run.input_tokens,
    outputTokens: run.output_tokens,
    costUsd: run.cost_usd,
    durationMs: run.duration_ms,
    exitCode: run.exit_code,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    attempt: run.attempt,
    pendingQuestions: pendingRow?.cnt ?? 0,
  });
});

/**
 * Get worker pool status.
 */
router.get('/execution/pool', (_req, res) => {
  res.json(workerPool.getStatus());
});

/**
 * Start a single task independently of pipeline run.
 */
router.post('/execution/tasks/:id/start', (req, res) => {
  const taskId = req.params.id as string;
  try {
    const result = startSingleTask(taskId);
    res.json({ ...result, taskId });
  } catch (err) {
    throw new AppError(400, (err as Error).message);
  }
});

/**
 * Resume an approved task (enqueue for execution after approval).
 */
router.post('/execution/tasks/:id/resume', (req, res) => {
  const taskId = req.params.id as string;
  try {
    resumeTask(taskId);
    res.json({ resumed: true, taskId });
  } catch (err) {
    throw new AppError(400, (err as Error).message);
  }
});

/**
 * Retry spawn: re-parse a completed task's output for SPAWN_TASKS directives.
 * Useful for testing auto-spawn or triggering spawn on already-completed tasks.
 */
router.post('/execution/tasks/:id/retry-spawn', (req, res) => {
  const taskId = req.params.id as string;
  try {
    const spawnedIds = triggerSpawnFromOutput(taskId);
    res.json({
      spawned: spawnedIds.length,
      spawnedIds,
      message: spawnedIds.length > 0
        ? `${spawnedIds.length} follow-up task(s) spawned`
        : 'No SPAWN_TASKS block found in task output',
    });
  } catch (err) {
    throw new AppError(400, (err as Error).message);
  }
});

/**
 * List control requests (questions/approvals) for a task.
 */
router.get('/execution/tasks/:id/questions', (req, res) => {
  const taskId = req.params.id as string;
  const db = getDb();

  const requests = db.prepare(
    'SELECT * FROM control_requests WHERE task_id = ? ORDER BY created_at DESC'
  ).all(taskId) as Array<{
    id: string; task_id: string; run_id: string; tool_name: string;
    tool_use_id: string | null; input_json: string; question: string | null;
    status: string; response_json: string | null;
    created_at: string; responded_at: string | null; timeout_at: string;
  }>;

  res.json(requests.map((r) => ({
    id: r.id,
    taskId: r.task_id,
    runId: r.run_id,
    toolName: r.tool_name,
    toolUseId: r.tool_use_id,
    inputJson: r.input_json,
    question: r.question,
    status: r.status,
    responseJson: r.response_json,
    createdAt: r.created_at,
    respondedAt: r.responded_at,
    timeoutAt: r.timeout_at,
  })));
});

/**
 * Respond to a control request (allow/deny a tool use or answer a question).
 */
router.post('/execution/tasks/:id/respond', (req, res) => {
  const taskId = req.params.id as string;
  const body = req.body as {
    requestId: string;
    action: 'allow' | 'deny';
    message?: string;
    updatedInput?: Record<string, unknown>;
  };

  if (!body.requestId || !body.action) {
    throw new AppError(400, 'requestId and action are required');
  }

  const db = getDb();
  const cr = db.prepare(
    'SELECT * FROM control_requests WHERE id = ? AND task_id = ?'
  ).get(body.requestId, taskId) as {
    id: string; status: string; input_json: string;
  } | undefined;

  if (!cr) throw new AppError(404, 'Control request not found');
  if (cr.status !== 'pending') throw new AppError(400, `Control request already responded (status: ${cr.status})`);

  // Copy any message-level attachments to the worktree's .attachments/ dir
  let attachmentFileRefs = '';
  if (body.action === 'allow') {
    const taskRow = db.prepare('SELECT worktree_path FROM tasks WHERE id = ?')
      .get(taskId) as { worktree_path: string | null } | undefined;

    if (taskRow?.worktree_path) {
      try {
        const copied = copyMessageAttachmentsToWorktree(body.requestId, taskRow.worktree_path);
        if (copied.length > 0) {
          attachmentFileRefs = '\n\nAttached files:\n' + copied.map((a) =>
            `- .attachments/${a.original_name} (${a.mime_type}, ${formatBytes(a.size_bytes)})`
          ).join('\n');
        }
      } catch {
        // Non-critical — attachment copy failure shouldn't block the response
      }
    }
  }

  let responseJson: string;
  if (body.action === 'allow') {
    const input = body.updatedInput ?? JSON.parse(cr.input_json);
    // Append file references to the user's text response if attachments were copied
    if (attachmentFileRefs && typeof input === 'object' && input !== null) {
      const inputObj = input as Record<string, unknown>;
      if (typeof inputObj.text === 'string') {
        inputObj.text = inputObj.text + attachmentFileRefs;
      } else if (typeof inputObj.response === 'string') {
        inputObj.response = inputObj.response + attachmentFileRefs;
      }
    }
    responseJson = buildAllowResponse(body.requestId, input);
  } else {
    responseJson = buildDenyResponse(body.requestId, body.message ?? 'Denied by user', true);
  }

  db.prepare(
    "UPDATE control_requests SET status = ?, response_json = ?, responded_at = ? WHERE id = ?"
  ).run(
    body.action === 'allow' ? 'approved' : 'denied',
    responseJson,
    new Date().toISOString(),
    body.requestId,
  );

  res.json({ ok: true, requestId: body.requestId, action: body.action });
});

export default router;
