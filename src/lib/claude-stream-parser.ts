/**
 * CLI Stream Parser
 *
 * Parses CLI stream-json output into structured conversation blocks.
 * Supports:
 * - Claude CLI: stream_event, assistant, user, result
 * - Codex CLI: thread.started, item.completed (agent_message, reasoning,
 *   command_execution), turn.completed
 */

export type BlockType = 'text' | 'tool_use' | 'tool_result';

export interface TextBlock {
  type: 'text';
  content: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  toolName: string;
  toolId: string;
  input: Record<string, unknown>;
  /** Short summary for display (e.g. file path for Edit/Read) */
  summary?: string;
}

export interface ToolResultBlock {
  type: 'tool_result';
  toolId: string;
  content: string;
  /** Whether the result was an error */
  isError?: boolean;
}

export type ConversationBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface ParsedStream {
  /** Structured conversation blocks */
  blocks: ConversationBlock[];
  /** Final result text (from type:"result" message) */
  result?: string;
  /** Whether parsing found any Claude stream JSON */
  isClaudeStream: boolean;
}

interface PendingToolUse {
  toolId: string;
  toolName: string;
  inputChunks: string[];
}

/**
 * Extract a short summary from tool_use input for display.
 */
function summarizeToolInput(toolName: string, input: Record<string, unknown>): string | undefined {
  const name = toolName.toLowerCase();

  // File operations — show file path (Claude + Gemini tool names)
  if (name === 'edit' || name === 'write' || name === 'read' ||
      name === 'read_file' || name === 'write_file' || name === 'edit_file') {
    const fp = input.file_path ?? input.filePath ?? input.path;
    if (typeof fp === 'string') {
      // Show only filename + parent dir
      const parts = fp.split('/');
      return parts.length > 2
        ? `.../${parts.slice(-2).join('/')}`
        : fp;
    }
  }

  // Directory listing (Gemini)
  if (name === 'list_directory' || name === 'list_dir') {
    const fp = input.dir_path ?? input.path;
    if (typeof fp === 'string') return fp;
  }

  // Bash — show command (Claude + Gemini)
  if (name === 'bash' || name === 'execute' || name === 'shell' || name === 'execute_command') {
    const cmd = input.command ?? input.cmd;
    if (typeof cmd === 'string') {
      return cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd;
    }
  }

  // Glob/Grep — show pattern (Claude + Gemini)
  if (name === 'glob' || name === 'grep' || name === 'search' ||
      name === 'grep_search' || name === 'find_files') {
    const pat = input.pattern ?? input.query;
    if (typeof pat === 'string') return pat;
  }

  return undefined;
}

