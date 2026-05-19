/**
 * CLI Output Parser
 *
 * Extracts human-readable content and metadata from CLI output formats.
 * Claude CLI returns JSON with `{ type: "result", result: "...", usage: {...}, ... }`
 * Codex and Gemini return plain text.
 */

export interface OutputMeta {
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  cost?: number;
  durationMs?: number;
  apiDurationMs?: number;
  numTurns?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ParsedOutput {
  /** The human-readable content */
  content: string;
  /** Whether the provider reported the payload as an error */
  isError?: boolean;
  /** Metadata extracted from structured CLI output */
  meta?: OutputMeta;
}

/**
 * Parse raw CLI output and extract the human-readable result.
 *
 * - Claude CLI (JSON): extracts `result` field, captures usage/cost metadata
 * - Codex/Gemini (text): returns as-is
 * - stream-json partial lines: handles newline-separated JSON objects
 */
export function parseCliOutput(raw: string): ParsedOutput {
  const trimmed = raw.trim();
  if (!trimmed) return { content: '' };

  // Try single JSON object (Claude CLI `--output-format json` or Gemini `-o json`)
  // Gemini sometimes prefixes JSON with warnings like "MCP issues detected..."
  const jsonStart = trimmed.indexOf('{');
  if (jsonStart >= 0 && (trimmed.startsWith('{') || trimmed.includes('{"session_id"') || trimmed.includes('{"type"'))) {
    const jsonStr = trimmed.slice(jsonStart);
    try {
      const parsed = JSON.parse(jsonStr);
      // Claude: { type: "result", result: "..." }
      if (parsed.type === 'result' && typeof parsed.result === 'string') {
        return {
          isError: parsed.is_error === true,
          content: parsed.result,
          meta: extractMeta(parsed),
        };
      }
      // Gemini: { session_id, response, stats }
      if (typeof parsed.response === 'string' && parsed.session_id) {
        return {
          content: parsed.response,
          meta: extractGeminiMeta(parsed),
        };
      }
      if (parsed.type === 'error' && typeof parsed.message === 'string') {
        return {
          content: parsed.message,
          isError: true,
        };
      }

      // Single JSON payload but not a recognized structured result:
      // preserve the raw JSON instead of collapsing to empty content.
      if (trimmed.startsWith('{')) {
        return { content: trimmed };
      }
    } catch {
      // Not valid single-line JSON, try stream-json below
    }
  }

  // Try stream-json: multiple newline-separated JSON objects
  // Claude CLI `--output-format stream-json` emits one JSON per line
  // Gemini `-o stream-json` emits init, message, result lines
  if (trimmed.includes('{"type":')) {
    const lines = trimmed.split('\n').filter((l) => l.trim());

    // Claude: find the last "result" line with a result string
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]!);
        if (parsed.type === 'result' && typeof parsed.result === 'string') {
          return {
            isError: parsed.is_error === true,
            content: parsed.result,
            meta: extractMeta(parsed),
          };
        }
      } catch {
        continue;
      }
    }

    // Gemini stream-json: collect assistant messages + extract stats from result line
    const assistantParts: string[] = [];
    let geminiMeta: OutputMeta | undefined;
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'message' && parsed.role === 'assistant' && parsed.content) {
          assistantParts.push(parsed.content);
        }
        if (parsed.type === 'result' && parsed.stats) {
          geminiMeta = {
            inputTokens: parsed.stats.input_tokens,
            outputTokens: parsed.stats.output_tokens,
          };
        }
      } catch {
        continue;
      }
    }
    if (assistantParts.length > 0) {
      return {
        content: assistantParts.join('\n\n'),
        meta: geminiMeta,
      };
    }

    // Codex --json: item.completed with agent_message, turn.completed with usage
    const codexMessages: string[] = [];
    const codexErrors: string[] = [];
    let codexMeta: OutputMeta | undefined;
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'item.completed' && parsed.item?.type === 'agent_message') {
          codexMessages.push(parsed.item.text);
        }
        if (parsed.type === 'item.completed' && parsed.item?.type === 'error'
          && typeof parsed.item?.message === 'string') {
          codexErrors.push(parsed.item.message);
        }
        if (parsed.type === 'error' && typeof parsed.message === 'string') {
          codexErrors.push(parsed.message);
        }
        if (parsed.type === 'turn.failed' && typeof parsed.error?.message === 'string') {
          codexErrors.push(parsed.error.message);
        }
        if (parsed.type === 'turn.completed' && parsed.usage) {
          codexMeta = {
            inputTokens: parsed.usage.input_tokens,
            outputTokens: parsed.usage.output_tokens,
          };
        }
      } catch {
        continue;
      }
    }
    if (codexMessages.length > 0) {
      return {
        content: codexMessages.join('\n\n'),
        meta: codexMeta,
      };
    }
    if (codexErrors.length > 0) {
      return {
        content: codexErrors.join('\n'),
        isError: true,
      };
    }

    // Claude live/partial: extract text from "assistant" messages when the
    // final result line is missing from persisted stream-json output.
    let claudeMeta: OutputMeta | undefined;
    const claudeTextParts: string[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'assistant' && parsed.message?.content) {
          for (const block of parsed.message.content) {
            if (block.type === 'text' && typeof block.text === 'string') {
              claudeTextParts.push(block.text);
            }
          }
          if (parsed.message?.usage) {
            claudeMeta = extractMeta({ usage: parsed.message.usage });
          }
        }
      } catch {
        continue;
      }
    }
    if (claudeTextParts.length > 0) {
      return {
        content: claudeTextParts.join('\n\n'),
        meta: claudeMeta,
      };
    }

    // Stream-json detected but no readable text extracted (e.g. only tool calls)
    // Return empty rather than raw JSON noise
    return { content: '' };
  }

  // Plain text output (Codex, Gemini, or non-JSON Claude)
  return { content: trimmed };
}

