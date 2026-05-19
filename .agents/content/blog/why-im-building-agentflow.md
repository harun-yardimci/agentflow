---
title: "Why I built AgentFlow: a conductor for your AI coding agents"
author: Harun Yardımcı
date: 2026-05-17
status: ready
audience: solo developers, indie hackers, team-of-one builders already using Claude Code / Codex / Gemini CLI
goal: launch — awareness + first installs + first stars
voice: founder, dry, technical, no hype
estimated_read: 8 min
assets:
  - assets/dashboard-pipelines-list.png
  - assets/pipeline-board-multi-agent.png
  - assets/crew-directory.png
sub_pages:
  - blog/example-pipelines.md
  - blog/worktree-deep-dive.md
  - blog/agents-driving-agents.md
  - blog/choosing-the-right-model.md
cta:
  repo: https://github.com/harun-yardimci/agentflow
  install: |
    git clone https://github.com/harun-yardimci/agentflow.git
    cd agentflow && npm install && npm run dev
---

# Why I built AgentFlow: a conductor for your AI coding agents

I'm a team of one. Most weeks I'm shipping a product, a landing page, a marketing push, a bug fix, and a customer support thread — and somewhere in there I'm supposed to also think.

So I live in AI coding agents. Claude Code in one pane. Codex in another. Gemini CLI in a third. Each of them, on its best day, is better than I am. Combined, on a normal day, they're a traffic jam.

