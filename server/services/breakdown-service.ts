import { readFileSync } from 'fs';
import { join } from 'path';
import { getDb } from '../db/connection.js';
import { getProviderKey } from '../lib/provider-utils.js';
import { createExecutor } from '../executor/index.js';
import type { AttachmentRow } from './attachment-service.js';
import { formatBytes } from './attachment-service.js';

interface Agent {
  id: string;
  name: string;
  icon: string;
  title?: string;
  default_model: string;
  prompt: string;
}

interface BreakdownTaskPlan {
  name: string;
  agentId: string;
  model: string;
  approval: string;
  stage: number;
  dependsOn: number[];
  input: string;
  rationale: string;
  priority: string | null;
  tags: string[];
  taskType: 'seeded' | 'spawned' | 'planned' | 'system';
}

interface BreakdownPlan {
  summary: string;
  tasks: BreakdownTaskPlan[];
  reasoning: string;
}

export interface ClaudeStreamState {
  buffer: string;
  assistantText: string;
  emittedEventKeys: Set<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function extractTextContent(value: unknown): string {
  if (!Array.isArray(value)) return '';
  let text = '';
  for (const item of value) {
    if (!isRecord(item)) continue;
    if (item.type === 'text' && typeof item.text === 'string') {
      text += item.text;
      continue;
    }
    if (isRecord(item.delta) && typeof item.delta.text === 'string') {
      text += item.delta.text;
    }
  }
  return text;
}

function commonPrefixLength(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return i;
  }
  return len;
}

/** @internal exported for testing */
export function extractIncrementalClaudeText(event: unknown, state: ClaudeStreamState): string {
  if (!isRecord(event)) return '';

  const type = typeof event.type === 'string' ? event.type : '';
  const subtype = typeof event.subtype === 'string' ? event.subtype : '';

  if (type === 'result' || subtype === 'success' || subtype === 'error') {
    return '';
  }

  // stream_event wrapper: Claude CLI wraps real events inside event.event
  if (type === 'stream_event' && isRecord(event.event)) {
    return extractIncrementalClaudeText(event.event, state);
  }

  let mode: 'snapshot' | 'delta' = 'snapshot';
  let candidate = '';

  if (isRecord(event.delta) && typeof event.delta.text === 'string') {
    mode = 'delta';
    candidate = event.delta.text;
  }

  if (!candidate && isRecord(event.message)) {
    const message = event.message;
    const fullText = extractTextContent(message.content);
    if (fullText) {
      mode = 'snapshot';
      candidate = fullText;
    } else if (isRecord(message.delta) && typeof message.delta.text === 'string') {
      mode = 'delta';
      candidate = message.delta.text;
    }
  }

  if (!candidate && Array.isArray(event.content)) {
    const fullText = extractTextContent(event.content);
    if (fullText) {
      mode = 'snapshot';
      candidate = fullText;
    }
  }

  if (!candidate && type.includes('delta') && typeof event.text === 'string') {
    mode = 'delta';
    candidate = event.text;
  }

  if (!candidate) return '';

  if (mode === 'delta') {
    if (state.assistantText.endsWith(candidate)) return '';
    state.assistantText += candidate;
    return candidate;
  }

  if (candidate.startsWith(state.assistantText)) {
    const delta = candidate.slice(state.assistantText.length);
    state.assistantText = candidate;
    return delta;
  }

  const shared = commonPrefixLength(state.assistantText, candidate);
  const delta = candidate.slice(shared);
  state.assistantText = candidate;
  return delta;
}

/** @internal exported for testing */
export function parseClaudeStreamJsonChunk(
  rawChunk: string,
  state: ClaudeStreamState,
  onChunk: (text: string) => void,
): void {
  state.buffer += rawChunk;
  const lines = state.buffer.split('\n');
  state.buffer = lines.pop() ?? '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      let event: unknown = parsed;
      if (
        isRecord(parsed) &&
        parsed.type === 'stream_event' &&
        isRecord(parsed.event)
      ) {
        event = parsed.event;
      }

      const text = extractIncrementalClaudeText(event, state);
      if (text) {
        onChunk(text);
        continue;
      }
      const status = extractClaudeEventStatus(event, state);
      if (status) onChunk(status);
    } catch {
      // Forward non-JSON lines as diagnostics (e.g. verbose output, CLI messages)
      if (trimmed.length > 0) {
        const safeLine = trimmed.length > 700 ? `${trimmed.slice(0, 700)}…` : trimmed;
        onChunk(`[cli] ${safeLine}\n`);
      }
    }
  }
}

