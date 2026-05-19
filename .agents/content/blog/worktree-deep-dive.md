---
title: "Why worktree isolation is load-bearing"
subtitle: "A short technical explainer on why every AgentFlow task gets its own git worktree, not just its own branch."
author: Harun Yardımcı
date: 2026-05-17
status: ready
repo: https://github.com/harun-yardimci/agentflow
parent: why-im-building-agentflow.md
audience: developers running multiple AI coding agents
voice: founder, technical, concrete
estimated_read: 4 min
---

# Why worktree isolation is load-bearing

If I had to throw away two of AgentFlow's three differentiators and keep one, I'd keep this.

## The bug that made me care

Two Claude Code sessions, same branch.

- Session A runs at 21:14. Refactors `server/auth.ts`. Commits. Looks good. I move on.
- Session B, started at 21:12, still running, finishes at 21:19. Its context had the *pre-refactor* `auth.ts`. It rewrites the old version. Commits. Silently overwrites A's work.
- I find out at 22:40 when the thing I thought was fixed isn't fixed.

No error. No conflict. No warning. Just two branch tips where there should have been one meaningful history.

## Why branches alone don't solve it

You might think: "fine, give each agent its own branch." That's what I tried first.

The problem: agents run `git` commands in a *checkout*. Two agents in the same checkout can't be on two branches at once. If they're in the same folder, one of them is going to be on the wrong branch, or checking out, or stashing — and if they do it while the other is mid-write, you get a different flavor of the same bug.

Branches are a history abstraction. The working tree — the files on disk — is singular per checkout. That's the real contention.

## What git worktrees actually are

From `git help worktree`:

> A git repository can support multiple working trees, allowing you to check out more than one branch at a time.

Concretely: a worktree is a second folder, pointing at the same `.git` directory, checked out to its own branch. No clone, no extra remotes, no re-fetching.

```
repo/                     ← main checkout, branch `main`
  .git/                   ← real git directory
  src/...

../worktree-task-a/       ← second working tree, branch `task/a`
  .git                    ← file, points back at repo/.git
  src/...

../worktree-task-b/       ← third working tree, branch `task/b`
  .git                    ← file, points back at repo/.git
  src/...
```

All three share history. None of them can step on each other's files.

## How AgentFlow uses them

`server/engine/worktree-manager.ts` owns the lifecycle:

1. When a task enters `running`, manager creates `../worktree-<task-id>/` on a fresh branch `task/<task-id>`.
2. The task's CLI agent (`claude -p`, `codex exec`, `gemini -p`) is spawned with that worktree as its cwd.
3. When the task finishes, its diff is captured and saved to `pipeline_ctx`.
4. The worktree is either kept (for review) or torn down based on task config.

That's it. One decision, applied everywhere.

## What this buys you, concretely

**Parallel, conflict-free.** Ten tasks on the same repo, same day, no git fights. I run overnight batches of 6–12 tasks. None of them see each other's files.

**Clean per-task diffs.** Every task produces a single branch's worth of changes. Merging is a deliberate act, not a side effect.

**Fair agent A/B tests.** Same prompt, same starting commit, three worktrees, three agents. Three clean diffs to compare. No "was it the prompt or the race condition?" uncertainty.

**Blast-radius control.** A task that goes sideways corrupts one worktree. Torch it and move on. Your main checkout is untouched.

**Review is a pull request, essentially.** The diff a task produces is the same shape as a PR. If you want to wire it to CI, you already have the artifact.

## The one rule

Never run a CLI agent in the repo root. Always in a worktree. Even a "quick, one-off" task. The moment you break this rule, you've re-introduced the bug I opened this post with.

This is why AgentFlow doesn't expose a "just run it here" mode. There's no foot-gun button. The abstraction isn't "pipelines with optional worktrees" — it's "worktrees with pipelines on top." The thing I promised not to let you do again is structurally prevented.

## Try it without AgentFlow

If nothing else, steal the pattern. Next time you're about to run two agents in parallel:

```
git worktree add ../feature-x feature-x
cd ../feature-x
claude -p "..."
```

Second agent, new terminal:

```
git worktree add ../feature-y feature-y
cd ../feature-y
codex exec "..."
```

They can't touch each other. You just bought yourself a category of peace.

---

Related reading:

- [Three pipelines I actually run in AgentFlow](example-pipelines.md) — where this pattern earns its keep
- [Agents driving agents: the MCP angle](agents-driving-agents.md)
- [Picking the right model for each task](choosing-the-right-model.md)
