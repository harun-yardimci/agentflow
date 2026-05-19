import { spawn } from 'child_process';
import { getDb } from '../db/connection.js';
import { eventBus } from './event-bus.js';
import { logTimestamp } from '../lib/log-timestamp.js';

export interface HookResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

type CanonicalHookKey = 'pre_run_hook' | 'post_run_hook';
type HookKey = CanonicalHookKey | 'pre_task_hook' | 'post_task_hook';

interface HookContext {
  agentId?: string;
  model?: string;
  pipelineId: string;
  taskDurationMs?: number;
  taskExitCode?: number;
  taskId: string;
  taskName: string;
  taskOutput?: string;
  taskStatus?: string;
  taskTokens?: number;
  workingDir: string;
}

const HOOK_OUTPUT_PREVIEW = 300;

/** Load hook scripts from settings */
function normalizeHookKey(hookKey: HookKey): CanonicalHookKey {
  return hookKey === 'pre_task_hook' ? 'pre_run_hook'
    : hookKey === 'post_task_hook' ? 'post_run_hook'
      : hookKey;
}

function getLegacyHookKey(hookKey: CanonicalHookKey): 'pre_task_hook' | 'post_task_hook' {
  return hookKey === 'pre_run_hook' ? 'pre_task_hook' : 'post_task_hook';
}

function loadHook(hookKey: HookKey): string | null {
  try {
    const db = getDb();
    const canonicalKey = normalizeHookKey(hookKey);
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(canonicalKey) as { value: string } | undefined;
    const canonicalValue = row?.value?.trim();
    if (canonicalValue) return canonicalValue;

    const legacyRow = db.prepare('SELECT value FROM settings WHERE key = ?')
      .get(getLegacyHookKey(canonicalKey)) as { value: string } | undefined;
    return legacyRow?.value?.trim() || null;
  } catch {
    return null;
  }
}

function truncateHookText(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= HOOK_OUTPUT_PREVIEW) return trimmed;
  return `${trimmed.slice(0, HOOK_OUTPUT_PREVIEW)}...`;
}

function insertHookLog(pipelineId: string, type: string, message: string): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)',
  ).run(pipelineId, logTimestamp(), type, message);
}

function hookLabel(hookKey: HookKey): string {
  return normalizeHookKey(hookKey) === 'pre_run_hook'
    ? 'Pre-run hook'
    : 'Post-run hook';
}

function logHookStart(
  hookKey: HookKey,
  context: HookContext,
): void {
  insertHookLog(
    context.pipelineId,
    'info',
    `${hookLabel(hookKey)} started for '${context.taskName}'`,
  );
}

function logHookResult(
  hookKey: HookKey,
  context: HookContext,
  result: HookResult,
): void {
  const label = hookLabel(hookKey);
  const summaryType = result.exitCode === 0 ? 'info' : 'warning';
  insertHookLog(
    context.pipelineId,
    summaryType,
    `${label} ${result.exitCode === 0 ? 'completed' : 'failed'} for '${context.taskName}' `
      + `(exit ${result.exitCode}, ${result.durationMs}ms)`,
  );

  if (result.stdout.trim()) {
    insertHookLog(
      context.pipelineId,
      'info',
      `${label} stdout: ${truncateHookText(result.stdout)}`,
    );
  }

  if (result.stderr.trim()) {
    insertHookLog(
      context.pipelineId,
      result.exitCode === 0 ? 'warning' : 'error',
      `${label} stderr: ${truncateHookText(result.stderr)}`,
    );
  }
}

/**
 * Execute a shell hook (pre_run_hook or post_run_hook).
 *
 * Environment variables passed:
 *  - AGENTFLOW_TASK_ID / TASK_ID
 *  - AGENTFLOW_TASK_NAME / TASK_NAME
 *  - AGENTFLOW_PIPELINE_ID / PIPELINE_ID
 *  - AGENTFLOW_TASK_AGENT_ID / TASK_AGENT
 *  - AGENTFLOW_TASK_MODEL / TASK_MODEL
 *  - AGENTFLOW_TASK_STATUS / TASK_STATUS (post hooks)
 *  - AGENTFLOW_TASK_EXIT_CODE / TASK_EXIT_CODE (post hooks)
 *  - AGENTFLOW_TASK_OUTPUT / TASK_OUTPUT (post hooks)
 *  - AGENTFLOW_TASK_TOKENS / TASK_TOKENS (post hooks)
 *  - AGENTFLOW_TASK_DURATION_MS / TASK_DURATION_MS (post hooks)
 *  - AGENTFLOW_WORKING_DIR / WORKING_DIR
 */
