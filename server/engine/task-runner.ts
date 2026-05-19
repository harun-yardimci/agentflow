import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { getDb } from '../db/connection.js';
import { logTimestamp } from '../lib/log-timestamp.js';
import { createExecutor, type ExecutorResult } from '../executor/index.js';
import { getProviderKey } from '../lib/provider-utils.js';
import { checkOutput } from '../safety/index.js';
import {
  createWorktree,
  createWorktreeFromRef,
  branchHasCommits,
  mergeBranch,
  ensureGitignore,
  finalizeTempMergeWorktree,
  cleanupTempWorktree,
  removeWorktreeAndBranch,
  type MergeResult,
} from './worktree-manager.js';
import { eventBus } from './event-bus.js';
import { workerPool } from './worker-pool.js';
import {
  archiveInheritedFollowUpsForParent,
  checkDependenciesSatisfied,
  completeAndCascade,
} from '../services/task-service.js';
import { recalcPipelineStatus } from '../services/pipeline-service.js';
import {
  buildFrozenRunUsageMetrics,
  refreshTaskUsageMetrics,
} from '../services/usage-service.js';
import {
  attachPendingFollowUpToRun,
  closeActiveCycles,
  createConversationMessage,
  describeTriggerEvent,
  getNextAttemptNumber,
  getOrCreateActiveCycle,
  inferAttemptContext,
  reopenCycle,
  setCycleStatus,
  upsertConversationMessage,
} from '../services/task-cycle-service.js';
import { setMemory } from '../services/memory-service.js';
import { runPreTaskHook, runPostTaskHook } from './task-hooks.js';
import { parseCliOutput } from '../executor/output-parser.js';
import { detectRateLimit, type RateLimitInfo } from './rate-limit-detector.js';
import { parseSpawnDirectives, stripSpawnBlock } from './spawn-parser.js';
import { deduplicateSpawnDirectives, getActiveTasks } from './spawn-dedup.js';
import { extractQuestion, buildAllowResponse, buildDenyResponse, type ControlRequest } from '../executor/control-protocol.js';
import { copyToWorktree, buildPromptWithAttachments, isImageMime } from '../services/attachment-service.js';
import {
  buildCycleSummary,
  materializeContextPacketFiles,
  buildPromptContextBlock,
  type ContextPacketSourceType,
} from '../services/context-packet-service.js';
import {
  createIncrementalConversationState,
  finalizeIncrementalConversation,
  flushIncrementalConversation,
  ingestStderrConversationChunk,
  ingestStdoutConversationChunk,
} from './incremental-conversation.js';

/** Polling interval (ms) for checking DB for user responses to control requests */
const CONTROL_POLL_INTERVAL_MS = 500;

interface TaskRow {
  id: string;
  pipeline_id: string;
  name: string;
  agent_id: string;
  model: string;
  approval: string;
  status: string;
  stage: number;
  stage_id: string | null;
  input: string;
  original_input: string;
  current_input: string;
  output: string | null;
  tokens: number | null;
  duration: string | null;
  iteration: number;
  max_iterations: number;
  timeout_ms: number;
  retry_count: number;
  max_retries: number;
  user_note: string | null;
  interactive_mode: number;
  branch: string | null;
  worktree_path: string | null;
  worktree_status: string | null;
  sort_order: number;
  task_type: string;
  source_task_id: string | null;
  conflict_base_sha: string | null;
  conflict_branch_sha: string | null;
}

interface AgentRow {
  id: string;
  name: string;
  prompt: string;
  max_tokens: number | null;
}

interface PromptContextItem {
  allowCompaction?: boolean;
  content: string;
  maxLines?: number;
  maxTokens?: number;
  sourceKey: string;
  sourceType: ContextPacketSourceType;
  title: string;
}

function buildCycleHistorySection(taskId: string, cycleId: string): string | null {
  const db = getDb();
  const messages = db.prepare(`
    SELECT role, message_type, content
    FROM conversation_messages
    WHERE task_id = ? AND cycle_id = ?
    ORDER BY created_at ASC
    LIMIT 24
  `).all(taskId, cycleId) as { role: string; message_type: string; content: string }[];

  if (messages.length === 0) return null;

  const lines = messages.map((message) => {
    const label = message.role === 'assistant'
      ? 'Assistant'
      : message.role === 'user'
        ? 'User'
        : 'System';
    const trimmed = message.content.trim();
    const content = trimmed.length > 700
      ? trimmed.slice(0, 700) + '\n... (truncated)'
      : trimmed;
    return `### ${label} (${message.message_type})\n${content}`;
  });

  return `## Current Cycle History\n${lines.join('\n\n')}`;
}

function buildPromptContextSection(
  task: TaskRow,
  sectionTitle: string,
  items: PromptContextItem[],
  cycleId?: string,
): string | null {
  const rendered = items
    .filter((item) => item.content.trim().length > 0)
    .map((item) => buildPromptContextBlock({
      allowCompaction: item.allowCompaction,
      content: item.content,
      cycleId: cycleId ?? null,
      maxLines: item.maxLines,
      maxTokens: item.maxTokens,
      pipelineId: task.pipeline_id,
      sourceKey: item.sourceKey,
      sourceType: item.sourceType,
      taskId: task.id,
      title: item.title,
    }).rendered);

  if (rendered.length === 0) return null;
  return `## ${sectionTitle}\n${rendered.join('\n\n')}`;
}

