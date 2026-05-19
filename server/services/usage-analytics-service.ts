import { getDb } from '../db/connection.js';

interface UsageAnalyticsFilters {
  from?: string;
  model?: string;
  pipelineId?: string;
  provider?: string;
  to?: string;
}

interface QueryParts {
  params: unknown[];
  whereClause: string;
}

function buildUsageFilters(filters: UsageAnalyticsFilters): QueryParts {
  const clauses = ["er.status != 'running'"];
  const params: unknown[] = [];

  if (filters.from) {
    clauses.push('date(er.started_at) >= date(?)');
    params.push(filters.from);
  }

  if (filters.to) {
    clauses.push('date(er.started_at) <= date(?)');
    params.push(filters.to);
  }

  if (filters.pipelineId) {
    clauses.push('t.pipeline_id = ?');
    params.push(filters.pipelineId);
  }

  if (filters.provider) {
    clauses.push("COALESCE(er.provider, m.provider, 'unknown') = ?");
    params.push(filters.provider);
  }

  if (filters.model) {
    clauses.push('COALESCE(er.model_used, t.model) = ?');
    params.push(filters.model);
  }

  return {
    params,
    whereClause: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
  };
}

const BASE_USAGE_JOINS = `
  FROM execution_runs er
  JOIN tasks t ON t.id = er.task_id
  JOIN pipelines p ON p.id = t.pipeline_id
  LEFT JOIN models m ON m.id = COALESCE(er.model_used, t.model)
`;

