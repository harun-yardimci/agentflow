import { upsertConversationMessage } from '../services/task-cycle-service.js';

type ConversationRole = 'assistant' | 'system' | 'user';

interface DraftMessage {
  id: string;
  role: ConversationRole;
  messageType: string;
  content: string;
  meta: Record<string, unknown>;
}

interface PendingClaudeToolUse {
  toolId: string;
  toolName: string;
  inputChunks: string[];
  initialInput: Record<string, unknown>;
}

export interface IncrementalConversationContext {
  taskId: string;
  cycleId: string;
  runId: string;
  agentId: string;
  provider: string;
  modelUsed: string;
}

export interface IncrementalConversationState {
  runId: string;
  stdoutRemainder: string;
  stderrRemainder: string;
  drafts: Map<string, DraftMessage>;
  dirtyIds: Set<string>;
  toolMessageIds: Map<string, string>;
  assistantSegmentIndex: number;
  rawStdoutIndex: number;
  rawStderrIndex: number;
  jsonEventIndex: number;
  toolSequence: number;
  currentAssistantMessageId: string | null;
  currentRawStdoutMessageId: string | null;
  currentRawStderrMessageId: string | null;
  hasClaudeTextDelta: boolean;
  lastAssistantMessageId: string | null;
  pendingClaudeToolUses: Map<number, PendingClaudeToolUse>;
}

function makeMessageId(runId: string, kind: string, index: number | string): string {
  return `msg_${runId}_${kind}_${index}`;
}

function normalizeToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        const block = item as Record<string, unknown>;
        if (block.type === 'text' && typeof block.text === 'string') {
          return block.text;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function ensureDraft(
  state: IncrementalConversationState,
  id: string,
  role: ConversationRole,
  messageType: string,
  content: string,
  meta: Record<string, unknown> = {},
): DraftMessage {
  const existing = state.drafts.get(id);
  if (existing) {
    return existing;
  }

  const created: DraftMessage = {
    id,
    role,
    messageType,
    content,
    meta,
  };
  state.drafts.set(id, created);
  state.dirtyIds.add(id);
  return created;
}

function touchDraft(state: IncrementalConversationState, id: string): void {
  state.dirtyIds.add(id);
}

function breakAssistantSegment(state: IncrementalConversationState): void {
  state.currentAssistantMessageId = null;
}

function beginClaudeAssistantMessage(
  state: IncrementalConversationState,
): void {
  state.hasClaudeTextDelta = false;
  breakAssistantSegment(state);
}

function breakRawSegments(state: IncrementalConversationState): void {
  state.currentRawStdoutMessageId = null;
  state.currentRawStderrMessageId = null;
}

function appendAssistantText(state: IncrementalConversationState, text: string): void {
  if (!text) return;

  let messageId = state.currentAssistantMessageId;
  if (!messageId) {
    messageId = makeMessageId(state.runId ?? 'run', 'assistant', state.assistantSegmentIndex++);
    ensureDraft(state, messageId, 'assistant', 'stream_text', '', {});
    state.currentAssistantMessageId = messageId;
    state.lastAssistantMessageId = messageId;
  }

  const draft = ensureDraft(state, messageId, 'assistant', 'stream_text', '', {});
  draft.content += text;
  state.lastAssistantMessageId = messageId;
  touchDraft(state, messageId);
}

function appendRawText(
  state: IncrementalConversationState,
  stream: 'stdout' | 'stderr',
  text: string,
): void {
  if (!text) return;
  breakAssistantSegment(state);

  const currentIdKey = stream === 'stdout' ? 'currentRawStdoutMessageId' : 'currentRawStderrMessageId';
  let messageId = state[currentIdKey];
  if (!messageId) {
    const index = stream === 'stdout' ? state.rawStdoutIndex++ : state.rawStderrIndex++;
    messageId = makeMessageId(state.runId ?? 'run', stream, index);
    state[currentIdKey] = messageId;
    ensureDraft(
      state,
      messageId,
      'system',
      stream === 'stdout' ? 'raw_stdout' : 'raw_stderr',
      '',
      { stream },
    );
  }

  const draft = ensureDraft(
    state,
    messageId,
    'system',
    stream === 'stdout' ? 'raw_stdout' : 'raw_stderr',
    '',
    { stream },
  );
  draft.content += (draft.content ? '\n' : '') + text;
  touchDraft(state, messageId);
}

function recordJsonEvent(
  state: IncrementalConversationState,
  obj: Record<string, unknown>,
): void {
  breakAssistantSegment(state);
  breakRawSegments(state);

  const messageId = makeMessageId(state.runId ?? 'run', 'json', state.jsonEventIndex++);
  ensureDraft(
    state,
    messageId,
    'system',
    'json_event',
    JSON.stringify(obj, null, 2),
    { collapsed: true },
  );
  touchDraft(state, messageId);
}

function shouldSuppressSystemEvent(obj: Record<string, unknown>): boolean {
  const subtype = typeof obj.subtype === 'string' ? obj.subtype : '';
  return subtype === 'api_retry'
    || subtype === 'task_started'
    || subtype === 'task_progress'
    || subtype === 'task_notification';
}

function shouldSuppressRateLimitEvent(obj: Record<string, unknown>): boolean {
  return obj.type === 'rate_limit_event';
}

function shouldSuppressStreamEvent(
  event: Record<string, unknown> | undefined,
  pendingToolUses: Map<number, PendingClaudeToolUse>,
): boolean {
  if (!event) return false;

  const eventType = typeof event.type === 'string' ? event.type : '';
  if (eventType === 'message_start' || eventType === 'message_delta' || eventType === 'message_stop') {
    return true;
  }

  if (eventType === 'content_block_delta') {
    const delta = event.delta as Record<string, unknown> | undefined;
    const deltaType = typeof delta?.type === 'string' ? delta.type : '';
    if (deltaType === 'thinking_delta' || deltaType === 'signature_delta') {
      return true;
    }
  }

  if (eventType === 'content_block_start') {
    const contentBlock = event.content_block as Record<string, unknown> | undefined;
    const blockType = typeof contentBlock?.type === 'string' ? contentBlock.type : '';
    if (blockType === 'text' || blockType === 'thinking') {
      return true;
    }
  }

  if (eventType === 'content_block_stop') {
    const index = typeof event.index === 'number' ? event.index : null;
    if (index == null || !pendingToolUses.has(index)) {
      return true;
    }
  }

  return false;
}

function parseBestEffortToolInput(partial: string): Record<string, unknown> {
  const trimmed = partial.trim();
  if (!trimmed) return {};

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    // Continue with repair heuristics below.
  }

  let repaired = trimmed;
  const quoteCount = (repaired.match(/"/g) ?? []).length;
  if (quoteCount % 2 === 1) {
    repaired += '"';
  }
  if (!repaired.endsWith('}')) {
    repaired += '}';
  }

  try {
    const parsed = JSON.parse(repaired);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    // Fall through to field salvage.
  }

  const result: Record<string, unknown> = {};
  const stringKeys = [
    'file_path',
    'filePath',
    'path',
    'dir_path',
    'command',
    'cmd',
    'pattern',
    'query',
  ];

  for (const key of stringKeys) {
    const regex = new RegExp(`"${key}"\\s*:\\s*"([^"]*)`);
    const match = trimmed.match(regex);
    if (match?.[1] != null) {
      result[key] = match[1];
    }
  }

  const timeoutMatch = trimmed.match(/"timeout"\s*:\s*(\d+)/);
  if (timeoutMatch?.[1]) {
    result.timeout = Number(timeoutMatch[1]);
  }

  return result;
}

function recordSessionInit(
  state: IncrementalConversationState,
  obj: Record<string, unknown>,
): void {
  breakAssistantSegment(state);
  breakRawSegments(state);

  const mcpServers = Array.isArray(obj.mcp_servers)
    ? obj.mcp_servers.filter((server): server is Record<string, unknown> =>
        !!server && typeof server === 'object')
    : [];
  const connectedServers = mcpServers
    .filter((server) => server.status === 'connected')
    .map((server) => String(server.name ?? 'unknown'));
  const failedServers = mcpServers
    .filter((server) => server.status === 'failed')
    .map((server) => String(server.name ?? 'unknown'));
  const authServers = mcpServers
    .filter((server) => server.status === 'needs-auth')
    .map((server) => String(server.name ?? 'unknown'));
  const tools = Array.isArray(obj.tools)
    ? obj.tools.filter((tool): tool is string => typeof tool === 'string')
    : [];
  const skills = Array.isArray(obj.skills)
    ? obj.skills.filter((skill): skill is string => typeof skill === 'string')
    : [];
  const agents = Array.isArray(obj.agents)
    ? obj.agents.filter((agent): agent is string => typeof agent === 'string')
    : [];

  const messageId = makeMessageId(state.runId ?? 'run', 'session_init', state.jsonEventIndex++);
  ensureDraft(state, messageId, 'system', 'session_init', 'Session initialized', {
    cwd: typeof obj.cwd === 'string' ? obj.cwd : null,
    sessionId: typeof obj.session_id === 'string'
      ? obj.session_id
      : typeof obj.thread_id === 'string'
        ? obj.thread_id
        : null,
    model: typeof obj.model === 'string' ? obj.model : null,
    permissionMode: typeof obj.permissionMode === 'string' ? obj.permissionMode : null,
    claudeCodeVersion: typeof obj.claude_code_version === 'string'
      ? obj.claude_code_version
      : null,
    outputStyle: typeof obj.output_style === 'string' ? obj.output_style : null,
    fastModeState: typeof obj.fast_mode_state === 'string' ? obj.fast_mode_state : null,
    toolCount: tools.length,
    skillCount: skills.length,
    agentCount: agents.length,
    connectedServers,
    failedServers,
    authServers,
    agents,
  });
  touchDraft(state, messageId);
}

function makeToolMessageId(state: IncrementalConversationState, toolId: string): string {
  const existing = state.toolMessageIds.get(toolId);
  if (existing) return existing;
  const id = makeMessageId(state.runId ?? 'run', 'tool', state.toolSequence++);
  state.toolMessageIds.set(toolId, id);
  return id;
}

function recordToolUse(
  state: IncrementalConversationState,
  toolId: string,
  toolName: string,
  input: Record<string, unknown>,
  summary?: string,
): void {
  breakAssistantSegment(state);
  breakRawSegments(state);

  const messageId = makeToolMessageId(state, toolId);
  const draft = ensureDraft(state, messageId, 'assistant', 'tool_call', summary ?? toolName, {
    toolId,
    toolName,
    input,
    summary: summary ?? toolName,
  });
  draft.messageType = 'tool_call';
  draft.role = 'assistant';
  draft.content = summary ?? toolName;
  draft.meta = {
    ...draft.meta,
    toolId,
    toolName,
    input,
    summary: summary ?? toolName,
  };
  touchDraft(state, messageId);
}

function recordToolResult(
  state: IncrementalConversationState,
  toolId: string,
  content: string,
  isError?: boolean,
): void {
  const messageId = makeToolMessageId(state, toolId);
  const draft = ensureDraft(state, messageId, 'assistant', 'tool_call', 'Tool call', {
    toolId,
  });
  draft.meta = {
    ...draft.meta,
    toolId,
    resultContent: content,
    isError: isError === true,
  };
  touchDraft(state, messageId);
}

function parseStructuredLine(
  state: IncrementalConversationState,
  line: string,
): void {
  const trimmed = line.trim();
  if (!trimmed) return;

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    appendRawText(state, 'stdout', line);
    return;
  }

  if (obj.controlRequest) {
    return;
  }

  const type = typeof obj.type === 'string' ? obj.type : '';
  if (type === 'result') {
    return;
  }

  if (type === 'init') {
    recordSessionInit(state, obj);
    return;
  }

  if (type === 'thread.started') {
    recordSessionInit(state, obj);
    return;
  }

  if (type === 'stream_event') {
    const event = obj.event as Record<string, unknown> | undefined;
    if (event?.type === 'message_start') {
      beginClaudeAssistantMessage(state);
    }
    if (event?.type === 'message_stop') {
      breakAssistantSegment(state);
    }
    if (shouldSuppressStreamEvent(event, state.pendingClaudeToolUses)) {
      return;
    }
    const index = typeof event?.index === 'number' ? event.index : null;
    const delta = event?.delta as Record<string, unknown> | undefined;
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      state.hasClaudeTextDelta = true;
      appendAssistantText(state, delta.text);
      return;
    }

    const contentBlock = event?.content_block as Record<string, unknown> | undefined;
    if (
      event?.type === 'content_block_start'
      && index != null
      && contentBlock?.type === 'tool_use'
      && typeof contentBlock.id === 'string'
    ) {
      state.pendingClaudeToolUses.set(index, {
        toolId: contentBlock.id,
        toolName: typeof contentBlock.name === 'string' ? contentBlock.name : 'Tool',
        inputChunks: [],
        initialInput: contentBlock.input && typeof contentBlock.input === 'object'
          ? contentBlock.input as Record<string, unknown>
          : {},
      });
      return;
    }

    if (
      event?.type === 'content_block_delta'
      && index != null
      && delta?.type === 'input_json_delta'
      && typeof delta.partial_json === 'string'
    ) {
      const pending = state.pendingClaudeToolUses.get(index);
      if (pending) {
        pending.inputChunks.push(delta.partial_json);
        return;
      }
    }

    if (event?.type === 'content_block_stop' && index != null) {
      const pending = state.pendingClaudeToolUses.get(index);
      if (pending) {
        const input = pending.inputChunks.length > 0
          ? parseBestEffortToolInput(pending.inputChunks.join(''))
          : pending.initialInput;
        recordToolUse(state, pending.toolId, pending.toolName, input, pending.toolName);
        state.pendingClaudeToolUses.delete(index);
        return;
      }
    }
  }

  if (type === 'assistant') {
    const content = (obj.message as Record<string, unknown> | undefined)?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const part = block as Record<string, unknown>;
        if (part.type === 'text' && typeof part.text === 'string' && !state.hasClaudeTextDelta) {
          appendAssistantText(state, part.text);
        }
        if (part.type === 'tool_use') {
          recordToolUse(
            state,
            String(part.id ?? `tool-${state.toolSequence}`),
            String(part.name ?? 'Tool'),
            (part.input ?? {}) as Record<string, unknown>,
            typeof part.name === 'string' ? part.name : undefined,
          );
        }
      }
      return;
    }
  }

  if (type === 'user') {
    const content = (obj.message as Record<string, unknown> | undefined)?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const part = block as Record<string, unknown>;
        if (part.type === 'tool_result') {
          recordToolResult(
            state,
            String(part.tool_use_id ?? `tool-${state.toolSequence}`),
            normalizeToolResultContent(part.content),
            part.is_error === true,
          );
        }
      }
      return;
    }
  }

  if (type === 'message') {
    if (obj.role === 'user') {
      return;
    }

    if (obj.role === 'assistant' && typeof obj.content === 'string') {
      appendAssistantText(state, obj.content as string);
      return;
    }
  }

  if (type === 'system' && obj.subtype === 'init') {
    recordSessionInit(state, obj);
    return;
  }

  if (type === 'system' && shouldSuppressSystemEvent(obj)) {
    return;
  }

  if (shouldSuppressRateLimitEvent(obj)) {
    return;
  }

  if (type === 'tool_use') {
    recordToolUse(
      state,
      String(obj.tool_id ?? `tool-${state.toolSequence}`),
      String(obj.tool_name ?? 'Tool'),
      (obj.parameters ?? {}) as Record<string, unknown>,
      typeof obj.tool_name === 'string' ? obj.tool_name : undefined,
    );
    return;
  }

  if (type === 'tool_result') {
    recordToolResult(
      state,
      String(obj.tool_id ?? `tool-${state.toolSequence}`),
      typeof obj.output === 'string' ? obj.output : '',
      obj.status === 'error',
    );
    return;
  }

  if (type === 'item.completed' || type === 'item.started') {
    const item = obj.item as Record<string, unknown> | undefined;
    if (!item) {
      return;
    }
    const itemType = item.type as string | undefined;
    if (itemType === 'agent_message' && type === 'item.completed' && typeof item.text === 'string') {
      appendAssistantText(state, item.text);
      return;
    }
    if (itemType === 'command_execution') {
      const toolId = String(item.id ?? `tool-${state.toolSequence}`);
      const command = String(item.command ?? '');
      recordToolUse(
        state,
        toolId,
        'Bash',
        { command },
        command || 'Bash',
      );
      const output = typeof item.aggregated_output === 'string' ? item.aggregated_output : '';
      const exitCode = item.exit_code;
      if (output || exitCode !== null) {
        recordToolResult(
          state,
          toolId,
          output,
          typeof exitCode === 'number' && exitCode !== 0,
        );
      }
      return;
    }
  }

  if (type === 'turn.started') {
    return;
  }

  recordJsonEvent(state, obj);
}

