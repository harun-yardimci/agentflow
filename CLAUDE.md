# AgentFlow

AI agent orchestration platform — pipeline-based task runner for Claude, Codex, and Gemini CLI agents.

## Quick Reference

```bash
npm run dev          # Start frontend + backend (hot reload)
npm test             # Run tests (vitest)
npm run lint         # ESLint
npm run build        # Build frontend (vite)
npm run mcp          # Start MCP server (stdio)
```

Backend runs on port 3100. Frontend proxies `/api/*` and `/mcp/*` to backend via Vite config.

## Architecture

- **Frontend**: React 19 + TypeScript strict + Tailwind v4 + Vite 7 (`src/`)
- **Backend**: Express 5 + better-sqlite3 + Zod validation (`server/`)
- **MCP Server**: @modelcontextprotocol/sdk, stdio + SSE transports (`mcp/`)
- **Database**: SQLite in `data/agentflow.db` (gitignored)
- **Execution**: Worker pool spawns CLI processes (`server/engine/`)

## Project Structure

```
src/                 React frontend
  components/        UI components (pipelines/, agents/, settings/, shared/)
  context/           React context providers
  lib/               API client, utilities
  types/             TypeScript interfaces
server/              Express backend
  db/                Schema, connection, seed, migrations
  engine/            Task runner, worker pool, worktree manager, event bus
  executor/          CLI executor, templates (claude/codex/gemini), output parser
  routes/            REST API endpoints
  services/          Business logic (pipeline, task, context, breakdown)
  safety/            Output safety rules
  notifications/     Telegram, Slack integrations
mcp/                 MCP server (server.ts + index.ts entry)
bin/                 CLI entry point (cli.js)
```

## Key Design Decisions

- **Task execution**: CLI agents are spawned as child processes. stdin MUST be closed (`proc.stdin.end()`) even when `useStdin=false` — Claude CLI hangs on open stdin pipes.
- **Git isolation**: Each task runs in its own git worktree to prevent conflicts. Worktrees are created/cleaned up by `server/engine/worktree-manager.ts`.
- **Cascade logic**: When a task completes, its dependents are checked. `auto` approval tasks go straight to `running`, `manual` tasks go to `awaiting_approval`. This is atomic in a SQLite transaction.
- **Output chaining**: Task output is auto-saved to `pipeline_ctx` table so downstream tasks can reference it.
- **Interactive mode**: Tasks can pause for questions or tool approval via a control protocol (`server/executor/control-protocol.ts`).
- **Font**: IBM Plex Mono — no geometric unicode characters (they don't render). Use CSS dots, SVG, or HTML entities instead.
- **Dark theme**: surface-0 (#080808) to surface-4, accent-orange (#D97706).

## CLI Templates

Defined in `server/executor/cli-templates.ts`:
- `claude -p <prompt> --dangerously-skip-permissions --output-format json`
- `gemini -p <prompt> --yolo`
- `codex exec <prompt> --full-auto`

## Environment

- `PORT` — Server port (default: 3100)
- `ANTHROPIC_API_KEY` — For task breakdown feature (optional, can be set in UI settings)

## Conventions

- TypeScript strict mode, no `any`
- ESM imports (`import/export`), no CommonJS
- 2-space indent, single quotes
- Functional React components, hooks only
- Tailwind utility classes, `cn()` for conditional
- Commit format: `type(scope): description`
