---
title: "Picking the right model for each task"
subtitle: "A working dev's cheatsheet for Claude Opus vs Sonnet vs Codex vs Gemini, based on what I actually run in AgentFlow."
author: Harun Yardımcı
date: 2026-04-22
status: draft
parent: why-im-building-agentflow.md
audience: developers who run more than one AI agent and are tired of guessing which to pick
voice: founder, opinionated, concrete
estimated_read: 5 min
caveat: All of this is current as of April 2026 and will be wrong within three months. Re-evaluate.
---

# Picking the right model for each task

The single biggest win from running multiple AI coding agents isn't "having options." It's having a *default per task type*.

Because the second you have to decide, mid-flow, "should this be Claude or Codex?" — you've already lost. Defaults are how fast people work.

This is my current default table. It's not a benchmark. It's the result of a year of running real tasks and noticing which model I regret picking, and when.

## The defaults

| Task type | Default model | Why |
|-----------|---------------|-----|
| Architecture / system design | **Claude Opus 4.7** | Best at sustained careful reasoning. Earns its price exactly here. |
| Product spec / requirements | **Claude Sonnet 4.6** | Focused, doesn't over-think a spec. |
| Research / wide-net reading | **Gemini 3.1-Pro** | Cheapest per-token for long context, fine at summarizing. |
| Feature implementation | **Claude Sonnet 4.6** | The workhorse. 80% of my implementation tasks live here. |
| Hard implementation (engine, algo) | **Claude Opus 4.7** | The other 20%. When it's worth the wait. |
| Refactor (mechanical) | **Codex 1** | Best at "don't change behavior, just move things." |
| Merge-conflict resolution | **Codex 1** | Same reason. Mechanical, pattern-heavy. |
| Test writing | **Codex 1** | Completes test stubs with fewer hallucinated imports. |
| QA critique / playtest | **Claude Sonnet 4.6** | Good voice for honest feedback. |
| Content / copywriting | **Gemini 3.1-Pro** | Fast, long, cheap. First draft is plenty. |
| Code review | **Claude Opus 4.7** | Catches the subtle stuff. One of the few places I splurge. |
| Docs writing | **Claude Sonnet 4.6** | Steady prose. |
| DevOps / infra scripts | **GPT-5.4** (where available) | Still surprisingly good at shell + cloud-CLI flavor. |

## How I chose (and how you should)

Three axes:

1. **Token cost.** Matters more than you think when you're running 20 tasks a night.
2. **Latency.** Sonnet and Gemini finish while Opus is still thinking. For "I'll need 5 drafts to find one," that's decisive.
3. **Ceiling on reasoning.** Opus has the highest. When you genuinely need the smartest thinker, nothing else is close. When you don't, you're paying for capacity you aren't using.

A rough heuristic:

- **High-ceiling, low-volume work** → Opus. Architecture, review, hard algos.
- **Mid-ceiling, high-volume work** → Sonnet. Implementation, spec, QA.
- **Low-ceiling, very-high-volume work** → Gemini. Research reads, copy drafts.
- **Pattern-heavy, mechanical work** → Codex. Refactors, merges, tests.
- **Shell/infra fluency** → GPT-5.4. DevOps scripts, cloud CLIs.

## Concrete examples from my pipelines

**Game feature pipeline** ([full recipe](example-pipelines.md#pipeline-1--overnight-game-feature-hex-empire-lite-html5)):

- `Architecture` → Opus 4.7. Non-negotiable. If this one is sloppy, every downstream task compounds the sloppiness.
- `Research` → Gemini 3.1-Pro. I don't need a genius to skim 40 blog posts.
- `Implementation` → Opus 4.7 for the engine, Sonnet for the HTML5 adapter. Same code, different cognitive load.
- `Merge conflict auto-resolver` → Codex 1. Fires automatically when conflict detected.

**Marketing sprint pipeline** ([full recipe](example-pipelines.md#pipeline-2--landing-page-marketing-sprint-saas-landing-page)):

- `Positioning + ICP` → Sonnet 4.6. Focused thinking, no need to burn Opus here.
- `Hero copy` → I draft it myself. Agents' hero copy is ~70th percentile. Not good enough.
- `Section copy ×5` → Gemini 3.1-Pro. Parallel fan-out, volume game.
- `Tailwind impl` → Opus 4.7. Surprisingly, because Tailwind + accessibility + responsiveness is where "clever" saves hours of my re-work.
- `a11y + QA` → Sonnet 4.6.

**Self-improvement pipeline** ([full recipe](example-pipelines.md#pipeline-3--agentflow-self-improve-the-recursive-one)):

- `Log reading` → Sonnet 4.6.
- `Cluster failures` → Gemini 3.1-Pro.
- `Schedule fix pipelines via MCP` → Sonnet 4.6. This task calls `create_pipeline`; needs reliability more than brilliance.

## Anti-patterns I've fallen into

**Using Opus for everything.** Especially tempting when you're new. Result: budget gone, latency high, quality indistinguishable from Sonnet on 80% of the tasks.

**Using Gemini for hard code.** Gemini is getting better fast. It is not Opus. If the task requires more than one inference hop, Opus wins, and it isn't close.

**Using Codex as a generalist.** Codex shines on mechanical pattern work. Give it "design an API" and you'll get something that runs but isn't quite *right*. Give it "convert these 30 files from JS to TS, same behavior" and it's untouchable.

**Ignoring GPT-5.4.** Easy to default to Anthropic for everything. GPT-5.4 is worth having in the rotation for infra and DevOps scripting — its shell fluency is still underappreciated.

## Letting AgentFlow pick

The table above is what I've hard-coded into my AgentFlow [Crew](../../../.agents/product-marketing-context.md):

- Atlas (Systems Architect) → Opus 4.7
- Compass (Product Owner) → Sonnet 4.6
- Forge (Senior Developer) → Opus 4.7
- Pixel (UI/UX Designer) → Sonnet 4.6
- Scout (Research Analyst) → Gemini 3.1-Pro
- Quill (Content Writer) → Gemini 3.1-Pro
- Sentinel (QA Engineer) → Sonnet 4.6
- Beacon (SEO Specialist) → Gemini 3.1-Pro
- Rocket (DevOps Engineer) → GPT-5.4

Once the roles are set up, I stop thinking about models. I pick an agent by *role* and the model comes along for the ride. Atlas is always Atlas. When a new better model ships, I update Atlas once, and every future pipeline gets it.

That's the real win of "multi-agent native." Not that you *can* use all four providers. That you *stop needing to think about which one you're using*.

---

Related reading:

- [Three pipelines I actually run in AgentFlow](example-pipelines.md) — concrete use of this table
- [Why worktree isolation is load-bearing](worktree-deep-dive.md) — so you can run different models on the same prompt safely
- [Agents driving agents: the MCP angle](agents-driving-agents.md)