function extractMeta(obj: Record<string, unknown>): OutputMeta | undefined {
  const meta: OutputMeta = {};
  let hasMeta = false;

  if (typeof obj.total_cost_usd === 'number') {
    meta.cost = obj.total_cost_usd;
    hasMeta = true;
  }
  if (typeof obj.duration_ms === 'number') {
    meta.durationMs = obj.duration_ms;
    hasMeta = true;
  }
  if (typeof obj.duration_api_ms === 'number') {
    meta.apiDurationMs = obj.duration_api_ms;
    hasMeta = true;
  }
  if (typeof obj.num_turns === 'number') {
    meta.numTurns = obj.num_turns;
    hasMeta = true;
  }

  const usage = obj.usage as Record<string, unknown> | undefined;
  if (usage && typeof usage === 'object') {
    if (typeof usage.input_tokens === 'number') {
      meta.inputTokens = usage.input_tokens;
      hasMeta = true;
    }
    if (typeof usage.output_tokens === 'number') {
      meta.outputTokens = usage.output_tokens;
      hasMeta = true;
    }
    if (typeof usage.cache_read_input_tokens === 'number') {
      meta.cacheReadInputTokens = usage.cache_read_input_tokens;
      hasMeta = true;
    }
    if (typeof usage.cache_creation_input_tokens === 'number') {
      meta.cacheCreationInputTokens = usage.cache_creation_input_tokens;
      hasMeta = true;
    }
  }

  return hasMeta ? meta : undefined;
}

function extractGeminiMeta(obj: Record<string, unknown>): OutputMeta | undefined {
  const stats = obj.stats as Record<string, unknown> | undefined;
  if (!stats || typeof stats !== 'object') return undefined;

  const meta: OutputMeta = {};
  let hasMeta = false;

  // Aggregate tokens across all models
  const models = stats.models as Record<string, Record<string, unknown>> | undefined;
  if (models && typeof models === 'object') {
    let totalInput = 0;
    let totalOutput = 0;
    for (const model of Object.values(models)) {
      const tokens = model.tokens as Record<string, number> | undefined;
      if (tokens) {
        totalInput += tokens.prompt ?? 0;
        totalOutput += tokens.candidates ?? 0;
      }
    }
    if (totalInput > 0) { meta.inputTokens = totalInput; hasMeta = true; }
    if (totalOutput > 0) { meta.outputTokens = totalOutput; hasMeta = true; }
  }

  return hasMeta ? meta : undefined;
}
