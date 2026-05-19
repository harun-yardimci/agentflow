import { describe, expect, it } from 'vitest';
import { parseClaudeStream } from '../src/lib/claude-stream-parser.ts';

describe('parseClaudeStream', () => {
  it('keeps meaningful blocks when the raw stream ends with invalid JSON', () => {
    const raw = [
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tool_1',
              name: 'Read',
              input: { file_path: '/tmp/test.py' },
            },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool_1',
              content: 'file contents',
              is_error: false,
            },
          ],
        },
      }),
      '{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\\"file_path',
    ].join('\n');

    const parsed = parseClaudeStream(raw);

    expect(parsed.isClaudeStream).toBe(true);
    expect(parsed.blocks).toEqual([
      {
        type: 'tool_use',
        toolName: 'Read',
        toolId: 'tool_1',
        input: { file_path: '/tmp/test.py' },
        summary: '.../tmp/test.py',
      },
      {
        type: 'tool_result',
        toolId: 'tool_1',
        content: 'file contents',
        isError: false,
      },
    ]);
  });

  it('salvages tool input from stream_event input_json_delta chunks', () => {
    const raw = [
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 1,
          content_block: {
            type: 'tool_use',
            id: 'tool_2',
            name: 'Read',
            input: {},
          },
        },
      }),
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"file_path": "/tmp/' },
        },
      }),
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: 'example.py"}' },
        },
      }),
      JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_stop', index: 1 },
      }),
    ].join('\n');

    const parsed = parseClaudeStream(raw);
    const toolUse = parsed.blocks.find((block) => block.type === 'tool_use');

    expect(parsed.isClaudeStream).toBe(true);
    expect(toolUse).toEqual({
      type: 'tool_use',
      toolName: 'Read',
      toolId: 'tool_2',
      input: { file_path: '/tmp/example.py' },
      summary: '.../tmp/example.py',
    });
  });

  it('salvages truncated Codex command execution lines', () => {
    const raw = '{"type":"item.started","item":{"type":"command_execution","id":"cmd_1","command":"npm test';

    const parsed = parseClaudeStream(raw);
    const toolUse = parsed.blocks.find((block) => block.type === 'tool_use');

    expect(parsed.isClaudeStream).toBe(true);
    expect(toolUse).toEqual({
      type: 'tool_use',
      toolName: 'Bash',
      toolId: 'cmd_1',
      input: { command: 'npm test' },
      summary: 'npm test',
    });
  });

  it('salvages truncated Gemini tool_use lines', () => {
    const raw = '{"type":"tool_use","tool_name":"Read","tool_id":"gem_1","parameters":{"file_path":"/tmp/gem';

    const parsed = parseClaudeStream(raw);
    const toolUse = parsed.blocks.find((block) => block.type === 'tool_use');

    expect(parsed.isClaudeStream).toBe(true);
    expect(toolUse).toEqual({
      type: 'tool_use',
      toolName: 'Read',
      toolId: 'gem_1',
      input: { file_path: '/tmp/gem' },
      summary: '.../tmp/gem',
    });
  });
});