/** Assemble the full prompt for a task, including context from dependencies */
function assembleInput(
  task: TaskRow,
  agent: AgentRow,
  options?: {
    allowContextCompaction?: boolean;
    cycleId?: string;
    triggerType?: string;
    followUpPrompt?: string;
  },
): string {
  const db = getDb();
  const parts: string[] = [];

  // 1. Agent role / job description
  if (agent.prompt) {
    parts.push(`## Role\n${agent.prompt}`);
  }

  // 2. Pipeline rules & constraints
  const pipeline = db.prepare('SELECT rules FROM pipelines WHERE id = ?').get(task.pipeline_id) as { rules: string | null } | undefined;
  if (pipeline?.rules?.trim()) {
    parts.push(`## Rules & Constraints\n${pipeline.rules.trim()}`);
  }

  // 3. Context from completed dependency tasks
  const deps = db.prepare(
    'SELECT depends_on_task_id FROM task_deps WHERE task_id = ?'
  ).all(task.id) as { depends_on_task_id: string }[];

  if (deps.length > 0) {
    const depOutputs: PromptContextItem[] = [];
    for (const dep of deps) {
      const depTask = db.prepare('SELECT name, output FROM tasks WHERE id = ?').get(dep.depends_on_task_id) as { name: string; output: string | null } | undefined;
      if (depTask?.output) {
        depOutputs.push({
          allowCompaction: options?.allowContextCompaction,
          content: depTask.output,
          maxLines: 18,
          maxTokens: 360,
          sourceKey: dep.depends_on_task_id,
          sourceType: 'dependency_output',
          title: depTask.name,
        });
      }
    }
    const depSection = buildPromptContextSection(
      task,
      'Previous Task Outputs',
      depOutputs,
      options?.cycleId,
    );
    if (depSection) {
      parts.push(depSection);
    }
  }

  // 3b. Sibling task outputs (completed tasks in same pipeline, not already shown as deps)
  {
    const depIds = new Set(deps.map((d) => d.depends_on_task_id));
    const MAX_SIBLING_TASKS = 6;
    const MAX_SIBLING_OUTPUT = 2000;

    const siblingTasks = db.prepare(`
      SELECT t.id, t.name, t.output
      FROM tasks t
      LEFT JOIN execution_runs er ON er.task_id = t.id AND er.status = 'completed'
      WHERE t.pipeline_id = ?
        AND t.id != ?
        AND t.status = 'completed'
        AND t.archived_at IS NULL
      GROUP BY t.id
      ORDER BY COALESCE(MAX(er.completed_at), t.created_at) ASC
      LIMIT 10
    `).all(task.pipeline_id, task.id) as { id: string; name: string; output: string | null }[];

    const siblings = siblingTasks
      .filter((s) => !depIds.has(s.id) && s.output?.trim())
      .slice(-MAX_SIBLING_TASKS);

    if (siblings.length > 0) {
      const siblingSection = buildPromptContextSection(
        task,
        'Completed Pipeline Tasks',
        siblings.map((s) => {
          let output = s.output!.trim();
          if (output.length > MAX_SIBLING_OUTPUT) {
            output = output.slice(0, MAX_SIBLING_OUTPUT) + '\n... (truncated)';
          }
          return {
            allowCompaction: options?.allowContextCompaction,
            content: output,
            maxLines: 16,
            maxTokens: 320,
            sourceKey: s.id,
            sourceType: 'sibling_output' as const,
            title: s.name,
          };
        }),
        options?.cycleId,
      );
      if (siblingSection) {
        parts.push(siblingSection);
      }
    }
  }

  // 4. Current cycle context
  if (options?.cycleId) {
    const cycleRow = db.prepare(
      'SELECT cycle_number, summary FROM task_cycles WHERE id = ?'
    ).get(options.cycleId) as { cycle_number: number; summary: string } | undefined;

    if (cycleRow) {
      parts.push(`## Task Cycle\nCurrent run thread: Run #${cycleRow.cycle_number}`);
      if (cycleRow.summary?.trim()) {
        const cycleSummary = buildPromptContextSection(
          task,
          'Task Cycle Summary',
          [{
            allowCompaction: options?.allowContextCompaction,
            content: cycleRow.summary.trim(),
            maxLines: 10,
            maxTokens: 180,
            sourceKey: options.cycleId,
            sourceType: 'cycle_summary',
            title: `Run #${cycleRow.cycle_number}`,
          }],
          options?.cycleId,
        );
        if (cycleSummary) {
          parts.push(cycleSummary);
        }
      }
    }

    const cycleHistory = buildCycleHistorySection(task.id, options.cycleId);
    if (cycleHistory) {
      const historySection = buildPromptContextSection(
        task,
        'Current Cycle History',
          [{
          allowCompaction: options?.allowContextCompaction,
          content: cycleHistory.replace(/^## Current Cycle History\n/, ''),
          maxLines: 20,
          maxTokens: 420,
          sourceKey: options.cycleId,
          sourceType: 'cycle_history',
          title: `Run #${cycleRow?.cycle_number ?? '?'}`,
        }],
        options.cycleId,
      );
      if (historySection) {
        parts.push(historySection);
      }
    }
  }

  // 5. Previous run context (injects previous output regardless of status)
  {
    const lastRun = db.prepare(
      "SELECT parsed_output, stdout, stderr, status, error_message, exit_code, duration_ms, model_used FROM execution_runs WHERE task_id = ? AND status != 'running' ORDER BY attempt DESC LIMIT 1"
    ).get(task.id) as {
      parsed_output: string | null;
      stdout: string | null;
      stderr: string | null;
      status: string;
      error_message: string | null;
      exit_code: number | null;
      duration_ms: number | null;
      model_used: string | null;
    } | undefined;

    if (lastRun) {
      const MAX_PREV_OUTPUT = 8000;
      const MAX_STDERR = 2000;

      if (lastRun.status === 'completed' || lastRun.status === 'aborted') {
        // Previous run SUCCEEDED — provide its output as context
        const output = lastRun.parsed_output?.trim() || lastRun.stdout?.trim();
        if (output) {
          let prevOutput = output;
          if (prevOutput.length > MAX_PREV_OUTPUT) {
            prevOutput = prevOutput.slice(0, MAX_PREV_OUTPUT) + '\n... (truncated)';
          }
          const previousRunSection = buildPromptContextSection(
            task,
            'Previous Run Output',
            [{
              allowCompaction: options?.allowContextCompaction,
              content: [
                lastRun.model_used ? `Model: ${lastRun.model_used}` : null,
                'Output:',
                prevOutput,
                'Instructions: This task was previously completed. You are re-running it — review the previous output, then improve or continue the work. Do not redo what was already done correctly.',
              ].filter(Boolean).join('\n\n'),
              maxLines: 18,
              maxTokens: 360,
              sourceKey: `completed:${lastRun.model_used ?? 'unknown'}`,
              sourceType: 'previous_run',
              title: 'Previous completed attempt',
            }],
            options?.cycleId,
          );
          if (previousRunSection) {
            parts.push(previousRunSection);
          }
        }
      } else if (lastRun.stdout?.trim() || lastRun.stderr?.trim() || lastRun.error_message) {
        // Previous run FAILED/TIMEOUT — show error context
        let previousOutput = '';
        if (lastRun.stdout && lastRun.stdout.trim().length > 0) {
          previousOutput = lastRun.stdout.trim();
          if (previousOutput.length > MAX_PREV_OUTPUT) {
            previousOutput = '... (truncated)\n' + previousOutput.slice(-MAX_PREV_OUTPUT);
          }
        }

        let stderrContent = '';
        if (lastRun.stderr && lastRun.stderr.trim().length > 0) {
          stderrContent = lastRun.stderr.trim();
          if (stderrContent.length > MAX_STDERR) {
            stderrContent = '... (truncated)\n' + stderrContent.slice(-MAX_STDERR);
          }
        }

        const failedLines = [
          lastRun.model_used ? `Model: ${lastRun.model_used}` : null,
          lastRun.status === 'timeout'
            ? `Failure Reason: Timed out after ${Math.round((lastRun.duration_ms ?? 0) / 60_000)} minutes.`
            : lastRun.error_message
              ? `Failure Reason: ${lastRun.error_message.slice(0, 200)}`
              : null,
          lastRun.exit_code !== null && lastRun.exit_code !== 0
            ? `Exit Code: ${lastRun.exit_code}`
            : null,
          stderrContent ? `Error Output (stderr):\n${stderrContent}` : null,
          previousOutput ? `Previous Output:\n${previousOutput}` : null,
          'Instructions: Fix the issues described above and try again. Do NOT repeat the same approach that failed.',
        ].filter(Boolean).join('\n\n');
        const failedSection = buildPromptContextSection(
          task,
          'Previous Attempt Failed',
          [{
            allowCompaction: options?.allowContextCompaction,
            content: failedLines,
            maxLines: 20,
            maxTokens: 380,
            sourceKey: `failed:${lastRun.model_used ?? 'unknown'}`,
            sourceType: 'previous_run',
            title: 'Previous failed attempt',
          }],
          options?.cycleId,
        );
        if (failedSection) {
          parts.push(failedSection);
        }
      }
    }

  }

  // 6. Pipeline context (project memory)
  const ctxRows = db.prepare(
    'SELECT key, value FROM pipeline_ctx WHERE pipeline_id = ?'
  ).all(task.pipeline_id) as { key: string; value: string }[];

  const projectCtx = ctxRows.filter((r) => !r.key.startsWith('task_output:'));
  if (projectCtx.length > 0) {
    const ctxStr = projectCtx.map((r) => `- ${r.key}: ${r.value}`).join('\n');
    const contextSection = buildPromptContextSection(
      task,
      'Project Context',
      [{
        allowCompaction: options?.allowContextCompaction,
        content: ctxStr,
        maxLines: 16,
        maxTokens: 260,
        sourceKey: 'pipeline_ctx',
        sourceType: 'project_context',
        title: 'Pipeline context',
      }],
      options?.cycleId,
    );
    if (contextSection) {
      parts.push(contextSection);
    }
  }

  const memoryRows = db.prepare(`
    SELECT layer, key, value
    FROM memory
    WHERE pipeline_id = ?
      AND layer IN ('project', 'artifact', 'cycle')
    ORDER BY created_at ASC
    LIMIT 20
  `).all(task.pipeline_id) as { layer: string; key: string; value: string }[];

  if (memoryRows.length > 0) {
    const memoryStr = memoryRows.map((row) => `- [${row.layer}] ${row.key}: ${row.value}`).join('\n');
    const memorySection = buildPromptContextSection(
      task,
      'Shared Memory',
      [{
        allowCompaction: options?.allowContextCompaction,
        content: memoryStr,
        maxLines: 18,
        maxTokens: 280,
        sourceKey: 'memory',
        sourceType: 'shared_memory',
        title: 'Shared memory',
      }],
      options?.cycleId,
    );
    if (memorySection) {
      parts.push(memorySection);
    }
  }

  // 7. Task-specific input
  if (task.original_input?.trim()) {
    parts.push(`## Original Task Input\n${task.original_input.trim()}`);
  }

  const currentInput = task.current_input?.trim() || task.input?.trim();
  if (currentInput) {
    parts.push(`## Current Task Input\n${currentInput}`);
  }

  if (options?.followUpPrompt?.trim()) {
    parts.push(`## Latest User Follow-up\n${options.followUpPrompt.trim()}`);
  }

  if (options?.triggerType === 'agent_switch' || options?.triggerType === 'provider_switch' || options?.triggerType === 'model_switch') {
    parts.push('## Handoff Instructions\nYou are taking over an existing task cycle. Review the prior thread context carefully, preserve previously completed work, and continue from the latest user intent without dropping the original task requirements.');
  }

  // 8. Completion Protocol (always injected)
  const completionParts: string[] = [];

  completionParts.push(`## Completion Protocol
When you finish your work, follow these steps:

### Git — MANDATORY
- **IMPORTANT: You MUST commit your changes before finishing.** Run: \`git add -A && git commit -m "type(scope): description"\`
- Use conventional commits: feat, fix, refactor, chore, docs, test, style, perf
- If you're in a worktree, only commit to your own branch — never touch main/master.
- Write meaningful commit messages that describe WHY, not just WHAT.
- **Do NOT finish without committing. Uncommitted changes will be lost.**

### Output
- End your response with a clear summary of what you accomplished.
- If downstream tasks depend on your work, structure your output so they can parse it (e.g., file paths created, API contracts defined, design tokens chosen).
- If you encountered blockers or made trade-off decisions, document them in your output.`);

  // Spawn instructions (if auto_spawn enabled)
  const spawnEnabled = db.prepare(
    "SELECT value FROM settings WHERE key = 'auto_spawn_follow_ups'"
  ).get() as { value: string } | undefined;

  if (spawnEnabled?.value === 'true') {
    const agents = db.prepare('SELECT id, name FROM agents').all() as { id: string; name: string }[];
    const agentList = agents.map((a) => `${a.id} (${a.name})`).join(', ');

    // Detect if this is a review/QA task by agent type or task name patterns
    const isReviewTask = task.agent_id === 'qa'
      || /review|test|audit|verify|check|inspect|validate/i.test(task.name);

    completionParts.push(`### Follow-up Task Spawning
${isReviewTask
  ? `IMPORTANT: If you find ANY critical issues, blockers, or bugs, you MUST spawn fix tasks using the block below. Do NOT just report issues without spawning — the whole point of automated review is to trigger fixes automatically. For each blocker/critical finding, spawn a targeted fix task assigned to the appropriate agent.`
  : `If your work reveals issues, bugs, or follow-up needs, you can spawn tasks by including this block at the END of your output:`}

Include this block at the END of your output:

\`\`\`
<!-- SPAWN_TASKS
[
  {
    "name": "Short task name",
    "agentId": "developer",
    "model": "claude",
    "approval": "auto",
    "input": "Detailed instructions for the follow-up task including: file paths, line numbers, what to fix, and expected outcome...",
    "priority": "high"
  }
]
SPAWN_TASKS -->
\`\`\`

Available agents: ${agentList}

When to spawn:
- You found critical/blocker issues → MUST spawn a fix task (developer agent) for each one
- You wrote code → spawn a test task (qa agent) if no tests exist yet
- You found a bug outside your scope → spawn a fix task (developer agent)
- You made architecture decisions → spawn a documentation task if needed
${isReviewTask
  ? `- CONDITIONAL PASS with blockers → spawn fix tasks for EVERY blocker, then spawn a verification task (qa agent) that depends on all fixes
- Each spawned fix task should reference the specific file, line number, and exact change needed`
  : `Do NOT spawn for trivial issues or things you can fix yourself.`}`);
  }

  parts.push(completionParts.join('\n\n'));

  // 9. User note (for retry guidance)
  if (task.user_note) {
    parts.push(`## Additional Instructions\n${task.user_note}`);
  }

  return parts.join('\n\n');
}

/**
 * Assemble a lightweight prompt for resume mode.
 * Since --resume restores the full conversation history, we only need the follow-up instruction.
 */
function assembleResumeInput(_task: TaskRow, _agent: AgentRow, followUpPrompt?: string): string {
  if (followUpPrompt) {
    return followUpPrompt;
  }
  return 'Continue from where you left off. Review your previous work and make any improvements if needed.';
}

/** Error thrown when merge conflicts prevent worktree creation */
class MergeConflictError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly mergeResult: MergeResult,
  ) {
    super(`Merge conflict in task ${taskId}: ${mergeResult.conflictFiles?.join(', ')}`);
    this.name = 'MergeConflictError';
  }
}

/** Resolve the project dir from pipeline settings */
function resolveProjectDir(pipelineId: string): string {
  const db = getDb();
  const pipelineRow = db.prepare('SELECT working_dir FROM pipelines WHERE id = ?').get(pipelineId) as { working_dir: string } | undefined;
  const pipelineDir = pipelineRow?.working_dir && pipelineRow.working_dir !== '.' ? pipelineRow.working_dir : null;
  const wdSetting = db.prepare("SELECT value FROM settings WHERE key = 'working_directory'").get() as { value: string } | undefined;
  return pipelineDir || wdSetting?.value || process.cwd();
}

function resolvePipelineBaseRef(pipelineId: string): string {
  const db = getDb();
  const pipelineRow = db.prepare(
    'SELECT git_branch FROM pipelines WHERE id = ?'
  ).get(pipelineId) as { git_branch: string | null } | undefined;
  return pipelineRow?.git_branch?.trim() || 'HEAD';
}

/** Get the working directory for a task — creates worktree with dependency merging */
function resolveWorkingDir(taskId: string, pipelineId: string): string {
  const db = getDb();
  const projectDir = resolveProjectDir(pipelineId);
  const pipelineBaseRef = resolvePipelineBaseRef(pipelineId);

  // Read task-level worktree settings
  const taskMeta = db.prepare(
    'SELECT use_worktree, branch, source_task_id, task_type, worktree_path FROM tasks WHERE id = ?'
  ).get(taskId) as {
    use_worktree: number;
    branch: string | null;
    source_task_id: string | null;
    task_type: string;
    worktree_path: string | null;
  } | undefined;

  // Priority 1: Task-level opt-out — run directly in project dir
  if (taskMeta?.use_worktree === 0) {
    return projectDir;
  }

  // Priority 2: Global setting (respected when task has default use_worktree=1)
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'worktree_isolation'").get() as { value: string } | undefined;
  const globalWorktree = setting?.value !== 'false';

  if (!globalWorktree && !taskMeta?.branch) {
    return projectDir;
  }

  // Priority 3: Task-level branch — create worktree from specified ref
  if (taskMeta?.branch) {
    // Reuse existing worktree if present
    if (taskMeta.worktree_path && existsSync(taskMeta.worktree_path)) {
      db.prepare('UPDATE tasks SET worktree_status = ? WHERE id = ?')
        .run('active', taskId);
      return taskMeta.worktree_path;
    }

    ensureGitignore(projectDir);
    const worktree = createWorktreeFromRef(taskId, projectDir, taskMeta.branch);
    db.prepare('UPDATE tasks SET worktree_path = ?, worktree_status = ? WHERE id = ?')
      .run(worktree.path, 'active', taskId);
    return worktree.path;
  }

  // Fixer/spawned task: reuse source task's worktree (same branch, no fork)
  if ((taskMeta?.task_type === 'system' || taskMeta?.task_type === 'spawned') && taskMeta?.source_task_id) {
    const sourceTask = db.prepare('SELECT worktree_path FROM tasks WHERE id = ?')
      .get(taskMeta.source_task_id) as { worktree_path: string | null } | undefined;
    if (sourceTask?.worktree_path && existsSync(sourceTask.worktree_path)) {
      db.prepare('UPDATE tasks SET worktree_path = ?, worktree_status = ? WHERE id = ?')
        .run(sourceTask.worktree_path, 'active', taskId);
      return sourceTask.worktree_path;
    }
  }

  // Reuse existing worktree if present (e.g., after merge conflict resolution)
  if (taskMeta?.worktree_path && existsSync(taskMeta.worktree_path)) {
    db.prepare('UPDATE tasks SET worktree_status = ? WHERE id = ?')
      .run('active', taskId);
    return taskMeta.worktree_path;
  }

  ensureGitignore(projectDir);

  // Find dependency branches that have actual commits
  const deps = db.prepare('SELECT depends_on_task_id FROM task_deps WHERE task_id = ?')
    .all(taskId) as { depends_on_task_id: string }[];

  const depBranches: string[] = [];
  for (const dep of deps) {
    const branch = `task/${dep.depends_on_task_id}`;
    if (branchHasCommits(branch, projectDir, pipelineBaseRef)) {
      depBranches.push(branch);
    }
  }

  // Create worktree based on dependency count
  let worktree;

  if (depBranches.length === 0) {
    // No dependency changes — branch from pipeline default ref.
    worktree = createWorktree(taskId, projectDir, pipelineBaseRef);
  } else if (depBranches.length === 1) {
    // Single dependency — branch directly from dep's branch
    worktree = createWorktreeFromRef(taskId, projectDir, depBranches[0]!);
  } else {
    // Multiple dependencies — branch from first, merge rest
    worktree = createWorktreeFromRef(taskId, projectDir, depBranches[0]!);

    for (let i = 1; i < depBranches.length; i++) {
      const mergeResult = mergeBranch(worktree.path, depBranches[i]!);
      if (!mergeResult.ok) {
        // Capture (base, branch) SHAs so identical retries reuse the same fixer.
        let baseSha: string | null = null;
        let branchSha: string | null = null;
        try {
          baseSha = execSync('git rev-parse HEAD', {
            cwd: worktree.path,
            stdio: 'pipe',
          }).toString().trim();
        } catch { /* leave null */ }
        try {
          branchSha = execSync(`git rev-parse --verify "${depBranches[i]!}"`, {
            cwd: projectDir,
            stdio: 'pipe',
          }).toString().trim();
        } catch { /* leave null */ }

        spawnMergeFixerTask(
          taskId, pipelineId, worktree.path, mergeResult, depBranches, baseSha, branchSha,
        );
        throw new MergeConflictError(taskId, mergeResult);
      }
    }
  }

  // Store worktree path in task
  db.prepare('UPDATE tasks SET worktree_path = ?, worktree_status = ? WHERE id = ?')
    .run(worktree.path, 'active', taskId);

  return worktree.path;
}

