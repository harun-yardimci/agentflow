# Task Cycle Threading Design

Date: 2026-03-24
Status: Proposed
Owner: Codex

## Summary

This document proposes a redesign of task execution history so that user-visible
`Run #1`, `Run #2`, and follow-up threads reflect a stable task-level cycle
instead of provider-specific session grouping.

The current system mixes several concepts:

- user-visible run history
- executor attempts
- provider session resume IDs
- retry counters and iteration counters

That works for simple same-provider follow-up flows, but it breaks down when:

- the user switches agent
- the user switches provider/model
- a retry should logically stay in the same conversation
- we want detailed audit history without fragmenting the UI thread

The redesign separates these concerns into explicit layers:

- `task_cycle`: user-visible thread boundary
- `execution_attempt`: each concrete execution inside a cycle
- `conversation_message`: each bubble/event shown in the UI
- `memory`: structured context shared across attempts and handoffs

## Goals

- Make `Run #N` mean "task cycle", not "provider session group".
- Keep `retry` inside the same cycle.
- Keep user follow-up inside the same cycle.
- Allow `agent`, `provider`, and `model` changes inside the same cycle.
- Preserve full failure and attempt history.
- Preserve the original task input on every attempt.
- Store rich per-attempt metadata for later inspection.
- Support provider-native resume when available, without making UI continuity
  depend on provider session semantics.

## Non-Goals

- Replacing the existing worker pool model.
- Replacing existing attachment handling.
- Replacing all context storage in one step.
- Adding long-term semantic search memory in this phase.

## Current Problems

### 1. `Run #N` is not a stable user concept

Today the Task Drawer groups records from `execution_runs` into sessions using
`isFollowUp` and `sessionId`. This means the UI grouping depends on whether the
provider can resume the same session. If the provider changes, the same logical
conversation may split into a new UI run.

### 2. Retry semantics are mixed with attempt semantics

The current `attempt`, `iteration`, and `retry_count` values serve internal
execution control, but they are not a reliable representation of the user-facing
conversation thread. User-triggered retry resets counters while auto-retry
increments them.

### 3. Context continuity is partly implicit

If the same provider session is resumed, sending only the new follow-up message
is enough. If the provider changes, continuity relies on ad hoc prompt
reconstruction. There is no explicit handoff packet or cycle summary.

### 4. Shared memory exists but is not central to orchestration

The repository already has:

- `pipeline_ctx` for task output style key/value storage
- `memory` for structured memory entries

But runtime prompt assembly does not yet consistently use `memory` as the
official mechanism for cycle continuity and inter-attempt handoff.

## Correct Terminology

- `agent`: the work role/persona, such as `developer`, `qa`, `research`
- `provider`: the runtime family, such as `claude`, `gemini`, `codex`
- `model`: the specific model under a provider, such as `sonnet`, `opus`,
  `gpt-5.4`, `2.5-pro`

## Proposed Model

### 1. Task Cycle

A `task_cycle` is the user-visible conversation thread for a task.

Properties:

- starts when the task is first run
- continues across retries
- continues across user follow-ups
- continues across agent/provider/model switches
- ends only when the user explicitly starts fresh

This means:

- `Retry` stays in the same cycle
- follow-up stays in the same cycle
- agent switch stays in the same cycle
- `Restart fresh` creates a new cycle

### 2. Execution Attempt

An `execution_attempt` is one concrete executor invocation inside a cycle.

Examples:

- initial run
- retry after failure
- rerun after user follow-up
- handoff to a different agent
- provider/model change
- auto-retry

Each attempt keeps full execution details and can have its own provider-native
session ID.

### 3. Provider Session

A provider session is a native runtime concept such as Claude resume state.

It is useful, but it is not the source of truth for user-visible continuity.

Rules:

- if the same agent/provider/model path can resume natively, use it
- if native resume is not possible, keep logical continuity through handoff
  context
- the UI never treats provider session boundaries as cycle boundaries

### 4. Conversation Message

A `conversation_message` is the unit rendered as a bubble or event in the UI.

Examples:

- user follow-up
- assistant final answer
- system event: retry started
- system event: switched to QA on Gemini 2.5 Pro
- tool question / tool answer
- summarized error card

This gives the UI a clean rendering model instead of rebuilding threads from raw
attempt rows.

## Data Model

### New Table: `task_cycles`

```sql
CREATE TABLE task_cycles (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  cycle_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  started_by TEXT,
  restart_reason TEXT,
  summary TEXT DEFAULT '',
  UNIQUE(task_id, cycle_number)
);
```

Purpose:

