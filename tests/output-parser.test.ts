import { describe, it, expect } from 'vitest';
import { parseCliOutput } from '../server/executor/output-parser.js';

describe('Output Parser', () => {
  it('should extract result from Claude CLI JSON output', () => {
    const raw = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'Here is the design specification for the dashboard...',
      duration_ms: 45000,
      duration_api_ms: 42000,
      num_turns: 3,
      total_cost_usd: 0.0523,
      is_error: false,
      usage: {
        input_tokens: 1500,
        output_tokens: 3200,
        cache_read_input_tokens: 240,
        cache_creation_input_tokens: 120,
      },
    });

    const parsed = parseCliOutput(raw);

    expect(parsed.content).toBe('Here is the design specification for the dashboard...');
    expect(parsed.isError).toBe(false);
    expect(parsed.meta).toBeDefined();
    expect(parsed.meta!.cost).toBe(0.0523);
    expect(parsed.meta!.durationMs).toBe(45000);
    expect(parsed.meta!.apiDurationMs).toBe(42000);
    expect(parsed.meta!.numTurns).toBe(3);
    expect(parsed.meta!.inputTokens).toBe(1500);
    expect(parsed.meta!.outputTokens).toBe(3200);
    expect(parsed.meta!.cacheReadInputTokens).toBe(240);
    expect(parsed.meta!.cacheCreationInputTokens).toBe(120);
  });

  it('should return plain text output as-is', () => {
    const raw = 'This is a plain text output from Codex or Gemini.';
    const parsed = parseCliOutput(raw);

    expect(parsed.content).toBe(raw);
    expect(parsed.meta).toBeUndefined();
  });

  it('should handle empty output', () => {
    const parsed = parseCliOutput('');
    expect(parsed.content).toBe('');
    expect(parsed.meta).toBeUndefined();
  });

  it('should extract single JSON error payloads', () => {
    const raw = JSON.stringify({ type: 'error', message: 'Something went wrong' });
    const parsed = parseCliOutput(raw);

    expect(parsed.content).toBe('Something went wrong');
    expect(parsed.isError).toBe(true);
    expect(parsed.meta).toBeUndefined();
  });

  it('should mark Claude result payloads that are flagged as errors', () => {
    const raw = JSON.stringify({
      type: 'result',
      is_error: true,
      result: 'Rate limit exceeded',
    });

    const parsed = parseCliOutput(raw);
    expect(parsed.content).toBe('Rate limit exceeded');
    expect(parsed.isError).toBe(true);
  });

  it('should handle stream-json with multiple lines', () => {
    const lines = [
      JSON.stringify({ type: 'assistant', content: [{ type: 'text', text: 'partial' }] }),
      JSON.stringify({ type: 'assistant', content: [{ type: 'text', text: 'more output' }] }),
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'Final result from stream',
        total_cost_usd: 0.01,
        usage: { input_tokens: 100, output_tokens: 200 },
      }),
    ];

    const raw = lines.join('\n');
    const parsed = parseCliOutput(raw);

    expect(parsed.content).toBe('Final result from stream');
    expect(parsed.meta?.cost).toBe(0.01);
    expect(parsed.meta?.inputTokens).toBe(100);
    expect(parsed.meta?.outputTokens).toBe(200);
  });

  it('should fall back to Claude assistant messages when stream-json has no final result line', () => {
    const raw = [
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Draft answer' },
          ],
          usage: {
            input_tokens: 50,
            output_tokens: 75,
          },
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Follow-up detail' },
          ],
        },
      }),
    ].join('\n');

    const parsed = parseCliOutput(raw);

    expect(parsed.content).toBe('Draft answer\n\nFollow-up detail');
    expect(parsed.meta?.inputTokens).toBe(50);
    expect(parsed.meta?.outputTokens).toBe(75);
  });

  it('should handle result with missing optional metadata', () => {
    const raw = JSON.stringify({
      type: 'result',
      result: 'Simple result',
    });

    const parsed = parseCliOutput(raw);
    expect(parsed.content).toBe('Simple result');
    expect(parsed.meta).toBeUndefined();
  });

  it('should handle multiline text output', () => {
    const raw = `## Design Spec

This is a multiline output
with multiple paragraphs.

### Section 1
Content here.`;

    const parsed = parseCliOutput(raw);
    expect(parsed.content).toBe(raw.trim());
    expect(parsed.meta).toBeUndefined();
  });

  it('should extract Codex error events when no agent message is present', () => {
    const raw = [
      JSON.stringify({
        type: 'item.completed',
        item: {
          id: 'item_0',
          type: 'error',
          message: 'Model metadata for `gpt-4o` not found.',
        },
      }),
      JSON.stringify({
        type: 'error',
        message: '{"detail":"The \'gpt-4o\' model is not supported."}',
      }),
      JSON.stringify({
        type: 'turn.failed',
        error: {
          message: '{"detail":"The \'gpt-4o\' model is not supported."}',
        },
      }),
    ].join('\n');

    const parsed = parseCliOutput(raw);

    expect(parsed.isError).toBe(true);
    expect(parsed.content).toContain('gpt-4o');
    expect(parsed.content).toContain('not supported');
  });

  it('should prefer Codex agent messages over Codex error events', () => {
    const raw = [
      '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Minor warning"}}',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Task completed successfully."}}',
      '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":200}}',
    ].join('\n');

    const parsed = parseCliOutput(raw);

    expect(parsed.content).toBe('Task completed successfully.');
    expect(parsed.isError).toBeUndefined();
    expect(parsed.meta?.inputTokens).toBe(100);
    expect(parsed.meta?.outputTokens).toBe(200);
  });
});