/** Create an execution run record */
function createExecutionRun(
  taskId: string,
  cycleId: string,
  attempt: number,
  attemptNumber: number,
  executorType: string,
  model: string,
  agentId: string,
  provider: string,
  worktreePath: string | null,
  followUpPrompt: string | null = null,
  isFollowUp = false,
  triggerType = 'initial',
  parentRunId: string | null = null,
): string {
  const db = getDb();
  const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  db.prepare(`
    INSERT INTO execution_runs (
      id, task_id, cycle_id, attempt, attempt_number, status, started_at,
      executor_type, model_used, agent_id, provider, worktree_path,
      follow_up_prompt, is_follow_up, trigger_type, parent_run_id
    ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId,
    taskId,
    cycleId,
    attempt,
    attemptNumber,
    new Date().toISOString(),
    executorType,
    model,
    agentId,
    provider,
    worktreePath,
    followUpPrompt,
    isFollowUp ? 1 : 0,
    triggerType,
    parentRunId,
  );

  // Link task to current run
  db.prepare('UPDATE tasks SET current_run_id = ? WHERE id = ?').run(runId, taskId);

  return runId;
}

/** Update execution run with results */
function completeExecutionRun(runId: string, result: ExecutorResult, status: 'completed' | 'failed' | 'aborted' | 'timeout', errorMessage?: string): void {
  const db = getDb();
  const completedAt = new Date().toISOString();
  const existingRun = db.prepare(
    'SELECT model_used, started_at FROM execution_runs WHERE id = ?',
  ).get(runId) as { model_used: string | null; started_at: string } | undefined;
  const parsedStdout = parseCliOutput(result.output);
  const parsedStderr = parsedStdout.meta ? null : parseCliOutput(result.stderr ?? '');
  const usageMetrics = buildFrozenRunUsageMetrics({
    calculatedAt: completedAt,
    db,
    fallbackTokens: result.tokens,
    meta: parsedStdout.meta ?? parsedStderr?.meta,
    modelId: existingRun?.model_used ?? null,
  });

  // Smart truncation: strip stream_event lines first (they're redundant with assistant messages),
  // then fall back to tail-truncation only if still too large.
  let stdout = result.output;
  const MAX_STDOUT = 512 * 1024;
  if (stdout.length > MAX_STDOUT) {
    // Remove stream_event lines (text deltas) — assistant messages contain the final text
    const lines = stdout.split('\n');
    const kept: string[] = [];
    for (const line of lines) {
      if (line.includes('"stream_event"')) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'stream_event') continue; // skip delta lines
        } catch { /* keep unparseable lines */ }
      }
      kept.push(line);
    }
    stdout = kept.join('\n');

    // If still too large after stripping deltas, tail-truncate
    if (stdout.length > MAX_STDOUT) {
      stdout = stdout.slice(-MAX_STDOUT);
      stdout = '[OUTPUT TRUNCATED]\n' + stdout;
    }
  }

  db.prepare(`
    UPDATE execution_runs
    SET status = ?, completed_at = ?, exit_code = ?, stdout = ?, stderr = ?,
        tokens_used = ?, input_tokens = ?, output_tokens = ?,
        cache_read_input_tokens = ?, cache_creation_input_tokens = ?,
        cost_usd = ?, pricing_source = ?, pricing_snapshot_json = ?,
        duration_ms = ?, error_message = ?, session_id = ?, provider_session_id = ?
    WHERE id = ?
  `).run(
    status,
    completedAt,
    result.exitCode,
    stdout,
    result.stderr,
    usageMetrics.tokensUsed,
    usageMetrics.inputTokens,
    usageMetrics.outputTokens,
    usageMetrics.cacheReadInputTokens,
    usageMetrics.cacheCreationInputTokens,
    usageMetrics.costUsd,
    usageMetrics.pricingSource,
    usageMetrics.pricingSnapshotJson,
    result.durationMs,
    errorMessage ?? null,
    result.sessionId ?? null,
    result.sessionId ?? null,
    runId
  );
}

/** Extract human-readable text from stream-json stdout for live display */
export function extractLiveStreamText(raw: string): string {
  return extractStreamText(raw);
}

function extractStreamText(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // Quick check: if no JSON stream markers, it's plain text — return as-is
  if (!trimmed.includes('"type":')) {
    return trimmed;
  }

  const lines = trimmed.split('\n');
  const deltas: string[] = [];
  const assistantTexts: string[] = [];
  const codexTexts: string[] = [];
  const geminiTexts: string[] = [];
  let resultText: string | undefined;
  let foundJsonLine = false;

  for (const line of lines) {
    if (!line.includes('"type":')) continue;
    try {
      const obj = JSON.parse(line);
      foundJsonLine = true;

      // Claude: stream_event text deltas
      if (obj.type === 'stream_event') {
        const delta = obj.event?.delta;
        if (delta?.type === 'text_delta' && delta.text) {
          deltas.push(delta.text);
        }
      }

      // Claude: assistant message text blocks (full messages, not deltas)
      if (obj.type === 'assistant' && obj.message?.content) {
        for (const block of obj.message.content as Array<Record<string, unknown>>) {
          if (block.type === 'text' && typeof block.text === 'string' && (block.text as string).trim()) {
            assistantTexts.push(block.text as string);
          }
        }
      }

      // Codex: item.completed with agent_message
      if ((obj.type === 'item.completed' || obj.type === 'item.started') && obj.item?.type === 'agent_message') {
        if (typeof obj.item.text === 'string' && (obj.item.text as string).trim()) {
          codexTexts.push(obj.item.text as string);
        }
      }

      // Gemini: assistant messages
      if (obj.type === 'message' && obj.role === 'assistant' && typeof obj.content === 'string') {
        geminiTexts.push(obj.content as string);
      }

      // Final result line (Claude / Gemini)
      if (obj.type === 'result' && typeof obj.result === 'string' && (obj.result as string).trim()) {
        resultText = obj.result as string;
      }
    } catch {
      continue;
    }
  }

  // Priority: result > assistant messages > deltas > codex > gemini > plain text fallback
  if (resultText) return resultText;
  if (assistantTexts.length > 0) return assistantTexts.join('\n\n');
  if (deltas.length > 0) return deltas.join('');
  if (codexTexts.length > 0) return codexTexts.join('\n\n');
  if (geminiTexts.length > 0) return geminiTexts.join('\n\n');

  // No structured data extracted — if no JSON was parsed, return raw text
  if (!foundJsonLine) return trimmed;

  return '';
}

/** Flush stdout + stderr buffers and elapsed time to execution_run (called periodically during execution) */
function flushOutput(runId: string, stdout: string, stderr: string, startTime: number): void {
  try {
    const db = getDb();
    const cap = 2 * 1024 * 1024; // 2MB to accommodate stream-json with images
    const cappedStdout = stdout.length > cap ? stdout.slice(-cap) : stdout;
    const cappedStderr = stderr.length > cap ? stderr.slice(-cap) : stderr;
    const elapsed = Date.now() - startTime;
    db.prepare('UPDATE execution_runs SET stdout = ?, stderr = ?, duration_ms = ? WHERE id = ?')
      .run(cappedStdout, cappedStderr, elapsed, runId);
  } catch {
    // Non-critical, ignore
  }
}

export interface RateLimitHoldOpts {
  task: TaskRow;
  taskId: string;
  cycleId: string;
  runId: string;
  provider: string;
  attempt: number;
  attemptNumber: number;
  rateLimit: RateLimitInfo;
  /** Original CLI error; kept in meta for diagnostics when `source` is a fallback. */
  errorMsg: string;
  insertLog: { run: (...args: unknown[]) => void };
}

/**
 * Park a task in `rate_limited` status without consuming a retry. The
 * rate-limit resumer flips it back to `queued` once `resume_at` passes.
 *
 * Exported so the contract (retry_count NOT incremented, resume_at set,
 * event emitted) can be exercised in unit tests without driving the full
 * `handleTaskFailure` surface.
 */
export function holdTaskForRateLimit(opts: RateLimitHoldOpts): void {
  const {
    task, taskId, cycleId, runId, provider,
    attempt, attemptNumber, rateLimit, errorMsg, insertLog,
  } = opts;
  const db = getDb();

  db.prepare(
    'UPDATE tasks SET status = ?, resume_at = ?, current_run_id = NULL WHERE id = ?',
  ).run('rate_limited', rateLimit.resumeAt.toISOString(), taskId);

  reopenCycle(cycleId);
  setCycleStatus(cycleId, 'queued');

  createConversationMessage({
    taskId,
    cycleId,
    runId,
    role: 'system',
    messageType: 'event',
    content: `Attempt #${attemptNumber} hit ${provider} rate limit. Resuming at ${rateLimit.resumeAt.toISOString()} (matched: "${rateLimit.source}").`,
    agentId: task.agent_id,
    provider,
    modelUsed: task.model,
    meta: {
      attempt,
      attemptNumber,
      rateLimited: true,
      resumeAt: rateLimit.resumeAt.toISOString(),
      matched: rateLimit.source,
      error: errorMsg.slice(0, 500),
    },
  });

  insertLog.run(
    task.pipeline_id, logTimestamp(), 'warning',
    `'${task.name}' rate-limited by ${provider} — resuming at ${rateLimit.resumeAt.toLocaleString()}`,
  );

  eventBus.emit('task:rate_limited', {
    taskId, pipelineId: task.pipeline_id, taskName: task.name,
    status: 'rate_limited', resumeAt: rateLimit.resumeAt.toISOString(),
  });

  recalcPipelineStatus(task.pipeline_id);
}

/**
 * Handle task failure with auto-retry support.
 * If auto_retry is enabled and retry_count < max_retries, re-enqueue with feedback.
 * Otherwise, mark as failed.
 */
