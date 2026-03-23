# Contributing to PawHub

Thank you for your interest in contributing Paws to OpenVole! PawHub is the official collection of Paws (plugins) for the OpenVole agent framework.

For contributing to the core framework, see the [OpenVole CONTRIBUTING.md](https://github.com/openvole/openvole/blob/main/CONTRIBUTING.md).

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/<your-username>/pawhub.git`
3. Add upstream remote: `git remote add upstream https://github.com/openvole/pawhub.git`
4. Install dependencies: `pnpm install`
5. Build all paws: `pnpm -r build`

Before starting work, sync your fork with upstream:

```bash
git fetch upstream
git checkout main
git merge upstream/main
```

## Creating a New Paw

### Scaffold

Use the CLI to scaffold a new paw:

```bash
npx openvole paw create <name>
```

This generates the directory structure under `paws/paw-<name>/` with all required files:

```
paws/paw-<name>/
  src/
    index.ts        — Entry point: import { definePaw } from '@openvole/paw-sdk'; export default definePaw(paw)
    paw.ts          — PawDefinition with tools, onLoad, onUnload
  vole-paw.json     — Manifest (name, tools, permissions)
  package.json
  tsconfig.json
  tsup.config.ts
  README.md
```

### Required Files

**`vole-paw.json`** — Manifest declaring what the paw provides and needs:

```json
{
  "name": "@openvole/paw-<name>",
  "version": "0.1.0",
  "description": "Short description of what the paw does",
  "entry": "./dist/index.js",
  "brain": false,
  "type": "tool",
  "inProcess": false,
  "transport": "ipc",
  "tools": [
    { "name": "tool_name", "description": "What the tool does" }
  ],
  "permissions": {
    "network": [],
    "listen": [],
    "filesystem": [],
    "env": ["REQUIRED_ENV_VAR"],
    "childProcess": false
  }
}
```

**`tsup.config.ts`**:

```typescript
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node20',
  splitting: false,
})
```

**`tsconfig.json`**:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

### Paw Types

| Type | Description | Examples |
|------|-------------|---------|
| **brain** | LLM provider — implements think() | paw-ollama, paw-claude, paw-openai |
| **channel** | Messaging platform — receives/sends messages | paw-telegram, paw-slack, paw-discord |
| **tool** | Provides tools the Brain can call | paw-browser, paw-shell, paw-filesystem |
| **infrastructure** | Internal services — memory, sessions, compaction | paw-memory, paw-session, paw-compact |

Set the `type` field in your `vole-paw.json` manifest to one of these values.

### Patterns to Follow

- **Tool paws**: Look at `paw-filesystem` or `paw-github` for reference
- **Channel paws**: Look at `paw-telegram` for the IPC transport, pendingTasks, and bus event pattern
- **Brain paws**: Look at `paw-ollama` for the think() interface and BRAIN.md scaffolding

## Updating an Existing Paw

Bug fixes and improvements to existing paws are welcome:

- Read the paw's existing code and understand its patterns before making changes
- Don't change the tool names or parameter schemas without discussion — it breaks existing users
- Maintain graceful degradation behavior
- Update the README if your change affects configuration or usage
- Don't bump the version in `package.json` — maintainers handle versioning

## Development Standards

### Code
- TypeScript strict mode, ESM only
- Use Zod for tool parameter schemas
- Use `@openvole/paw-sdk` as a peer dependency
- No unnecessary external dependencies — prefer built-in Node APIs (fetch, fs, crypto)
- Biome for formatting and linting

### Graceful Degradation
- **Never crash on missing env vars** — log a warning and stay alive
- Tools should return error messages if called without required configuration
- Follow the pattern: check env vars in `onLoad`, log warning if missing, return early

```typescript
async onLoad() {
  if (!process.env.MY_API_KEY) {
    console.log('[paw-name] MY_API_KEY not set — paw will not function')
    return
  }
  // ... initialize
}
```

### Manifest Permissions
- Declare **all** permissions the paw needs in `vole-paw.json`
- `network`: domains the paw connects to
- `listen`: ports the paw binds to (channel paws with webhooks)
- `filesystem`: directories the paw reads/writes outside `.openvole/`
- `env`: environment variables the paw uses
- `childProcess`: set to `true` only if the paw spawns external processes

### Commits
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`, `docs:`
- Keep commits focused

### Pull Requests
- One paw per PR for new paws
- Include a `README.md` with: install instructions, config example, env vars table, tool descriptions
- Describe what the paw does and why it's useful
- Make sure `pnpm --filter @openvole/paw-<name> build` passes

## Checklist for New Paws

- [ ] `vole-paw.json` with accurate tool descriptions and permissions
- [ ] `package.json` with `@openvole/paw-sdk` as peer dependency
- [ ] `tsup.config.ts` and `tsconfig.json`
- [ ] `README.md` with install, config, env vars, and tool docs
- [ ] Graceful degradation on missing env vars
- [ ] Tools use Zod schemas for parameter validation
- [ ] Builds successfully: `pnpm --filter @openvole/paw-<name> build`
- [ ] No hardcoded paths — use `process.cwd()` for project root
- [ ] Data written to `.openvole/paws/<name>/` (not project root)

## Skills

PawHub is for Paws only. Skills (SKILL.md files) are not hosted here. To share a skill:

- **ClawHub**: Submit to [ClawHub](https://clawhub.ai) for community discovery
- **Local**: Place in `.openvole/skills/<name>/SKILL.md` for personal use

## What NOT to Submit

- Paws with hardcoded API keys or credentials
- Paws that write outside `.openvole/paws/<name>/` without declaring filesystem permissions
- Paws with unnecessary `childProcess: true`
- Paws without a README

## Security

If you discover a security vulnerability in any paw, please report it responsibly:
- Email: security@openvole.dev
- Do **not** open a public issue for security vulnerabilities

## Maintainers

PawHub is maintained by the [OpenVole team](https://github.com/openvole). Maintainers review PRs, handle versioning, and publish to npm.

If you're interested in becoming a maintainer, demonstrate consistent contributions and reach out via GitHub Discussions.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