function processChunkLines(
  state: IncrementalConversationState,
  chunk: string,
  stream: 'stdout' | 'stderr',
): void {
  const key = stream === 'stdout' ? 'stdoutRemainder' : 'stderrRemainder';
  const combined = state[key] + chunk;
  const lines = combined.split('\n');
  state[key] = lines.pop() ?? '';

  for (const line of lines) {
    if (stream === 'stdout') {
      parseStructuredLine(state, line);
    } else if (line.trim()) {
      appendRawText(state, 'stderr', line);
    }
  }
}

export function createIncrementalConversationState(runId: string): IncrementalConversationState {
  return {
    runId,
    stdoutRemainder: '',
    stderrRemainder: '',
    drafts: new Map<string, DraftMessage>(),
    dirtyIds: new Set<string>(),
    toolMessageIds: new Map<string, string>(),
    assistantSegmentIndex: 0,
    rawStdoutIndex: 0,
    rawStderrIndex: 0,
    jsonEventIndex: 0,
    toolSequence: 0,
    currentAssistantMessageId: null,
    currentRawStdoutMessageId: null,
    currentRawStderrMessageId: null,
    hasClaudeTextDelta: false,
    lastAssistantMessageId: null,
    pendingClaudeToolUses: new Map<number, PendingClaudeToolUse>(),
  };
}