async function handleTaskFailure(
  db: ReturnType<typeof getDb>,
  taskId: string,
  cycleId: string,
  runId: string,
  task: TaskRow,
  errorMsg: string,
  isTimeout: boolean,
  attempt: number,
  attemptNumber: number,
  provider: string,
  insertLog: { run: (...args: unknown[]) => void },
  workingDir: string,
  exitCode: number,
  taskDurationMs: number,
  taskTokens: number,
): Promise<void> {
  // Provider-level rate limit: hold the task instead of consuming a retry.
  // The rate-limit resumer will flip it back to 'queued' once resume_at passes.
  const rateLimit = isTimeout ? null : detectRateLimit(errorMsg, provider);
  if (rateLimit) {
    holdTaskForRateLimit({
      task, taskId, cycleId, runId, provider,
      attempt, attemptNumber, rateLimit, errorMsg, insertLog,
    });
    return;
  }

  // Increment retry_count
  db.prepare('UPDATE tasks SET retry_count = retry_count + 1 WHERE id = ?').run(taskId);

  // Re-read to get current counters
  const updated = db.prepare('SELECT retry_count, max_retries, auto_retry, iteration FROM tasks WHERE id = ?')
    .get(taskId) as { retry_count: number; max_retries: number; auto_retry: number; iteration: number };

  if (updated.auto_retry === 1 && updated.retry_count < updated.max_retries) {
    // Auto-retry: re-enqueue with incremented iteration for feedback injection
    db.prepare('UPDATE tasks SET status = ?, iteration = iteration + 1 WHERE id = ?')
      .run('queued', taskId);

    reopenCycle(cycleId);
    setCycleStatus(cycleId, 'queued');
    createConversationMessage({
      taskId,
      cycleId,
      runId,
      role: 'system',
      messageType: 'event',
      content: `Attempt #${attemptNumber} failed and queued for auto-retry.`,
      agentId: task.agent_id,
      provider,
      modelUsed: task.model,
      meta: { attempt, attemptNumber, error: errorMsg.slice(0, 500) },
    });

    insertLog.run(task.pipeline_id, logTimestamp(), 'warning',
      `'${task.name}' auto-retrying (${updated.retry_count}/${updated.max_retries}) with error feedback`);

    eventBus.emit('task:auto_retry', {
      taskId, pipelineId: task.pipeline_id, taskName: task.name, status: 'queued',
      retryCount: updated.retry_count, maxRetries: updated.max_retries,
    });

    recalcPipelineStatus(task.pipeline_id);

    // Re-enqueue for execution
    workerPool.enqueue({
      taskId,
      pipelineId: task.pipeline_id,
      taskName: task.name,
      execute: () => runTask(taskId),
    });
  } else {
    // No auto-retry or exhausted retries — mark as failed
    db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('failed', taskId);
    setCycleStatus(cycleId, 'failed');
    createConversationMessage({
      taskId,
      cycleId,
      runId,
      role: 'system',
      messageType: 'error',
      content: errorMsg,
      agentId: task.agent_id,
      provider,
      modelUsed: task.model,
      meta: { attempt, attemptNumber, exitCode, timeout: isTimeout },
    });

    setMemory(
      task.pipeline_id,
      'cycle',
      `task:${taskId}:cycle:${cycleId}:last_failure`,
      JSON.stringify({
        attemptNumber,
        error: errorMsg,
        provider,
        model: task.model,
        at: new Date().toISOString(),
      }),
      taskId,
    );

    insertLog.run(task.pipeline_id, logTimestamp(), 'error',
      `'${task.name}' ${isTimeout ? 'timed out' : 'failed'} — ${errorMsg.slice(0, 200)}`);

    eventBus.emit('task:failed', {
      taskId, pipelineId: task.pipeline_id, taskName: task.name, status: 'failed',
      error: errorMsg, attempt,
    });

    recalcPipelineStatus(task.pipeline_id);

    // Post-task hook (failure)
    await runPostTaskHook(
      taskId,
      task.name,
      task.pipeline_id,
      workingDir,
      'failed',
      exitCode,
      {
        agentId: task.agent_id,
        model: task.model,
        taskDurationMs,
        taskOutput: errorMsg,
        taskTokens,
      },
    ).catch(() => { /* non-critical */ });
  }
}

