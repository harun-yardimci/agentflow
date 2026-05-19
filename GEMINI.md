# AgentFlow — Project Context for Gemini CLI

## What is this project?

AgentFlow is an AI agent orchestration platform. It runs multi-step pipelines where each task is executed by a CLI coding agent (Claude Code, Codex CLI, or Gemini CLI). It has a React dashboard for monitoring and an MCP server for programmatic control.

## Commands

- `npm run dev` — Start frontend + backend with hot reload (port 3100)
- `npm test` — Run tests with vitest
- `npm run lint` — ESLint
- `npm run build` — Build frontend

## Tech Stack

- Frontend: React 19, TypeScript (strict mode), Tailwind CSS v4, Vite 7
- Backend: Express 5, better-sqlite3, Zod validation
- MCP: @modelcontextprotocol/sdk (stdio + SSE)
- Database: SQLite (`data/agentflow.db`, gitignored)

## Structure

- `src/` — React frontend (components, context, lib, types)
- `server/` — Express backend (db, engine, executor, routes, services, safety)
- `mcp/` — MCP server
- `bin/` — CLI entry point

## Important Rules

- TypeScript strict mode, no `any` — use `unknown` + type guards
- ESM imports only, no CommonJS `require()`
- 2-space indent, single quotes in TypeScript
- Functional React components only
- Tailwind utility-first CSS, use `cn()` for conditional classes
- Commit format: `type(scope): description`
- Port 3100 is the default backend port
- When spawning CLI processes, always close stdin (`proc.stdin.end()`)
- No geometric unicode characters in UI (IBM Plex Mono doesn't render them)
