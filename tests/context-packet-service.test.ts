import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb } from './helpers/test-db.js';

let db: Database.Database;

vi.mock('../server/db/connection.js', () => ({
  getDb: () => db,
  closeDb: () => {
    db?.close();
  },
}));

const {
  buildCycleSummary,
  buildPromptContextBlock,
  getContextPacket,
  getContextPacketRelativePath,
  materializeContextPacketFiles,
} = await import('../server/services/context-packet-service.js');

function seedTask(): void {
  db.prepare(
    "INSERT INTO pipelines (id, name, status, created) VALUES ('p1', 'Test', 'queued', '2024-01-01T00:00:00.000Z')"
  ).run();
  db.prepare(
    "INSERT INTO tasks (id, pipeline_id, name, agent_id, model, input, original_input, current_input, created_at) VALUES ('t1', 'p1', 'Task 1', 'developer', 'claude:sonnet', 'original', 'original', 'original', '2024-01-01T00:00:00.000Z')"
  ).run();
}

function buildLargeMarkdown(): string {
  return [
    '# Release Notes',
    '',
    ...Array.from({ length: 20 }, (_, index) => `- Decision ${index + 1}: keep API contract stable for consumer ${index + 1}`),
    '',
    '## Next Steps',
    ...Array.from({ length: 20 }, (_, index) => `- TODO ${index + 1}: update file path /src/modules/feature-${index + 1}.ts with migration notes`),
  ].join('\n');
}

function buildBorderlineText(): string {
  return Array.from(
    { length: 15 },
    (_, index) => `line ${index + 1}: filler text for context block ${index + 1}`
  ).join('\n');
}

describe('Context Packet Service', () => {
  beforeEach(() => {
    db = createTestDb();
    seedTask();
  });

  afterEach(() => {
    db.close();
  });

  it('stores and reuses compacted prompt packets for large context blocks', () => {
    const content = buildLargeMarkdown();

    const first = buildPromptContextBlock({
      content,
      cycleId: 'cycle-1',
      pipelineId: 'p1',
      sourceKey: 'dep:t0',
      sourceType: 'dependency_output',
      taskId: 't1',
      title: 'Dependency A',
    });
    const second = buildPromptContextBlock({
      content,
      cycleId: 'cycle-1',
      pipelineId: 'p1',
      sourceKey: 'dep:t0',
      sourceType: 'dependency_output',
      taskId: 't1',
      title: 'Dependency A',
    });

    expect(first.compacted).toBe(true);
    expect(first.packetId).toBeTruthy();
    expect(first.rendered).toContain('.agentflow/context-packets/');
    expect(first.rendered).not.toContain('[context packet:');
    expect(second.packetId).toBe(first.packetId);

    const stored = getContextPacket(first.packetId!);
    expect(stored.originalContent).toBe(content);
    expect(stored.compactContent.length).toBeLessThan(content.length);
    expect(stored.savingsPercent).toBeGreaterThan(0);

    const count = db.prepare('SELECT COUNT(*) AS count FROM context_packets')
      .get() as { count: number };
    expect(count.count).toBe(1);

    const workdir = `/tmp/agentflow-context-packets-${Date.now()}`;
    const written = materializeContextPacketFiles(first.rendered, workdir);
    expect(written).toEqual([getContextPacketRelativePath(first.packetId!)]);
    const absolutePath = join(workdir, written[0]!);
    expect(existsSync(absolutePath)).toBe(true);
    expect(readFileSync(absolutePath, 'utf-8')).toContain(content);
  });

  it('keeps cycle summary generation side-effect free', () => {
    const before = db.prepare('SELECT COUNT(*) AS count FROM context_packets')
      .get() as { count: number };

    const summary = buildCycleSummary({
      attemptNumber: 3,
      output: buildLargeMarkdown(),
    });

    const after = db.prepare('SELECT COUNT(*) AS count FROM context_packets')
      .get() as { count: number };

    expect(summary).toContain('Latest completed attempt #3');
    expect(summary.length).toBeLessThan(buildLargeMarkdown().length);
    expect(after.count).toBe(before.count);
  });

  it('falls back to passthrough when marker overhead cancels token savings', () => {
    const content = buildBorderlineText();

    const result = buildPromptContextBlock({
      content,
      cycleId: 'cycle-1',
      minTokensToStore: 1,
      pipelineId: 'p1',
      sourceKey: 'memory:notes',
      sourceType: 'shared_memory',
      taskId: 't1',
      title: 'Borderline Notes',
    });

    expect(result.compacted).toBe(false);
    expect(result.packetId).toBeNull();

    const count = db.prepare('SELECT COUNT(*) AS count FROM context_packets')
      .get() as { count: number };
    expect(count.count).toBe(0);
  });
});
