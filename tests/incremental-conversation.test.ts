import { describe, expect, it } from 'vitest';
import {
  createIncrementalConversationState,
  ingestStdoutConversationChunk,
} from '../server/engine/incremental-conversation.js';

describe('incremental-conversation', () => {
  it('waits for the next chunk when a JSON line is incomplete', () => {
    const state = createIncrementalConversationState('run_1');

    ingestStdoutConversationChunk(
      state,
      '{"type":"stream_event","event":{"delta":{"type":"text_delta","text":"Hel',
    );

    expect(state.drafts.size).toBe(0);

    ingestStdoutConversationChunk(
      state,
      'lo"}}}\n',
    );

    const draft = Array.from(state.drafts.values())[0];
    expect(draft?.messageType).toBe('stream_text');
    expect(draft?.content).toBe('Hello');
  });

  it('merges tool result into the existing tool call card', () => {
    const state = createIncrementalConversationState('run_2');

    ingestStdoutConversationChunk(
      state,
      `${JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool_1',
              name: 'Bash',
              input: { command: 'npm test' },
            },
          ],
        },
      })}\n`,
    );

    ingestStdoutConversationChunk(
      state,
      `${JSON.stringify({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool_1',
              content: 'All tests passed',
              is_error: false,
            },
          ],
        },
      })}\n`,
    );

    const drafts = Array.from(state.drafts.values());
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.messageType).toBe('tool_call');
    expect(drafts[0]?.meta.resultContent).toBe('All tests passed');
  });

  it('formats system init events into a structured session card', () => {
    const state = createIncrementalConversationState('run_3');

    ingestStdoutConversationChunk(
      state,
      `${JSON.stringify({
        type: 'system',
        subtype: 'init',
        cwd: '/tmp/worktree',
        model: 'claude-sonnet-4-6',
        permissionMode: 'bypassPermissions',
        claude_code_version: '2.1.81',
        tools: ['Bash', 'Read'],
        skills: ['brainstorming'],
        agents: ['general-purpose', 'Plan'],
        mcp_servers: [
          { name: 'stitch', status: 'connected' },
          { name: 'agentflow', status: 'failed' },
          { name: 'gmail', status: 'needs-auth' },
        ],
      })}\n`,
    );

    const draft = Array.from(state.drafts.values())[0];
    expect(draft?.messageType).toBe('session_init');
    expect(draft?.meta.model).toBe('claude-sonnet-4-6');
    expect(draft?.meta.permissionMode).toBe('bypassPermissions');
    expect(draft?.meta.toolCount).toBe(2);
    expect(draft?.meta.connectedServers).toEqual(['stitch']);
    expect(draft?.meta.failedServers).toEqual(['agentflow']);
    expect(draft?.meta.authServers).toEqual(['gmail']);
  });

  it('buffers Claude input_json_delta chunks into a single tool call', () => {
    const state = createIncrementalConversationState('run_4');

    ingestStdoutConversationChunk(
      state,
      `${JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'tool_partial_1',
            name: 'Read',
            input: {},
          },
        },
      })}\n`,
    );

    ingestStdoutConversationChunk(
      state,
      `${JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'input_json_delta',
            partial_json: '{"file_path":"/tmp/de',
          },
        },
      })}\n`,
    );

    ingestStdoutConversationChunk(
      state,
      `${JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'input_json_delta',
            partial_json: 'mo.txt"}',
          },
        },
      })}\n`,
    );

    ingestStdoutConversationChunk(
      state,
      `${JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_stop',
          index: 0,
        },
      })}\n`,
    );

    const drafts = Array.from(state.drafts.values());
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.messageType).toBe('tool_call');
    expect(drafts[0]?.meta.toolName).toBe('Read');
    expect(drafts[0]?.meta.input).toEqual({ file_path: '/tmp/demo.txt' });
  });

  it('suppresses low-level Claude stream and system noise events', () => {
    const state = createIncrementalConversationState('run_5');

    const noisyLines = [
      {
        type: 'system',
        subtype: 'api_retry',
        attempt: 1,
        max_retries: 10,
      },
      {
        type: 'rate_limit_event',
        rate_limit_info: { status: 'allowed' },
      },
      {
        type: 'stream_event',
        event: {
          type: 'message_start',
          message: { role: 'assistant' },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', thinking: 'internal reasoning' },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'signature_delta', signature: 'sig' },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_stop',
          index: 0,
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'message_delta',
          delta: { stop_reason: 'tool_use', stop_sequence: null },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'message_stop',
        },
      },
      {
        type: 'system',
        subtype: 'task_progress',
        task_id: 'subtask_1',
        description: 'Reading files',
      },
    ];

    ingestStdoutConversationChunk(
      state,
      `${noisyLines.map((line) => JSON.stringify(line)).join('\n')}\n`,
    );

    expect(Array.from(state.drafts.values())).toHaveLength(0);
  });

  it('normalizes Gemini init and suppresses echoed user prompts', () => {
    const state = createIncrementalConversationState('run_6');

    ingestStdoutConversationChunk(
      state,
      `${JSON.stringify({
        type: 'init',
        session_id: 'gemini_session_1',
        model: 'auto-gemini-3',
      })}\n`,
    );

    ingestStdoutConversationChunk(
      state,
      `${JSON.stringify({
        type: 'message',
        role: 'user',
        content: 'Research the market',
      })}\n`,
    );

    const drafts = Array.from(state.drafts.values());
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.messageType).toBe('session_init');
    expect(drafts[0]?.meta.sessionId).toBe('gemini_session_1');
    expect(drafts[0]?.meta.model).toBe('auto-gemini-3');
  });

  it('normalizes Codex thread start and suppresses turn start noise', () => {
    const state = createIncrementalConversationState('run_7');

    ingestStdoutConversationChunk(
      state,
      `${JSON.stringify({
        type: 'thread.started',
        thread_id: 'thread_123',
      })}\n`,
    );

    ingestStdoutConversationChunk(
      state,
      `${JSON.stringify({
        type: 'turn.started',
      })}\n`,
    );

    const drafts = Array.from(state.drafts.values());
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.messageType).toBe('session_init');
    expect(drafts[0]?.meta.sessionId).toBe('thread_123');
  });

  it('resets Claude text-delta suppression when a new assistant message starts', () => {
    const state = createIncrementalConversationState('run_8');

    ingestStdoutConversationChunk(
      state,
      `${JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'message_start',
          message: { role: 'assistant' },
        },
      })}\n`,
    );

    ingestStdoutConversationChunk(
      state,
      `${JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: {
            type: 'text_delta',
            text: 'First turn',
          },
        },
      })}\n`,
    );

    ingestStdoutConversationChunk(
      state,
      `${JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'message_stop',
        },
      })}\n`,
    );

    ingestStdoutConversationChunk(
      state,
      `${JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'message_start',
          message: { role: 'assistant' },
        },
      })}\n`,
    );

    ingestStdoutConversationChunk(
      state,
      `${JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'text',
              text: 'Second turn',
            },
          ],
        },
      })}\n`,
    );

    const drafts = Array.from(state.drafts.values())
      .filter((draft) => draft.messageType === 'stream_text');

    expect(drafts).toHaveLength(2);
    expect(drafts.map((draft) => draft.content)).toEqual([
      'First turn',
      'Second turn',
    ]);
  });
});
