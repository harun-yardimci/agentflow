# Product Marketing Context

*Last updated: 2026-04-21*
*Status: V2 — aligned with founder on audience (solo/indie), business model (OSS only for now), phase (awareness only, no GitHub link yet), differentiators (worktree + multi-agent + MCP). Open items marked `[?]`.*

## Product Overview
**One-liner:** Pipeline-based orchestration for AI coding agents — run Claude Code, Codex, and Gemini CLI side-by-side in isolated git worktrees with a visual dashboard and MCP control plane.

**What it does:** AgentFlow lets developers design multi-step task graphs where each task is executed by a CLI agent (Claude Code, Codex, or Gemini) inside its own git worktree. You watch progress, logs, diffs, and interactive prompts from a dashboard, or drive the whole system programmatically over MCP.

**Product category:** AI agent orchestration / agentic workflow runner. Adjacent shelves: CI-for-agents, "agent conductor," LLM workflow engines. `[?]` still settling on category naming.

**Product type:** Open-source developer tool. Self-hosted, local-first, SQLite-backed. Apache-2.0 licensed.

**Business model:** OSS-only today (Apache-2.0, self-hosted). No commercial layer, no pricing, no accounts. Team tier is on the roadmap but explicitly not a 2026 priority — focus is OSS adoption first.

## Target Audience
**Target audience:** Solo developers, indie hackers, one-person companies / "team-of-one" builders who already live in Claude Code / Codex / Gemini CLI and want to ship faster with agents. NOT targeting teams or enterprises right now.

**Decision-makers:** The individual developer. Bottom-up, dev-tool, one-person decision. No buying committee, no procurement.

**Primary use case:** Running *many* AI coding tasks in parallel without them stepping on each other, and without the developer having to babysit every prompt.

**Jobs to be done:**
- "Help me run 5 agent tasks overnight and show me what broke vs. what shipped."
- "Let me chain agents — spec → implement → review — without copy-pasting between terminals."
- "Give me one dashboard for Claude + Codex + Gemini so I can pick the right model per task."

**Use cases:**
- Multi-step refactors split across agents (plan in Claude, implement in Codex, polish in Gemini)
- Overnight backlogs where each task becomes an isolated worktree
- Parallel experimentation: run the same prompt across three agents, diff results
- Automated pipelines triggered from an MCP client (another Claude session, Cursor, Claude Desktop)
- Approvals-in-the-loop: agents pause for human input on risky steps

## Personas
| Persona | Cares about | Challenge | Value we promise |
|---------|-------------|-----------|------------------|
| Indie hacker / solo founder | Shipping velocity, doing the work of a team alone | Manually juggling Claude/Codex/Gemini in separate terminals | One conductor, parallel worktrees, agents run while they sleep |
| "Team-of-one" power user | Comparing Claude vs Codex vs Gemini on real tasks | Can't run them side-by-side on the same branch without conflicts | Worktree-per-task isolation, same prompt across agents |
| Agent-curious senior dev | Wiring agents into their own tooling | No programmable control plane for the CLI agents they already use | Built-in MCP server — drive AgentFlow from another agent |

## Problems & Pain Points
**Core problem:** Running multiple AI coding agents in parallel is currently a manual, fragile mess — terminals everywhere, git conflicts between agents, no way to see what any of them actually did.

**Why alternatives fall short:**
- Raw CLIs (Claude Code, Codex, Gemini standalone): one task at a time, no isolation, no cross-agent orchestration
- tmux/shell scripts: no state, no dashboard, no persistence, no approvals
- Generic workflow engines (Airflow, Temporal): built for data/backend pipelines, not LLM agents; no worktree model, no CLI-agent awareness
- "Agent frameworks" (AutoGen, CrewAI, etc.): Python libraries for building agents, not tools for running CLI-based coding agents you already use

**What it costs them:**
- Wasted time babysitting agents instead of batching them
- Dropped work when agents conflict on the same files
- Can't compare agents fairly — no clean side-by-side
- No audit trail of what the agent did, why, and what changed

**Emotional tension:**
- "I feel like I'm supposed to be 10x-ing with these tools but I'm just tab-switching"
- Fear of letting an agent loose on a real branch
- Frustration when a task silently hangs and you don't notice for an hour

## Competitive Landscape
**Direct:** `[?]` very few true direct competitors today. Emerging: Conductor, Agent-Zero-style UIs, Backlog.md-style schedulers, custom internal tools teams build. Most fall short by being single-agent, no worktree isolation, or no MCP.

**Secondary:** Raw CLI usage (Claude Code / Codex / Gemini standalone). Falls short on parallelism, isolation, visibility, and orchestration.

**Indirect:** `[?]` Generic dev workflow tools (Makefiles, shell scripts, Taskfile), CI-based agent runners (GitHub Actions + agent-in-a-box patterns). Falls short because they treat agents as black-box jobs instead of interactive, stateful collaborators.

## Differentiation
**Key differentiators:**
- **Worktree-per-task isolation** — every task runs in its own git worktree, so parallel agents can't clobber each other
- **Multi-agent native** — Claude Code, Codex, Gemini all first-class; pick per task
- **MCP server built-in** — another agent can drive AgentFlow itself (agents-for-agents)
- **Interactive execution** — tasks can pause for approvals, questions, tool permission — not just "run and pray"
- **Self-hosted, local-first, SQLite** — no cloud, no account, no per-seat pricing
- **Visual dashboard + REST + MCP** — same system, three surfaces