export async function executeHook(
  hookKey: HookKey,
  context: HookContext,
  timeoutMs = 30000,
): Promise<HookResult | null> {
  const script = loadHook(hookKey);
  if (!script) return null;

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    AGENTFLOW_TASK_ID: context.taskId,
    AGENTFLOW_TASK_NAME: context.taskName,
    AGENTFLOW_PIPELINE_ID: context.pipelineId,
    AGENTFLOW_WORKING_DIR: context.workingDir,
    TASK_ID: context.taskId,
    TASK_NAME: context.taskName,
    PIPELINE_ID: context.pipelineId,
    WORKING_DIR: context.workingDir,
  };

  if (context.agentId !== undefined) {
    env.AGENTFLOW_TASK_AGENT_ID = context.agentId;
    env.TASK_AGENT = context.agentId;
  }
  if (context.model !== undefined) {
    env.AGENTFLOW_TASK_MODEL = context.model;
    env.TASK_MODEL = context.model;
  }
  if (context.taskStatus !== undefined) {
    env.AGENTFLOW_TASK_STATUS = context.taskStatus;
    env.TASK_STATUS = context.taskStatus;
  }
  if (context.taskExitCode !== undefined) {
    env.AGENTFLOW_TASK_EXIT_CODE = String(context.taskExitCode);
    env.TASK_EXIT_CODE = String(context.taskExitCode);
  }
  if (context.taskOutput !== undefined) {
    env.AGENTFLOW_TASK_OUTPUT = context.taskOutput;
    env.TASK_OUTPUT = context.taskOutput;
  }
  if (context.taskTokens !== undefined) {
    env.AGENTFLOW_TASK_TOKENS = String(context.taskTokens);
    env.TASK_TOKENS = String(context.taskTokens);
  }
  if (context.taskDurationMs !== undefined) {
    env.AGENTFLOW_TASK_DURATION_MS = String(context.taskDurationMs);
    env.TASK_DURATION_MS = String(context.taskDurationMs);
  }

  const startTime = Date.now();

  return new Promise<HookResult>((resolve) => {
    const proc = spawn('sh', ['-c', script], {
      cwd: context.workingDir,
      env,
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      resolve({
        exitCode: -1,
        stdout,
        stderr: err.message,
        durationMs: Date.now() - startTime,
      });
    });

    proc.on('close', (code) => {
      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
        durationMs: Date.now() - startTime,
      });
    });
  });
}

/** Run pre-task hook. Returns true if OK to proceed, false to abort. */
export async function runPreTaskHook(
  taskId: string,
  taskName: string,
  pipelineId: string,
  workingDir: string,
  agentId?: string,
  model?: string,
): Promise<{ ok: boolean; result: HookResult | null }> {
  if (!loadHook('pre_run_hook')) {
    return { ok: true, result: null };
  }
  logHookStart('pre_run_hook', {
    agentId,
    model,
    pipelineId,
    taskId,
    taskName,
    workingDir,
  });
  const result = await executeHook('pre_run_hook', {
    agentId,
    model,
    pipelineId,
    taskId,
    taskName,
    workingDir,
  });

  if (!result) return { ok: true, result: null };
  logHookResult('pre_run_hook', {
    agentId,
    model,
    pipelineId,
    taskId,
    taskName,
    workingDir,
  }, result);

  // Non-zero exit code from pre-hook = abort task
  if (result.exitCode !== 0) {
    eventBus.emit('task:hook_failed', {
      taskId, pipelineId, taskName, status: 'blocked',
      hook: 'pre_run_hook',
      exitCode: result.exitCode, stderr: result.stderr.slice(0, 500),
    });

    return { ok: false, result };
  }

  return { ok: true, result };
}

/** Run post-task hook (informational, does not affect task outcome). */
export async function runPostTaskHook(
  taskId: string,
  taskName: string,
  pipelineId: string,
  workingDir: string,
  taskStatus: string,
  taskExitCode: number,
  options?: {
    agentId?: string;
    model?: string;
    taskDurationMs?: number;
    taskOutput?: string;
    taskTokens?: number;
  },
): Promise<HookResult | null> {
  if (!loadHook('post_run_hook')) {
    return null;
  }
  logHookStart('post_run_hook', {
    agentId: options?.agentId,
    model: options?.model,
    pipelineId,
    taskDurationMs: options?.taskDurationMs,
    taskExitCode,
    taskId,
    taskName,
    taskOutput: options?.taskOutput,
    taskStatus,
    taskTokens: options?.taskTokens,
    workingDir,
  });
  const result = await executeHook('post_run_hook', {
    agentId: options?.agentId,
    model: options?.model,
    pipelineId,
    taskDurationMs: options?.taskDurationMs,
    taskExitCode,
    taskId,
    taskName,
    taskOutput: options?.taskOutput,
    taskStatus,
    taskTokens: options?.taskTokens,
    workingDir,
  });

  if (result) {
    logHookResult('post_run_hook', {
      agentId: options?.agentId,
      model: options?.model,
      pipelineId,
      taskDurationMs: options?.taskDurationMs,
      taskExitCode,
      taskId,
      taskName,
      taskOutput: options?.taskOutput,
      taskStatus,
      taskTokens: options?.taskTokens,
      workingDir,
    }, result);
  }

  if (result && result.exitCode !== 0) {
    eventBus.emit('task:hook_failed', {
      taskId, pipelineId, taskName, status: taskStatus,
      hook: 'post_run_hook',
      exitCode: result.exitCode, stderr: result.stderr.slice(0, 500),
    });
  }

  return result;
}
