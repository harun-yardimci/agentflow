# Changelog

All notable changes to AgentFlow are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and AgentFlow adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] — 2026-05-19

### Fixed

- Server no longer prints a multi-line stack trace ("Unhandled error:
  NotFoundError: Not Found") when something — usually a browser tab cached
  from a previous run, macOS Spotlight, or a link-preview tool — requests
  a path that hits the SPA fallback with a missing file. The error handler
  now logs a single `[404] METHOD /path` warning and returns the right
  status code; 5xx errors keep their stacks.
- SPA fallback registers a `sendFile` callback so an ENOENT inside
  `send` is routed through the error handler instead of leaking out.

## [1.0.1] — 2026-05-19

### Fixed

- Fresh installs no longer ship with two leftover demo pipelines ("SaaS
  Landing Page" and "Blog Post: AI in Fraud") in the dashboard. The starter
  crew of agents is still seeded on first run; the pipeline board now
  opens empty.

## [1.0.0] — 2026-05-19

First public release.

### Highlights

- Pipeline-based orchestration of Claude Code, Codex, and Gemini CLI tasks
  from a single visual dashboard.
- Per-task git worktree isolation so multiple agents can work in parallel on
  the same repository without colliding.
- Built-in MCP server (stdio + SSE) so other agents and clients can drive
  AgentFlow programmatically.
- SQLite-backed pipeline, task, attachment, and context storage. Default DB
  path is `~/.agentflow/agentflow.db`, override via `AGENTFLOW_DB_PATH`.
- Interactive execution: pause for approvals, follow-up questions, and tool
  permission requests over a control protocol.
- Conditional branching, auto-retry, and skip semantics for task graphs.
- Shared pipeline context with automatic compaction for large context
  packets.
- Auto-resume of Claude tasks after rate-limit windows.
- Claude, Codex, and Gemini CLI templates with sandbox-aware flags and
  attachment support.
- File attachment pipeline end-to-end: per-task, per-pipeline, planner
  integration, and CLI executor wiring.
- Task drawer with structured agent timeline, conversation threading,
  attachments, and execution-first layout.
- Telegram and Slack notifications.
- Token cost analytics design and worktree cleanup for archived tasks.

### Runtime

- Server: Express 5 + better-sqlite3 + Zod validation.
- Worker pool with `max_parallel_tasks` enforcement, queueing, and failure
  hooks.
- Output parser, control protocol, and CLI template layer covering the
  three supported CLIs.
- Codex CLI: argument-injection hardening, sandbox flag alignment,
  current-lineup model defaults, session resume disabled (requires TTY).
- Claude CLI: rate-limit detector and auto-resume.
- Gemini CLI: generic file-attachment flag support.
- Conflict-fixer worktrees with dedupe by base/branch SHA signature.

### Frontend

- React 19 + TypeScript strict + Tailwind v4 + Vite 7.
- Visual pipeline board with stages, drag-and-drop task cards, and live
  status pills.
- Task drawer with inline attachments, retry/restart, parsed output, and
  auto-scroll on task open / session change.
- Manual task creation form with auto-slug generation.
- Image attachment previews in a modal.
- Sidebar pipeline filter and task search.

### Packaging & distribution

- `bin/cli.js` boots the runtime from the published tarball.
- `package.json > files` ships only `bin/`, `dist/`, `dist-server/`, and
  `NOTICE`.
- Apache-2.0 license, NOTICE file, code of conduct, contributing guide,
  security policy, support guide, and issue + PR templates.
- GitHub Actions CI runs lint, typecheck, tests, build, and
  `npm pack --dry-run` on Node 20 and Node 22.
- Default DB path resolves to `~/.agentflow/agentflow.db` with
  `AGENTFLOW_DB_PATH` override; runtime paths helper isolates per-user
  state.

### Known limitations

- `npm publish` has not happened yet — install from source until v1.0.0
  lands on the registry.
- Coverage HTML report is not bundled — use `npm run test:coverage`
  locally.

[1.0.2]: https://github.com/harun-yardimci/agentflow/releases/tag/v1.0.2
[1.0.1]: https://github.com/harun-yardimci/agentflow/releases/tag/v1.0.1
[1.0.0]: https://github.com/harun-yardimci/agentflow/releases/tag/v1.0.0