/** Run a single task end-to-end */
export async function runTask(taskId: string, followUpPrompt?: string): Promise<void> {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const depCheck = checkDependenciesSatisfied(taskId);
  if (!depCheck.ok) {
    db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('queued', taskId);
    db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)')
      .run(
        task.pipeline_id,
        logTimestamp(),
        'info',
        `'${task.name}' queued — waiting on: ${depCheck.pending.join(', ')}`,
      );
    recalcPipelineStatus(task.pipeline_id);
    return;
  }

  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(task.agent_id) as AgentRow | undefined;
  if (!agent) throw new Error(`Agent not found: ${task.agent_id}`);

  // Safety: check if provider is disabled
  const providerKey = getProviderKey(task.model);
  const providerEnabledSetting = db.prepare('SELECT value FROM settings WHERE key = ?')
    .get(`provider_${providerKey}_enabled`) as { value: string } | undefined;
  if (providerEnabledSetting?.value === 'false') {
    db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('failed', taskId);
    const insertLog = db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)');
    insertLog.run(task.pipeline_id, logTimestamp(), 'error',
      `'${task.name}' failed — provider '${providerKey}' is disabled`);

    eventBus.emit('task:failed', {
      taskId, pipelineId: task.pipeline_id, taskName: task.name, status: 'failed',
      error: `Provider '${providerKey}' is disabled`,
      attempt: 0,
    });
    return;
  }

  // Safety: check iteration limit
  if (task.iteration >= task.max_iterations) {
    db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('failed', taskId);
    const insertLog = db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)');
    insertLog.run(task.pipeline_id, logTimestamp(), 'error',
      `'${task.name}' failed — max iterations (${task.max_iterations}) reached`);

    eventBus.emit('task:failed', {
      taskId, pipelineId: task.pipeline_id, taskName: task.name, status: 'failed',
      error: `Max iterations (${task.max_iterations}) reached`,
      attempt: 0,
    });
    return;
  }

  // Safety: check retry limit
  if (task.retry_count >= task.max_retries) {
    db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('failed', taskId);
    const insertLog = db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)');
    insertLog.run(task.pipeline_id, logTimestamp(), 'error',
      `'${task.name}' failed — max retries (${task.max_retries}) exceeded`);

    eventBus.emit('task:failed', {
      taskId, pipelineId: task.pipeline_id, taskName: task.name, status: 'failed',
      error: `Max retries (${task.max_retries}) exceeded`,
      attempt: 0,
    });
    return;
  }

  // 1. Increment iteration
  db.prepare('UPDATE tasks SET iteration = iteration + 1, status = ? WHERE id = ?')
    .run('running', taskId);

  // 2. Resolve working directory (worktree with dependency merging)
  let workingDir: string;
  try {
    workingDir = resolveWorkingDir(taskId, task.pipeline_id);
  } catch (err) {
    if (err instanceof MergeConflictError) {
      // Merge conflict — fixer task already spawned by resolveWorkingDir
      // Revert task to queued so it runs again after fixer completes
      db.prepare('UPDATE tasks SET status = ?, iteration = iteration - 1 WHERE id = ?')
        .run('queued', taskId);

      const insertLog = db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)');
      insertLog.run(task.pipeline_id, logTimestamp(), 'warning',
        `'${task.name}' blocked — merge conflict in ${err.mergeResult.conflictFiles?.join(', ') ?? 'unknown files'}`);

      recalcPipelineStatus(task.pipeline_id);
      return;
    }

    // Other worktree errors — fallback to project dir
    workingDir = resolveProjectDir(task.pipeline_id);
    console.warn(`[TaskRunner] Worktree creation failed for ${taskId}, using project dir:`, (err as Error).message);
  }

  // 3. Run pre-task hook
  const preHook = await runPreTaskHook(
    taskId,
    task.name,
    task.pipeline_id,
    workingDir,
    task.agent_id,
    task.model,
  );
  if (!preHook.ok) {
    // Pre-hook failed — fail the task
    db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run('failed', taskId);
    db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)').run(
      task.pipeline_id, logTimestamp(), 'error',
      `'${task.name}' failed — pre-task hook failed`);
    eventBus.emit('task:failed', {
      taskId, pipelineId: task.pipeline_id, taskName: task.name, status: 'failed',
      error: 'Pre-task hook failed',
      attempt: 0,
    });
    await runPostTaskHook(
      taskId,
      task.name,
      task.pipeline_id,
      workingDir,
      'failed',
      preHook.result?.exitCode ?? -1,
      {
        agentId: task.agent_id,
        model: task.model,
        taskDurationMs: preHook.result?.durationMs,
        taskOutput: preHook.result?.stderr || preHook.result?.stdout || 'Pre-run hook failed',
      },
    ).catch(() => { /* non-critical */ });
    return;
  }

  // 4. Assemble input + check for resumable session
  // Always check for a previous session_id regardless of iteration counter
  // (retryTask resets iteration to 0 for re-runs, but session history persists in execution_runs)
  const cycle = getOrCreateActiveCycle(taskId, 'executor');
  reopenCycle(cycle.id);
  const {
    triggerType,
    parentRunId,
    provider,
  } = inferAttemptContext(taskId, cycle.id, task.agent_id, task.model, followUpPrompt, task.retry_count);
  const attemptNumber = getNextAttemptNumber(cycle.id);

  let resumeSessionId: string | undefined;
  const lastRunWithSession = db.prepare(
    `SELECT provider_session_id, session_id, model_used
     FROM execution_runs
     WHERE task_id = ? AND cycle_id = ? AND COALESCE(provider_session_id, session_id) IS NOT NULL
     ORDER BY COALESCE(attempt_number, attempt) DESC LIMIT 1`
  ).get(taskId, cycle.id) as {
    provider_session_id: string | null;
    session_id: string | null;
    model_used: string | null;
  } | undefined;
  if (lastRunWithSession?.provider_session_id || lastRunWithSession?.session_id) {
    // Only resume if the provider matches — can't resume a Claude session with Gemini
    const prevProvider = lastRunWithSession.model_used?.split(':')[0];
    const currentProvider = task.model?.split(':')[0];
    if (prevProvider && currentProvider && prevProvider === currentProvider) {
      resumeSessionId = lastRunWithSession.provider_session_id ?? lastRunWithSession.session_id ?? undefined;
    }
  }

  const executor = createExecutor(task.model);
  const allowContextCompaction = executor.type !== 'api';

  let prompt = resumeSessionId
    ? assembleResumeInput(task, agent, followUpPrompt)
    : assembleInput(task, agent, {
      allowContextCompaction,
      cycleId: cycle.id,
      triggerType,
      followUpPrompt,
    });

  const contextPacketPaths = allowContextCompaction
    ? materializeContextPacketFiles(prompt, workingDir)
    : [];

  // 4b. Copy task attachments to worktree and inject into prompt
  const { files: taskAttachments } = copyToWorktree(taskId, workingDir);
  if (taskAttachments.length > 0) {
    const providerKey = getProviderKey(task.model);
    prompt = buildPromptWithAttachments(prompt, taskAttachments, providerKey);
  }

  // 5. Create execution run
  const startTime = Date.now();
  const attempt = task.retry_count + 1;
  const isFollowUp = !!followUpPrompt || !!resumeSessionId;
  const runId = createExecutionRun(
    taskId, cycle.id, attempt, attemptNumber, executor.type, task.model, task.agent_id, provider, workingDir,
    followUpPrompt ?? null, isFollowUp, triggerType, parentRunId,
  );

  setCycleStatus(cycle.id, 'running');

  if (followUpPrompt?.trim()) {
    attachPendingFollowUpToRun({
      taskId,
      cycleId: cycle.id,
      runId,
      content: followUpPrompt.trim(),
      agentId: task.agent_id,
      provider,
      modelUsed: task.model,
      attempt,
      attemptNumber,
      triggerType,
    });
  } else {
    const triggerEvent = describeTriggerEvent(triggerType, agent.name, provider, task.model);
    if (triggerEvent) {
      createConversationMessage({
        taskId,
        cycleId: cycle.id,
        runId,
        role: 'system',
        messageType: 'event',
        content: triggerEvent,
        agentId: task.agent_id,
        provider,
        modelUsed: task.model,
        meta: { attempt, attemptNumber, triggerType },
      });
    }
  }

  // 6. Register abort function with worker pool
  workerPool.registerAbort(taskId, () => executor.abort());

  // Emit event
  eventBus.emit('task:started', {
    taskId, pipelineId: task.pipeline_id, taskName: task.name, status: 'running',
  });

  const insertLog = db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)');
  insertLog.run(task.pipeline_id, logTimestamp(), 'model',
    `${task.model} → ${agent.name}`);

  if (taskAttachments.length > 0) {
    insertLog.run(task.pipeline_id, logTimestamp(), 'info',
      `Copied ${taskAttachments.length} attachment(s) to .attachments/`);
  }
  // 5. Execute
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  let controlPollTimer: ReturnType<typeof setInterval> | null = null;
  const conversationState = createIncrementalConversationState(runId);
  const flushLiveState = () => {
    flushOutput(runId, stdoutBuffer, stderrBuffer, startTime);
    flushIncrementalConversation(conversationState, {
      taskId,
      cycleId: cycle.id,
      runId,
      agentId: task.agent_id,
      provider,
      modelUsed: task.model,
    });
  };

  // Interactive mode: only for Claude-based models with the flag enabled
  const isInteractive = task.interactive_mode === 1 && getProviderKey(task.model) === 'claude';

  try {
    // 7. Flush stdout + stderr + structured timeline every 1s
    flushTimer = setInterval(() => {
      flushLiveState();
    }, 1000);

    // Interactive mode: set up control request handler
    const onControlRequest = isInteractive
      ? (request: ControlRequest) => {
          const timeoutSetting = db.prepare(
            "SELECT value FROM settings WHERE key = 'interactive_question_timeout_ms'"
          ).get() as { value: string } | undefined;
          const timeoutMs = parseInt(timeoutSetting?.value ?? '300000', 10) || 300000;
          const timeoutAt = new Date(Date.now() + timeoutMs).toISOString();
          const question = extractQuestion(request.toolName, request.input);

          db.prepare(`
            INSERT INTO control_requests (id, task_id, run_id, tool_name, tool_use_id, input_json, question, status, created_at, timeout_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
          `).run(
            request.requestId, taskId, runId, request.toolName, request.toolUseId ?? null,
            JSON.stringify(request.input), question, new Date().toISOString(), timeoutAt,
          );

          insertLog.run(task.pipeline_id, logTimestamp(), 'info',
            `'${task.name}' is asking: ${question ?? request.toolName}`);

          eventBus.emit('task:question', {
            taskId, pipelineId: task.pipeline_id, taskName: task.name, status: 'running',
            requestId: request.requestId, toolName: request.toolName, question,
          });
        }
      : undefined;

    // Interactive mode: poll DB for user responses and write them to executor stdin
    if (isInteractive) {
      // Prepared statements for the poll loop (avoid re-preparing every 500ms)
      const claimRespondedStmt = db.prepare(
        "UPDATE control_requests SET status = status || '_sent' WHERE task_id = ? AND run_id = ? AND status IN ('approved', 'denied') RETURNING id, response_json"
      );
      const claimTimedOutStmt = db.prepare(
        "UPDATE control_requests SET status = 'timed_out', responded_at = ? WHERE task_id = ? AND run_id = ? AND status = 'pending' AND timeout_at < ? RETURNING id"
      );

      controlPollTimer = setInterval(() => {
        try {
          // Atomically claim user responses (approved/denied → approved_sent/denied_sent)
          const responded = claimRespondedStmt.all(taskId, runId) as { id: string; response_json: string }[];

          for (const r of responded) {
            try {
              executor.sendControlResponse?.(r.response_json);
            } catch (err) {
              console.warn(`[TaskRunner] Failed to send control response ${r.id}:`, (err as Error).message);
            }
          }

          // Atomically claim timed-out pending requests
          const now = new Date().toISOString();
          const timedOut = claimTimedOutStmt.all(now, taskId, runId, now) as { id: string }[];

          for (const r of timedOut) {
            const denyJson = buildDenyResponse(r.id, 'Timed out waiting for user response', true);
            // Store the deny response JSON
            db.prepare(
              "UPDATE control_requests SET response_json = ? WHERE id = ?"
            ).run(denyJson, r.id);
            try {
              executor.sendControlResponse?.(denyJson);
            } catch { /* process may be dead */ }
          }
        } catch {
          // Non-critical polling error
        }
      }, CONTROL_POLL_INTERVAL_MS);
    }

    if (resumeSessionId) {
      insertLog.run(task.pipeline_id, logTimestamp(), 'info',
        `Resuming session ${resumeSessionId.slice(0, 8)}...`);
    }

    const result = await executor.execute(
      {
        prompt,
        workingDir,
        timeoutMs: task.timeout_ms,
        model: task.model,
        systemPrompt: undefined,
        maxTokens: agent.max_tokens ?? undefined,
        outputFormat: 'stream-json',
        includePartialMessages: true,
        interactiveMode: isInteractive,
        resumeSessionId,
        attachments: taskAttachments.length > 0
          ? {
              images: taskAttachments
                .filter((a) => isImageMime(a.mime_type))
                .map((a) => ({ originalName: a.original_name, mimeType: a.mime_type })),
              files: taskAttachments
                .filter((a) => !isImageMime(a.mime_type))
                .map((a) => ({ originalName: a.original_name, mimeType: a.mime_type })),
            }
          : undefined,
      },
      (chunk) => {
        stdoutBuffer += chunk;
        ingestStdoutConversationChunk(conversationState, chunk);
      },
      (chunk) => {
        stderrBuffer += chunk;
        ingestStderrConversationChunk(conversationState, chunk);
      },
      onControlRequest,
    );

    if (flushTimer) clearInterval(flushTimer);
    if (controlPollTimer) clearInterval(controlPollTimer);
    finalizeIncrementalConversation(conversationState, {
      taskId,
      cycleId: cycle.id,
      runId,
      agentId: task.agent_id,
      provider,
      modelUsed: task.model,
    });

    // 6. Safety check on output
    const outputCheck = checkOutput(result.output);
    if (outputCheck.violations.length > 0) {
      for (const v of outputCheck.violations) {
        insertLog.run(task.pipeline_id, logTimestamp(), 'warning',
          `Safety: ${v.description} in '${task.name}' output`);
      }
    }

    // 7. Handle result
    if (result.exitCode === 0) {
      // Success
      completeExecutionRun(runId, result, 'completed');

      // Mark worktree as ready for review
      db.prepare('UPDATE tasks SET worktree_status = ? WHERE id = ?')
        .run('ready_for_review', taskId);

      // Parse CLI output: extract human-readable content from JSON wrappers
      const parsed = parseCliOutput(result.output);
      // Never fall back to raw stream-json output — it's unreadable binary/JSON noise
      const cleanOutput = parsed.content || '[No parseable output — agent may have produced only tool calls]';
      const effectiveTokens = parsed.meta?.inputTokens && parsed.meta?.outputTokens
        ? parsed.meta.inputTokens + parsed.meta.outputTokens
        : result.tokens;

      // Save parsed output to the execution run (per-run, never overwritten)
      db.prepare('UPDATE execution_runs SET parsed_output = ? WHERE id = ?')
        .run(cleanOutput, runId);
      upsertConversationMessage({
        id: conversationState.lastAssistantMessageId ?? `msg_${runId}_final`,
        taskId,
        cycleId: cycle.id,
        runId,
        role: 'assistant',
        messageType: 'final_answer',
        content: cleanOutput,
        agentId: task.agent_id,
        provider,
        modelUsed: task.model,
        meta: { attempt, attemptNumber, status: 'completed' },
      });

      setMemory(
        task.pipeline_id,
        'artifact',
        `task:${taskId}:cycle:${cycle.id}:attempt:${attemptNumber}:output`,
        cleanOutput,
        taskId,
      );

      setMemory(
        task.pipeline_id,
        'cycle',
        `task:${taskId}:cycle:${cycle.id}:latest`,
        JSON.stringify({
          attemptNumber,
          agentId: task.agent_id,
          provider,
          model: task.model,
          output: cleanOutput,
          completedAt: new Date().toISOString(),
        }),
        taskId,
      );

      // Complete task and cascade
      const durationStr = `${(result.durationMs / 1000).toFixed(1)}s`;
      const cascadeResult = completeAndCascade(taskId, cleanOutput, durationStr, effectiveTokens);
      refreshTaskUsageMetrics(taskId, db);

      // Auto-promote a completed merge-conflict fixer's commit onto the base
      // branch. Without this, the fixer's merge commit lives on a detached
      // HEAD in a temp worktree and the blocked task stays `blocked_by_conflict`,
      // which causes re-clicking "Merge" to spawn another fixer on a fresh
      // temp worktree each time.
      try {
        finalizeMergeFixerTask(taskId);
      } catch (err) {
        db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)')
          .run(task.pipeline_id, logTimestamp(), 'warning',
            `Finalize merge fixer failed for ${taskId.slice(-6)}: ${(err as Error).message?.slice(0, 500)}`);
      }
      setCycleStatus(cycle.id, 'completed', buildCycleSummary({
        attemptNumber,
        output: cleanOutput,
      }));

      // Auto-spawn follow-up tasks if enabled
      const spawnSetting = db.prepare(
        "SELECT value FROM settings WHERE key = 'auto_spawn_follow_ups'"
      ).get() as { value: string } | undefined;

      if (spawnSetting?.value === 'true') {
        const maxSetting = db.prepare(
          "SELECT value FROM settings WHERE key = 'max_spawned_tasks_per_completion'"
        ).get() as { value: string } | undefined;
        const maxItems = parseInt(maxSetting?.value ?? '10', 10) || 10;

        const directives = parseSpawnDirectives(cleanOutput, maxItems);

        // Warn if review/QA task found blockers but didn't spawn fixes
        if (directives.length === 0) {
          const isReviewTask = task.agent_id === 'qa'
            || /review|test|audit|verify|check|inspect|validate/i.test(task.name);
          if (isReviewTask) {
            const hasCriticalFindings = /\bcritical\b|\bblocker\b|\bmust be fixed\b|\bCONDITIONAL PASS\b|\bFAIL\b|\bfailed\b|\berrors? remain/i.test(cleanOutput);
            if (hasCriticalFindings) {
              const insertLog = db.prepare(
                'INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)'
              );
              insertLog.run(task.pipeline_id, logTimestamp(), 'warning',
                `Review task '${task.name}' found critical issues but did NOT spawn fix tasks. ` +
                `Consider manually creating fix tasks or re-running the review task.`);
              eventBus.emit('task:spawn_missing', {
                taskId, pipelineId: task.pipeline_id,
                taskName: task.name, status: 'running',
                message: 'Critical issues found but no SPAWN_TASKS block in output',
              });
            }
          }
        }

        // Always strip spawn block from saved output (even if empty)
        const strippedOutput = stripSpawnBlock(cleanOutput);
        if (strippedOutput !== cleanOutput) {
          db.prepare('UPDATE tasks SET output = ? WHERE id = ?')
            .run(strippedOutput, taskId);
          db.prepare(
            "UPDATE pipeline_ctx SET value = ? WHERE pipeline_id = ? AND key = ?"
          ).run(strippedOutput, task.pipeline_id, `task_output:${task.name}`);
          // Also strip from per-run parsed output
          db.prepare('UPDATE execution_runs SET parsed_output = ? WHERE id = ?')
            .run(strippedOutput, runId);
        }

        if (directives.length > 0) {

          const spawnedIds = spawnFollowUpTasks(taskId, task.pipeline_id, directives);

          // Enqueue spawned auto-running tasks
          for (const sid of spawnedIds) {
            const st = db.prepare('SELECT id, pipeline_id, name, status FROM tasks WHERE id = ?')
              .get(sid) as { id: string; pipeline_id: string; name: string; status: string } | undefined;
            const spawnedDepCheck = checkDependenciesSatisfied(sid);
            if (st?.status === 'queued' && spawnedDepCheck.ok) {
              workerPool.enqueue({
                taskId: sid,
                pipelineId: st.pipeline_id,
                taskName: st.name,
                execute: () => runTask(sid),
              });
            } else if (st?.status === 'awaiting_approval') {
              eventBus.emit('task:approval_needed', {
                taskId: sid, pipelineId: st.pipeline_id,
                taskName: st.name, status: 'awaiting_approval',
              });
            }
          }
        }
      }

      // Enqueue cascaded auto-running tasks into worker pool
      for (const cascadedId of cascadeResult.cascaded) {
        const cascadedTask = db.prepare('SELECT id, pipeline_id, name, status FROM tasks WHERE id = ?')
          .get(cascadedId) as { id: string; pipeline_id: string; name: string; status: string } | undefined;
        if (cascadedTask?.status === 'queued') {
          workerPool.enqueue({
            taskId: cascadedId,
            pipelineId: cascadedTask.pipeline_id,
            taskName: cascadedTask.name,
            execute: () => runTask(cascadedId),
          });
        } else if (cascadedTask?.status === 'awaiting_approval') {
          eventBus.emit('task:approval_needed', {
            taskId: cascadedId, pipelineId: cascadedTask.pipeline_id,
            taskName: cascadedTask.name, status: 'awaiting_approval',
          });
        }
      }

      eventBus.emit('task:completed', {
        taskId, pipelineId: task.pipeline_id, taskName: task.name, status: 'completed',
        output: result.output, tokens: result.tokens, durationMs: result.durationMs,
      });

      // Post-task hook (success)
      await runPostTaskHook(
        taskId,
        task.name,
        task.pipeline_id,
        workingDir,
        'completed',
        result.exitCode,
        {
          agentId: task.agent_id,
          model: task.model,
          taskDurationMs: result.durationMs,
          taskOutput: cleanOutput,
          taskTokens: effectiveTokens ?? undefined,
        },
      ).catch(() => { /* non-critical */ });

    } else {
      // Extract error from stdout result JSON when stderr is empty
      // (e.g., Claude CLI rate limit: { type: "result", is_error: true, result: "You've hit your limit..." })
      let stdoutError = '';
      if (!result.stderr && result.output) {
        const parsed = parseCliOutput(result.output);
        if (parsed.isError && parsed.content) {
          stdoutError = parsed.content;
        } else if (parsed.content && result.exitCode !== 0) {
          stdoutError = parsed.content;
        }
      }
      const errorMsg = result.stderr || stdoutError || `Exit code: ${result.exitCode}`;
      const normalizedError = errorMsg.toLowerCase();
      const isAborted = normalizedError.startsWith('aborted:') ||
        normalizedError.includes('aborted by user');
      const isTimeout = !isAborted && errorMsg.startsWith('TIMEOUT:');
      const runStatus = isAborted ? 'aborted' : (isTimeout ? 'timeout' : 'failed');

      completeExecutionRun(runId, result, runStatus, errorMsg);
      refreshTaskUsageMetrics(taskId, db);

      if (isAborted) {
        // Keep paused tasks queued; if still running, mark as blocked.
        db.prepare(
          "UPDATE tasks SET status = CASE WHEN status = 'running' THEN 'blocked' ELSE status END WHERE id = ?"
        ).run(taskId);
        setCycleStatus(cycle.id, 'blocked');
        createConversationMessage({
          taskId,
          cycleId: cycle.id,
          runId,
          role: 'system',
          messageType: 'event',
          content: `Attempt #${attemptNumber} aborted.`,
          agentId: task.agent_id,
          provider,
          modelUsed: task.model,
          meta: { attempt, attemptNumber, status: 'aborted' },
        });

        insertLog.run(task.pipeline_id, logTimestamp(), 'warning',
          `'${task.name}' aborted — ${errorMsg.slice(0, 200)}`);
      } else {
        await handleTaskFailure(
          db,
          taskId,
          cycle.id,
          runId,
          task,
          errorMsg,
          isTimeout,
          attempt,
          attemptNumber,
          provider,
          insertLog,
          workingDir,
          result.exitCode,
          result.durationMs,
          result.tokens,
        );
      }
    }

  } catch (err) {
    if (flushTimer) clearInterval(flushTimer);
    if (controlPollTimer) clearInterval(controlPollTimer);
    finalizeIncrementalConversation(conversationState, {
      taskId,
      cycleId: cycle.id,
      runId,
      agentId: task.agent_id,
      provider,
      modelUsed: task.model,
    });

    const errorMsg = (err as Error).message;
    const normalizedError = errorMsg.toLowerCase();
    const isAborted = normalizedError.startsWith('aborted:') ||
      normalizedError.includes('aborted by user');
    const isTimeout = !isAborted && (errorMsg.includes('timeout') || errorMsg.includes('TIMEOUT'));

    completeExecutionRun(runId, {
      output: stdoutBuffer, exitCode: -1, tokens: 0,
      durationMs: 0, stderr: errorMsg, artifacts: [],
    }, isAborted ? 'aborted' : (isTimeout ? 'timeout' : 'failed'), errorMsg);
    refreshTaskUsageMetrics(taskId, db);

    if (isAborted) {
      db.prepare(
        "UPDATE tasks SET status = CASE WHEN status = 'running' THEN 'blocked' ELSE status END WHERE id = ?"
      ).run(taskId);
      setCycleStatus(cycle.id, 'blocked');
      createConversationMessage({
        taskId,
        cycleId: cycle.id,
        runId,
        role: 'system',
        messageType: 'event',
        content: `Attempt #${attemptNumber} aborted.`,
        agentId: task.agent_id,
        provider,
        modelUsed: task.model,
        meta: { attempt, attemptNumber, status: 'aborted' },
      });
      insertLog.run(task.pipeline_id, logTimestamp(), 'warning',
        `'${task.name}' aborted — ${errorMsg.slice(0, 200)}`);
    } else {
      await handleTaskFailure(
        db,
        taskId,
        cycle.id,
        runId,
        task,
        errorMsg,
        isTimeout,
        attempt,
        attemptNumber,
        provider,
        insertLog,
        workingDir,
        -1,
        0,
        0,
      );
    }
  }
}

