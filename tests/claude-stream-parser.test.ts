import { describe, expect, it, vi } from 'vitest';
import {
  extractIncrementalClaudeText,
  parseClaudeStreamJsonChunk,
  type ClaudeStreamState,
} from '../server/services/breakdown-service.js';

function makeState(): ClaudeStreamState {
  return { buffer: '', assistantText: '', emittedEventKeys: new Set() };
}

describe('extractIncrementalClaudeText', () => {
  it('extracts text from a plain content_block_delta event', () => {
    const state = makeState();
    const event = {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'Hello' },
    };
    expect(extractIncrementalClaudeText(event, state)).toBe('Hello');
    expect(state.assistantText).toBe('Hello');
  });

  it('unwraps stream_event wrapper and extracts delta text', () => {
    const state = makeState();
    const event = {
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'World' },
      },
      session_id: 'abc-123',
    };
    expect(extractIncrementalClaudeText(event, state)).toBe('World');
    expect(state.assistantText).toBe('World');
  });

  it('accumulates multiple stream_event deltas', () => {
    const state = makeState();
    const events = [
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'foo' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: ' bar' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: ' baz' } } },
    ];

    const chunks: string[] = [];
    for (const ev of events) {
      const t = extractIncrementalClaudeText(ev, state);
      if (t) chunks.push(t);
    }

    expect(chunks).toEqual(['foo', ' bar', ' baz']);
    expect(state.assistantText).toBe('foo bar baz');
  });

  it('ignores stream_event with result subtype', () => {
    const state = makeState();
    const event = {
      type: 'stream_event',
      event: { type: 'result', subtype: 'success', result: 'done' },
    };
    expect(extractIncrementalClaudeText(event, state)).toBe('');
  });

  it('handles snapshot-style message content', () => {
    const state = makeState();
    const event = {
      type: 'stream_event',
      event: {
        type: 'message',
        message: {
          content: [{ type: 'text', text: 'snapshot text' }],
        },
      },
    };
    expect(extractIncrementalClaudeText(event, state)).toBe('snapshot text');
  });
});

describe('parseClaudeStreamJsonChunk', () => {
  it('parses NDJSON lines with stream_event wrappers', () => {
    const state = makeState();
    const chunks: string[] = [];
    const onChunk = (text: string) => chunks.push(text);

    const ndjson = [
      JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } } }),
      JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: ' world' } } }),
    ].join('\n') + '\n';

    parseClaudeStreamJsonChunk(ndjson, state, onChunk);

    expect(chunks).toEqual(['Hello', ' world']);
    expect(state.assistantText).toBe('Hello world');
  });

  it('handles chunks split across multiple calls', () => {
    const state = makeState();
    const chunks: string[] = [];
    const onChunk = (text: string) => chunks.push(text);

    const line1 = JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'part1' } } });
    const line2 = JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: ' part2' } } });

    // First chunk: partial line
    parseClaudeStreamJsonChunk(line1.slice(0, 20), state, onChunk);
    expect(chunks).toEqual([]); // buffered, not yet complete

    // Second chunk: rest of line1 + newline + line2 + newline
    parseClaudeStreamJsonChunk(line1.slice(20) + '\n' + line2 + '\n', state, onChunk);
    expect(chunks).toEqual(['part1', ' part2']);
  });

  it('forwards non-JSON lines as diagnostics', () => {
    const state = makeState();
    const chunks: string[] = [];
    const onChunk = (text: string) => chunks.push(text);

    parseClaudeStreamJsonChunk('Some CLI warning message\n', state, onChunk);

    expect(chunks.length).toBe(1);
    expect(chunks[0]).toContain('[cli]');
    expect(chunks[0]).toContain('Some CLI warning message');
  });

  it('emits lifecycle events for non-delta stream events', () => {
    const state = makeState();
    const chunks: string[] = [];
    const onChunk = (text: string) => chunks.push(text);

    const initEvent = JSON.stringify({
      type: 'stream_event',
      event: { type: 'system', subtype: 'init', model: 'claude-sonnet-4-20250514' },
    });

    parseClaudeStreamJsonChunk(initEvent + '\n', state, onChunk);

    expect(chunks.some(c => c.includes('claude:init'))).toBe(true);
  });
});
