# Token And Cost Analytics Design

Date: 2026-03-27
Status: Approved
Owner: Codex

## Goal

Make token and cost usage visible in AgentFlow so we can answer:

- which task consumed how many tokens
- which task cost how much
- which models/providers are used most
- how token and cost trends change over time

The system must preserve historical cost at execution time. If a model price is
changed later in settings, past runs must not be recalculated.

## Current State

The codebase already captures part of the required data:

- `tasks.tokens` stores summary token count at task level
- `execution_runs.tokens_used` stores per-run token count
- CLI output parsing already extracts structured token metadata in some cases
- model pricing exists in `models.cost_per_1k`
- the models page already computes lightweight usage stats from pipeline tasks

Current gaps:

- no frozen run-level cost persistence
- no persisted input/output token split
- no analytics endpoint for time series and leaderboard views
- model configuration page shows summary cards but not real usage analytics
- historical cost changes if we recompute from live `cost_per_1k`

## Scope

### In Scope

- persist frozen token and cost metrics per execution run
- surface task-level token and cost values in the UI
- add model/provider usage analytics with charts
- add time-based usage breakdown
- add estimated backfill for older runs

### Out Of Scope

- importing provider-native usage dashboards from Claude, Gemini, or Codex CLI
- billing reconciliation against provider invoices
- team/user attribution outside of task and model dimensions

## CLI Usage Findings

We checked whether native CLI usage dashboards should be pulled into the model
configuration page.

Findings:

- Claude has a local cache file at `~/.claude/stats-cache.json` with model token
  aggregates and activity summaries.
- Gemini includes a built-in `stats` slash command in its installed package.
- Codex stores token count events in archived session logs.

We are not using these in Phase 1 because there is no common, stable,
backend-friendly interface across all three providers. The formats and access
patterns differ, and some commands are interactive rather than intended for
machine consumption.

Decision:

- Phase 1 skips CLI-native usage import.
- Phase 2 may add provider-specific import adapters if a stable source is
  validated per provider.

## Product Decisions

### Historical Cost Model

Use frozen historical cost.

At run completion:

- if the provider returns exact cost, persist it directly
- otherwise compute cost from the model price active at that moment
- store the pricing snapshot used for that calculation

Past runs never change when model pricing is edited later.

### Source Of Truth

`execution_runs` is the source of truth for analytics.

`tasks` stores denormalized summary fields for fast rendering.

## Data Model

### Execution Runs

Add fields to `execution_runs`:

- `input_tokens INTEGER`
- `output_tokens INTEGER`
- `cache_read_input_tokens INTEGER DEFAULT 0`
- `cache_creation_input_tokens INTEGER DEFAULT 0`
- `cost_usd REAL`
- `pricing_source TEXT NOT NULL DEFAULT 'calculated'`
- `pricing_snapshot_json TEXT NOT NULL DEFAULT '{}'`

Meaning:

- `input_tokens` and `output_tokens` preserve the structured split when the CLI
  exposes it
- cache token fields preserve provider-specific accounting when available
- `cost_usd` is the frozen historical run cost
- `pricing_source` indicates `exact`, `calculated`, or `backfilled`
- `pricing_snapshot_json` stores the model pricing context used for the frozen
  value

Suggested snapshot payload:

```json
{
  "modelId": "claude:sonnet",
  "provider": "claude",
  "costPer1k": 0.015,
  "mode": "calculated",
  "calculatedAt": "2026-03-27T10:00:00.000Z"
}
```

### Tasks

Add fields to `tasks`:

- `input_tokens INTEGER`
- `output_tokens INTEGER`
- `cost_usd REAL`

These are denormalized summaries of the latest successful task completion state.
They support quick task list rendering without having to aggregate runs on every
page load.

## Execution Flow Changes

When a run completes successfully:

1. Parse CLI output for structured usage metadata.
2. Prefer exact provider cost if the CLI returned one.
3. If exact cost is missing:
   - derive total tokens from structured input/output values when available
   - otherwise fall back to `result.tokens`
   - compute cost with the current model's `cost_per_1k`
