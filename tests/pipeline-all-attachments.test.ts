import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTestDb } from './helpers/test-db.js';
import type { Attachment } from '../src/types/index.js';

// ─── Service-level tests ───

let db: Database.Database;

vi.mock('../server/db/connection.js', () => ({
  getDb: () => db,
  closeDb: () => { db?.close(); },
}));

// Mock pipeline-runner to avoid worker pool init
vi.mock('../server/engine/pipeline-runner.js', () => ({
  resumeTask: () => undefined,
}));

const { listAllPipelineAttachments, listAttachments } = await import(
  '../server/services/attachment-service.js'
);

function seedPipelineAndTask(): void {
  db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)')
    .run('agent-1', 'Agent', 'prompt');
  db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)')
    .run('p1', 'Pipeline', 'queued', '2024-01-01');
  db.prepare(
    'INSERT INTO tasks (id, pipeline_id, name, agent_id, model, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('t1', 'p1', 'Task 1', 'agent-1', 'claude', 'auto', 'queued', 0, 'input', 0);
}

function insertAttachment(
  id: string,
  targetType: string,
  targetId: string,
  pipelineId: string,
  originalName: string,
): void {
  db.prepare(
    'INSERT INTO attachments (id, target_type, target_id, pipeline_id, filename, original_name, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, targetType, targetId, pipelineId, `${id}.txt`, originalName, 'text/plain', 100, '2024-01-01T00:00:00Z');
}

describe('listAllPipelineAttachments', () => {
  beforeEach(() => {
    db = createTestDb();
    seedPipelineAndTask();
  });

  afterEach(() => {
    db.close();
  });

  it('returns both task-scoped and pipeline-scoped attachments', () => {
    insertAttachment('att-pipe', 'pipeline', 'p1', 'p1', 'spec.md');
    insertAttachment('att-task', 'task', 't1', 'p1', 'task-file.txt');

    const all = listAllPipelineAttachments('p1');
    expect(all).toHaveLength(2);
    expect(all.map((a: { id: string }) => a.id).sort()).toEqual(['att-pipe', 'att-task']);
  });

  it('returns empty array when pipeline has no attachments', () => {
    const all = listAllPipelineAttachments('p1');
    expect(all).toEqual([]);
  });

  it('does not mix attachments from different pipelines', () => {
    db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)')
      .run('p2', 'Other', 'queued', '2024-01-01');

    insertAttachment('att-p1', 'pipeline', 'p1', 'p1', 'file-p1.txt');
    insertAttachment('att-p2', 'pipeline', 'p2', 'p2', 'file-p2.txt');

    const all = listAllPipelineAttachments('p1');
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('att-p1');
  });

  it('includes message-scoped attachments belonging to the pipeline', () => {
    db.prepare(
      'INSERT INTO control_requests (id, task_id, run_id, tool_name, input_json, status, created_at, timeout_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('cr1', 't1', 'run1', 'tool', '{}', 'pending', '2024-01-01', '2024-01-02');

    insertAttachment('att-msg', 'message', 'cr1', 'p1', 'msg-file.txt');
    insertAttachment('att-task', 'task', 't1', 'p1', 'task-file.txt');

    const all = listAllPipelineAttachments('p1');
    expect(all).toHaveLength(2);
    expect(all.map((a: { targetType: string }) => a.targetType).sort()).toEqual(['message', 'task']);
  });

  it('preserves targetType so UI can show source labels', () => {
    insertAttachment('att-pipe', 'pipeline', 'p1', 'p1', 'pipeline-file.md');
    insertAttachment('att-task', 'task', 't1', 'p1', 'task-file.txt');

    const all = listAllPipelineAttachments('p1');
    const pipeAtt = all.find((a: { id: string }) => a.id === 'att-pipe');
    const taskAtt = all.find((a: { id: string }) => a.id === 'att-task');

    expect(pipeAtt?.targetType).toBe('pipeline');
    expect(taskAtt?.targetType).toBe('task');
  });

  it('is a superset of target-scoped listAttachments', () => {
    insertAttachment('att-pipe', 'pipeline', 'p1', 'p1', 'spec.md');
    insertAttachment('att-task', 'task', 't1', 'p1', 'task-file.txt');

    const pipelineOnly = listAttachments('pipeline', 'p1');
    const taskOnly = listAttachments('task', 't1');
    const all = listAllPipelineAttachments('p1');

    expect(pipelineOnly).toHaveLength(1);
    expect(taskOnly).toHaveLength(1);
    expect(all).toHaveLength(2);

    // Every item in pipelineOnly and taskOnly should exist in all
    for (const item of [...pipelineOnly, ...taskOnly]) {
      expect(all.some((a: { id: string }) => a.id === item.id)).toBe(true);
    }
  });
});

// ─── UI source label test ───

describe('PlannerAttachments source labels', () => {
  it('shows "task" label for task-scoped attachments and "pipeline" for pipeline-scoped', async () => {
    const { PlannerAttachments } = await import(
      '../src/components/pipelines/PlannerAttachments.js'
    );

    const mixed: Attachment[] = [
      {
        id: 'att-pipe',
        targetType: 'pipeline',
        targetId: 'p1',
        pipelineId: 'p1',
        filename: 'spec.md',
        originalName: 'spec.md',
        mimeType: 'text/markdown',
        sizeBytes: 1024,
        createdAt: '2025-01-01T00:00:00.000Z',
      },
      {
        id: 'att-task',
        targetType: 'task',
        targetId: 't1',
        pipelineId: 'p1',
        filename: 'code.ts',
        originalName: 'code.ts',
        mimeType: 'text/typescript',
        sizeBytes: 2048,
        createdAt: '2025-01-01T00:00:00.000Z',
      },
    ];

    const html = renderToStaticMarkup(
      React.createElement(PlannerAttachments, {
        attachments: mixed,
        onAttachmentsChange: () => undefined,
        onSelectedAttachmentIdsChange: () => undefined,
        pipelineId: 'p1',
        selectedAttachmentIds: ['att-task'],
      }),
    );

    // Button text should reference "Available" not "Pipeline"
    expect(html).toContain('Choose From Available (2)');
    // Selected task attachment should be visible
    expect(html).toContain('code.ts');
    expect(html).toContain('1 selected');
  });
});

// ─── API helper contract test ───

describe('listAllPipelineAttachments API helper', () => {
  it('calls GET /api/pipelines/:id/attachments and extracts attachments array', async () => {
    const mockAttachments: Attachment[] = [
      {
        id: 'att-1',
        targetType: 'task',
        targetId: 't1',
        pipelineId: 'p1',
        filename: 'f1.txt',
        originalName: 'file.txt',
        mimeType: 'text/plain',
        sizeBytes: 100,
        createdAt: '2025-01-01',
      },
    ];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ attachments: mockAttachments }),
    }) as unknown as typeof fetch;

    try {
      const { listAllPipelineAttachments: apiHelper } = await import('../src/lib/api.js');
      const result = await apiHelper('p1');
      expect(result).toEqual(mockAttachments);

      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toContain('/pipelines/p1/attachments');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
