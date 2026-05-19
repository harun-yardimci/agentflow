# Repo Transfer And Publish Checklist

This checklist is for moving AgentFlow into a new repository and preparing it
for a first public npm release without publishing yet.

## 1. Create the new repository

- Create the new GitHub repository
- Push the current branch history into that repository
- Confirm the default branch name you want to keep using
- Re-check branch protection, required checks, and maintainer access

## 2. Update repository metadata

These values still point to the current repository and should be updated after
the move:

- `package.json > repository.url`
- `package.json > homepage`
- `package.json > bugs.url`
- `README.md` clone URL examples
- Any GitHub links inside `CONTRIBUTING.md`, `SECURITY.md`, and issue templates

Recommended verification after the update:

```bash
node -p "const pkg=require('./package.json'); ({repository: pkg.repository, homepage: pkg.homepage, bugs: pkg.bugs})"
```

## 3. Confirm package naming

Before publishing, decide:

- Keep `agentflow` as the npm package name, or use a scope such as `@your-scope/agentflow`
- Keep the binary command as `agentflow`
- Whether the GitHub repo name and npm package name should match exactly

If the package name changes, update:

- `package.json > name`
- install examples in `README.md`
- MCP examples in `README.md` and `bin/cli.js` help text

## 4. Public repo sanity pass

- Add a real screenshot or GIF to the README hero section
- Confirm no personal, machine-local, or editor-specific files are tracked
- Re-read `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, and `SUPPORT.md`
- Confirm Apache-2.0 is the intended license for the new repo

Useful checks:

```bash
git status --short
git ls-files | rg '(^|/)(\\.DS_Store|\\.idea|\\.vscode|\\.claude|\\.playwright-mcp)'
```

## 5. npm release readiness

Before the first publish candidate, run:

```bash
npm run lint
npm test
npm run build
npm pack --dry-run --json
```

Review the tarball output for:

- `bin/cli.js`
- `dist/`
- `dist-server/`
- `LICENSE`
- `NOTICE`
- no test files
- no local logs
- no editor config files

## 6. Local smoke checks

Run these from the source checkout:

```bash
node bin/cli.js --help
node bin/cli.js --version
AGENTFLOW_DB_PATH=/tmp/agentflow-smoke.db node bin/cli.js --port 3210
```

Expected result:

- help and version commands succeed
- app initializes with a writable DB path
- if your environment blocks port binding, test on a machine without sandbox

## 7. npm account and package ownership

Before publishing, confirm:

- npm account is logged in
- you own the target package name
- 2FA requirements are understood
- org or scope permissions are configured if publishing under a team

Useful commands:

```bash
npm whoami
npm view agentflow name version
```

## 8. First release checklist

- Decide initial public version number
- Tag the release commit after the repo move
- Publish from the new repository only
- Install the package in a clean temp directory
- Verify `npx <package-name>` works from outside the repo

Clean install smoke test:

```bash
mkdir -p /tmp/agentflow-publish-smoke
cd /tmp/agentflow-publish-smoke
npm init -y
npm install <your-package-name>
npx <your-package-name> --help
```

## 9. Post-move follow-up

- Update badges once the new repo is live
- Enable GitHub Issues and Discussions if you want community support there
- Add release notes for the first public version
- Re-check CI on the new repository after the first push

## Current state snapshot

At the time this checklist was created:

- runtime packaging is prepared with `dist/` and `dist-server/`
- breakdown is CLI-only and no API key is required
- default DB path is `~/.agentflow/agentflow.db`, with `AGENTFLOW_DB_PATH`
  available as an override
- lint, tests, build, and `npm pack --dry-run` are passing locally
