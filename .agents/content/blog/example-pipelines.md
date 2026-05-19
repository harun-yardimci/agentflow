---
title: "Three pipelines I actually run in AgentFlow"
subtitle: "Concrete recipes: what each task does, which agent runs it, why."
author: Harun Yardımcı
date: 2026-05-17
status: ready
repo: https://github.com/harun-yardimci/agentflow
parent: why-im-building-agentflow.md
audience: solo developers, indie hackers using AgentFlow or thinking about it
voice: founder, concrete, no abstractions
estimated_read: 6 min
assets:
  - assets/pipeline-board-multi-agent.png
---

# Three pipelines I actually run in AgentFlow

People ask me what a pipeline *is* in practice. Fair question — "pipeline-based orchestration for AI coding agents" is the kind of sentence that sounds like everything and nothing.

So here are three real pipelines I run. No toy examples. Each is something I actually shipped with this month.

Format for each:

- **Shape** — the task graph, in ASCII.
- **Who runs what** — agent + model per task, and why.
- **Prompts** — the actual task prompts (abbreviated), because those are the load-bearing part.
- **Gotchas** — what broke, what I changed.

---

## Pipeline 1 — Overnight game feature: "Hex Empire Lite HTML5"

Shape:

```
┌───────────────┐
│ proje dizini  │  Atlas (Opus 4.7)   — scope + folder layout
└───────┬───────┘
        ▼
┌───────────────┐   ┌───────────────┐
│ Arch. design  │   │ Mobil pazar   │  Scout (Gemini 3.1-Pro)
└───────┬───────┘   │ araştırması   │
        │           └───────────────┘
        ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ Design Visual │   │ Define Spec   │   │ Game Design   │
│ Assets        │   │ (Hex Empire)  │   │ Document      │
└───────┬───────┘   └───────┬───────┘   └───────┬───────┘
        │                   │                   │
        └──────────┬────────┴─────────┬─────────┘
                   ▼                  ▼
        ┌───────────────────┐  ┌─────────────────┐
        │ Implement engine  │  │ UI/UX tasarımı  │
        │ in Godot          │  │ (mobil hex)     │
        └─────────┬─────────┘  └────────┬────────┘
                  ▼                     ▼
        ┌───────────────────────────────────────┐
        │ Implement HTML5 Hex Empire Lite       │  Forge (Opus 4.7)
        └───────────────────┬───────────────────┘
                            ▼
        ┌───────────────────────────────────────┐
        │ Demo QA — oynanabilirlik testi        │  Sentinel (Sonnet 4.6)
        └───────────────────┬───────────────────┘
                            ▼
        ┌───────────────────────────────────────┐
        │ Merge Conflict: Hex grid resolver     │  Codex 1  (auto-spawned)
        └───────────────────────────────────────┘
```

Who runs what:

| Task | Agent | Model | Why this agent |
|------|-------|-------|----------------|
| Proje dizini | Atlas — Systems Architect | Claude Opus 4.7 | Careful reasoning about folder layout, doesn't hand-wave |
| Architectural Design | Atlas | Claude Opus 4.7 | Same — I want one thinker owning structure |
| Mobil strateji araştırması | Scout — Research Analyst | Gemini 3.1-Pro | Cheap, fast, good at wide-net research reads |
| Design Visual Assets | Pixel — UI/UX Designer | Claude Sonnet 4.6 | Sonnet is strong enough at vibes + fast enough to iterate |
| Define Product Spec | Compass — Product Owner | Claude Sonnet 4.6 | Focused spec writing, doesn't over-reason |
| Implement engine (Godot) | Forge — Senior Developer | Claude Opus 4.7 | Hard engine work — Opus earns its price here |
| Implement HTML5 Lite | Forge | Claude Opus 4.7 | Same |
| Demo QA | Sentinel — QA Engineer | Claude Sonnet 4.6 | Fast + good at playtest-style critique |
| Merge conflict resolver | Codex 1 | codex exec | Auto-spawned by the runtime when conflict detected; Codex is best at mechanical merges |

Sample prompt — `proje dizini`:

```
You are the Systems Architect for a new game project: "Hex Empire Lite".
Output:
1. A folder layout (tree) for a Godot + HTML5 dual-target repo.
2. Naming conventions (camelCase for ts, snake_case for gd).
3. A one-paragraph rationale per top-level folder.
Constraints:
- Single repo, two engines, shared assets/ folder.
- No prose outside the requested structure.
Write to pipeline_ctx as `architecture.proje_dizini`.
```

Sample prompt — `Merge conflict`:

```
A merge conflict occurred while integrating branch task/impl-hex-engine into main.
Files in conflict: {{conflict.files}}
Context of each side: {{conflict.sides}}
Resolve the conflict preserving the semantic intent of both sides where possible.
Commit with message: "fix(merge): auto-resolve <file> via codex"
Do NOT introduce behavioral changes beyond what both sides implied.
```

Gotchas:

- Opus 4.7 at the *top* of the graph is expensive but non-negotiable. The whole run costs more if Atlas hand-waves — every downstream agent inherits the sloppiness.
- Gemini for research: watch context length. It will happily dump 8K tokens of "interesting finds" into `pipeline_ctx` and blow the budget of the next task.
- The auto-spawned Codex merge-fixer was a surprise. I added it as a runtime-level pattern, not a pipeline-level task — any branch merge in any pipeline can trigger one.

