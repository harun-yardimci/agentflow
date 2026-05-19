# Worktree Cleanup Design

Date: 2026-03-28
Status: Implemented
Owner: Codex

## Goal

Automatically remove stale task worktrees without deleting their branches.

The cleanup must only target archived tasks whose worktrees are no longer
needed, while preserving any state that could still require human review.

## Approved Rules

A task worktree is eligible for cleanup only when all of the following are
true:

- the task has `archived_at`
- at least 5 days have passed since `archived_at`
- the task branch is merged into the pipeline base branch (`main`, `master`, or
  the pipeline's configured git branch)
- the task is not running
- the worktree exists and is clean

If the branch is not merged, the worktree must not be deleted.

If the worktree is dirty, the worktree must not be deleted even when the task
is archived, old enough, and merged.

Cleanup removes only the worktree. The task branch is preserved.

## Current State

The codebase already has most of the building blocks:

- `cleanup-service.ts` runs scheduled background cleanup jobs
- `worktree-manager.ts` can remove only the worktree or remove the worktree and
  branch together
- `git.ts` already knows how to determine whether a task branch is merged into
  the pipeline base branch
- `tasks` already stores `archived_at`, `branch`, `worktree_path`, and
  `worktree_status`

Current gap:

- there is no automated lifecycle job for archived worktree cleanup

## Approaches Considered

### 1. Extend the Existing Cleanup Service

Add worktree cleanup directly into the existing cleanup scheduler.

Pros:

- least amount of wiring
- reuses existing daily cleanup timing

Cons:

- mixes DB retention cleanup with git/worktree lifecycle logic
- harder to test and evolve independently

### 2. Dedicated Worktree Cleanup Service

Create a separate service that handles worktree cleanup policy and git checks,
then start it from server bootstrap.

Pros:

- clean separation of concerns
- easier to test and extend
- supports later additions like manual triggers and settings-backed retention

Cons:

- slightly more code than extending the existing cleanup file

### 3. External Cron Calling an API Endpoint

Keep cleanup outside the app process and trigger it through HTTP.

Pros:

- decoupled from app runtime

Cons:

- extra operational setup
- not self-contained for local usage

Decision:

- use a dedicated worktree cleanup service

## Runtime Design

Create a new `worktree-cleanup-service` with a `runWorktreeCleanup()` entry
point and a small scheduler wrapper.

Behavior:

- server startup schedules the first cleanup pass in the background after a
  short delay
- startup must not block on cleanup
- long scans should yield periodically so API requests are not starved
- the service continues to run every 24 hours

This keeps the app responsive during boot while still ensuring cleanup starts
soon after launch.

## Candidate Selection

The service will query tasks that have:

- `archived_at IS NOT NULL`
- `worktree_path IS NOT NULL`
- `status != 'running'`

The service then applies in-memory eligibility checks:

- archive age is at least 5 days
- branch exists and is merged into the pipeline base branch
- worktree path exists
- worktree has no uncommitted changes

Tasks failing any condition are skipped or marked blocked depending on the
reason.

## Result States

No new table is required. Existing task fields are enough.

Recommended `worktree_status` outcomes:

- `cleaned`
- `cleanup_blocked_dirty`

State transitions:

- on successful cleanup:
  - `worktree_path = NULL`
  - `worktree_status = 'cleaned'`
- if the worktree path is already missing on disk:
  - `worktree_path = NULL`
  - `worktree_status = 'cleaned_missing_path'`
- on dirty worktree:
  - keep `worktree_path`
  - set `worktree_status = 'cleanup_blocked_dirty'`

All other ineligible cases are skipped without destructive changes.

## Logging

Each decision should produce a short pipeline log entry.

Examples:

- `'Task X' worktree cleaned after archive retention`
- `'Task Y' cleanup blocked — worktree has uncommitted changes`
- `'Task Z' cleanup skipped — branch not merged into main`

This provides auditability without needing a separate history table.

## Safety Rules

- never touch running tasks
- never delete branches
- never force-remove dirty worktrees
- never delete worktrees for unmerged archived tasks
- use `removeWorktree(...)`, not `removeWorktreeAndBranch(...)`

## Future Extensions

Not part of this change, but the design should allow:

- `worktree_cleanup_retention_days` in settings
- a manual "run cleanup now" action
- UI badges/tooltips for cleanup outcomes