export function ingestStdoutConversationChunk(
  state: IncrementalConversationState,
  chunk: string,
): void {
  processChunkLines(state, chunk, 'stdout');
}

export function ingestStderrConversationChunk(
  state: IncrementalConversationState,
  chunk: string,
): void {
  processChunkLines(state, chunk, 'stderr');
}

export function flushIncrementalConversation(
  state: IncrementalConversationState,
  context: IncrementalConversationContext,
): void {
  for (const id of state.dirtyIds) {
    const draft = state.drafts.get(id);
    if (!draft || (!draft.content.trim() && draft.messageType !== 'tool_call')) continue;
    upsertConversationMessage({
      id: draft.id,
      taskId: context.taskId,
      cycleId: context.cycleId,
      runId: context.runId,
      role: draft.role,
      messageType: draft.messageType,
      content: draft.content,
      agentId: context.agentId,
      provider: context.provider,
      modelUsed: context.modelUsed,
      meta: draft.meta,
    });
  }
  state.dirtyIds.clear();
}

export function finalizeIncrementalConversation(
  state: IncrementalConversationState,
  context: IncrementalConversationContext,
): void {
  if (state.stdoutRemainder.trim()) {
    parseStructuredLine(state, state.stdoutRemainder);
    state.stdoutRemainder = '';
  }
  if (state.stderrRemainder.trim()) {
    appendRawText(state, 'stderr', state.stderrRemainder);
    state.stderrRemainder = '';
  }
  flushIncrementalConversation(state, context);
}