4. Persist run metrics to `execution_runs`.
5. Update summary token and cost fields on `tasks`.

When a run fails:

- persist any available usage metrics
- keep `cost_usd` if meaningful usage was billed and surfaced

## Backfill Strategy

Older runs do not have frozen cost.

Backfill process:

1. For each run where `cost_usd` is null:
   - read `tokens_used`
   - resolve the model price from current `models.cost_per_1k`
   - compute an estimated value
2. Store:
   - `cost_usd`
   - `pricing_source = 'backfilled'`
   - `pricing_snapshot_json` with `mode: backfilled`
3. Recompute task summary fields from the updated runs

UI must visually differentiate exact/calculated values from backfilled values.

## API Design

Add a new analytics endpoint:

- `GET /api/analytics/usage`

Supported filters:

- `from`
- `to`
- `pipelineId`
- `provider`
- `model`

Response shape:

```json
{
  "summary": {
    "totalRuns": 0,
    "totalTasks": 0,
    "totalTokens": 0,
    "inputTokens": 0,
    "outputTokens": 0,
    "totalCostUsd": 0,
    "averageTokensPerRun": 0,
    "averageCostPerTask": 0
  },
  "timeseries": [
    {
      "date": "2026-03-27",
      "tokens": 0,
      "costUsd": 0,
      "runs": 0
    }
  ],
  "byProvider": [
    {
      "provider": "claude",
      "runs": 0,
      "tokens": 0,
      "costUsd": 0
    }
  ],
  "byModel": [
    {
      "model": "claude:sonnet",
      "provider": "claude",
      "runs": 0,
      "tasks": 0,
      "inputTokens": 0,
      "outputTokens": 0,
      "tokens": 0,
      "costUsd": 0,
      "averageDurationMs": 0
    }
  ],
  "topTasks": [
    {
      "taskId": "t1",
      "taskName": "Research",
      "pipelineId": "p1",
      "pipelineName": "Launch",
      "model": "claude:sonnet",
      "tokens": 0,
      "costUsd": 0,
      "pricingSource": "exact"
    }
  ]
}
```

## UI Design

### Task-Level Visibility

Show token and cost details in task surfaces:

- task card: compact token + cost summary
- task drawer: input tokens, output tokens, total tokens, frozen cost
- show `exact`, `calculated`, or `backfilled` badge when needed

### Pipeline-Level Visibility

Pipeline totals should come from persisted task summaries:

- total tokens
- total cost

These values must not change when model pricing is updated later.

### Model Configuration Page

Keep the existing provider/config section and add a second section:

- `Usage & Cost Analytics`

This section should include:

- KPI cards
  - total tokens
  - total cost
  - avg cost per task
  - avg tokens per run
- trend chart
  - daily tokens
  - daily cost
- model distribution chart
  - cost by model
  - usage share by model/provider
- model breakdown table
- top costly tasks table

## Chart Strategy

Do not add a heavy charting dependency in Phase 1.

Use lightweight SVG or CSS-based chart components for:

- time-series bars/lines
- stacked bars for model/provider comparison

This keeps the bundle lean and avoids introducing a new visualization library
for a narrow initial analytics surface.

## Error Handling

- missing token split is allowed; fall back to total tokens
- missing exact cost is allowed; compute and mark as calculated
- failed backfill should not block server start
- malformed pricing snapshots should degrade to `unknown` labeling in the UI

## Testing Plan

### Backend

- migration tests for new columns
- output parsing tests for input/output token extraction
- run completion tests for frozen cost persistence
- analytics endpoint aggregation tests
- backfill tests for exact vs backfilled labeling

### Frontend

- model analytics page renders summary, charts, and tables
- task drawer renders token split and cost badges
- pipeline totals remain stable after model pricing edits

## Rollout Plan

Phase 1:

- migrations
- frozen run/task persistence
- analytics endpoint
- task and model UI

Phase 2:

- optional provider-native usage import adapters per CLI

## Success Criteria

- every completed task can show token count and frozen cost
- model configuration page can answer which model/provider consumed the most
  tokens and cost
- analytics remain stable after model pricing changes
- old runs are visible with clearly labeled backfilled cost