/** Max depth of recursive spawn chains (A spawns B spawns C → depth 2) */
const MAX_SPAWN_DEPTH = 3;

/** Compute how deep in the spawn chain a task is (0 = original, 1 = spawned, 2 = spawned-from-spawned) */
function getSpawnDepth(taskId: string): number {
  const db = getDb();
  let depth = 0;
  let currentId: string | null = taskId;

  while (currentId) {
    const row = db.prepare(
      "SELECT source_task_id FROM tasks WHERE id = ? AND task_type = 'spawned'"
    ).get(currentId) as { source_task_id: string | null } | undefined;

    if (!row?.source_task_id) break;
    depth++;
    currentId = row.source_task_id;

    if (depth > MAX_SPAWN_DEPTH) break; // safety guard
  }

  return depth;
}

/**
 * Resolve the pipeline stage for a spawned task based on the assigned agent.
 * Priority: directive.stage > agent-to-stage keyword match > source task fallback.
 *
 * Matching strategy:
 * 1. Direct match — agent ID substring in stage name or vice versa (e.g. "deploy" ↔ "Deploy")
 * 2. Keyword map — indirect semantic match (e.g. "qa" → "Testing", "developer" → "Development")
 * 3. Fallback — inherit source task's stage
 */
function resolveSpawnStage(
  db: import('better-sqlite3').Database,
  pipelineId: string,
  agentId: string,
  directiveStage: number | undefined,
  fallbackStage: number,
): { stage: number; stageId: string | null } {
  const stages = db.prepare(
    'SELECT id, name FROM pipeline_stages WHERE pipeline_id = ? ORDER BY sort_order',
  ).all(pipelineId) as Array<{ id: string; name: string }>;

  // No stages defined — use numeric fallback
  if (stages.length === 0) {
    return { stage: directiveStage ?? fallbackStage, stageId: null };
  }

  // Directive explicitly specifies stage — honour it
  if (directiveStage !== undefined) {
    const row = stages[directiveStage];
    return { stage: directiveStage, stageId: row?.id ?? null };
  }

  const agentLower = agentId.toLowerCase();

  // 1. Direct match: agent ID appears in stage name or vice versa
  for (let i = 0; i < stages.length; i++) {
    const stageLower = stages[i]!.name.toLowerCase();
    if (stageLower.includes(agentLower) || agentLower.includes(stageLower)) {
      return { stage: i, stageId: stages[i]!.id };
    }
  }

  // 2. Keyword map: agent role → stage name keywords
  const AGENT_STAGE_KEYWORDS: Record<string, string[]> = {
    research: ['research'],
    product: ['planning', 'plan'],
    architect: ['planning', 'plan', 'architect'],
    designer: ['design', 'planning'],
    developer: ['development', 'dev', 'implement'],
    content: ['development', 'content'],
    seo: ['review', 'seo'],
    qa: ['test', 'qa', 'quality'],
    deploy: ['deploy', 'release'],
  };

  const keywords = Object.entries(AGENT_STAGE_KEYWORDS)
    .find(([key]) => agentLower.includes(key))?.[1];

  if (keywords) {
    for (let i = 0; i < stages.length; i++) {
      const stageLower = stages[i]!.name.toLowerCase();
      if (keywords.some((kw) => stageLower.includes(kw))) {
        return { stage: i, stageId: stages[i]!.id };
      }
    }
  }

  // 3. Fallback: same stage as source task
  const fallbackRow = stages[fallbackStage];
  return { stage: fallbackStage, stageId: fallbackRow?.id ?? null };
}

/**
 * Resolve pipeline stage for a conflict-fixer/system task.
 * Conflict fixing is implementation work — target the development stage if one
 * exists. Falls back to the parent task's stage so the fixer never lands in a
 * later column than the work it blocks (e.g. deploy).
 */
function resolveFixerStage(
  db: import('better-sqlite3').Database,
  pipelineId: string,
  parentStage: number,
  parentStageId: string | null,
): { stage: number; stageId: string | null } {
  const stages = db.prepare(
    'SELECT id, name FROM pipeline_stages WHERE pipeline_id = ? ORDER BY sort_order',
  ).all(pipelineId) as Array<{ id: string; name: string }>;

  if (stages.length === 0) {
    return { stage: parentStage, stageId: parentStageId };
  }

  const DEV_KEYWORDS = ['development', 'dev', 'implement', 'build', 'code'];
  for (let i = 0; i < stages.length; i++) {
    const name = stages[i]!.name.toLowerCase();
    if (DEV_KEYWORDS.some((kw) => name.includes(kw))) {
      return { stage: i, stageId: stages[i]!.id };
    }
  }

  const fallbackRow = stages[parentStage];
  return {
    stage: parentStage,
    stageId: parentStageId ?? fallbackRow?.id ?? null,
  };
}