function getEventKey(type: string, subtype: string): string {
  return `${type}:${subtype || '-'}`;
}

function extractClaudeEventStatus(event: unknown, state: ClaudeStreamState): string {
  if (!isRecord(event)) return '';
  const type = typeof event.type === 'string' ? event.type : '';
  const subtype = typeof event.subtype === 'string' ? event.subtype : '';
  if (!type) return '';

  const isError = event.is_error === true || subtype.includes('error');
  if (type === 'result' && subtype === 'success' && !isError) return '';

  const eventKey = getEventKey(type, subtype);
  if (!isError && state.emittedEventKeys.has(eventKey)) return '';
  if (!isError) state.emittedEventKeys.add(eventKey);

  if (type === 'system' && subtype === 'init') {
    const model = typeof event.model === 'string' ? event.model : 'unknown';
    return `[claude:init] model=${model}\n`;
  }

  if (isError) {
    let details = '';
    if (Array.isArray(event.errors) && typeof event.errors[0] === 'string') {
      details = event.errors[0].split('\n')[0]!.slice(0, 220);
    }
    return `[claude:error] ${details || subtype || type}\n`;
  }

  // Show lifecycle progress to avoid "empty spinner" perception when no text chunks arrive.
  if (subtype.includes('delta') || subtype.includes('token')) return '';
  if (type === 'result') return '';
  return `[claude:event] ${eventKey}\n`;
}

function flushClaudeStreamBuffer(
  state: ClaudeStreamState,
  onChunk: (text: string) => void,
): void {
  if (!state.buffer.trim()) return;
  parseClaudeStreamJsonChunk('\n', state, onChunk);
}

function unwrapClaudeCliOutput(rawOutput: string): string {
  const output = rawOutput.trim();
  if (!output) return rawOutput;

  try {
    const single = JSON.parse(output) as Record<string, unknown>;
    if (single.type === 'result' && typeof single.result === 'string') {
      return single.result;
    }
  } catch {
    // Not a single JSON object; try line-delimited stream-json.
  }

  let streamResult = '';
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;
      if (event.type === 'result' && typeof event.result === 'string') {
        streamResult = event.result;
      }
    } catch {
      // Ignore malformed lines
    }
  }

  return streamResult || rawOutput;
}

function summarizeAgentForPlanner(agent: Agent): string {
  const role = agent.title?.trim() || agent.name.trim() || agent.id;
  return `- **${agent.id}** ("${agent.name}" ${agent.icon}): Role: ${role}. Default model: ${agent.default_model}.`;
}

function getRepairModel(model: string): string {
  const providerKey = getProviderKey(model);
  switch (providerKey) {
    case 'claude':
      return 'claude:haiku';
    case 'gemini':
      return 'gemini:2.5-flash';
    case 'codex':
      return 'codex:gpt-5.6-luna';
    case 'antigravity':
      return 'antigravity:gemini-3.7-flash';
    default:
      return model;
  }
}

