# Contributing to AgentFlow

Thanks for helping improve AgentFlow. This project is still evolving quickly, so
small, well-scoped pull requests are the easiest way to contribute.

## Before you start

- Read the [README](README.md) for the current product and setup overview
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md)
- For security issues, use the private flow in [SECURITY.md](SECURITY.md)

## Local setup

### Requirements

- Node.js `^20.19.0` or `>=22.12.0`
- npm
- Git
- At least one supported AI CLI if you want to run real pipelines locally

### Install

```bash
git clone https://github.com/harun-yardimci/agentflow.git
cd agentflow
npm install
cp .env.example .env
```

### Run the app

```bash
npm run dev
```

Open [http://localhost:3100](http://localhost:3100).

## Quality checks

Run these before opening a pull request:

```bash
npm run lint
npm test
npm run build
```

`npm run lint` includes both ESLint and TypeScript typechecking.

## Pull request guidelines

- Prefer focused PRs over large mixed changes
- Add or update tests when behavior changes
- Update docs when setup, workflows, or user-facing behavior changes
- Keep commits descriptive and easy to review
- If a change is large, open an issue first so we can align on direction

## Commit style

This repo prefers conventional-style commit messages:

```text
type(scope): short description
```

Examples:

- `feat(mcp): add pipeline question response tool`
- `fix(worktree): avoid deleting dirty merged branches`
- `docs(readme): clarify source install flow`

## What to include in a PR

- Problem statement
- Approach taken
- Testing performed
- Screenshots or recordings for UI changes when helpful

## Contribution licensing

By submitting a contribution, you agree that your work will be licensed under
the Apache License 2.0 that applies to this repository.