Run cost: 22.1M tokens, $59.01. 17 tasks, one overnight, zero hand-holding from me.

---

## Pipeline 2 — Landing page marketing sprint: "SaaS Landing Page"

Shape:

```
┌──────────────────┐
│ Positioning      │  Compass (Sonnet 4.6)   — product-marketing-context
└────────┬─────────┘
         ▼
┌──────────────────┐
│ ICP + JTBD       │  Compass (Sonnet 4.6)
└────────┬─────────┘
         ▼
┌──────────────────┐   ┌──────────────────┐
│ Hero + CTA copy  │   │ Competitive      │
└────────┬─────────┘   │ differentiation  │
         │             └────────┬─────────┘
         │                      │
         └──────────┬───────────┘
                    ▼
           ┌──────────────────┐
           │ Landing page IA  │  Atlas (Opus 4.7)  — once, carefully
           └────────┬─────────┘
                    ▼
           ┌──────────────────┐
           │ Section copy ×5  │  Quill (Gemini 3.1-Pro)  — parallel fan-out
           └────────┬─────────┘
                    ▼
           ┌──────────────────┐
           │ Tailwind impl    │  Forge (Opus 4.7)
           └────────┬─────────┘
                    ▼
           ┌──────────────────┐
           │ QA + a11y check  │  Sentinel (Sonnet 4.6)
           └──────────────────┘
```

Key idea: the middle fan-out ("Section copy ×5") is five sibling tasks that run in parallel, each in its own worktree, each drafting one section (Hero, Features, Social Proof, Pricing, FAQ). Gemini handles this well because the tasks are independent, context-light, and volume-heavy.

Sample prompt — section copy task:

```
You are writing the `{{section}}` section of a SaaS landing page.
Positioning (from pipeline_ctx): {{positioning}}
ICP (from pipeline_ctx):        {{icp}}
Tone: {{brand_voice.tone}}

Deliver:
- Headline (max 70 chars)
- Subhead (max 160 chars)
- Body copy (max 120 words)
- One CTA variant

No emoji. No "revolutionary", "game-changing", "unleash".
Write to pipeline_ctx as `landing.sections.{{section}}`.
```

Gotchas:

- Five parallel copywriting tasks shouldn't touch the same file. Solved by worktree isolation — each writes to its own `landing.sections.{{section}}` key in `pipeline_ctx`, then the Tailwind implementer reads all five and composes the page.
- I almost used Opus for the copy. Wasteful. Sonnet / Gemini produce fine first-drafts and I rewrite the top 30% myself anyway.

---

## Pipeline 3 — "agentflow self improve" (the recursive one)

Shape:

```
┌───────────────────────┐
│ Read last 7 days of   │   Compass (Sonnet 4.6)
│ logs + errors         │
└──────────┬────────────┘
           ▼
┌───────────────────────┐
│ Cluster failures      │   Scout (Gemini 3.1-Pro)
│ → top 3 recurring     │
└──────────┬────────────┘
           ▼
┌───────────────────────┐
│ For each recurring    │   — this FANS OUT at runtime
│ issue, open a new     │     via the MCP server, not
│ AgentFlow pipeline    │     as a pre-defined graph
└───────────────────────┘
```

This one is different. The last task doesn't *do* the work — it *schedules* it, by calling AgentFlow's own MCP server. The output is: N new pipelines, each one a focused fix for a specific recurring failure.

The prompt is roughly:

```
You have access to the `agentflow` MCP tools.
Input (from pipeline_ctx): top_recurring_issues = [...]
For each issue:
  1. Draft a one-sentence title and a one-paragraph description.
  2. Decide a 2–4 task pipeline to fix it.
  3. Call `create_pipeline` with that structure.
  4. Return the new pipeline id in `output.scheduled`.
Do not create more than 3 pipelines in one run.
Do not run the pipelines — I want to review them first.
```

This is the "agent driving agents" pattern. AgentFlow running AgentFlow. The meta-agent doesn't write code; it writes pipelines. I wake up to a stack of proposed work, approve the ones that make sense, and the worker pool picks them up.

Gotchas:

- Bounded fan-out. Without the `max 3 pipelines` cap, this thing will happily propose 27 pipelines and my token bill will remember it forever.
- Always gate on human approval. A recursive agent that auto-runs the pipelines it spawns is a great way to discover a bug in production at 4am.
- Logging matters more than ever. If a meta-agent spawns work, I need to be able to trace "why does this pipeline exist?" back to the run that created it. AgentFlow stamps the originating run id on every spawned pipeline for exactly this reason.

---

## What these three have in common

Different domains — game dev, marketing, self-observability — but the shape is the same:

1. **A reasoner up top** (usually Opus) sets structure.
2. **Parallel specialists** (Sonnet / Gemini / Codex) fan out with tight, context-aware prompts.
3. **A QA or reviewer** at the end catches what everyone else missed.
4. **A worktree per task** keeps them from stepping on each other.

That's the whole pattern. Once you see it, most of your AI-agent work can be expressed this way.

See also:

- [Why worktree isolation is load-bearing](worktree-deep-dive.md)
- [Agents driving agents: the MCP angle](agents-driving-agents.md)
- [Picking the right model for each task](choosing-the-right-model.md)