async function repairBreakdownResponse(
  rawOutput: string,
  model: string,
  onChunk?: (chunk: string) => void,
  abortSignal?: AbortSignal,
  workingDir?: string,
): Promise<BreakdownPlan> {
  const repairModel = getRepairModel(model);
  const repairTimeoutMs = 45_000;
  const repairSystemPrompt = `You repair malformed execution plans for AgentFlow.

Return ONLY valid JSON matching this schema:
{
  "summary": "string",
  "tasks": [
    {
      "name": "string",
      "agentId": "string",
      "model": "claude" | "gemini" | "codex" | "antigravity",
      "approval": "auto" | "manual" | "on_error",
      "stage": 0,
      "dependsOn": [0],
      "input": "string",
      "rationale": "string",
      "priority": "urgent" | "high" | "medium" | "low" | null,
      "tags": ["frontend"],
      "taskType": "planned" | "spawned" | "seeded" | "system"
    }
  ],
  "reasoning": "string"
}

Rules:
- Output JSON only. No markdown. No prose outside JSON.
- If the source content is a review, analysis, or free-form notes, infer a reasonable execution plan from it.
- Use an empty tasks array when the request does not require any actionable tasks.
- Keep dependsOn indices valid and 0-based.
- Prefer "planned" for core work and "spawned" for follow-up QA/review tasks.`;

  const repairUserPrompt = `Convert this malformed planner output into valid JSON:

--- BEGIN MALFORMED OUTPUT ---
${rawOutput}
--- END MALFORMED OUTPUT ---`;

  onChunk?.(
    `[breakdown] malformed planner output detected; attempting JSON repair with ${repairModel}...\n`,
  );

  const repaired = await callLLM(
    repairModel,
    repairSystemPrompt,
    repairUserPrompt,
    repairTimeoutMs,
    onChunk,
    abortSignal,
    workingDir,
  );

  return parseBreakdownResponse(repaired);
}

/**
 * Call an LLM for breakdown.
 * Breakdown runs through the local CLI only.
 *
 * IMPORTANT: Breakdown must NOT use CLI with --dangerously-skip-permissions
 * because that gives Claude tool access (file writes, shell commands, etc).
 * Breakdown should only produce a JSON execution plan, not execute anything.
 */
async function callLLM(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs: number,
  onChunk?: (chunk: string) => void,
  abortSignal?: AbortSignal,
  workingDir?: string,
): Promise<string> {
  const providerKey = getProviderKey(model);

  if (abortSignal?.aborted) {
    throw new Error('Breakdown aborted by client');
  }

  // CLI only (without --dangerously-skip-permissions to prevent tool use)
  const executor = createExecutor(providerKey);

  const useClaudeStreamJson =
    executor.type === 'cli' &&
    providerKey === 'claude' &&
    typeof onChunk === 'function';

  if (useClaudeStreamJson) {
    const claudeStreamState: ClaudeStreamState = {
      buffer: '', assistantText: '', emittedEventKeys: new Set<string>(),
    };

    onChunk('[claude] stream started...\n');

    const handleAbort = () => executor.abort();
    abortSignal?.addEventListener('abort', handleAbort, { once: true });

    try {
      const prompt = `${systemPrompt}\n\n---\n\n${userPrompt}`;
      const result = await executor.execute(
        {
          prompt,
          workingDir: workingDir ?? process.cwd(),
          timeoutMs,
          model: providerKey,
          maxTokens: 4096,
          outputFormat: 'stream-json',
          includePartialMessages: true,
          // NOTE: forceSkipPermissions deliberately NOT set —
          // breakdown should only produce text, not use tools
        },
        (chunk) => {
          parseClaudeStreamJsonChunk(chunk, claudeStreamState, onChunk);
        },
      ).finally(() => {
        abortSignal?.removeEventListener('abort', handleAbort);
      });

      flushClaudeStreamBuffer(claudeStreamState, onChunk);

      if (result.exitCode === 0) {
        let output = unwrapClaudeCliOutput(result.output);
        if (claudeStreamState.assistantText) {
          output = claudeStreamState.assistantText;
        }
        return output;
      }

      if (abortSignal?.aborted) {
        throw new Error('Breakdown aborted by client');
      }

      onChunk(`[breakdown] CLI exited with code ${result.exitCode}\n`);
    } catch (err) {
      if (abortSignal?.aborted) {
        throw new Error('Breakdown aborted by client');
      }
      onChunk(`[breakdown] CLI error: ${(err as Error).message.slice(0, 200)}\n`);
    }

    throw new Error('Breakdown generation failed');
  }

  // Non-Claude or non-streaming path: use executor directly
  if (onChunk) {
    onChunk('[cli] running via executor...\n');
  }

  const handleAbort = () => executor.abort();
  abortSignal?.addEventListener('abort', handleAbort, { once: true });

  const prompt = executor.type === 'cli'
    ? `${systemPrompt}\n\n---\n\n${userPrompt}`
    : userPrompt;

  const result = await executor.execute(
    {
      prompt,
      workingDir: process.cwd(),
      timeoutMs,
      model: providerKey,
      systemPrompt: executor.type === 'api' ? systemPrompt : undefined,
      maxTokens: 4096,
    },
    onChunk,
  ).finally(() => {
    abortSignal?.removeEventListener('abort', handleAbort);
  });

  if (result.exitCode !== 0) {
    if (abortSignal?.aborted) {
      throw new Error('Breakdown aborted by client');
    }
    const errorMsg = result.stderr || result.output || `Process exited with code ${result.exitCode}`;
    throw new Error(`LLM execution failed (exit ${result.exitCode}): ${errorMsg.slice(0, 500)}`);
  }

  let output = result.output;

  if (executor.type === 'cli' && providerKey === 'claude') {
    output = unwrapClaudeCliOutput(output);
  }

  return output;
}

