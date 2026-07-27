# Changelog

All notable changes to AgentFlow are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and AgentFlow adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.1] — 2026-07-28

### Changed

- **Claude Opus 5 added; Opus tiers shifted.** `claude:opus` now runs
  `claude-opus-5`, and the previous version (4.8) moves down to the
  `claude:opus-legacy` tier so it stays selectable. Existing databases are
  migrated in place; the flags are only rewritten when they still hold the
  outgoing value, so custom picks are preserved.
- **Claude Fable 5 re-enabled.** The provider-side outage is over, so Fable is
  selectable again. Databases disabled by the outage migration are restored
  once; Fable is not forced back on if it is later disabled from the UI.

## [1.3.0] — 2026-07-10

### Changed

- **Codex model catalog refreshed.** The `codex-1` / `o3` / `o4-mini` tiers are
  replaced by the GPT 5.6 variants (Sol, Terra, Luna) plus GPT 5.5, 5.4, and
  5.4 Mini. The 5.6 tiers are Codex product tiers rather than public API SKUs,
  so they carry no token price. Existing tasks and agents pointing at the
  retired ids are migrated to `codex:gpt-5.6-sol` / `codex:gpt-5.6-luna`.
- **App icon and notifications.** The placeholder favicon is replaced by the
  AgentFlow mark, and native notifications now point at a real `icon-192.png`
  instead of a `/favicon.ico` that never existed.

## [1.2.1] — 2026-06-23

### Added

- **Auth/session-expiry handling for CLI agents.** When a provider CLI
  (Claude, Codex, or Gemini) returns an authentication or session-expiry error
  (401, expired token, "please run /login"), the task no longer silently burns
  its retries and fails along with its dependents. Such failures are now parked
  in a new `auth_required` status without consuming a retry: the task surfaces
  as blocked, emits a `task:auth_required` event with an actionable
  Telegram/Slack notification, and waits for the user to re-login in their
  terminal and manually retry. Detection uses conservative, failure-framed
  patterns so ordinary agent output is not misclassified.

## [1.2.0] — 2026-06-15

### Added

- **Routines — recurring scheduled tasks per pipeline.** Each pipeline can now
  define routines that spawn a fresh task on a preset schedule (hourly, daily,
  or weekly) interpreted in the server's local timezone. Triggers reuse the
  existing task-creation, worker-pool, and approval flow — `auto` routines run
  immediately, `manual` routines wait for approval and skip a fire while a prior
  run is still pending. Misconfigured routines (deleted agent) are skipped
  instead of spawning failing tasks, and the schedule is advanced atomically
  with task creation so a partial failure can't re-fire the routine. Managed
  from a Routines drawer on the pipeline header, over REST
  (`/api/pipelines/:id/routines`, `…/routines/:id/run`), and via MCP tools
  (`list_routines`, `create_routine`, `update_routine`, `delete_routine`,
  `run_routine`).

### Changed

- **Claude Fable 5 temporarily disabled.** The model stays visible in the
  selector but is not selectable while a provider-side outage persists; it will
  be re-enabled when service is restored.

## [1.1.2] — 2026-06-11

### Security

- **Attachment path traversal → arbitrary file write.** An uploaded file's
  original name was used unsanitized as a path when copying into a task's
  `.attachments/` directory, so a name like `../../.git/hooks/pre-commit`
  could write outside the worktree (a route to code execution). Names are now
  sanitized at save, copy, and reference-formatting boundaries.
- **Git command injection.** Branch names and refs (settable via the API,
  pipeline base branch, and task dependencies) were interpolated into shell
  strings passed to `execSync`. All git/docker invocations reachable from the
  API now use `execFileSync` with argv arrays — no shell, no injection.
- **Network exposure.** The server bound to all interfaces with wildcard CORS
  and no auth. It now binds `127.0.0.1` by default (set `AGENTFLOW_HOST` to
  opt into LAN access) and restricts CORS to loopback origins, closing the
  CSRF-to-task-execution chain.
- **Removed** the unused `GET /api/settings/decrypt/:key` endpoint, which
  returned plaintext secrets over HTTP — an unauthenticated exfiltration
  vector with no callers (executors read secrets directly via the crypto lib).

### Fixed

- MCP server's HTTP client now targets `127.0.0.1` (not `localhost`) to match
  the backend's loopback bind, avoiding an IPv6-resolution miss on some hosts.

## [1.0.3] — 2026-05-19

### Added

- Real AgentFlow favicon (`public/favicon.svg`) — orange dot on dark
  surface, linked from `index.html`. Tabs and bookmarks now show the
  brand icon instead of the default Vite logo.

### Fixed

- `/favicon.ico` requests redirect to `/favicon.svg` instead of 404,
  killing the noisy log line every browser produced on first paint.
- `/.well-known/appspecific/com.chrome.devtools.json` returns `{}` so
  Chrome DevTools workspace probes stop logging 404s when devtools is
  open against a local AgentFlow.

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

[1.0.3]: https://github.com/harun-yardimci/agentflow/releases/tag/v1.0.3
[1.0.2]: https://github.com/harun-yardimci/agentflow/releases/tag/v1.0.2
[1.0.1]: https://github.com/harun-yardimci/agentflow/releases/tag/v1.0.1
[1.0.0]: https://github.com/harun-yardimci/agentflow/releases/tag/v1.0.0