- stable user-facing run grouping
- durable thread boundary

### Evolve `execution_runs` into attempt records

We can either rename the table later or keep the existing table name for
backward compatibility and expand it.

Proposed added columns:

```sql
ALTER TABLE execution_runs ADD COLUMN cycle_id TEXT REFERENCES task_cycles(id);
ALTER TABLE execution_runs ADD COLUMN attempt_number INTEGER;
ALTER TABLE execution_runs ADD COLUMN parent_run_id TEXT;
ALTER TABLE execution_runs ADD COLUMN trigger_type TEXT DEFAULT 'initial';
ALTER TABLE execution_runs ADD COLUMN agent_id TEXT;
ALTER TABLE execution_runs ADD COLUMN provider TEXT;
ALTER TABLE execution_runs ADD COLUMN provider_session_id TEXT;
ALTER TABLE execution_runs ADD COLUMN metadata_json TEXT DEFAULT '{}';
```

Semantics:

- `cycle_id`: owning cycle
- `attempt_number`: sequence inside the cycle
- `parent_run_id`: previous attempt if this is a retry or handoff
- `trigger_type`: `initial`, `retry`, `follow_up`, `agent_switch`,
  `provider_switch`, `auto_retry`
- `agent_id`: role/persona used for this attempt
- `provider`: denormalized provider key
- `provider_session_id`: native resume/session ID

Notes:

- Existing `session_id` can be migrated or aliased to `provider_session_id`
- Existing `follow_up_prompt` remains useful as metadata, but not as the only
  conversation primitive

### New Table: `conversation_messages`

```sql
CREATE TABLE conversation_messages (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  cycle_id TEXT NOT NULL REFERENCES task_cycles(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES execution_runs(id) ON DELETE SET NULL,
  role TEXT NOT NULL,
  message_type TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  agent_id TEXT,
  provider TEXT,
  model_used TEXT,
  meta_json TEXT DEFAULT '{}'
);
```

Role values:

- `user`
- `assistant`
- `system`

Message type values:

- `follow_up`
- `final_answer`
- `event`
- `tool_question`
- `tool_answer`
- `summary`
- `error`

Purpose:

- explicit rendering source for task thread UI
- no more reconstructing the visible conversation purely from execution rows

### Existing `memory` table

The current `memory` table is valid and should be integrated into orchestration.

Recommended official layer meanings:

- `project`: durable pipeline-level context
- `artifact`: important outputs, APIs, contracts, summaries
- `cycle`: summaries and handoff context specific to one task cycle
- `short_term`: transient messages or small ephemeral notes

## Task Input Preservation

We must never lose the original task input.

Current risk:

- `tasks.input` is both the original and current editable instruction source

Recommended schema change:

```sql
ALTER TABLE tasks ADD COLUMN original_input TEXT;
ALTER TABLE tasks ADD COLUMN current_input TEXT;
```

Migration:

- copy existing `input` into both `original_input` and `current_input`
- phase out direct dependency on `tasks.input`

Rules:

- `original_input`: immutable baseline prompt
- `current_input`: mutable current task instruction
- follow-up prompts are additional cycle messages, not replacements

## Prompt Assembly Strategy

### Same agent, same provider session

If we can resume the same provider session:

- send only the new follow-up message
- include new attachments if any
- do not resend the full context

This preserves low token cost and keeps native continuity.

### Same agent, no provider session resume

Send a compact continuation packet:

- original task input
- current task input
- current cycle summary
- latest user follow-up
- open blockers / pending work
- relevant artifact references

### Agent switch or provider switch

Do not resend the full raw transcript by default.

Instead, send a handoff packet.

#### Handoff packet contents

- original task input
- current task input
- cycle objective
- latest user follow-up chain
- summaries of recent attempts
- current blockers and failure history
- relevant artifacts
- relevant project/cycle memory
- explicit handoff reason
- explicit expectation for the new agent

This keeps logical continuity while avoiding transcript bloat.

## Cycle Summary and Handoff Summary

At the end of each completed or failed attempt, generate:

- attempt summary
- updated cycle summary

Store them in:

- `conversation_messages` as system/summary messages
- `memory` as `cycle` or `artifact` entries

This gives future attempts a short, stable context source.

## UI Redesign

### Task Drawer

Replace the current session grouping with cycle-based grouping.

Top-level selector:

- `Run #1`
- `Run #2`

These now map to `task_cycles.cycle_number`.

Inside a cycle, render one continuous thread composed from
`conversation_messages`.

### Thread content

Render:

- user follow-up bubbles
- assistant answer bubbles
- system event cards
- tool Q/A cards where applicable
- error summaries

