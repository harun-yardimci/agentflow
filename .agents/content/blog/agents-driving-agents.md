---
title: "Agents driving agents: the MCP angle"
subtitle: "Why AgentFlow exposes itself as an MCP server, and what happens when you let Claude plan your workday."
author: Harun Yardımcı
date: 2026-05-17
status: ready
repo: https://github.com/harun-yardimci/agentflow
parent: why-im-building-agentflow.md
audience: developers already familiar with MCP, or curious about meta-agent patterns
voice: founder, practical, shows don't tells
estimated_read: 5 min
---

# Agents driving agents: the MCP angle

"Agents driving agents" is one of those phrases that either sounds profound or sounds ridiculous, depending on whether you've ever tried it.

I've tried it. It's both.

## What I mean by "MCP-native"

AgentFlow is not a CLI with MCP stapled on. It's an engine with two surfaces:

- **REST + UI** for humans.
- **MCP** for other agents.

Both surfaces hit the same SQLite database, the same worker pool, the same worktree manager. Anything a human can do in the dashboard, an MCP client can do programmatically — and vice versa.

The tools exposed over MCP today:

| Tool | What it does |
|------|--------------|
| `list_pipelines` | List all pipelines with their tasks and logs |
| `get_pipeline` | Read one pipeline's full state |
| `create_pipeline` | Create a new pipeline with optional tasks |
| `delete_pipeline` | Tear one down |
| `add_task` | Append a task to a pipeline |
| `delete_task` | Remove a task |
| `approve_task` | Approve a `pending_approval` task |
| `reject_task` | Reject one |
| `move_task` | Move between stages |
| `complete_task` | Mark done + cascade to dependents |
| `run_pipeline` | Kick off execution |
| `list_agents` | List crew members |
| `update_agent` | Tweak an agent's system prompt or model |
| `get_logs` | Read activity logs |
| `get_pipeline_context` | Read shared context keys |
| `set_pipeline_context` | Write shared context keys |
| `list_pending_questions` | Interactive questions awaiting answers |
| `respond_to_question` | Answer one |

Which means, from Claude Desktop or Cursor, I can type:

> "Claude, look at my last 7 days of AgentFlow logs. Find the three most common failure modes. For each one, propose a 2–4 task pipeline to fix it. Don't run any of them — I want to review first."

And Claude does it. Through MCP. The output is: three new pipelines, sitting in my dashboard, each one a focused fix, waiting for me to click "run."

## The example pipeline that made this click for me

The pipeline is [`agentflow self improve`](example-pipelines.md#pipeline-3--agentflow-self-improve-the-recursive-one). Roughly:

1. Read last week's logs.
2. Cluster failures.
3. For each recurring failure, call `create_pipeline` to schedule a fix.

Step 3 is the interesting one. The task doesn't *fix* anything. It *schedules* fixes. The meta-agent writes pipelines, not code. A separate set of agents, spun up by the worker pool, writes the actual code.

This is the separation of concerns I'd been trying to get right for a year. Planners plan. Implementers implement. Reviewers review. The MCP layer is what lets them be different agents, on different models, coordinated without being coupled.

## When this is actually worth doing

Most tasks don't need a meta-agent. A single pipeline with 5 tasks is already 90% of the value.

Where meta-agents pull their weight:

1. **Recurring analysis that turns into work.** "Every Monday, look at what broke last week, and queue up fixes." One meta-agent, running weekly, keeping the backlog honest.
2. **Scale-out on a long-tail of similar tasks.** "Here are 50 URLs, for each one draft a competitor comparison pipeline." The meta-agent dispatches 50 pipelines, each with its own worktree and crew.
3. **Coordinating across pipelines.** "If pipeline A finishes with a breaking change, open a pipeline in repo B to adapt." Cross-project plumbing without writing cross-project code.

When it is *not* worth it:

1. **A single task you'll run once.** Just run it.
2. **Anything where the meta-agent has to make aesthetic judgment calls.** Those are yours.
3. **Anything time-critical.** Meta-layer adds latency and failure surface.

## Guardrails I've learned the hard way

**Bounded fan-out.** Every meta-prompt that can call `create_pipeline` must declare a hard limit. Say `max 3 pipelines per run`. Otherwise the agent will enthusiastically propose 27 and you'll pay for all of them.

**Human approval between layers.** The meta-agent can *draft* pipelines. It should not auto-run them. AgentFlow defaults spawned pipelines to `pending_approval` for exactly this reason. Flip that off at your own risk.

**Trace parentage.** Every pipeline spawned via MCP is stamped with the originating run id. When a weird pipeline shows up in your dashboard, you can answer "who created this?" without diffing git history.

**Budget, budget, budget.** A meta-agent that schedules 5 pipelines of 10 tasks each has just committed you to 50 agent runs. `get_pipeline_context` and `set_pipeline_context` make it easy to pass budgets down; use them.

## What this isn't

It isn't "AI that runs itself." I'm not interested in that and I don't think you should be either. Every AgentFlow pipeline, even ones spawned by meta-agents, terminates at a human decision somewhere. The pattern is: agents do the grunt work, humans do the taste work.

It also isn't a framework for *building* agents. AgentFlow runs the CLI agents you already have. The MCP surface is for driving pipelines, not for writing agents. If you want the latter, you want a different category of tool.

## The practical setup

To wire Claude Code into AgentFlow, one line:

```
claude mcp add agentflow --env AGENTFLOW_PORT=3100 -- node ./bin/cli.js mcp
```

Claude Desktop / Cursor, drop into your MCP config:

```json
{
  "mcpServers": {
    "agentflow": {
      "command": "node",
      "args": ["./bin/cli.js", "mcp"],
      "env": {
        "AGENTFLOW_PORT": "3100"
      }
    }
  }
}
```

The MCP server shares SQLite directly with the backend — no HTTP hop, no serialization round-trip. Tool calls are fast enough to feel local.

---

Related reading:

- [Three pipelines I actually run in AgentFlow](example-pipelines.md) — including the recursive self-improve one
- [Why worktree isolation is load-bearing](worktree-deep-dive.md) — what keeps meta-spawned pipelines from eating each other
- [Picking the right model for each task](choosing-the-right-model.md)