/** Spawn follow-up tasks from structured SPAWN_TASKS directives in task output */
function spawnFollowUpTasks(
  sourceTaskId: string,
  pipelineId: string,
  directives: import('./spawn-parser.js').SpawnDirective[],
): string[] {
  const db = getDb();
  const sourceTask = db.prepare('SELECT * FROM tasks WHERE id = ?')
    .get(sourceTaskId) as TaskRow | undefined;
  if (!sourceTask) return [];

  // Recursive spawn depth guard
  const currentDepth = getSpawnDepth(sourceTaskId);
  if (currentDepth >= MAX_SPAWN_DEPTH) {
    const insertLog = db.prepare(
      'INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)'
    );
    insertLog.run(pipelineId, logTimestamp(), 'warning',
      `Spawn blocked: '${sourceTask.name}' already at depth ${currentDepth} (max ${MAX_SPAWN_DEPTH})`);
    return [];
  }

  const insertLog = db.prepare(
    'INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)'
  );
  const now = () => logTimestamp();

  // Dedup: check for existing active tasks that already cover the same work
  const activeTasks = getActiveTasks(db, pipelineId);
  const { kept, skipped } = deduplicateSpawnDirectives(directives, activeTasks);

  for (const skip of skipped) {
    insertLog.run(pipelineId, now(), 'info',
      `Spawn dedup: skipped '${skip.directive.name}' — duplicate of '${skip.matchedTaskName}' (${skip.reason})`);
  }

  if (kept.length === 0) {
    insertLog.run(pipelineId, now(), 'info',
      `All ${directives.length} spawn directive(s) deduplicated — no new tasks created`);
    return [];
  }

  const spawnedIds: string[] = [];

  // Find downstream tasks that depend on the source task
  const downstreamDeps = db.prepare(
    'SELECT task_id FROM task_deps WHERE depends_on_task_id = ?'
  ).all(sourceTaskId) as { task_id: string }[];

  const maxSort = db.prepare(
    'SELECT MAX(sort_order) as mx FROM tasks WHERE pipeline_id = ?'
  ).get(pipelineId) as { mx: number | null };
  let sortOrder = (maxSort.mx ?? 0) + 1;

  const baseTs = Date.now();
  let previousInheritedSpawnId: string | null = null;

  db.transaction(() => {
    for (let i = 0; i < kept.length; i++) {
      const directive = kept[i]!;

      // Validate agent exists
      const agentExists = db.prepare(
        'SELECT id FROM agents WHERE id = ?'
      ).get(directive.agentId) as { id: string } | undefined;

      if (!agentExists) {
        insertLog.run(pipelineId, now(), 'warning',
          `Spawn skipped: unknown agent '${directive.agentId}' for '${directive.name}'`);
        continue;
      }

      // Use index in ID to avoid collision in tight loop
      const taskId = `t_${baseTs}_${i}_${Math.random().toString(36).slice(2, 8)}`;

      // Model priority: agent's default_model always wins (crew member config).
      // Only fall back to directive.model or sourceTask.model if agent has no default.
      const agentRow = db.prepare(
        'SELECT default_model FROM agents WHERE id = ?'
      ).get(directive.agentId) as { default_model: string } | undefined;
      const model = agentRow?.default_model || directive.model || sourceTask.model;
      const approval = directive.approval || 'auto';
      const status = approval === 'auto' ? 'queued' : 'awaiting_approval';

      // Spawned tasks always reuse source's worktree — same branch, no fork.
      // Only set explicit branch if directive specifically requests one,
      // otherwise inherit nothing (worktree_path inheritance handles isolation).
      const spawnBranch = directive.branch ?? null;
      const spawnWorktreePath = sourceTask.worktree_path ?? null;

      // Resolve stage: directive > agent-based match > source task fallback
      const { stage: spawnStage, stageId: spawnStageId } = resolveSpawnStage(
        db, pipelineId, directive.agentId, directive.stage, sourceTask.stage,
      );

      // 1. Create spawned task — inherit source's worktree (same branch, no fork)
      db.prepare(`
        INSERT INTO tasks (id, pipeline_id, name, agent_id, model, approval, status,
          stage, stage_id, input, sort_order, timeout_ms, task_type, source_task_id,
          priority, created_at, branch, worktree_path, worktree_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'spawned', ?, ?, ?, ?, ?, ?)
      `).run(
        taskId,
        pipelineId,
        directive.name,
        directive.agentId,
        model,
        approval,
        status,
        spawnStage,
        spawnStageId,
        directive.input,
        sortOrder++,
        sourceTask.timeout_ms,
        sourceTaskId,
        directive.priority ?? null,
        now(),
        spawnBranch,
        spawnWorktreePath,
        spawnWorktreePath ? 'inherited' : null,
      );

      // 2a. Spawned task depends on source (already completed)
      db.prepare(
        'INSERT INTO task_deps (task_id, depends_on_task_id) VALUES (?, ?)'
      ).run(taskId, sourceTaskId);

      if (spawnWorktreePath && !spawnBranch && previousInheritedSpawnId) {
        db.prepare(
          'INSERT INTO task_deps (task_id, depends_on_task_id) VALUES (?, ?)'
        ).run(taskId, previousInheritedSpawnId);
      }

      // 2b. Inherit source task's dependencies (transitive chain)
      const sourceDeps = db.prepare(
        'SELECT depends_on_task_id FROM task_deps WHERE task_id = ?'
      ).all(sourceTaskId) as { depends_on_task_id: string }[];

      for (const sd of sourceDeps) {
        const exists = db.prepare(
          'SELECT 1 FROM task_deps WHERE task_id = ? AND depends_on_task_id = ?'
        ).get(taskId, sd.depends_on_task_id);
        if (!exists) {
          db.prepare(
            'INSERT INTO task_deps (task_id, depends_on_task_id) VALUES (?, ?)'
          ).run(taskId, sd.depends_on_task_id);
        }
      }

      // 3. Wire downstream: tasks that depended on source now also depend on spawned
      for (const ds of downstreamDeps) {
        // Check it doesn't already exist
        const exists = db.prepare(
          'SELECT 1 FROM task_deps WHERE task_id = ? AND depends_on_task_id = ?'
        ).get(ds.task_id, taskId);
        if (!exists) {
          db.prepare(
            'INSERT INTO task_deps (task_id, depends_on_task_id) VALUES (?, ?)'
          ).run(ds.task_id, taskId);
        }

        // Revert downstream tasks that were already cascaded.
        // A new dependency was injected, so downstream must wait for the spawned task.
        const dsTask = db.prepare(
          'SELECT status FROM tasks WHERE id = ?'
        ).get(ds.task_id) as { status: string } | undefined;

        if (dsTask?.status === 'awaiting_approval' || dsTask?.status === 'queued') {
          db.prepare('UPDATE tasks SET status = ? WHERE id = ?')
            .run('queued', ds.task_id);
        } else if (dsTask?.status === 'running') {
          // Running task has an active executor — mark it for re-queue after current run.
          // The executor will see 'pending_requeue' on completion and won't cascade.
          db.prepare('UPDATE tasks SET status = ? WHERE id = ?')
            .run('pending_requeue', ds.task_id);
          insertLog.run(pipelineId, now(), 'warn',
            `Downstream task '${ds.task_id}' was running when new dep added — will re-queue after completion`);
        }
      }

      // 4. Log
      insertLog.run(pipelineId, now(), 'info',
        `Spawned follow-up: '${directive.name}' (${directive.agentId}/${model})`);

      spawnedIds.push(taskId);
      if (spawnWorktreePath && !spawnBranch) {
        previousInheritedSpawnId = taskId;
      }
    }

    recalcPipelineStatus(pipelineId);
  })();

  // 5. Emit events (outside transaction)
  if (spawnedIds.length > 0) {
    eventBus.emit('task:spawned', {
      taskId: sourceTaskId,
      pipelineId,
      taskName: sourceTask.name,
      status: 'completed',
      sourceTaskId,
      spawnedCount: spawnedIds.length,
    });
  }

  return spawnedIds;
}

/**
 * Trigger spawn from a completed task's output (manual/retry endpoint).
 * Re-parses the task output for SPAWN_TASKS directives and spawns follow-up tasks.
 * Returns spawned task IDs or empty array if nothing to spawn.
 */
export function triggerSpawnFromOutput(taskId: string): string[] {
  const db = getDb();

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as TaskRow | undefined;
  if (!task) throw new Error(`Task not found: ${taskId}`);
  if (task.status !== 'completed') throw new Error(`Task must be completed (current: ${task.status})`);
  if (!task.output) throw new Error('Task has no output to parse');

  const maxSetting = db.prepare(
    "SELECT value FROM settings WHERE key = 'max_spawned_tasks_per_completion'"
  ).get() as { value: string } | undefined;
  const maxItems = parseInt(maxSetting?.value ?? '10', 10) || 10;

  const directives = parseSpawnDirectives(task.output, maxItems);

  // Always strip spawn block from saved output (even if empty)
  const strippedOutput = stripSpawnBlock(task.output);
  if (strippedOutput !== task.output) {
    db.prepare('UPDATE tasks SET output = ? WHERE id = ?').run(strippedOutput, taskId);
    db.prepare(
      'UPDATE pipeline_ctx SET value = ? WHERE pipeline_id = ? AND key = ?'
    ).run(strippedOutput, task.pipeline_id, `task_output:${task.name}`);
  }

  if (directives.length === 0) {
    return [];
  }

  const spawnedIds = spawnFollowUpTasks(taskId, task.pipeline_id, directives);

  // Enqueue spawned auto-running tasks
  for (const sid of spawnedIds) {
    const st = db.prepare('SELECT id, pipeline_id, name, status FROM tasks WHERE id = ?')
      .get(sid) as { id: string; pipeline_id: string; name: string; status: string } | undefined;
    const spawnedDepCheck = checkDependenciesSatisfied(sid);
    if (st?.status === 'queued' && spawnedDepCheck.ok) {
      workerPool.enqueue({
        taskId: sid,
        pipelineId: st.pipeline_id,
        taskName: st.name,
        execute: () => runTask(sid),
      });
    } else if (st?.status === 'awaiting_approval') {
      eventBus.emit('task:approval_needed', {
        taskId: sid, pipelineId: st.pipeline_id,
        taskName: st.name, status: 'awaiting_approval',
      });
    }
  }

  return spawnedIds;
}

/**
 * Dedup check + supersede stale fixers for a given source task.
 *
 * Returns the existing pending fixer's id when its conflict signature
 * (base_sha + branch_sha) matches the new attempt — caller should reuse
 * it instead of spawning. When the signature differs, any non-archived
 * pending fixers are archived (their worktrees now point at stale tips)
 * so the spawn-attempt counter resets and a fresh fixer can be created.
 */
function findOrSupersedeFixer(
  sourceTaskId: string,
  namePrefix: string,
  baseSha: string | null,
  branchSha: string | null,
): { reuseId: string | null } {
  const db = getDb();
  const pending = db.prepare(
    `SELECT id, conflict_base_sha, conflict_branch_sha
     FROM tasks
     WHERE source_task_id = ?
       AND task_type = 'system'
       AND name LIKE ?
       AND archived_at IS NULL
       AND status IN ('queued', 'running', 'awaiting_approval')`,
  ).all(sourceTaskId, `${namePrefix}%`) as {
    id: string;
    conflict_base_sha: string | null;
    conflict_branch_sha: string | null;
  }[];

  for (const row of pending) {
    if (
      baseSha
      && branchSha
      && row.conflict_base_sha === baseSha
      && row.conflict_branch_sha === branchSha
    ) {
      return { reuseId: row.id };
    }
  }

  // Different signature — supersede stale pending fixers so the cap doesn't
  // trip and the new fixer can take over.
  if (pending.length > 0) {
    const archiveStmt = db.prepare(
      "UPDATE tasks SET archived_at = ?, status = 'cancelled' WHERE id = ?",
    );
    const ts = logTimestamp();
    for (const row of pending) {
      archiveStmt.run(ts, row.id);
    }
  }

  return { reuseId: null };
}