This is the tool I built to unjam it. It's called AgentFlow, it's open source under Apache-2.0, and as of today you can clone it, run it locally, and drive it from the same agents you already use. The repo is at [github.com/harun-yardimci/agentflow](https://github.com/harun-yardimci/agentflow). No accounts, no waitlist, no cloud.

If you're a team-of-one builder too, this post is the why. The README is the how.

> This post is the overview. Each of the load-bearing ideas gets its own sub-page with code, war stories, and defaults:
>
> - [Three pipelines I actually run](example-pipelines.md) — full recipes, prompts, gotchas
> - [Why worktree isolation is load-bearing](worktree-deep-dive.md) — the bug that made me care
> - [Agents driving agents: the MCP angle](agents-driving-agents.md) — the recursive pattern
> - [Picking the right model for each task](choosing-the-right-model.md) — my default table

## The three-terminal problem

A modern solo dev's workflow, roughly:

1. Open a terminal. Run `claude -p "refactor this module"`.
2. Another terminal. Run `codex exec "write unit tests"`.
3. A third terminal. Run `gemini -p "rewrite these marketing bullets"`.
4. Cry softly because two of them just committed to the same branch and one of them is wrong and you don't know which.

Each CLI, alone, is great. The problem is they are *alone*. There is no conductor. You are the conductor. You are also the cellist, the sound engineer, the janitor, and the guy fixing the broken chair in row four.

The specific failure modes I kept hitting:

- **Parallelism breaks on git.** Two agents on the same branch step on each other. The second wins silently, the first's work vanishes, and you notice an hour later.
- **Fair comparison is impossible.** I couldn't cleanly A/B a prompt across Claude and Codex because they were racing on the same checkout.
- **Observability is terminals.** After a batch of tasks, my only artifact is scrollback. What changed, why, in what order — I have to guess from `git log`.
- **No programmable control.** I wanted a meta-agent to plan my day and dispatch tasks. Writing Python glue for every new idea was a weekend I didn't have.

I tried fixing each separately: shell scripts, a Taskfile, a half-built dashboard, tmux layouts I treated as infrastructure. None of it held because each fix solved one symptom and made the others worse.

Eventually I stopped and asked: what would a *real tool* for this look like?

## The three ideas behind AgentFlow

There are three load-bearing ideas. None are novel alone. Their combination is.

### 1. Every task runs in its own git worktree

A `git worktree` is a second checkout of the same repo, in a different folder, on its own branch, sharing `.git`. Been in git since 2015; most devs have never used it.

In AgentFlow every task is a worktree. Task A lives in `worktree-task-A/` on `task/a`. Task B lives in `worktree-task-B/` on `task/b`. Same history. Different working trees. They can't see each other. They run in parallel without coordination.

This one decision kills an entire bug category:

- No silent overwrites between parallel agents.
- No "did this agent touch my uncommitted changes?" panic.
- Clean per-task diffs, always.
- Failed tasks can't contaminate successful ones.

The same prompt can run across Claude, Codex, Gemini simultaneously — three clean diffs, side by side, fair fight. → [Full story in the worktree deep-dive](worktree-deep-dive.md).

### 2. Agents are interchangeable at the task level

AgentFlow doesn't wrap one model. It wraps three CLIs — Claude Code, Codex, Gemini — as first-class executors. You assign an agent *per task*, not per pipeline.

Why it matters: different agents are good at different things. Opus for planning. Sonnet for implementation. Codex for refactors and merge resolution. Gemini for high-volume text.

When a task finishes, its output is captured and chained into downstream tasks' context. A realistic pipeline:

- `Plan` → Claude Opus 4.7
- `Implement` → Claude Sonnet 4.6
- `Tests` → Codex 1
- `Docs` → Gemini 3.1-Pro
- `Review` → Claude Opus 4.7

Same pipeline, five minds, one board.

![Pipeline board with tasks across 5 stages and 5 different models](assets/pipeline-board-multi-agent.png)

*Real run: 17 tasks, 5 agents, $59 in tokens, a merge conflict resolved automatically by Codex while I was at dinner.*

→ [Full defaults table for when to pick which model](choosing-the-right-model.md).

### 3. MCP is built in — another agent can drive AgentFlow

AgentFlow exposes itself as an MCP server. Any MCP-compatible client — Claude Code, Cursor, Claude Desktop, your own agent — can list pipelines, create tasks, approve steps, read logs, write to shared context.

The feature I didn't know I needed until I had it. A meta-agent can plan and dispatch. I've had Claude, through Claude Desktop, draft a pipeline, hand it to AgentFlow, and let the worker pool do the rest.

"Agents driving agents" is a cliché; in practice it's just a programmable control plane with a sensible protocol. → [The MCP deep-dive](agents-driving-agents.md), including the recursive self-improve pipeline.

## Three pipelines, three screenshots

The best way to understand a tool is to see what it runs. These are real pipelines I shipped with this month. → [Full recipes, prompts, and gotchas are here](example-pipelines.md).

### Pipeline 1 — Overnight game build (17 tasks, 5 agents, $59)

Shape (abridged):

```
Architecture → Opus 4.7
    ↓
Parallel: [Spec (Sonnet) | Visuals (Sonnet) | Game Doc (Opus)]
    ↓
Implement engine (Opus) · Implement HTML5 (Opus) · UI/UX (Sonnet)
    ↓
QA (Sonnet) → Auto-spawned Merge Conflict Resolver (Codex 1)
```

The auto-spawned merge-fixer is a runtime pattern, not a pipeline task. Any conflict, any pipeline, triggers one. Codex is best at mechanical merges.

### Pipeline 2 — Landing page sprint with parallel copy fan-out

```
Positioning (Sonnet) → ICP (Sonnet) → IA (Opus)
                                          ↓
              Section copy ×5 — parallel — Gemini 3.1-Pro
                                          ↓
                          Tailwind impl (Opus) → a11y + QA (Sonnet)
```

Five sibling tasks, five worktrees, one pipeline. Each drafts a section (Hero, Features, Social Proof, Pricing, FAQ). Gemini handles volume; the Tailwind implementer composes. Worktree isolation is what makes the fan-out safe.

### Pipeline 3 — "agentflow self improve" (the recursive one)

```
Read last 7 days of logs (Sonnet)
    ↓
Cluster failures → top 3 (Gemini)
    ↓
For each, call MCP `create_pipeline` (Sonnet) — bounded to 3
```

The last task doesn't fix anything. It *schedules* fixes, via AgentFlow's own MCP server. The meta-agent writes pipelines; other agents write the code. I wake up to a stack of proposed work, approve what makes sense. → [Why bounded fan-out and human approval are non-negotiable here](agents-driving-agents.md#guardrails-ive-learned-the-hard-way).

## What it looks like today

**The overview.** Sidebar of pipelines in various states — running, blocked, completed, queued. Everything in SQLite, so you close your laptop mid-run and come back to it.

![Overview dashboard with pipeline sidebar and board view](assets/dashboard-pipelines-list.png)

**The crew.** Named roles mapped to models. Atlas is Systems Architect on Opus. Forge is Senior Developer on Opus. Pixel is UI/UX Designer on Sonnet. Rocket is DevOps on GPT-5.4. You build a small team; the team shows up in every pipeline.

![Crew directory with 9 agents across roles and models](assets/crew-directory.png)

**The board.** Kanban across Research, Planning, Development, Testing, Review. Each card shows the agent, the model, priority, duration, and status (seeded, spawned, approved, rejected).

## What it isn't — and by design

- **Not cloud.** Runs locally. Your SQLite, your worktrees, your repos. No accounts. Apache-2.0.
- **Not a framework.** You don't build agents in it. You *run* the CLI agents you already use.
- **Not a SaaS product.** No pricing, no signup. Team features are roadmap, not 2026 priority. I want solo devs and team-of-one builders to love this first; I'll earn the right to build bigger things later.

## Try it

```bash
git clone https://github.com/harun-yardimci/agentflow.git
cd agentflow
npm install
npm run dev
```

Open [localhost:3100](http://localhost:3100). You'll need at least one of Claude Code, Codex CLI, or Gemini CLI installed locally — the README has install lines for each.

Want another agent to drive AgentFlow? It ships with an MCP server: `claude mcp add agentflow --env AGENTFLOW_PORT=3100 -- node ./bin/cli.js mcp`.

## What I want to hear from you

If you're a team of one and you've felt this exact workflow pain — I want to know what broke first for you. The specific moment. The specific git mess. The specific comparison you couldn't run. Not a wishlist — a war story.

The rough edges in v1.0.0 are the ones real users will hit in their first ten minutes. Your war stories are cheaper than mine. Open an [issue](https://github.com/harun-yardimci/agentflow/issues), star the repo if it's useful, reply to the post where you found this, or DM me. I read everything.

---

**Keep reading:**

- [Three pipelines I actually run in AgentFlow](example-pipelines.md) — full prompts, full graphs, full gotchas
- [Why worktree isolation is load-bearing](worktree-deep-dive.md) — technical explainer
- [Agents driving agents: the MCP angle](agents-driving-agents.md) — meta-agent patterns
- [Picking the right model for each task](choosing-the-right-model.md) — defaults cheatsheet

The repo is at [github.com/harun-yardimci/agentflow](https://github.com/harun-yardimci/agentflow). It's the same code I'm shipping with every day.