Examples of system events:

- `Retry started after failure`
- `Switched agent to QA`
- `Switched provider to Gemini`
- `Restarted fresh as Run #2`

### Attempt Details View

Each assistant or system event linked to a run should expose a details panel:

- agent
- provider
- model
- start time
- completion time
- duration
- token usage
- exit code
- worktree path
- provider session ID
- status
- parsed output
- raw stdout/stderr

This satisfies the requirement to inspect execution metadata later.

## API Changes

### New Endpoints

- `GET /api/tasks/:id/cycles`
- `GET /api/tasks/:id/cycles/:cycleId`
- `GET /api/tasks/:id/cycles/:cycleId/messages`
- `GET /api/tasks/:id/cycles/:cycleId/attempts`
- `POST /api/tasks/:id/follow-up`
- `POST /api/tasks/:id/retry`
- `POST /api/tasks/:id/restart-fresh`
- `POST /api/tasks/:id/switch-agent`

### Behavior

- `follow-up`: appends a user message and creates a new attempt in the same
  cycle
- `retry`: creates a new attempt in the same cycle
- `switch-agent`: creates a new attempt in the same cycle with a handoff packet
- `restart-fresh`: creates a new cycle

## Migration Strategy

### Phase 1: Schema introduction

- add `task_cycles`
- add new columns to `execution_runs`
- add `conversation_messages`
- add `original_input` and `current_input` to `tasks`

### Phase 2: Backfill

For each task:

- create `cycle #1`
- assign all existing `execution_runs` to that cycle
- map each existing run to an `attempt_number`
- backfill follow-up prompts as `conversation_messages`
- copy `tasks.input` into `original_input` and `current_input`

### Phase 3: Runtime switch

- new task starts create cycles explicitly
- UI reads cycles/messages instead of reconstructing sessions from old fields
- backend writes attempt and message records on every execution path

### Phase 4: Compatibility cleanup

- keep old fields during transition
- later deprecate session-based UI grouping

## Backend Execution Rules

### Start

- if no cycle exists, create cycle #1
- create attempt #1 within that cycle

### Retry

- same cycle
- new attempt
- add system event message

### Follow-up

- same cycle
- append user message
- create new attempt

### Agent switch

- same cycle
- append system event message
- create new attempt
- build handoff packet

### Provider switch

- same cycle
- append system event message
- create new attempt
- start a new provider session unless native continuity is possible

### Restart fresh

- close old cycle
- create new cycle with incremented `cycle_number`
- create first attempt in the new cycle

## Risks

### Prompt bloat

Mitigation:

- use summaries, not full transcript replay
- token-budgeted handoff packets
- relevance filtering for memory/artifacts

### Migration complexity

Mitigation:

- additive migrations
- preserve existing tables and fields first
- staged rollout

### UI/backend mismatch during rollout

Mitigation:

- add compatibility adapters
- switch one view at a time

## Recommended Rollout Order

1. Add schema and migration
2. Backfill cycles and inputs
3. Write runtime attempt/cycle creation logic
4. Add conversation message writes
5. Add cycle summary and handoff summary generation
6. Update APIs
7. Update Task Drawer UI
8. Add tests
9. Remove old session-based grouping logic

## Test Plan

### Backend

- initial start creates cycle #1 and attempt #1
- retry stays in same cycle
- follow-up stays in same cycle
- restart fresh creates cycle #2
- agent switch stays in same cycle and creates handoff attempt
- provider switch stays in same cycle and creates new provider session
- original input is preserved across all attempts
- cycle summary is updated after each attempt

### Frontend

- Task Drawer shows cycles instead of provider-session groupings
- follow-up thread renders in one continuous conversation
- retries appear as system events, not separate cycles
- attempt metadata details are viewable
- provider switch does not split the cycle thread

### Migration

- existing tasks get cycle #1
- old run history remains visible
- follow-up prompts are preserved

## Open Decisions

1. Should cycle summaries be generated synchronously at attempt completion or via
   a deferred background summarizer?
2. Should `execution_runs` be renamed to `execution_attempts` later, or should
   we keep the existing table name for compatibility?
3. Should we expose `conversation_messages` as the sole UI source immediately,
   or use a temporary adapter from attempts plus message rows?

## Recommendation

Proceed with the heavy solution.

The right long-term model is:

- user-facing continuity comes from `task_cycle`
- execution auditing comes from `execution_attempt`
- rendering comes from `conversation_message`
- context continuity comes from `cycle summary + handoff packet + memory`
- provider-native session resume is an optimization, not the core identity model
