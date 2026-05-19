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

const { getUsageAnalytics } = await import(
  '../server/services/usage-analytics-service.js'
);
const { refreshAllTaskUsageMetrics } = await import(
  '../server/services/usage-service.js'
);

describe('Usage analytics service', () => {
  beforeEach(() => {
    db = createTestDb();

    db.prepare(
      'INSERT INTO providers (id, label, color, bg, cli_command) VALUES (?, ?, ?, ?, ?)',
    ).run('codex', 'Codex', '#22C55E', '#071710', 'codex');
    db.prepare(
      'INSERT INTO providers (id, label, color, bg, cli_command) VALUES (?, ?, ?, ?, ?)',
    ).run('claude', 'Claude', '#D97706', '#1C1208', 'claude');

    db.prepare(`
      INSERT INTO models (id, provider, label, color, bg, cost_per_1k, cli_flag)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'codex:gpt-5.4',
      'codex',
      'GPT 5.4',
      '#22C55E',
      '#071710',
      0.01,
      'gpt-5.4',
    );
    db.prepare(`
      INSERT INTO models (id, provider, label, color, bg, cost_per_1k, cli_flag)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'claude:sonnet',
      'claude',
      'Claude Sonnet',
      '#D97706',
      '#1C1208',
      0.015,
      'claude-sonnet-4-6',
    );

    db.prepare(
      'INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)',
    ).run('p1', 'Analytics Pipeline', 'completed', '2026-03-27T10:00:00.000Z');

    db.prepare(`
      INSERT INTO tasks (
        id, pipeline_id, name, agent_id, model, approval, status, stage, input, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      't1',
      'p1',
      'Implement analytics',
      'developer',
      'codex:gpt-5.4',
      'auto',
      'completed',
      0,
      'Build analytics',
      0,
    );
    db.prepare(`
      INSERT INTO tasks (
        id, pipeline_id, name, agent_id, model, approval, status, stage, input, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      't2',
      'p1',
      'Write rollout summary',
      'designer',
      'claude:sonnet',
      'manual',
      'completed',
      1,
      'Summarize rollout',
      1,
    );

    const insertRun = db.prepare(`
      INSERT INTO execution_runs (
        id, task_id, attempt, status, started_at, completed_at, tokens_used,
        input_tokens, output_tokens, cost_usd, pricing_source, provider,
        model_used, pricing_snapshot_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertRun.run(
      'run-1',
      't1',
      1,
      'completed',
      '2026-03-26T09:00:00.000Z',
      '2026-03-26T09:01:00.000Z',
      1000,
      400,
      600,
      10,
      'exact',
      'codex',
      'codex:gpt-5.4',
      JSON.stringify({
        calculatedAt: '2026-03-26T09:01:00.000Z',
        costPer1k: 0.01,
        label: 'GPT 5.4',
        mode: 'exact',
        modelId: 'codex:gpt-5.4',
        provider: 'codex',
        source: 'exact',
      }),
    );
    insertRun.run(
      'run-2',
      't1',
      2,
      'failed',
      '2026-03-27T11:00:00.000Z',
      '2026-03-27T11:01:00.000Z',
      500,
      200,
      300,
      5,
      'calculated',
      'codex',
      'codex:gpt-5.4',
      JSON.stringify({
        calculatedAt: '2026-03-27T11:01:00.000Z',
        costPer1k: 0.01,
        label: 'GPT 5.4',
        mode: 'estimated',
        modelId: 'codex:gpt-5.4',
        provider: 'codex',
        source: 'calculated',
      }),
    );
    insertRun.run(
      'run-3',
      't2',
      1,
      'completed',
      '2026-03-27T12:00:00.000Z',
      '2026-03-27T12:01:00.000Z',
      2000,
      1000,
      1000,
      20,
      'exact',
      'claude',
      'claude:sonnet',
      JSON.stringify({
        calculatedAt: '2026-03-27T12:01:00.000Z',
        costPer1k: 0.015,
        label: 'Claude Sonnet',
        mode: 'exact',
        modelId: 'claude:sonnet',
        provider: 'claude',
        source: 'exact',
      }),
    );

    refreshAllTaskUsageMetrics(db);
  });

  afterEach(() => {
    db.close();
  });

  it('aggregates summary, model, provider, and task usage', () => {
    const analytics = getUsageAnalytics({});

    expect(analytics.summary).toMatchObject({
      runCount: 3,
      taskCount: 2,
      totalTokens: 3500,
      totalInputTokens: 1600,
      totalOutputTokens: 1900,
      totalCostUsd: 35,
    });

    expect(analytics.timeseries).toEqual([
      {
        date: '2026-03-26',
        tokens: 1000,
        inputTokens: 400,
        outputTokens: 600,
        costUsd: 10,
      },
      {
        date: '2026-03-27',
        tokens: 2500,
        inputTokens: 1200,
        outputTokens: 1300,
        costUsd: 25,
      },
    ]);

    expect(analytics.providers).toEqual([
      expect.objectContaining({
        key: 'claude',
        tokens: 2000,
        costUsd: 20,
        runCount: 1,
      }),
      expect.objectContaining({
        key: 'codex',
        tokens: 1500,
        costUsd: 15,
        runCount: 2,
      }),
    ]);

    expect(analytics.models).toEqual([
      expect.objectContaining({
        key: 'claude:sonnet',
        label: 'Claude Sonnet',
        tokens: 2000,
        costUsd: 20,
      }),
      expect.objectContaining({
        key: 'codex:gpt-5.4',
        label: 'GPT 5.4',
        tokens: 1500,
        costUsd: 15,
      }),
    ]);

    expect(analytics.topTasks[0]).toMatchObject({
      taskId: 't2',
      taskName: 'Write rollout summary',
      tokens: 2000,
      costUsd: 20,
      runCount: 1,
    });
    expect(analytics.topTasks[1]).toMatchObject({
      taskId: 't1',
      taskName: 'Implement analytics',
      tokens: 1500,
      costUsd: 15,
      runCount: 2,
    });
  });
});
