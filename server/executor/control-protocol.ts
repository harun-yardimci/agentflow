/**
 * Control Protocol Handler for Claude CLI's --permission-prompt-tool=stdio
 *
 * Parses stdout lines for controlRequest objects and builds controlResponse payloads.
 * Based on the same protocol used by Vibe Kanban (BloopAI).
 *
 * Protocol:
 * - Claude writes JSON lines to stdout: stream_event, controlRequest, or result
 * - We write JSON lines to stdin: controlResponse (Allow or Deny)
 */

export interface ControlRequest {
  requestId: string;
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
  permissionSuggestions?: string[];
}

export type ParsedLine =
  | { kind: 'stream_event'; data: unknown }
  | { kind: 'control_request'; request: ControlRequest }
  | { kind: 'result'; data: unknown }
  | null;

/**
 * Parse a single stdout line from Claude CLI (stream-json + control protocol).
 * Returns null for unparseable lines or empty strings.
 */
export function parseStdoutLine(line: string): ParsedLine {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('{')) return null;

  try {
    const obj = JSON.parse(trimmed);

    // Control request — Claude is asking for permission or user input
    if (obj.controlRequest) {
      const cr = obj.controlRequest;
      const request = cr.request;

      if (request?.CanUseTool) {
        return {
          kind: 'control_request',
          request: {
            requestId: cr.requestId,
            toolName: request.CanUseTool.toolName ?? '',
            toolUseId: request.CanUseTool.toolUseId ?? '',
            input: request.CanUseTool.input ?? {},
            permissionSuggestions: request.CanUseTool.permissionSuggestions,
          },
        };
      }

      // HookCallback — treat as control request too
      if (request?.HookCallback) {
        return {
          kind: 'control_request',
          request: {
            requestId: cr.requestId,
            toolName: '__hook_callback__',
            toolUseId: request.HookCallback.callbackId ?? '',
            input: request.HookCallback.input ?? {},
          },
        };
      }

      return null;
    }

    // Result — execution complete
    if (obj.type === 'result' || obj.result !== undefined) {
      return { kind: 'result', data: obj };
    }

    // Stream event — normal output (text deltas, tool use, etc.)
    if (obj.type === 'stream_event' || obj.type === 'content_block_delta' || obj.event) {
      return { kind: 'stream_event', data: obj };
    }

    // Unknown JSON — treat as stream event
    return { kind: 'stream_event', data: obj };
  } catch {
    return null;
  }
}

/**
 * Build an Allow response to send back to Claude via stdin.
 */
export function buildAllowResponse(
  requestId: string,
  updatedInput?: Record<string, unknown>,
): string {
  const response: Record<string, unknown> = {
    controlResponse: {
      requestId,
      response: {
        Allow: {
          updatedInput: updatedInput ?? {},
        },
      },
    },
  };
  return JSON.stringify(response);
}

/**
 * Build a Deny response to send back to Claude via stdin.
 */
export function buildDenyResponse(
  requestId: string,
  message: string,
  interrupt = false,
): string {
  const response: Record<string, unknown> = {
    controlResponse: {
      requestId,
      response: {
        Deny: {
          message,
          interrupt,
        },
      },
    },
  };
  return JSON.stringify(response);
}

/**
 * Extract a human-readable question text from a control request.
 * Handles AskUserQuestion tool and falls back to a tool summary for other tools.
 */
export function extractQuestion(
  toolName: string,
  input: Record<string, unknown>,
): string | null {
  // AskUserQuestion — extract the question text
  if (toolName === 'AskUserQuestion') {
    // Claude's AskUserQuestion schema has a "questions" array
    const questions = input.questions as Array<{ question?: string }> | undefined;
    if (Array.isArray(questions) && questions.length > 0) {
      return questions.map((q) => q.question ?? '').filter(Boolean).join('\n');
    }
    // Fallback: check for direct question field
    if (typeof input.question === 'string') {
      return input.question;
    }
    return 'Agent is asking a question';
  }

  // Other tools — generate a summary
  if (toolName === 'Bash') {
    const cmd = input.command ?? input.cmd ?? '';
    return `Run command: ${String(cmd).slice(0, 200)}`;
  }

  if (toolName === 'Edit' || toolName === 'Write') {
    const file = input.file_path ?? input.filePath ?? '';
    return `${toolName} file: ${String(file)}`;
  }

  if (toolName === 'Read') {
    const file = input.file_path ?? input.filePath ?? '';
    return `Read file: ${String(file)}`;
  }

  // Generic tool permission request
  return `Tool permission: ${toolName}`;
}