/** Spawn a fixer task for UI-triggered merge/rebase conflicts (branch ↔ main) */
export function spawnGitConflictFixer(
  taskId: string,
  pipelineId: string,
  conflictFiles: string[],
  operation: 'merge' | 'rebase',
  branch: string,
  mainBranch: string,
  worktreePath: string,
  baseSha: string | null,
  branchSha: string | null,
  mergeOutput?: string,
): string | null {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?')
    .get(taskId) as TaskRow | undefined;
  if (!task) return null;

  // Dedup: identical conflict signature → reuse the existing pending fixer.
  // Different signature (target branch advanced or task branch got new commits)
  // → supersede the stale fixer and spawn a fresh one.
  const namePrefix = 'Git Conflict (';
  const { reuseId } = findOrSupersedeFixer(taskId, namePrefix, baseSha, branchSha);
  if (reuseId) {
    db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)')
      .run(
        pipelineId,
        logTimestamp(),
        'info',
        `Git ${operation} retry on '${task.name}' — same conflict signature, reusing existing fixer ${reuseId}`,
      );
    return reuseId;
  }

  // Guard: prevent infinite fixer loop — fixer tasks created here are named
  // `Git Conflict (merge|rebase): ...`, so the counter must match that prefix.
  const fixerCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM tasks WHERE source_task_id = ? AND task_type = 'system' AND name LIKE 'Git Conflict (%' AND archived_at IS NULL"
  ).get(taskId) as { cnt: number };

  if (fixerCount.cnt >= MAX_MERGE_FIXER_ATTEMPTS) {
    db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)')
      .run(
        pipelineId,
        logTimestamp(),
        'error',
        `Git conflict fixer limit reached (${MAX_MERGE_FIXER_ATTEMPTS}) for '${task.name}' — not spawning another`,
      );
    return null;
  }

  const fixerId = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const opLabel = operation === 'merge'
    ? `Merging ${branch} into ${mainBranch}`
    : `Rebasing ${branch} onto ${mainBranch}`;

  const instructions = operation === 'merge'
    ? [
        `1. Run: git checkout ${mainBranch}`,
        `2. Run: git merge ${branch} --no-edit`,
        '3. Resolve ALL conflict markers (<<<<<<< / ======= / >>>>>>>)',
        '4. Stage resolved files: git add <file>',
        '5. Complete the merge: git commit --no-edit',
      ]
    : [
        `1. Run: git rebase ${mainBranch}`,
        '2. Resolve ALL conflict markers (<<<<<<< / ======= / >>>>>>>)',
        '3. Stage resolved files: git add <file>',
        '4. Continue rebase: git rebase --continue',
        '5. Repeat steps 2-4 for each conflicting commit',
      ];

  const prompt = [
    `## Git Conflict Resolution (${operation})`,
    '',
    `Operation: ${opLabel}`,
    '',
    '### Conflicting Files:',
    conflictFiles.map((f) => `- ${f}`).join('\n') || 'Unknown',
    '',
    '### Instructions:',
    ...instructions,
    '6. Ensure the code compiles and makes logical sense',
    '',
    mergeOutput ? `### Error Output:\n${mergeOutput.slice(0, 2000)}` : '',
  ].join('\n');

  const { stage: fixerStage, stageId: fixerStageId } = resolveFixerStage(
    db, pipelineId, task.stage, task.stage_id ?? null,
  );

  db.transaction(() => {
    db.prepare(`
      INSERT INTO tasks (id, pipeline_id, name, agent_id, model, approval, status,
        stage, stage_id, input, sort_order, timeout_ms, task_type, source_task_id,
        worktree_path, worktree_status, conflict_base_sha, conflict_branch_sha, created_at)
      VALUES (?, ?, ?, ?, ?, 'auto', 'running', ?, ?, ?, ?, ?, 'system', ?, ?, 'active', ?, ?, ?)
    `).run(
      fixerId,
      pipelineId,
      `Git Conflict (${operation}): ${task.name}`,
      task.agent_id,
      task.model,
      fixerStage,
      fixerStageId,
      prompt,
      (task.sort_order ?? 0) + 1,
      task.timeout_ms,
      taskId,
      worktreePath,
      baseSha,
      branchSha,
      logTimestamp(),
    );

    db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)')
      .run(
        pipelineId,
        logTimestamp(),
        'warning',
        `Git ${operation} conflict in '${task.name}' — fixer task spawned (${conflictFiles.join(', ') || 'unknown'})`,
      );

    recalcPipelineStatus(pipelineId);
  })();

  eventBus.emit('task:merge_conflict', {
    taskId,
    pipelineId,
    taskName: task.name,
    status: task.status,
    conflictFiles,
    fixerTaskId: fixerId,
  });

  workerPool.enqueue({
    taskId: fixerId,
    pipelineId,
    taskName: `Git Conflict (${operation}): ${task.name}`,
    execute: () => runTask(fixerId),
  });

  return fixerId;
}

/**
 * Promote a completed `Git Conflict (merge)` fixer's commit back onto the
 * base branch. The fixer runs inside a temp worktree on a detached HEAD; its
 * commit is otherwise orphaned, which is why re-clicking "Merge" from the UI
 * used to spawn another fixer on a fresh temp worktree each time.
 *
 * Called after the fixer's task finishes with a successful exit code. A no-op
 * for non-fixer tasks and for rebase fixers (rebase runs in the task's own
 * persistent worktree so the existing `Sync` UI already reflects the result).
 */
export function finalizeMergeFixerTask(fixerTaskId: string): void {
  const db = getDb();

  const fixer = db.prepare(
    `SELECT id, pipeline_id, name, task_type, source_task_id, worktree_path
     FROM tasks WHERE id = ?`,
  ).get(fixerTaskId) as {
    id: string;
    pipeline_id: string;
    name: string;
    task_type: string | null;
    source_task_id: string | null;
    worktree_path: string | null;
  } | undefined;

  if (!fixer) return;
  if (fixer.task_type !== 'system') return;
  if (!fixer.name.startsWith('Git Conflict (merge):')) return;
  if (!fixer.source_task_id) return;
  if (!fixer.worktree_path) return;

  const source = db.prepare(
    'SELECT id, pipeline_id FROM tasks WHERE id = ?',
  ).get(fixer.source_task_id) as {
    id: string;
    pipeline_id: string;
  } | undefined;
  if (!source) return;

  const projectDir = resolveProjectDir(source.pipeline_id);
  const pipelineBase = resolvePipelineBaseRef(source.pipeline_id);
  const baseBranch =
    pipelineBase && pipelineBase !== 'HEAD' ? pipelineBase : detectDefaultBranch(projectDir);
  const taskBranch = `task/${source.id}`;

  const result = finalizeTempMergeWorktree(projectDir, baseBranch, fixer.worktree_path);

  const insertLog = db.prepare(
    'INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)',
  );

  if (!result.ok) {
    // Fixer committed but promotion failed. Keep the source task in
    // `blocked_by_conflict` so the UI nudges the user to retry; explain why.
    db.prepare(
      "UPDATE tasks SET worktree_status = 'blocked_by_conflict' WHERE id = ?",
    ).run(source.id);

    let reason = 'unknown';
    switch (result.reason) {
      case 'not_merge_commit':
        reason = 'fixer did not produce a merge commit';
        break;
      case 'not_fast_forward':
        reason = `base branch '${baseBranch}' advanced during resolution — retry merge`;
        cleanupTempWorktree(projectDir, fixer.worktree_path);
        break;
      case 'no_worktree':
        reason = 'fixer worktree missing';
        break;
      case 'exec_failed':
        reason = result.message ?? 'git command failed';
        break;
    }
    insertLog.run(
      source.pipeline_id,
      logTimestamp(),
      'warning',
      `Conflict fixer ${fixerTaskId.slice(-6)} finished but could not promote to ${baseBranch}: ${reason}`,
    );
    return;
  }

  cleanupTempWorktree(projectDir, fixer.worktree_path);
  try {
    removeWorktreeAndBranch(source.id, projectDir);
  } catch { /* best effort */ }

  db.prepare(
    "UPDATE tasks SET worktree_status = 'merged', worktree_path = NULL WHERE id = ?",
  ).run(source.id);

  try {
    archiveInheritedFollowUpsForParent(source.id, 'merged_with_parent');
  } catch { /* best effort */ }

  insertLog.run(
    source.pipeline_id,
    logTimestamp(),
    'info',
    `Merged ${taskBranch} into ${baseBranch} via conflict fixer (${result.commit?.slice(0, 7)})`,
  );

  recalcPipelineStatus(source.pipeline_id);
}

function detectDefaultBranch(projectDir: string): string {
  try {
    const out = execSync('git branch --list main master', {
      cwd: projectDir,
      stdio: 'pipe',
    }).toString();
    if (out.includes('main')) return 'main';
    if (out.includes('master')) return 'master';
  } catch { /* best effort */ }
  return 'main';
}

/** Spawn a system task to resolve merge conflicts, then re-enable the blocked task */
const MAX_MERGE_FIXER_ATTEMPTS = 3;

export function spawnMergeFixerTask(
  blockedTaskId: string,
  pipelineId: string,
  worktreePath: string,
  mergeResult: MergeResult,
  allDepBranches: string[],
  baseSha: string | null,
  branchSha: string | null,
): void {
  const db = getDb();
  const blockedTask = db.prepare('SELECT * FROM tasks WHERE id = ?')
    .get(blockedTaskId) as TaskRow | undefined;
  if (!blockedTask) return;

  // Dedup: identical (base, branch) commits → conflict is unchanged, reuse the
  // existing pending fixer. Different commits → archive stale ones and spawn fresh.
  const namePrefix = 'Merge Conflict:';
  const { reuseId } = findOrSupersedeFixer(blockedTaskId, namePrefix, baseSha, branchSha);
  if (reuseId) {
    db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)')
      .run(
        pipelineId,
        logTimestamp(),
        'info',
        `Merge retry on '${blockedTask.name}' — same conflict signature, reusing existing fixer ${reuseId}`,
      );
    return;
  }

  // Guard: prevent infinite fixer loop — count existing fixer tasks for this blocked task
  const fixerCount = db.prepare(
    "SELECT COUNT(*) as cnt FROM tasks WHERE source_task_id = ? AND task_type = 'system' AND name LIKE 'Merge Conflict:%' AND archived_at IS NULL"
  ).get(blockedTaskId) as { cnt: number };

  if (fixerCount.cnt >= MAX_MERGE_FIXER_ATTEMPTS) {
    // Max retries reached — fail the task instead of spawning another fixer
    db.prepare('UPDATE tasks SET status = ? WHERE id = ?')
      .run('failed', blockedTaskId);
    db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)')
      .run(
        pipelineId,
        logTimestamp(),
        'error',
        `'${blockedTask.name}' failed — merge conflict could not be resolved after ${MAX_MERGE_FIXER_ATTEMPTS} attempts`,
      );
    recalcPipelineStatus(pipelineId);
    return;
  }

  const fixerId = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const conflictPrompt = [
    '## Merge Conflict Resolution',
    '',
    'You are resolving git merge conflicts in a worktree.',
    `The following branches need to be merged: ${allDepBranches.join(', ')}`,
    '',
    `### Conflicted Branch: ${mergeResult.branch}`,
    '### Conflicting Files:',
    mergeResult.conflictFiles?.map((f) => `- ${f}`).join('\n') ?? 'Unknown',
    '',
    '### Instructions:',
    `1. The merge was aborted. Re-run: git merge ${mergeResult.branch} --no-edit`,
    '2. Resolve ALL conflict markers (<<<<<<< / ======= / >>>>>>>)',
    '3. Stage resolved files: git add <file>',
    '4. Complete the merge: git commit --no-edit',
    '5. Ensure the code compiles and makes logical sense',
    '',
    mergeResult.mergeOutput
      ? `### Merge Output:\n${mergeResult.mergeOutput.slice(0, 2000)}`
      : '',
  ].join('\n');

  const { stage: fixerStage, stageId: fixerStageId } = resolveFixerStage(
    db, pipelineId, blockedTask.stage, blockedTask.stage_id ?? null,
  );

  db.transaction(() => {
    // 1. Create the fixer system task
    db.prepare(`
      INSERT INTO tasks (id, pipeline_id, name, agent_id, model, approval, status,
        stage, stage_id, input, sort_order, timeout_ms, task_type, source_task_id,
        worktree_path, worktree_status, conflict_base_sha, conflict_branch_sha, created_at)
      VALUES (?, ?, ?, ?, ?, 'auto', 'running', ?, ?, ?, ?, ?, 'system', ?, ?, 'active', ?, ?, ?)
    `).run(
      fixerId,
      pipelineId,
      `Merge Conflict: ${blockedTask.name}`,
      blockedTask.agent_id,
      blockedTask.model,
      fixerStage,
      fixerStageId,
      conflictPrompt,
      blockedTask.sort_order,
      blockedTask.timeout_ms,
      blockedTaskId,
      worktreePath,
      baseSha,
      branchSha,
      logTimestamp(),
    );

    // 2. Wire blocked task to depend on the fixer
    db.prepare('INSERT INTO task_deps (task_id, depends_on_task_id) VALUES (?, ?)')
      .run(blockedTaskId, fixerId);

    // 3. Preserve worktree on blocked task so it reuses it after fixer completes
    db.prepare('UPDATE tasks SET worktree_path = ?, worktree_status = ? WHERE id = ?')
      .run(worktreePath, 'blocked_by_conflict', blockedTaskId);

    // 3. Log
    db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)')
      .run(
        pipelineId,
        logTimestamp(),
        'warning',
        `Merge conflict in '${blockedTask.name}' — fixer task spawned (${mergeResult.conflictFiles?.join(', ') ?? 'unknown'})`,
      );

    recalcPipelineStatus(pipelineId);
  })();

  // 4. Emit event
  eventBus.emit('task:merge_conflict', {
    taskId: blockedTaskId,
    pipelineId,
    taskName: blockedTask.name,
    status: 'queued',
    conflictFiles: mergeResult.conflictFiles ?? [],
    fixerTaskId: fixerId,
  });

  // 5. Enqueue the fixer for execution
  workerPool.enqueue({
    taskId: fixerId,
    pipelineId,
    taskName: `Merge Conflict: ${blockedTask.name}`,
    execute: () => runTask(fixerId),
  });
}