export function getUsageAnalytics(filters: UsageAnalyticsFilters) {
  const db = getDb();
  const { params, whereClause } = buildUsageFilters(filters);

  const summaryRow = db.prepare(`
    SELECT
      COUNT(*) AS run_count,
      COUNT(DISTINCT er.task_id) AS task_count,
      COALESCE(SUM(er.tokens_used), 0) AS total_tokens,
      COALESCE(SUM(er.input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(er.output_tokens), 0) AS total_output_tokens,
      COALESCE(SUM(er.cost_usd), 0) AS total_cost_usd
    ${BASE_USAGE_JOINS}
    ${whereClause}
  `).get(...params) as {
    run_count: number;
    task_count: number;
    total_tokens: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost_usd: number;
  };

  const timeseries = db.prepare(`
    SELECT
      substr(er.started_at, 1, 10) AS usage_date,
      COALESCE(SUM(er.tokens_used), 0) AS total_tokens,
      COALESCE(SUM(er.input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(er.output_tokens), 0) AS total_output_tokens,
      COALESCE(SUM(er.cost_usd), 0) AS total_cost_usd
    ${BASE_USAGE_JOINS}
    ${whereClause}
    GROUP BY usage_date
    ORDER BY usage_date ASC
  `).all(...params) as Array<{
    usage_date: string;
    total_tokens: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost_usd: number;
  }>;

  const providers = db.prepare(`
    SELECT
      COALESCE(er.provider, m.provider, 'unknown') AS provider_key,
      COUNT(*) AS run_count,
      COUNT(DISTINCT er.task_id) AS task_count,
      COALESCE(SUM(er.tokens_used), 0) AS total_tokens,
      COALESCE(SUM(er.input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(er.output_tokens), 0) AS total_output_tokens,
      COALESCE(SUM(er.cost_usd), 0) AS total_cost_usd
    ${BASE_USAGE_JOINS}
    ${whereClause}
    GROUP BY provider_key
    ORDER BY total_cost_usd DESC, total_tokens DESC
  `).all(...params) as Array<{
    provider_key: string;
    run_count: number;
    task_count: number;
    total_tokens: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost_usd: number;
  }>;

  const models = db.prepare(`
    SELECT
      COALESCE(er.model_used, t.model) AS model_key,
      COALESCE(m.label, COALESCE(er.model_used, t.model)) AS model_label,
      COALESCE(er.provider, m.provider, 'unknown') AS provider_key,
      COUNT(*) AS run_count,
      COUNT(DISTINCT er.task_id) AS task_count,
      COALESCE(SUM(er.tokens_used), 0) AS total_tokens,
      COALESCE(SUM(er.input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(er.output_tokens), 0) AS total_output_tokens,
      COALESCE(SUM(er.cost_usd), 0) AS total_cost_usd
    ${BASE_USAGE_JOINS}
    ${whereClause}
    GROUP BY model_key, model_label, provider_key
    ORDER BY total_cost_usd DESC, total_tokens DESC
  `).all(...params) as Array<{
    model_key: string;
    model_label: string;
    provider_key: string;
    run_count: number;
    task_count: number;
    total_tokens: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost_usd: number;
  }>;

  const topTasks = db.prepare(`
    SELECT
      t.id AS task_id,
      t.name AS task_name,
      t.pipeline_id AS pipeline_id,
      p.name AS pipeline_name,
      COUNT(*) AS run_count,
      COALESCE(SUM(er.tokens_used), 0) AS total_tokens,
      COALESCE(SUM(er.input_tokens), 0) AS total_input_tokens,
      COALESCE(SUM(er.output_tokens), 0) AS total_output_tokens,
      COALESCE(SUM(er.cost_usd), 0) AS total_cost_usd,
      MAX(er.started_at) AS last_run_at
    ${BASE_USAGE_JOINS}
    ${whereClause}
    GROUP BY t.id, t.name, t.pipeline_id, p.name
    ORDER BY total_cost_usd DESC, total_tokens DESC, last_run_at DESC
    LIMIT 10
  `).all(...params) as Array<{
    task_id: string;
    task_name: string;
    pipeline_id: string;
    pipeline_name: string;
    run_count: number;
    total_tokens: number;
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost_usd: number;
    last_run_at: string | null;
  }>;

  const summary = {
    avgCostPerTask: summaryRow.task_count > 0
      ? summaryRow.total_cost_usd / summaryRow.task_count
      : 0,
    avgTokensPerRun: summaryRow.run_count > 0
      ? summaryRow.total_tokens / summaryRow.run_count
      : 0,
    runCount: summaryRow.run_count,
    taskCount: summaryRow.task_count,
    totalCostUsd: summaryRow.total_cost_usd,
    totalInputTokens: summaryRow.total_input_tokens,
    totalOutputTokens: summaryRow.total_output_tokens,
    totalTokens: summaryRow.total_tokens,
  };

  return {
    filters: {
      from: filters.from ?? null,
      model: filters.model ?? null,
      pipelineId: filters.pipelineId ?? null,
      provider: filters.provider ?? null,
      to: filters.to ?? null,
    },
    providers: providers.map((row) => ({
      avgCostPerRun: row.run_count > 0 ? row.total_cost_usd / row.run_count : 0,
      avgTokensPerRun: row.run_count > 0 ? row.total_tokens / row.run_count : 0,
      costUsd: row.total_cost_usd,
      inputTokens: row.total_input_tokens,
      key: row.provider_key,
      label: row.provider_key,
      outputTokens: row.total_output_tokens,
      runCount: row.run_count,
      taskCount: row.task_count,
      tokens: row.total_tokens,
    })),
    models: models.map((row) => ({
      avgCostPerRun: row.run_count > 0 ? row.total_cost_usd / row.run_count : 0,
      avgTokensPerRun: row.run_count > 0 ? row.total_tokens / row.run_count : 0,
      costUsd: row.total_cost_usd,
      inputTokens: row.total_input_tokens,
      key: row.model_key,
      label: row.model_label,
      outputTokens: row.total_output_tokens,
      runCount: row.run_count,
      taskCount: row.task_count,
      tokens: row.total_tokens,
    })),
    summary,
    timeseries: timeseries.map((row) => ({
      costUsd: row.total_cost_usd,
      date: row.usage_date,
      inputTokens: row.total_input_tokens,
      outputTokens: row.total_output_tokens,
      tokens: row.total_tokens,
    })),
    topTasks: topTasks.map((row) => ({
      costUsd: row.total_cost_usd,
      inputTokens: row.total_input_tokens,
      lastRunAt: row.last_run_at,
      outputTokens: row.total_output_tokens,
      pipelineId: row.pipeline_id,
      pipelineName: row.pipeline_name,
      runCount: row.run_count,
      taskId: row.task_id,
      taskName: row.task_name,
      tokens: row.total_tokens,
    })),
  };
}
