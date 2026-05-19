# AgentFlow — Project Context for Codex CLI

## Overview

AgentFlow is an AI agent orchestration platform. It runs multi-step pipelines where each task is executed by a CLI coding agent (Claude Code, Codex CLI, or Gemini CLI). It has a React dashboard and an MCP server.

## Commands

- `npm run dev` — Start frontend + backend with hot reload (port 3100)
- `npm test` — Run tests with vitest
- `npm run lint` — ESLint
- `npm run build` — Build frontend

## Tech Stack

- Frontend: React 19, TypeScript (strict), Tailwind CSS v4, Vite 7
- Backend: Express 5, better-sqlite3, Zod
- MCP: @modelcontextprotocol/sdk
- DB: SQLite in `data/agentflow.db`

## Structure

- `src/` — React frontend
- `server/` — Express backend (db, engine, executor, routes, services, safety)
- `mcp/` — MCP server
- `bin/` — CLI entry point

## Rules

- TypeScript strict, no `any`
- ESM only, no CommonJS
- 2-space indent, single quotes
- Functional React components
- Tailwind utility classes, `cn()` for conditional
- Commits: `type(scope): description`
- Default port: 3100
- Always close stdin when spawning CLI processes
