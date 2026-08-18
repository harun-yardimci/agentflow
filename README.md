# AgentFlow

[![npm version](https://img.shields.io/npm/v/@argustech/agentflow.svg?label=npm&color=D97706)](https://www.npmjs.com/package/@argustech/agentflow)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![CI](https://github.com/harun-yardimci/agentflow/actions/workflows/ci.yml/badge.svg)](https://github.com/harun-yardimci/agentflow/actions/workflows/ci.yml)
[![Node.js Version](https://img.shields.io/node/v/@argustech/agentflow.svg)](https://nodejs.org)

Pipeline-based orchestration for AI coding agents. Build multi-step task
graphs, run them with Claude Code, Codex, Gemini, or Antigravity CLI, and monitor the
whole workflow from a visual dashboard or over MCP.

![AgentFlow pipeline board — five stages running across Claude, Codex, and Gemini side-by-side, each task in its own git worktree](docs/images/hero-pipeline-board.png)

## Run it

```bash
npx @argustech/agentflow
```

Open [http://localhost:3100](http://localhost:3100). No install, no config — `npx` pulls the package, builds the runtime, starts the dashboard on port 3100.

You'll also need at least one supported AI CLI on your machine (see [Supported Agent CLIs](#supported-agent-clis) below).

## Highlights

- Multi-agent execution for Claude Code, Codex CLI, Gemini CLI, and Antigravity CLI (`agy`)
- Real-time dashboard for pipeline state, logs, outputs, and git diffs
- MCP server for programmatic pipeline control from compatible clients
- Git worktree isolation so tasks can run without stepping on each other
- Interactive execution for approvals, follow-up questions, and tool access
- Shared pipeline context with built-in persistence on SQLite
- Optional Slack and Telegram notifications

## Install

### Requirements

- Node.js `^20.19.0` or `>=22.12.0`
- Git
- At least one supported AI CLI installed locally

### From npm (recommended)

```bash
# One-shot run, no install (slowest start, no global pollution)
npx @argustech/agentflow

# Global install — provides the `agentflow` command on PATH
npm install -g @argustech/agentflow
agentflow                  # start the dashboard
agentflow --help           # see all commands
```

A specific version pin:

```bash
npx @argustech/agentflow@1.0.0
```

### From source

```bash
git clone https://github.com/harun-yardimci/agentflow.git
cd agentflow
npm install
npm run dev
```

This is the right path if you want to hack on AgentFlow itself, run the
unbundled dev server with hot reload, or contribute back.

### Storage

AgentFlow stores its shared SQLite database at `~/.agentflow/agentflow.db`
by default. Override with `AGENTFLOW_DB_PATH`. Worktrees, attachments, and
uploads live under the same directory.

## Supported Agent CLIs

Install at least one of these tools before running pipelines:

- Claude Code: `npm install -g @anthropic-ai/claude-code`
- Codex CLI: `npm install -g @openai/codex`
- Gemini CLI: `npm install -g @google/gemini-cli`
- Antigravity CLI (`agy`): Google's successor to the Gemini CLI — see [antigravity.google](https://antigravity.google). The Gemini CLI stops serving free/Google One tiers on June 18, 2026; `agy` is the migration path.

> **Antigravity note:** `agy` emits plain-text output only (no token/cost metrics). Its `--model` values include a reasoning-effort suffix; AgentFlow presents one entry per Gemini family and executes the highest-effort variant (for example, `gemini-3.7-flash-high`).

## Development Commands

Run from a source checkout (`git clone` + `npm install`). End users of the
published package don't need any of these — they just `npx @argustech/agentflow`.

```bash
npm run dev          # frontend + backend with hot reload
npm run dev:fe       # frontend only
npm run dev:be       # backend only
npm run lint         # eslint + typecheck
npm run typecheck    # typecheck only
npm test             # vitest run
npm run build        # production bundle
npm run mcp          # MCP server over stdio
npm start            # production server (from source)
```

## MCP Usage

AgentFlow exposes an MCP server so compatible assistants can create and manage
pipelines programmatically.

Important runtime notes:

- `AGENTFLOW_PORT` is the AgentFlow app port, not the internal dev API port
- In development, the UI runs on `AGENTFLOW_PORT` and the backend on
  `AGENTFLOW_PORT + 1`
- By default, `npm run dev`, `npm start`, and `npm run mcp` share the same DB
  unless `AGENTFLOW_DB_PATH` is overridden

### Claude Code

```bash
# Globally installed
claude mcp add agentflow --env AGENTFLOW_PORT=3100 -- agentflow mcp

# Or via npx, no install needed
claude mcp add agentflow --env AGENTFLOW_PORT=3100 -- npx @argustech/agentflow mcp
```

### Claude Desktop / Cursor

Add this to your MCP config file:

```json
{
  "mcpServers": {
    "agentflow": {
      "command": "npx",
      "args": ["@argustech/agentflow", "mcp"],
      "env": {
        "AGENTFLOW_PORT": "3100"
      }
    }
  }
}
```

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `list_pipelines` | List all pipelines with tasks and logs |
| `get_pipeline` | Get pipeline details by ID |
| `create_pipeline` | Create a new pipeline with optional tasks |
| `delete_pipeline` | Delete a pipeline |
| `add_task` | Add a task to a pipeline |
| `delete_task` | Delete a task |
| `approve_task` | Approve a pending task |
| `reject_task` | Reject a task |
| `move_task` | Move a task to a different status |
| `complete_task` | Complete a task and cascade to dependents |
| `run_pipeline` | Start pipeline execution |
| `list_agents` | List available agents |
| `update_agent` | Update agent configuration |
| `get_logs` | Get pipeline activity logs |
| `get_pipeline_context` | Read shared pipeline context |
| `set_pipeline_context` | Write to shared pipeline context |
| `list_pending_questions` | List pending interactive questions |
| `respond_to_question` | Respond to an interactive question |

## Architecture

```text
+------------------+     +-----------------+     +------------------+
|   React Frontend | --> | Express Backend | <-- |   MCP Server     |
|   (Vite + TW v4) |     | (REST API)      |     | (stdio / SSE)    |
+------------------+     +--------+--------+     +--------+---------+
                                  |                        |
                           +------+------+                 |
                           |   SQLite    | <---------------+
                           +------+------+
                                  |
                    +-------------+-------------+
                    |             |             |
              +-----------+ +-----------+ +-----------+
              | Claude CLI| | Codex CLI | | Gemini CLI|
              +-----------+ +-----------+ +-----------+
```

- Frontend: React 19, TypeScript strict mode, Tailwind CSS v4, Vite 7
- Backend: Express 5, better-sqlite3, Zod validation
- MCP: `@modelcontextprotocol/sdk` with stdio and SSE transports
- Execution: worker pool that spawns CLI processes inside isolated git worktrees

## Configuration

Environment variables are documented in [.env.example](.env.example).

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | AgentFlow app port |
| `AGENTFLOW_PORT` | `3100` | App port hint for MCP clients |
| `AGENTFLOW_DB_PATH` | `~/.agentflow/agentflow.db` | Override the shared SQLite DB path |
| `TELEGRAM_BOT_TOKEN` | — | Telegram notifications |
| `TELEGRAM_CHAT_ID` | — | Telegram destination chat |
| `SLACK_WEBHOOK_URL` | — | Slack webhook notifications |
| `SLACK_BOT_TOKEN` | — | Slack bot notifications |
| `SLACK_CHANNEL` | — | Slack channel target |

## Project Structure

```text
src/             Frontend (React components, hooks, context)
server/          Backend (Express routes, services, execution engine)
  db/            SQLite schema, connection, seed
  engine/        Task runner, worker pool, worktree manager
  executor/      CLI executor, templates, output parser
  routes/        REST API endpoints
  services/      Business logic
  safety/        Output safety checks
mcp/             MCP server
bin/             CLI entry point
tests/           Unit and integration tests
```

## Community

- Contributing guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Security policy: [SECURITY.md](SECURITY.md)
- Support guidance: [SUPPORT.md](SUPPORT.md)
- Transfer and publish checklist: [docs/release/repo-transfer-and-publish-checklist.md](docs/release/repo-transfer-and-publish-checklist.md)

## License

AgentFlow core is licensed under [Apache-2.0](LICENSE).