function buildSystemPrompt(agents: Agent[]): string {
  const agentList = agents.map((a) => summarizeAgentForPlanner(a)).join('\n');

  return `You are an expert project planner for an AI agent orchestration system called AgentFlow.

Your ONLY job is to break down a high-level task description into a concrete execution plan (JSON) using the available agents.

CRITICAL: You are a PLANNER, not an executor. Do NOT write code, create files, or perform any actions. Your output must be ONLY a JSON execution plan. Do NOT use any tools.

## Available Agents
${agentList}

## Rules
1. NOT every agent needs to be used. Only include agents that are genuinely needed for the task.
2. Each task should have a clear, specific name (not just the agent name).
3. Assign appropriate stages (0-based): stage 0 runs first, stage 1 runs after stage 0 completes, etc. Tasks at the same stage run in parallel. Distribute tasks across stages sequentially — do NOT put all tasks at stage 0.
4. Set dependencies correctly using 0-based indices into the tasks array. A task can only depend on tasks with a lower index.
5. Choose the best model for each task:
   - "claude" — best for reasoning, architecture, complex analysis
   - "gemini" — best for research, content writing, cost-effective bulk work
   - "codex" — best for code generation, technical implementation
   - "antigravity" — Google's Antigravity (Gemini 3); successor to the Gemini CLI, good for research and content
6. Set approval mode: "auto" for low-risk tasks, "manual" for critical/high-stakes tasks.
7. Write clear input prompts for each task that reference what prior tasks will produce.
8. Assign priority when relevant: "urgent", "high", "medium", "low", or null.
9. Add relevant tags from: frontend, backend, bugfix, feature, refactor, design, test, documentation, research.
10. Provide a rationale for each task explaining why it's needed.
11. Set taskType for each task:
   - "planned" — core tasks directly from the breakdown (most tasks)
   - "spawned" — follow-up tasks that should only run after another task completes (e.g., testing after development, review after implementation)
12. Each task's input prompt MUST include:
   - A "Primary scope" hint (e.g., "Primary scope: auth module, src/auth/") — this is guidance, NOT a hard constraint. The agent may touch related files if needed.
   - Git commit convention for this specific task (e.g., "Commit as: feat(auth): ...")
   - What the downstream tasks expect from this task's output (if any).
13. Parallel task collision awareness:
   - If two tasks at the same stage might touch overlapping files, add a warning in both inputs: "⚠️ Task 'X' is also working in this area at the same stage. Coordinate via atomic, non-overlapping changes."
   - Prefer splitting parallel tasks by clear module boundaries.
14. For code-writing tasks, always add a follow-up test/review task at stage+1:
   - QA agent for testing (taskType: "spawned", depends on the dev task)
   - Only skip this if the dev task itself includes comprehensive tests in its instructions.
15. If the request does not require execution work, you MAY return "tasks": [] and explain why in summary/reasoning.

## Output Format
Respond with ONLY valid JSON (no markdown fences, no explanation outside JSON):
{
  "summary": "Brief 1-2 sentence overview of the execution plan",
  "tasks": [
    {
      "name": "Research Phase Task",
      "agentId": "agent_id",
      "model": "gemini",
      "approval": "auto",
      "stage": 0,
      "dependsOn": [],
      "input": "Detailed prompt for this task",
      "rationale": "Why this task is needed",
      "priority": null,
      "tags": ["research"],
      "taskType": "planned"
    },
    {
      "name": "Implementation Task",
      "agentId": "agent_id",
      "model": "claude",
      "approval": "auto",
      "stage": 1,
      "dependsOn": [0],
      "input": "Detailed prompt referencing prior task output",
      "rationale": "Why this task is needed",
      "priority": null,
      "tags": ["backend"],
      "taskType": "planned"
    },
    {
      "name": "Testing Task",
      "agentId": "agent_id",
      "model": "claude",
      "approval": "manual",
      "stage": 2,
      "dependsOn": [1],
      "input": "Test the implementation",
      "rationale": "Verify correctness",
      "priority": null,
      "tags": ["test"],
      "taskType": "spawned"
    }
  ],
  "reasoning": "Explain which agents were included and why, and which were excluded"
}`;
}