**How we do it differently:** Instead of "build your own agent" (frameworks) or "one agent in one terminal" (CLIs), AgentFlow is the *conductor* — treats each CLI as an interchangeable executor and gives you the pipeline, isolation, and observability around it.

**Why that's better:**
- You keep using the CLIs you already trust
- Parallelism without conflicts
- Swap agents per task based on what each is best at
- Programmable via MCP — fits into bigger automations

**Why customers choose us (primary differentiators, all three equally important):**
1. **Git worktree isolation per task** — nothing else treats each agent run as its own worktree
2. **Multi-agent native** — Claude Code + Codex + Gemini in one place, pick per task
3. **MCP server built-in** — AgentFlow itself is programmable, so agents can drive it

Lead with whichever differentiator fits the audience, but these three together are the pitch.

## Objections
| Objection | Response |
|-----------|----------|
| "I can just use Claude Code directly" | Sure, for one task. Try 5 overnight without conflicts — worktree isolation + dashboard is the unlock. |
| "Isn't this just a Makefile with extra steps?" | Makefiles don't handle interactive approvals, agent state, diffs, MCP control, or parallel worktrees. |
| "Why not just use [agent framework]?" | Those are libraries for *building* agents. AgentFlow *runs* the CLI agents you already use, no Python glue. |
| "Self-hosted is a pain" | `npm install`, one command, SQLite. No infra. |
| "Will this get abandoned?" | `[?]` Valid concern — need social proof (stars, contributors, roadmap visibility). |

**Anti-persona:**
- Non-developers / no-code users (this is a CLI-adjacent developer tool)
- Teams that want a fully managed cloud "agent platform" with SSO, audit, compliance — not the right buyer today
- Anyone who isn't already using Claude Code / Codex / Gemini CLI

## Switching Dynamics
**Push:** "My three terminal windows full of agents are a mess. I lost work to a git conflict. I don't know what agent did what."

**Pull:** "One dashboard, parallel worktrees, I can finally kick off a batch and walk away."

**Habit:** Developers are deeply habituated to their single-CLI flow. Muscle memory of `claude -p "..."` in a terminal is strong.

**Anxiety:**
- "Is this going to mess with my git repo?" (answer: worktrees isolate it)
- "Will I have to learn a whole config language?" (answer: pipelines are simple task graphs)
- "Is it stable enough to trust with a real branch?" `[?]` — needs social proof

## Customer Language
**How they describe the problem:** `[?]` need real quotes. Hypotheses:
- "I want to run a bunch of agent tasks overnight"
- "Claude and Codex keep stepping on each other"
- "I need to see what the agent actually did"

**How they describe us:** `[?]` need real quotes.
- Hypothesis: "It's like CI for my AI agents" / "An orchestrator for Claude Code"

**Words to use:** orchestration, pipeline, worktree, agent, parallel, isolated, MCP, dashboard, interactive, self-hosted, local-first, open source

**Words to avoid:** "autonomous AI employee," "AGI," "no-code," "enterprise" (for now), "platform" (overloaded), anything that suggests we replace the developer

**Glossary:**
| Term | Meaning |
|------|---------|
| Pipeline | A named graph of tasks with dependencies |
| Task | One unit of work assigned to one agent |
| Agent | A CLI executor (Claude Code, Codex, Gemini) |
| Worktree | Isolated git checkout where a task runs |
| MCP | Model Context Protocol — how external clients drive AgentFlow |
| Cascade | When a task finishes, its dependents auto-advance |

## Brand Voice
**Tone:** Technical, confident, a little dry. Talks to developers like peers.

**Style:** Direct, concrete, shows code and diagrams early. Skeptical of hype. No marketing fluff.

**Personality:** Practical · Composable · Open · Unflashy · Developer-first

## Proof Points
**Metrics:** None public yet. Do not cite numbers we don't have.

**Customers:** None announceable. This is pre-launch.

**Testimonials:** None. Rely on the founder's own voice and screenshots of the product.

**Value themes:**
| Theme | Proof |
|-------|-------|
| Parallel without conflicts | Git worktree-per-task model |
| One conductor, many agents | Claude Code + Codex + Gemini first-class |
| Programmable | MCP server with 15+ tools, REST API |
| Stays out of your way | Self-hosted, SQLite, Apache-2.0, no account |
| Interactive when it matters | Approvals, questions, tool permissions mid-run |

## Goals
**Current phase: AWARENESS ONLY.** No GitHub link pushed yet, no install CTA, no star asks, no waitlist. The goal right now is simply: make the right developers aware that AgentFlow exists and what it does.

**Business goal:** Build awareness with solo devs / indie hackers / team-of-one builders. Plant the idea that running multi-agent pipelines with worktree isolation is possible and valuable. Convert this awareness into adoption *later* when the product is publicly released.

**Conversion action (this phase):**
- Primary: "remember this exists / follow the founder for the release"
- Secondary: engage with the post (comments, DMs, reshares) so we learn what resonates
- NOT: install, star, sign up, buy — none of those exist yet

**Content implication:** LinkedIn posts and blog posts should be *founder-voice build-in-public*, not product marketing. Show the idea, the problem, the approach. No fake CTAs. No "download now." The subtext is "I'm building this, here's why, watch this space."

**Current metrics:** No public metrics to cite yet. Lean on the *idea* and the *demo* (screenshots), not social proof.
