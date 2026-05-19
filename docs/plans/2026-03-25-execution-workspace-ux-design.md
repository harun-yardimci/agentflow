## Summary

This design introduces a first implementation slice of a clearer execution
workspace model for task git management. The immediate goal is not a full
schema migration to first-class execution workspaces. Instead, this slice:

- reduces user confusion in the task drawer by replacing branch-centric wording
  with lineage-centric wording,
- prevents dangerous git actions while a task is actively running,
- invalidates stale worktree metadata when topology changes,
- prepares the UI and API for a later execution-workspace data model.

## Problem

The current system mixes three concerns in a way that is hard for users to
understand and unsafe for execution:

- `task.branch` acts like a "start from" override, but the UI presents it as a
  branch picker.
- `worktree_path` is reused as a cache, even when branch or dependency topology
  changes.
- merge, rebase, and cleanup actions can be triggered while a task is running.

This causes stale worktree reuse, misleading UI labels, and unsafe git actions.

## Scope For This Slice

### Backend

1. Invalidate stored worktree metadata when git topology changes:
   - `branch`
   - `useWorktree`
   - `dependsOn`
2. Block merge, rebase, and cleanup while the task is running.
3. Make branch switching clear stale worktree metadata after validation.
4. Normalize cleanup updates so the task no longer claims an active worktree.

### UI

1. Rename branch-centric labels to lineage-centric labels:
   - `Base branch` -> `Starts from`
   - `Use branch from` -> `Start from task`
   - `Branch` -> `Code line`
2. Show a short explanation that this field controls where isolated work starts.
3. Disable git actions while a task is running.
4. Improve advanced context wording so users see "workspace mode" rather than
   raw git internals.

## Deferred

The following are intentionally deferred to a later phase:

- first-class `execution_workspaces` table,
- workspace lineage graph at pipeline level,
- serialization/locking for shared spawned follow-up workspaces,
- integration workspaces for multi-upstream consumers,
- isolated merge worktrees instead of repo-root merge flows.

## Expected User Experience

After this slice:

- users edit a task's "Starts from" source rather than an ambiguous branch
  field,
- changing the source forces the next run to provision a fresh worktree,
- task drawer actions cannot mutate git state during active execution,
- advanced context better communicates whether a task uses an isolated or shared
  workspace.

## Testing

Add or update tests for:

- topology change invalidates worktree metadata,
- running tasks reject git actions,
- branch switch clears stale worktree state,
- task drawer wording reflects lineage terminology.