function parseBreakdownResponse(raw: string): BreakdownPlan {
  // Try to extract JSON from the response
  let jsonStr = raw.trim();

  // Strip markdown fences if present
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1]!.trim();
  }

  // Try to find JSON object boundaries
  const firstBrace = jsonStr.indexOf('{');
  const lastBrace = jsonStr.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
  }

  const parsed = JSON.parse(jsonStr) as BreakdownPlan;

  // Validate structure
  if (!parsed.summary || !Array.isArray(parsed.tasks)) {
    throw new Error('Invalid breakdown plan: missing summary or tasks array');
  }

  // Validate each task
  const validModels = ['claude', 'gemini', 'codex', 'antigravity'];
  const validApprovals = ['auto', 'manual', 'on_error'];

  for (let i = 0; i < parsed.tasks.length; i++) {
    const t = parsed.tasks[i]!;
    if (!t.name || !t.agentId) {
      throw new Error(`Task[${i}] missing name or agentId`);
    }
    if (!validModels.includes(t.model)) {
      t.model = 'claude'; // fallback
    }
    if (!validApprovals.includes(t.approval)) {
      t.approval = 'auto'; // fallback
    }
    if (!Array.isArray(t.dependsOn)) {
      t.dependsOn = [];
    }
    if (typeof t.stage !== 'number') {
      t.stage = 0;
    }
    if (!t.input) {
      t.input = '';
    }
    if (!t.rationale) {
      t.rationale = '';
    }
    if (!Array.isArray(t.tags)) {
      t.tags = [];
    }
    const validTaskTypes = ['seeded', 'spawned', 'planned', 'system'];
    if (!t.taskType || !validTaskTypes.includes(t.taskType)) {
      t.taskType = 'planned'; // default for breakdown-generated tasks
    }
  }

  return parsed;
}

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

/** @internal exported for testing */
export function isTextMime(mime: string): boolean {
  if (mime.startsWith('text/')) return true;
  return TEXT_MIME_TYPES.includes(mime);
}

const MAX_PER_FILE = 32 * 1024;  // 32KB per file
const MAX_TOTAL = 128 * 1024;    // 128KB total text budget

