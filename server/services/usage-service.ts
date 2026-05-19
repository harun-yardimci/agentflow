import type Database from 'better-sqlite3';

import { getDb } from '../db/connection.js';
import { parseCliOutput } from '../executor/output-parser.js';
import { getProviderKey } from '../lib/provider-utils.js';

export type PricingSource = 'backfilled' | 'calculated' | 'exact' | 'unknown';

interface ModelPricingRow {
  bg: string;
  color: string;
  cost_per_1k: number;
  label: string;
  provider: string;
}

interface ExecutionRunUsageRow {
  completed_at: string | null;
  id: string;
  model_used: string | null;
  started_at: string;
  status: string;
  stderr: string | null;
  stdout: string | null;
  tokens_used: number | null;
}

interface TaskUsageAggregateRow {
  cost_usd_total: number | null;
  input_tokens_total: number | null;
  output_tokens_total: number | null;
  total_tokens: number | null;
}

export interface UsageSnapshot {
  calculatedAt: string;
  costPer1k: number | null;
  label: string | null;
  mode: 'estimated' | 'exact';
  modelId: string | null;
  provider: string | null;
  source: PricingSource;
}

export interface UsageMetaLike {
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  cost?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface FrozenRunUsageMetrics {
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  pricingSnapshotJson: string;
  pricingSource: PricingSource;
  tokensUsed: number;
}

export interface TaskUsageSummary {
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  tokens: number;
}

function resolveDb(db?: Database.Database): Database.Database {
  return db ?? getDb();
}

function readModelPricing(
  modelId: string | null,
  db: Database.Database,
): ModelPricingRow | null {
  if (!modelId) {
    return null;
  }

  try {
    const row = db.prepare(
      'SELECT provider, label, color, bg, cost_per_1k FROM models WHERE id = ?',
    ).get(modelId) as ModelPricingRow | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

export function getUsageSnapshot(
  modelId: string | null,
  pricingSource: PricingSource,
  calculatedAt: string,
  db?: Database.Database,
): UsageSnapshot {
  const resolvedDb = resolveDb(db);
  const pricing = readModelPricing(modelId, resolvedDb);
  const provider = pricing?.provider ?? (modelId ? getProviderKey(modelId) : null);

  return {
    calculatedAt,
    costPer1k: pricing?.cost_per_1k ?? null,
    label: pricing?.label ?? modelId,
    mode: pricingSource === 'exact' ? 'exact' : 'estimated',
    modelId,
    provider,
    source: pricingSource,
  };
}

export function buildFrozenRunUsageMetrics(args: {
  calculatedAt?: string | null;
  fallbackTokens?: number | null;
  meta?: UsageMetaLike;
  modelId: string | null;
  pricingSource?: PricingSource;
  db?: Database.Database;
}): FrozenRunUsageMetrics {
  const resolvedDb = resolveDb(args.db);
  const meta = args.meta;
  const inputTokens = meta?.inputTokens ?? null;
  const outputTokens = meta?.outputTokens ?? null;
  const cacheReadInputTokens = meta?.cacheReadInputTokens ?? null;
  const cacheCreationInputTokens = meta?.cacheCreationInputTokens ?? null;
  const combinedTokens =
    (inputTokens ?? 0) +
    (outputTokens ?? 0) +
    (cacheReadInputTokens ?? 0) +
    (cacheCreationInputTokens ?? 0);
  const tokensUsed = combinedTokens > 0
    ? combinedTokens
    : Math.max(0, args.fallbackTokens ?? 0);
  const calculatedAt = args.calculatedAt ?? new Date().toISOString();

  let pricingSource: PricingSource = 'unknown';
  let costUsd: number | null = null;

  if (typeof meta?.cost === 'number' && Number.isFinite(meta.cost)) {
    pricingSource = 'exact';
    costUsd = meta.cost;
  } else {
    const snapshot = getUsageSnapshot(
      args.modelId,
      args.pricingSource ?? 'calculated',
      calculatedAt,
      resolvedDb,
    );
    if (
      typeof snapshot.costPer1k === 'number' &&
      Number.isFinite(snapshot.costPer1k) &&
      tokensUsed > 0
    ) {
      pricingSource = args.pricingSource ?? 'calculated';
      costUsd = (tokensUsed / 1000) * snapshot.costPer1k;
    }
  }

  const snapshot = getUsageSnapshot(
    args.modelId,
    pricingSource,
    calculatedAt,
    resolvedDb,
  );

  return {
    cacheCreationInputTokens,
    cacheReadInputTokens,
    costUsd,
    inputTokens,
    outputTokens,
    pricingSnapshotJson: JSON.stringify(snapshot),
    pricingSource,
    tokensUsed,
  };
}

export function refreshTaskUsageMetrics(
  taskId: string,
  db?: Database.Database,
): TaskUsageSummary {
  const resolvedDb = resolveDb(db);
  const row = resolvedDb.prepare(`
    SELECT
      COALESCE(SUM(tokens_used), 0) AS total_tokens,
      COALESCE(SUM(input_tokens), 0) AS input_tokens_total,
      COALESCE(SUM(output_tokens), 0) AS output_tokens_total,
      SUM(cost_usd) AS cost_usd_total
    FROM execution_runs
    WHERE task_id = ? AND status != 'running'
  `).get(taskId) as TaskUsageAggregateRow | undefined;

  const summary: TaskUsageSummary = {
    costUsd:
      typeof row?.cost_usd_total === 'number' && Number.isFinite(row.cost_usd_total)
        ? row.cost_usd_total
        : null,
    inputTokens: row?.input_tokens_total ?? null,
    outputTokens: row?.output_tokens_total ?? null,
    tokens: row?.total_tokens ?? 0,
  };

  resolvedDb.prepare(`
    UPDATE tasks
    SET tokens = ?, input_tokens = ?, output_tokens = ?, cost_usd = ?
    WHERE id = ?
  `).run(
    summary.tokens,
    summary.inputTokens,
    summary.outputTokens,
    summary.costUsd,
    taskId,
  );

  return summary;
}

export function refreshAllTaskUsageMetrics(db?: Database.Database): void {
  const resolvedDb = resolveDb(db);
  const rows = resolvedDb.prepare(
    "SELECT DISTINCT task_id FROM execution_runs WHERE status != 'running'",
  ).all() as Array<{ task_id: string }>;

  for (const row of rows) {
    refreshTaskUsageMetrics(row.task_id, resolvedDb);
  }
}

export function backfillRunUsageMetrics(db?: Database.Database): void {
  const resolvedDb = resolveDb(db);
  const rows = resolvedDb.prepare(`
    SELECT
      id,
      status,
      started_at,
      completed_at,
      stdout,
      stderr,
      tokens_used,
      model_used
    FROM execution_runs
    WHERE status != 'running'
  `).all() as ExecutionRunUsageRow[];

  const updateRun = resolvedDb.prepare(`
    UPDATE execution_runs
    SET tokens_used = ?,
        input_tokens = ?,
        output_tokens = ?,
        cache_read_input_tokens = ?,
        cache_creation_input_tokens = ?,
        cost_usd = ?,
        pricing_source = ?,
        pricing_snapshot_json = ?
    WHERE id = ?
  `);

  for (const row of rows) {
    const stdoutParsed = parseCliOutput(row.stdout ?? '');
    const stderrParsed = stdoutParsed.meta ? null : parseCliOutput(row.stderr ?? '');
    const metrics = buildFrozenRunUsageMetrics({
      calculatedAt: row.completed_at ?? row.started_at,
      db: resolvedDb,
      fallbackTokens: row.tokens_used,
      meta: stdoutParsed.meta ?? stderrParsed?.meta,
      modelId: row.model_used,
      pricingSource: 'backfilled',
    });

    updateRun.run(
      metrics.tokensUsed,
      metrics.inputTokens,
      metrics.outputTokens,
      metrics.cacheReadInputTokens,
      metrics.cacheCreationInputTokens,
      metrics.costUsd,
      metrics.pricingSource,
      metrics.pricingSnapshotJson,
      row.id,
    );
  }
}

export function backfillUsageMetrics(db?: Database.Database): void {
  const resolvedDb = resolveDb(db);
  backfillRunUsageMetrics(resolvedDb);
  refreshAllTaskUsageMetrics(resolvedDb);
}
