import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateBreakdown, streamBreakdown } from '../src/lib/api.js';

const originalFetch = globalThis.fetch;
const encoder = new TextEncoder();

function createSseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('streamBreakdown SSE parsing', () => {
  it('keeps no-attachment breakdown requests valid', async () => {
    const responseBody = {
      summary: 'summary',
      tasks: [],
      reasoning: 'reasoning',
    };

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    await generateBreakdown({
      description: 'test',
      agentIds: ['a1'],
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/breakdown',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          description: 'test',
          agentIds: ['a1'],
        }),
      }),
    );
  });

  it('passes attachmentIds through the breakdown request body', async () => {
    const responseBody = {
      summary: 'summary',
      tasks: [],
      reasoning: 'reasoning',
    };

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    await generateBreakdown({
      description: 'test',
      agentIds: ['a1'],
      attachmentIds: ['att-1', 'att-2'],
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/breakdown',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          description: 'test',
          agentIds: ['a1'],
          attachmentIds: ['att-1', 'att-2'],
        }),
      }),
    );
  });

  it('parses event and data lines split across different chunks', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      createSseResponse([
        'event: chunk\n',
        'data: {"text":"hello"}\n\n',
        'event: done\ndata: {}\n\n',
      ]),
    ) as unknown as typeof fetch;

    const onChunk = vi.fn();
    const onPlan = vi.fn();
    const onError = vi.fn();
    const onDone = vi.fn();

    await streamBreakdown(
      { description: 'test', agentIds: ['a1'] },
      { onChunk, onPlan, onError, onDone },
    );

    expect(onChunk).toHaveBeenCalledWith('hello');
    expect(onPlan).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('emits onDone when stream closes without explicit done event', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      createSseResponse([
        'event: chunk\ndata: {"text":"partial"}\n\n',
      ]),
    ) as unknown as typeof fetch;

    const onChunk = vi.fn();
    const onPlan = vi.fn();
    const onError = vi.fn();
    const onDone = vi.fn();

    await streamBreakdown(
      { description: 'test', agentIds: ['a1'] },
      { onChunk, onPlan, onError, onDone },
    );

    expect(onChunk).toHaveBeenCalledWith('partial');
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