/** @internal exported for testing */
export function buildAttachmentContext(attachmentIds: string[]): string {
  if (attachmentIds.length === 0) return '';

  const db = getDb();
  const blocks: string[] = [];
  let totalSize = 0;

  for (const id of attachmentIds) {
    const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as AttachmentRow | undefined;
    if (!row) continue;

    const isText = isTextMime(row.mime_type);
    const isImage = row.mime_type.startsWith('image/');

    if (isText && totalSize < MAX_TOTAL) {
      try {
        const filePath = join(process.cwd(), 'data', 'uploads', row.pipeline_id, row.filename);
        const content = readFileSync(filePath, 'utf-8');
        const maxSlice = Math.min(MAX_PER_FILE, MAX_TOTAL - totalSize);
        const truncated = content.slice(0, maxSlice);
        totalSize += truncated.length;
        const truncNote = content.length > maxSlice ? ' (truncated)' : '';
        blocks.push(
          `### ${row.original_name} (${row.mime_type}, ${formatBytes(row.size_bytes)})${truncNote}\n` +
          '```\n' + truncated + '\n```'
        );
      } catch {
        blocks.push(
          `### ${row.original_name} (${row.mime_type}, ${formatBytes(row.size_bytes)})\n` +
          '[File could not be read]'
        );
      }
    } else if (isImage) {
      blocks.push(
        `### ${row.original_name} (${row.mime_type}, ${formatBytes(row.size_bytes)})\n` +
        '[Image file — agents will access this via .attachments/ directory at runtime]'
      );
    } else {
      blocks.push(
        `### ${row.original_name} (${row.mime_type}, ${formatBytes(row.size_bytes)})\n` +
        '[Binary file — available in .attachments/ directory at runtime]'
      );
    }
  }

  if (blocks.length === 0) return '';
  return '## Attached Reference Files\n\n' + blocks.join('\n\n') + '\n\n---\n\n';
}

export async function generateBreakdown(
  description: string,
  agentIds: string[],
  model?: string,
  onChunk?: (chunk: string) => void,
  abortSignal?: AbortSignal,
  attachmentIds?: string[],
  pipelineId?: string,
): Promise<BreakdownPlan> {
  const db = getDb();

  // Resolve working directory from pipeline's working_dir
  let workingDir: string | undefined;
  if (pipelineId) {
    const pipelineRow = db.prepare('SELECT working_dir FROM pipelines WHERE id = ?').get(pipelineId) as { working_dir: string } | undefined;
    if (pipelineRow?.working_dir && pipelineRow.working_dir !== '.') {
      workingDir = pipelineRow.working_dir;
    }
  }

  // Fetch available agents
  const allAgents = db.prepare('SELECT * FROM agents').all() as Agent[];
  const selectedAgents = allAgents.filter((a) => agentIds.includes(a.id));

  if (selectedAgents.length === 0) {
    throw new Error('No valid agents selected');
  }

  // Determine model to use (default to claude, fallback to breakdown_model setting)
  let breakdownModel = model ?? 'claude';
  if (!model) {
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'breakdown_model'").get() as { value: string } | undefined;
    if (setting?.value) {
      breakdownModel = setting.value;
    }
  }

  // Default to 10 minutes; override with settings.breakdown_timeout_ms
  let breakdownTimeoutMs = 600_000;
  const timeoutSetting = db.prepare(
    "SELECT value FROM settings WHERE key = 'breakdown_timeout_ms'"
  ).get() as { value: string } | undefined;
  const parsedTimeout = timeoutSetting?.value ? parseInt(timeoutSetting.value, 10) : NaN;
  if (!Number.isNaN(parsedTimeout) && parsedTimeout > 0) {
    breakdownTimeoutMs = parsedTimeout;
  }

  const systemPrompt = buildSystemPrompt(selectedAgents);
  const attachmentContext = attachmentIds?.length
    ? buildAttachmentContext(attachmentIds)
    : '';
  const userPrompt = `Break down the following task into an execution plan:\n\n${attachmentContext}${description}`;

  const raw = await callLLM(
    breakdownModel,
    systemPrompt,
    userPrompt,
    breakdownTimeoutMs,
    onChunk,
    abortSignal,
    workingDir,
  );

  try {
    return parseBreakdownResponse(raw);
  } catch (err) {
    const message = (err as Error).message;
    if (
      message.includes('LLM execution failed')
      || message.includes('CLI spawn failed')
      || message.includes('Breakdown aborted')
    ) {
      throw err;
    }

    try {
      return await repairBreakdownResponse(
        raw,
        breakdownModel,
        onChunk,
        abortSignal,
        workingDir,
      );
    } catch (repairErr) {
      throw new Error(
        `Failed to parse breakdown plan: ${(err as Error).message}. Repair failed: ${(repairErr as Error).message}`,
      );
    }
  }
}
