import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  deleteTaskAttachment,
  getAttachmentDownloadUrl,
  getTaskAttachments,
  uploadTaskAttachment,
} from '../src/lib/api.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('task attachment api helpers', () => {
  it('lists task attachments from the task-specific route', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          attachments: [
            {
              id: 'att-1',
              targetType: 'task',
              targetId: 'task-1',
              pipelineId: 'pipe-1',
              filename: 'stored.txt',
              originalName: 'spec.txt',
              mimeType: 'text/plain',
              sizeBytes: 128,
              createdAt: '2025-01-10T12:00:00.000Z',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    ) as unknown as typeof fetch;

    const attachments = await getTaskAttachments('task-1');

    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.originalName).toBe('spec.txt');
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/tasks/task-1/attachments', {
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it('uploads a file to the task attachment endpoint', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          attachments: [
            {
              id: 'att-2',
              targetType: 'task',
              targetId: 'task-9',
              pipelineId: 'pipe-1',
              filename: 'stored-notes.txt',
              originalName: 'notes.txt',
              mimeType: 'text/plain',
              sizeBytes: 5,
              createdAt: '2025-01-10T12:00:00.000Z',
            },
          ],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    ) as unknown as typeof fetch;

    const uploaded = await uploadTaskAttachment(
      'task-9',
      new File(['hello'], 'notes.txt', { type: 'text/plain' }),
    );

    const mock = vi.mocked(globalThis.fetch);
    const [, options] = mock.mock.calls[0] ?? [];
    const body = options?.body;

    expect(uploaded.id).toBe('att-2');
    expect(options?.method).toBe('POST');
    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('files')).toBeInstanceOf(File);
  });

  it('surfaces api errors for failed attachment uploads', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'Task is running' }),
        {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    ) as unknown as typeof fetch;

    await expect(
      uploadTaskAttachment(
        'task-3',
        new File(['hello'], 'notes.txt', { type: 'text/plain' }),
      ),
    ).rejects.toThrow('Task is running');
  });

  it('surfaces per-file size limit errors for uploads', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'File too large — 10 MB per-file limit' }),
        {
          status: 413,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    ) as unknown as typeof fetch;

    await expect(
      uploadTaskAttachment(
        'task-3',
        new File(['hello'], 'too-large.bin', {
          type: 'application/octet-stream',
        }),
      ),
    ).rejects.toThrow('File too large');
  });

  it('surfaces list errors for deleted tasks', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'Task not found' }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    ) as unknown as typeof fetch;

    await expect(getTaskAttachments('missing-task')).rejects.toThrow('Task not found');
  });

  it('deletes task attachments through the task route', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ deleted: true }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    ) as unknown as typeof fetch;

    const result = await deleteTaskAttachment('task-1', 'att-4');

    expect(result.deleted).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/tasks/task-1/attachments/att-4',
      {
        headers: { 'Content-Type': 'application/json' },
        method: 'DELETE',
      },
    );
  });

  it('builds the task attachment download url', () => {
    expect(getAttachmentDownloadUrl('att-5')).toBe(
      '/api/attachments/att-5/download',
    );
  });
});