function parseBestEffortInput(partial: string): Record<string, unknown> {
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
    // Fall through to key-based salvage.
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

function extractJsonStringField(source: string, key: string): string | undefined {
  const match = source.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)`));
  return match?.[1];
}

function extractJsonNumberField(source: string, key: string): number | undefined {
  const match = source.match(new RegExp(`"${key}"\\s*:\\s*(-?\\d+)`));
  return match?.[1] ? Number(match[1]) : undefined;
}

function parseTruncatedProviderLine(line: string): ConversationBlock[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;

  if (trimmed.includes('"type":"tool_use"')) {
    const toolName = extractJsonStringField(trimmed, 'tool_name') ?? 'unknown';
    const toolId = extractJsonStringField(trimmed, 'tool_id') ?? `truncated-tool-${toolName}`;
    const input = parseBestEffortInput(trimmed);
    return [{
      type: 'tool_use',
      toolName,
      toolId,
      input,
      summary: summarizeToolInput(toolName, input),
    }];
  }

  if (
    (trimmed.includes('"type":"item.started"') || trimmed.includes('"type":"item.completed"'))
    && trimmed.includes('"type":"command_execution"')
  ) {
    const toolId = extractJsonStringField(trimmed, 'id') ?? 'truncated-codex-command';
    const command = extractJsonStringField(trimmed, 'command') ?? '';
    const output = extractJsonStringField(trimmed, 'aggregated_output') ?? '';
    const exitCode = extractJsonNumberField(trimmed, 'exit_code');
    const blocks: ConversationBlock[] = [{
      type: 'tool_use',
      toolName: 'Bash',
      toolId,
      input: command ? { command } : {},
      summary: command || 'Bash',
    }];

    if (output || exitCode != null) {
      blocks.push({
        type: 'tool_result',
        toolId,
        content: output,
        isError: exitCode != null && exitCode !== 0,
      });
    }

    return blocks;
  }

  if (trimmed.includes('"type":"tool_result"')) {
    const toolId = extractJsonStringField(trimmed, 'tool_id') ?? 'truncated-tool-result';
    const output = extractJsonStringField(trimmed, 'output') ?? '';
    const status = extractJsonStringField(trimmed, 'status');
    return [{
      type: 'tool_result',
      toolId,
      content: output,
      isError: status === 'error',
    }];
  }

  return null;
}

/**
 * Parse a single JSON line from Claude CLI stream output.
 * Returns conversation blocks or null if not parseable.
 */
function parseLine(line: string): ConversationBlock[] | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('{')) return null;

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const type = obj.type as string | undefined;

  // "assistant" message — contains text blocks and tool_use blocks
  if (type === 'assistant') {
    const msg = obj.message as Record<string, unknown> | undefined;
    if (!msg) return null;

    const content = msg.content as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(content)) return null;

    const blocks: ConversationBlock[] = [];

    for (const block of content) {
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        blocks.push({ type: 'text', content: block.text });
      } else if (block.type === 'tool_use') {
        const input = (block.input ?? {}) as Record<string, unknown>;
        const toolName = (block.name ?? 'unknown') as string;
        blocks.push({
          type: 'tool_use',
          toolName,
          toolId: (block.id ?? '') as string,
          input,
          summary: summarizeToolInput(toolName, input),
        });
      }
    }

    return blocks.length > 0 ? blocks : null;
  }

  // "user" message — contains tool_result entries
  if (type === 'user') {
    const msg = obj.message as Record<string, unknown> | undefined;
    if (!msg) return null;

    const content = msg.content as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(content)) return null;

    const blocks: ConversationBlock[] = [];

    for (const block of content) {
      if (block.type === 'tool_result') {
        let text = '';
        if (typeof block.content === 'string') {
          text = block.content;
        } else if (Array.isArray(block.content)) {
          text = (block.content as Array<Record<string, unknown>>)
            .filter((c) => c.type === 'text')
            .map((c) => c.text as string)
            .join('\n');
        }
        blocks.push({
          type: 'tool_result',
          toolId: (block.tool_use_id ?? '') as string,
          content: text,
          isError: block.is_error === true,
        });
      }
    }

    return blocks.length > 0 ? blocks : null;
  }

  return null;
}

/**
 * Parse CLI stream-json output into conversation blocks.
 * Supports both Claude CLI and Codex CLI formats.
 */
export function parseClaudeStream(raw: string): ParsedStream {
  const trimmed = raw.trim();
  if (!trimmed) return { blocks: [], isClaudeStream: false };

  // Quick check — does this look like stream JSON?
  if (!trimmed.includes('"type"')) {
    return { blocks: [], isClaudeStream: false };
  }

  const lines = trimmed.split('\n');
  const blocks: ConversationBlock[] = [];
  const seenToolIds = new Set<string>();
  const pendingTools = new Map<number, PendingToolUse>();
  let result: string | undefined;
  let foundStreamLine = false;

  const pushToolUse = (
    toolName: string,
    toolId: string,
    input: Record<string, unknown>,
  ): void => {
    if (!toolId || seenToolIds.has(toolId)) {
      return;
    }
    seenToolIds.add(toolId);
    blocks.push({
      type: 'tool_use',
      toolName,
      toolId,
      input,
      summary: summarizeToolInput(toolName, input),
    });
  };

  for (const line of lines) {
    const t = line.trim();
    if (!t || !t.startsWith('{')) continue;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(t);
    } catch {
      const fallbackBlocks = parseTruncatedProviderLine(t);
      if (fallbackBlocks) {
        foundStreamLine = true;
        for (const block of fallbackBlocks) {
          if (block.type === 'tool_use') {
            pushToolUse(block.toolName, block.toolId, block.input);
            continue;
          }
          blocks.push(block);
        }
      }
      continue;
    }

    const type = obj.type as string | undefined;
    if (!type) continue;

    // Claude stream types
    if (type === 'assistant' || type === 'user' || type === 'stream_event' || type === 'result') {
      foundStreamLine = true;
    }

    // Codex stream types
    if (type === 'thread.started' || type === 'turn.started' || type === 'turn.completed' ||
        type === 'item.completed' || type === 'item.started') {
      foundStreamLine = true;
    }

    // Gemini stream types
    if (type === 'init' || type === 'message' || type === 'tool_use' || type === 'tool_result') {
      foundStreamLine = true;
    }

    // Extract final result (Claude: result with text, Gemini: result with stats)
    if (type === 'result') {
      if (typeof obj.result === 'string') {
        result = obj.result;
      }
      // Gemini result has stats but no text — skip, last assistant message is the result
      continue;
    }

    if (type === 'stream_event') {
      const event = obj.event as Record<string, unknown> | undefined;
      if (!event) continue;

      if (event.type === 'content_block_start') {
        const index = typeof event.index === 'number' ? event.index : null;
        const contentBlock = event.content_block as Record<string, unknown> | undefined;
        if (
          index != null
          && contentBlock?.type === 'tool_use'
          && typeof contentBlock.id === 'string'
        ) {
          pendingTools.set(index, {
            toolId: contentBlock.id,
            toolName: typeof contentBlock.name === 'string'
              ? contentBlock.name
              : 'unknown',
            inputChunks: [],
          });
        }
        continue;
      }

      if (event.type === 'content_block_delta') {
        const index = typeof event.index === 'number' ? event.index : null;
        const delta = event.delta as Record<string, unknown> | undefined;
        if (
          index != null
          && delta?.type === 'input_json_delta'
          && typeof delta.partial_json === 'string'
        ) {
          const pending = pendingTools.get(index);
          if (pending) {
            pending.inputChunks.push(delta.partial_json);
          }
        }
        continue;
      }

      if (event.type === 'content_block_stop') {
        const index = typeof event.index === 'number' ? event.index : null;
        if (index != null) {
          const pending = pendingTools.get(index);
          if (pending && !seenToolIds.has(pending.toolId)) {
            pushToolUse(
              pending.toolName,
              pending.toolId,
              parseBestEffortInput(pending.inputChunks.join('')),
            );
          }
          pendingTools.delete(index);
        }
        continue;
      }

      continue;
    }

    // Skip Gemini init line
    if (type === 'init') continue;

    // Gemini: top-level "message" with role
    if (type === 'message') {
      if (obj.role === 'assistant' && typeof obj.content === 'string' && (obj.content as string).trim()) {
        blocks.push({ type: 'text', content: obj.content as string });
        result = obj.content as string; // last assistant message is the result
      }
      // Skip user messages
      continue;
    }

    // Gemini: top-level "tool_use"
    if (type === 'tool_use') {
      const params = (obj.parameters ?? {}) as Record<string, unknown>;
      const toolName = (obj.tool_name ?? 'unknown') as string;
      pushToolUse(
        toolName,
        (obj.tool_id ?? `gemini-${blocks.length}`) as string,
        params,
      );
      continue;
    }

    // Gemini: top-level "tool_result"
    if (type === 'tool_result') {
      blocks.push({
        type: 'tool_result',
        toolId: (obj.tool_id ?? '') as string,
        content: (obj.output ?? '') as string,
        isError: obj.status === 'error',
      });
      continue;
    }

    // Codex: item.completed — agent_message, command_execution, reasoning
    if (type === 'item.completed' || type === 'item.started') {
      const item = obj.item as Record<string, unknown> | undefined;
      if (!item) continue;

      const itemType = item.type as string | undefined;

      if (itemType === 'agent_message' && typeof item.text === 'string' && item.text.trim()) {
        blocks.push({ type: 'text', content: item.text });
        // Last agent_message is the result for Codex
        result = item.text;
      }

      if (itemType === 'command_execution') {
        const cmd = (item.command ?? '') as string;
        const output = (item.aggregated_output ?? '') as string;
        const exitCode = item.exit_code as number | null | undefined;
        const toolId = (item.id ?? `codex-${blocks.length}`) as string;

        pushToolUse('Bash', toolId, { command: cmd });

        if (output || exitCode !== null) {
          blocks.push({
            type: 'tool_result',
            toolId,
            content: output,
            isError: exitCode !== null && exitCode !== undefined && exitCode !== 0,
          });
        }
      }

      // Skip reasoning blocks (internal thinking)
      continue;
    }

    // Parse Claude assistant/user messages
    const parsed = parseLine(t);
    if (parsed) {
      for (const block of parsed) {
        if (block.type === 'tool_use') {
          pushToolUse(block.toolName, block.toolId, block.input);
          continue;
        }
        blocks.push(block);
      }
    }
  }

  // Merge consecutive text blocks
  const merged = mergeTextBlocks(blocks);

  return {
    blocks: merged,
    result,
    isClaudeStream: foundStreamLine,
  };
}

/**
 * Merge consecutive text blocks into single blocks.
 */
function mergeTextBlocks(blocks: ConversationBlock[]): ConversationBlock[] {
  const result: ConversationBlock[] = [];

  for (const block of blocks) {
    const prev = result[result.length - 1];
    if (block.type === 'text' && prev?.type === 'text') {
      prev.content += '\n\n' + block.content;
    } else {
      result.push({ ...block });
    }
  }

  return result;
}

/**
 * For live/streaming output that may not have full "assistant" messages yet,
 * extract text from stream_event text_delta entries.
 */
export function extractStreamingText(raw: string): string {
  const lines = raw.trim().split('\n');
  const textParts: string[] = [];

  for (const line of lines) {
    const t = line.trim();
    if (!t || !t.startsWith('{')) continue;

    try {
      const obj = JSON.parse(t) as Record<string, unknown>;

      if (obj.type === 'stream_event') {
        const event = obj.event as Record<string, unknown> | undefined;
        if (!event) continue;

        if (event.type === 'content_block_delta') {
          const delta = event.delta as Record<string, unknown> | undefined;
          if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
            textParts.push(delta.text);
          }
        }
      }
    } catch {
      continue;
    }
  }

  return textParts.join('');
}
