import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb } from '../server/db/connection.js';
import { createTables } from '../server/db/schema.js';
import { seedDatabase } from '../server/db/seed.js';
import * as pipelineService from '../server/services/pipeline-service.js';
import * as taskService from '../server/services/task-service.js';
import * as contextService from '../server/services/context-service.js';
import * as routineService from '../server/services/routine-service.js';
import { triggerRoutine } from '../server/engine/routine-scheduler.js';
import { buildAllowResponse, buildDenyResponse } from '../server/executor/control-protocol.js';
import { pausePipeline, retryTask, abortTask, resumeTask } from '../server/engine/pipeline-runner.js';
import { resolveApiPortForDev } from '../server/config/ports.js';

// Initialize database
const db = getDb();
createTables(db);
seedDatabase(db);

// Resolve API port: env override > persisted app port + 1 in dev.
function resolveApiPort(): number {
  if (process.env.AGENTFLOW_PORT) return parseInt(process.env.AGENTFLOW_PORT, 10);
  return resolveApiPortForDev();
}
// Use 127.0.0.1 (not "localhost") to match the backend's loopback bind — on
// IPv6-first hosts "localhost" can resolve to ::1 and miss the IPv4-only listener.
const API_BASE = `http://127.0.0.1:${resolveApiPort()}/api`;

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'agentflow',
    version: '1.1.2',
  });

  // ─── Pipeline Tools ───

  server.tool(
    'list_pipelines',
    'List all pipelines with their tasks and logs',
    {},
    async () => {
      try {
        const pipelines = pipelineService.listPipelines();
        return { content: [{ type: 'text', text: JSON.stringify(pipelines, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'get_pipeline',
    'Get a pipeline by ID with full details',
    { id: z.string().describe('Pipeline ID') },
    async ({ id }) => {
      try {
        const pipeline = pipelineService.getPipeline(id);
        return { content: [{ type: 'text', text: JSON.stringify(pipeline, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'create_pipeline',
    'Create a new pipeline',
    {
      name: z.string().describe('Pipeline name'),
      workingDir: z.string().trim().min(1).describe('Working directory path'),
      tasks: z.array(z.object({
        name: z.string(),
        agentId: z.string(),
        model: z.string().describe('Model key (e.g. claude:sonnet, gemini:2.5-pro, codex:gpt-5.6-sol)'),
        approval: z.enum(['auto', 'manual', 'on_error']).default('auto'),
        stage: z.number(),
        dependsOn: z.array(z.string()),
        input: z.string(),
      })).optional().describe('Optional initial tasks'),
    },
    async ({ name, workingDir, tasks }) => {
      try {
        const pipeline = pipelineService.createPipeline({
          name,
          workingDir,
          tasks,
        });
        return { content: [{ type: 'text', text: JSON.stringify(pipeline, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'delete_pipeline',
    'Delete a pipeline by ID',
    { id: z.string().describe('Pipeline ID') },
    async ({ id }) => {
      try {
        pipelineService.deletePipeline(id);
        return { content: [{ type: 'text', text: `Pipeline ${id} deleted` }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // ─── Task Tools ───

  server.tool(
    'add_task',
    'Add a task to a pipeline',
    {
      pipelineId: z.string().describe('Pipeline ID'),
      name: z.string().describe('Task name'),
      agentId: z.string().describe('Agent ID'),
      model: z.string().describe('Model key (e.g. claude:sonnet, gemini:2.5-pro, codex:gpt-5.6-sol)').default('claude:sonnet'),
      approval: z.enum(['auto', 'manual', 'on_error']).default('auto'),
      stage: z.number().default(0).describe('Stage/run order (0-based)'),
      dependsOn: z.array(z.union([
        z.string(),
        z.object({
          taskId: z.string(),
          condition: z.object({
            type: z.enum(['contains', 'not_contains', 'regex', 'status']),
            value: z.string(),
          }).nullable().default(null),
        }),
      ])).default([]).describe('Task IDs (or {taskId, condition} objects) this depends on'),
      input: z.string().default('').describe('Input prompt for the task'),
      priority: z.enum(['urgent', 'high', 'medium', 'low']).nullable().default(null).describe('Task priority'),
      tags: z.array(z.string()).default([]).describe('Free-form text tags'),
      useWorktree: z.boolean().default(true).describe('If false, task runs in project dir without worktree isolation'),
      branch: z.string().nullable().default(null).describe('Git ref to base worktree on (e.g. "main", "feature/x")'),
      autoRetry: z.boolean().default(false).describe('If true, automatically retry on failure with error feedback'),
    },
    async ({ pipelineId, ...taskData }) => {
      try {
        const task = taskService.createTask(pipelineId, taskData);
        return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'approve_task',
    'Approve a pending task (sets it to running)',
    { taskId: z.string().describe('Task ID') },
    async ({ taskId }) => {
      try {
        const task = taskService.approveTask(taskId);
        // Enqueue for real execution in worker pool (like REST route does)
        try {
          resumeTask(taskId);
        } catch {
          // Worker pool may not be available in stdio mode — task is still approved in DB
        }
        return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'reject_task',
    'Reject a task (sets it to failed)',
    { taskId: z.string().describe('Task ID') },
    async ({ taskId }) => {
      try {
        const task = taskService.rejectTask(taskId);
        return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'move_task',
    'Move a task to a different status',
    {
      taskId: z.string().describe('Task ID'),
      status: z.enum(['queued', 'running', 'completed', 'failed', 'awaiting_approval', 'blocked', 'skipped']).describe('Target status'),
    },
    async ({ taskId, status }) => {
      try {
        const result = taskService.moveTask(taskId, status);

        // Enqueue cascaded tasks into the worker pool
        for (const cascadedId of result.cascaded) {
          try { resumeTask(cascadedId); } catch { /* best effort */ }
        }

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'delete_task',
    'Delete a task from its pipeline',
    { taskId: z.string().describe('Task ID') },
    async ({ taskId }) => {
      try {
        taskService.deleteTask(taskId);
        return { content: [{ type: 'text', text: `Task ${taskId} deleted` }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // ─── Agent Tools ───

  server.tool(
    'list_agents',
    'List all available agents',
    {},
    async () => {
      try {
        const agents = db.prepare('SELECT * FROM agents ORDER BY name').all();
        return { content: [{ type: 'text', text: JSON.stringify(agents, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'update_agent',
    'Update an agent\'s configuration',
    {
      id: z.string().describe('Agent ID'),
      name: z.string().optional(),
      icon: z.string().optional(),
      defaultModel: z.string().describe('Model key (e.g. claude:sonnet, gemini:2.5-pro, codex:gpt-5.6-sol)').optional(),
      prompt: z.string().optional(),
    },
    async ({ id, ...update }) => {
      try {
        const fields: string[] = [];
        const values: unknown[] = [];
        if (update.name !== undefined) { fields.push('name = ?'); values.push(update.name); }
        if (update.icon !== undefined) { fields.push('icon = ?'); values.push(update.icon); }
        if (update.defaultModel !== undefined) { fields.push('default_model = ?'); values.push(update.defaultModel); }
        if (update.prompt !== undefined) { fields.push('prompt = ?'); values.push(update.prompt); }

        if (fields.length > 0) {
          values.push(id);
          db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`).run(...values);
        }
        const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
        if (!agent) {
          return { content: [{ type: 'text', text: `Error: Agent not found: ${id}` }], isError: true };
        }
        return { content: [{ type: 'text', text: JSON.stringify(agent, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // ─── Execution Tools ───

  server.tool(
    'run_pipeline',
    'Start a pipeline execution via the backend worker pool',
    { pipelineId: z.string().describe('Pipeline ID') },
    async ({ pipelineId }) => {
      try {
        // Call backend API so the worker pool picks up tasks
        const res = await fetch(`${API_BASE}/execution/${pipelineId}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: res.statusText }));
          return { content: [{ type: 'text', text: `Error: ${(body as { error: string }).error ?? `HTTP ${res.status}`}` }], isError: true };
        }

        const result = await res.json() as { started: string[]; pending: string[]; message: string };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        // Fallback to direct DB if backend is not running
        const tasks = db.prepare('SELECT * FROM tasks WHERE pipeline_id = ?').all(pipelineId) as { id: string; name: string; status: string; approval: string }[];
        const allDeps = db.prepare(
          `SELECT * FROM task_deps WHERE task_id IN (${tasks.map(() => '?').join(',') || "'_'"})`
        ).all(...tasks.map((t) => t.id)) as { task_id: string; depends_on_task_id: string }[];

        const started: string[] = [];
        const run = db.transaction(() => {
          for (const task of tasks) {
            if (task.status !== 'queued') continue;
            const deps = allDeps.filter((d) => d.task_id === task.id);
            if (deps.length > 0) continue;
            const newStatus = task.approval === 'auto' ? 'running' : 'awaiting_approval';
            db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(newStatus, task.id);
            started.push(task.name);
          }
          pipelineService.recalcPipelineStatus(pipelineId);
        });
        run();
        return { content: [{ type: 'text', text: `[fallback: backend offline] Started ${started.length} task(s): ${started.join(', ')}` }] };
      }
    }
  );

  server.tool(
    'complete_task',
    'Complete a running task and trigger cascade to dependent tasks',
    {
      taskId: z.string().describe('Task ID'),
      output: z.string().default('Task completed.').describe('Task output text'),
    },
    async ({ taskId, output }) => {
      try {
        const result = taskService.completeAndCascade(taskId, output, `${Math.floor(8 + Math.random() * 20)}s`, Math.floor(1500 + Math.random() * 5000));

        // Enqueue cascaded tasks into the worker pool
        for (const cascadedId of result.cascaded) {
          try { resumeTask(cascadedId); } catch { /* best effort */ }
        }

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // ─── Logs Tool ───

  server.tool(
    'get_logs',
    'Get activity logs for a pipeline',
    { pipelineId: z.string().describe('Pipeline ID') },
    async ({ pipelineId }) => {
      try {
        const logs = db.prepare('SELECT * FROM logs WHERE pipeline_id = ? ORDER BY id').all(pipelineId);
        return { content: [{ type: 'text', text: JSON.stringify(logs, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // ─── Context Tools ───

  server.tool(
    'get_pipeline_context',
    'Get shared context for a pipeline (key-value store)',
    { pipelineId: z.string().describe('Pipeline ID') },
    async ({ pipelineId }) => {
      try {
        const ctx = contextService.getContext(pipelineId);
        return { content: [{ type: 'text', text: JSON.stringify(ctx, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'set_pipeline_context',
    'Set a key-value pair in pipeline shared context',
    {
      pipelineId: z.string().describe('Pipeline ID'),
      key: z.string().describe('Context key'),
      value: z.string().describe('Context value'),
      setByTaskId: z.string().optional().describe('Task ID that set this value'),
    },
    async ({ pipelineId, key, value, setByTaskId }) => {
      try {
        const result = contextService.setContext(pipelineId, key, value, setByTaskId);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // ─── Pipeline Update ───

  server.tool(
    'update_pipeline',
    'Update a pipeline\'s name, description, rules, working directory, or enabled agents',
    {
      id: z.string().describe('Pipeline ID'),
      name: z.string().optional().describe('New pipeline name'),
      description: z.string().optional().describe('Pipeline description'),
      rules: z.string().optional().describe('Pipeline rules / instructions'),
      workingDir: z.string().trim().min(1).optional().describe('Working directory path'),
      enabledAgents: z.array(z.string()).optional().describe('List of enabled agent IDs'),
    },
    async ({ id, ...update }) => {
      try {
        const pipeline = pipelineService.updatePipeline(id, update);
        return { content: [{ type: 'text', text: JSON.stringify(pipeline, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // ─── Task Query & Update ───

  server.tool(
    'list_tasks',
    'List all tasks in a pipeline',
    { pipelineId: z.string().describe('Pipeline ID') },
    async ({ pipelineId }) => {
      try {
        const tasks = taskService.listTasks(pipelineId);
        return { content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'get_task',
    'Get a single task by ID with full details',
    { taskId: z.string().describe('Task ID') },
    async ({ taskId }) => {
      try {
        const task = taskService.getTask(taskId);
        return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'update_task',
    'Update a task\'s name, input, model, approval mode, stage, priority, tags, or timeout',
    {
      taskId: z.string().describe('Task ID'),
      name: z.string().optional().describe('Task name'),
      agentId: z.string().optional().describe('Agent ID'),
      model: z.string().describe('Model key (e.g. claude:sonnet, gemini:2.5-pro, codex:gpt-5.6-sol)').optional(),
      approval: z.enum(['auto', 'manual', 'on_error']).optional(),
      stage: z.number().optional().describe('Stage/run order (0-based)'),
      input: z.string().optional().describe('Input prompt'),
      status: z.enum(['queued', 'running', 'completed', 'failed', 'awaiting_approval', 'blocked', 'skipped']).optional(),
      priority: z.enum(['urgent', 'high', 'medium', 'low']).nullable().optional(),
      timeoutMs: z.number().optional().describe('Timeout in milliseconds'),
      tags: z.array(z.string()).optional().describe('Free-form text tags'),
      interactiveMode: z.boolean().optional().describe('Enable interactive mode for this task'),
      useWorktree: z.boolean().optional().describe('If false, task runs in project dir without worktree isolation'),
      branch: z.string().nullable().optional().describe('Git ref to base worktree on (e.g. "main", "feature/x")'),
      autoRetry: z.boolean().optional().describe('If true, automatically retry on failure with error feedback'),
    },
    async ({ taskId, ...update }) => {
      try {
        const task = taskService.updateTask(taskId, update);
        return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // ─── Execution Control ───

  server.tool(
    'pause_pipeline',
    'Pause a running pipeline: abort all running tasks and reset them to queued',
    { pipelineId: z.string().describe('Pipeline ID') },
    async ({ pipelineId }) => {
      try {
        const paused = pausePipeline(pipelineId);
        return { content: [{ type: 'text', text: JSON.stringify({ paused, message: `${paused} task(s) paused` }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'abort_task',
    'Abort a running task and set it to blocked',
    { taskId: z.string().describe('Task ID') },
    async ({ taskId }) => {
      try {
        const aborted = abortTask(taskId);
        if (!aborted) {
          return { content: [{ type: 'text', text: 'Error: Task not running or not found in pool' }], isError: true };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ aborted: true, taskId }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'retry_task',
    'Retry a failed/blocked/rejected task, optionally with user guidance',
    {
      taskId: z.string().describe('Task ID'),
      userNote: z.string().optional().describe('Optional guidance or instructions for the retry'),
    },
    async ({ taskId, userNote: followUpPrompt }) => {
      try {
        retryTask(taskId, followUpPrompt);
        return { content: [{ type: 'text', text: JSON.stringify({ retried: true, taskId }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // ─── Interactive Mode Tools ───

  server.tool(
    'list_pending_questions',
    'List pending control requests (questions/tool approvals) across running tasks',
    {
      pipelineId: z.string().optional().describe('Filter by pipeline ID'),
    },
    async ({ pipelineId }) => {
      try {
        const db = getDb();
        let rows;
        if (pipelineId) {
          rows = db.prepare(
            `SELECT cr.*, t.name as task_name FROM control_requests cr
             JOIN tasks t ON cr.task_id = t.id
             WHERE t.pipeline_id = ? AND cr.status = 'pending'
             ORDER BY cr.created_at DESC`
          ).all(pipelineId);
        } else {
          rows = db.prepare(
            `SELECT cr.*, t.name as task_name FROM control_requests cr
             JOIN tasks t ON cr.task_id = t.id
             WHERE cr.status = 'pending'
             ORDER BY cr.created_at DESC`
          ).all();
        }
        return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'respond_to_question',
    'Respond to a pending control request (allow or deny a tool use, or answer a question)',
    {
      requestId: z.string().describe('The control request ID to respond to'),
      action: z.enum(['allow', 'deny']).describe('Whether to allow or deny the request'),
      message: z.string().optional().describe('Optional message (used for deny reason or answer text)'),
    },
    async ({ requestId, action, message }) => {
      try {
        const db = getDb();

        const cr = db.prepare('SELECT * FROM control_requests WHERE id = ?').get(requestId) as {
          id: string; task_id: string; status: string; input_json: string;
        } | undefined;

        if (!cr) {
          return { content: [{ type: 'text', text: 'Error: Control request not found' }], isError: true };
        }
        if (cr.status !== 'pending') {
          return { content: [{ type: 'text', text: `Error: Already responded (status: ${cr.status})` }], isError: true };
        }

        let responseJson: string;
        if (action === 'allow') {
          const input = JSON.parse(cr.input_json);
          responseJson = buildAllowResponse(requestId, input);
        } else {
          responseJson = buildDenyResponse(requestId, message ?? 'Denied via MCP', true);
        }

        db.prepare(
          "UPDATE control_requests SET status = ?, response_json = ?, responded_at = ? WHERE id = ?"
        ).run(
          action === 'allow' ? 'approved' : 'denied',
          responseJson,
          new Date().toISOString(),
          requestId,
        );

        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, requestId, action }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // ─── Routine Tools ───
  // A routine is a recurring task template scoped to a pipeline. The server's
  // routine scheduler spawns a fresh task into the pipeline on each schedule fire.

  server.tool(
    'list_routines',
    'List all recurring routines for a pipeline',
    { pipelineId: z.string().describe('Pipeline ID') },
    async ({ pipelineId }) => {
      try {
        const routines = routineService.listRoutines(pipelineId);
        return { content: [{ type: 'text', text: JSON.stringify(routines, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'create_routine',
    'Create a recurring routine that spawns a task into a pipeline on a schedule (hourly/daily/weekly)',
    {
      pipelineId: z.string().describe('Pipeline ID'),
      name: z.string().describe('Routine / task name'),
      agentId: z.string().describe('Agent ID to run the task'),
      model: z.string().default('claude:sonnet').describe('Model key (e.g. claude:sonnet)'),
      approval: z.enum(['auto', 'manual', 'on_error']).default('auto'),
      input: z.string().default('').describe('Task prompt'),
      scheduleKind: z.enum(['hourly', 'daily', 'weekly']).default('daily'),
      scheduleTime: z.string().default('09:00').describe("'HH:MM' (24h, server local time) — used by daily/weekly"),
      scheduleWeekday: z.number().min(0).max(6).default(1).describe('0=Sunday … 6=Saturday — used by weekly'),
      useWorktree: z.boolean().default(true),
      branch: z.string().nullable().default(null),
      priority: z.enum(['urgent', 'high', 'medium', 'low']).nullable().default(null),
      enabled: z.boolean().default(true),
    },
    async ({ pipelineId, ...data }) => {
      try {
        const routine = routineService.createRoutine(pipelineId, { ...data, timeoutMs: null });
        return { content: [{ type: 'text', text: JSON.stringify(routine, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'update_routine',
    'Update a routine (any field, including enabling/disabling or changing the schedule)',
    {
      id: z.string().describe('Routine ID'),
      name: z.string().optional(),
      agentId: z.string().optional(),
      model: z.string().optional(),
      approval: z.enum(['auto', 'manual', 'on_error']).optional(),
      input: z.string().optional(),
      scheduleKind: z.enum(['hourly', 'daily', 'weekly']).optional(),
      scheduleTime: z.string().optional(),
      scheduleWeekday: z.number().min(0).max(6).optional(),
      useWorktree: z.boolean().optional(),
      branch: z.string().nullable().optional(),
      priority: z.enum(['urgent', 'high', 'medium', 'low']).nullable().optional(),
      enabled: z.boolean().optional(),
    },
    async ({ id, ...data }) => {
      try {
        const routine = routineService.updateRoutine(id, data);
        return { content: [{ type: 'text', text: JSON.stringify(routine, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'delete_routine',
    'Delete a routine',
    { id: z.string().describe('Routine ID') },
    async ({ id }) => {
      try {
        const result = routineService.deleteRoutine(id);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    'run_routine',
    'Trigger a routine immediately (does not advance its recurring schedule)',
    { id: z.string().describe('Routine ID') },
    async ({ id }) => {
      try {
        const routine = routineService.getRoutine(id);
        if (!routine.enabled) {
          return { content: [{ type: 'text', text: 'Error: Routine is disabled — enable it before running' }], isError: true };
        }
        const taskId = triggerRoutine(routine, false);
        if (!taskId) {
          return { content: [{ type: 'text', text: 'Error: Routine could not run (agent missing, or a previous run is still awaiting approval)' }], isError: true };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, taskId }, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  return server;
}
