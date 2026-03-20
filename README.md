# PawHub

**Official Paws for [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Paws

| Package | Description | npm |
|---------|-------------|-----|
| `@openvole/paw-ollama` | Brain Paw — local LLM via Ollama | [![npm](https://img.shields.io/npm/v/@openvole/paw-ollama)](https://www.npmjs.com/package/@openvole/paw-ollama) |
| `@openvole/paw-memory` | Persistent memory with source isolation | [![npm](https://img.shields.io/npm/v/@openvole/paw-memory)](https://www.npmjs.com/package/@openvole/paw-memory) |
| `@openvole/paw-session` | Session/conversation management | [![npm](https://img.shields.io/npm/v/@openvole/paw-session)](https://www.npmjs.com/package/@openvole/paw-session) |
| `@openvole/paw-compact` | Context compaction (in-process) | [![npm](https://img.shields.io/npm/v/@openvole/paw-compact)](https://www.npmjs.com/package/@openvole/paw-compact) |
| `@openvole/paw-dashboard` | Real-time web dashboard | [![npm](https://img.shields.io/npm/v/@openvole/paw-dashboard)](https://www.npmjs.com/package/@openvole/paw-dashboard) |
| `@openvole/paw-telegram` | Telegram bot channel | [![npm](https://img.shields.io/npm/v/@openvole/paw-telegram)](https://www.npmjs.com/package/@openvole/paw-telegram) |
| `@openvole/paw-browser` | Browser automation (Puppeteer) | [![npm](https://img.shields.io/npm/v/@openvole/paw-browser)](https://www.npmjs.com/package/@openvole/paw-browser) |
| `@openvole/paw-mcp` | MCP server bridge (1000+ tools) | [![npm](https://img.shields.io/npm/v/@openvole/paw-mcp)](https://www.npmjs.com/package/@openvole/paw-mcp) |
| `@openvole/paw-shell` | Shell command execution | [![npm](https://img.shields.io/npm/v/@openvole/paw-shell)](https://www.npmjs.com/package/@openvole/paw-shell) |
| `@openvole/paw-filesystem` | File system operations | [![npm](https://img.shields.io/npm/v/@openvole/paw-filesystem)](https://www.npmjs.com/package/@openvole/paw-filesystem) |

## Install

```bash
npm install @openvole/paw-ollama @openvole/paw-memory @openvole/paw-dashboard
```

Then add to `vole.config.json`:

```json
{
  "paws": [
    { "name": "@openvole/paw-ollama", "allow": { "network": ["127.0.0.1"], "env": ["OLLAMA_HOST", "OLLAMA_MODEL"] } },
    { "name": "@openvole/paw-memory", "allow": { "env": ["VOLE_MEMORY_DIR"] } },
    { "name": "@openvole/paw-dashboard", "allow": { "listen": [3001] } }
  ]
}
```

## Building a Paw

A Paw is a Node.js package that provides tools to the agent. See the [Paw Development Guide](https://github.com/openvole/openvole) in the main repo.

```typescript
import { definePaw, z } from '@openvole/paw-sdk'

export default definePaw({
  name: 'my-paw',
  version: '0.1.0',
  description: 'My custom paw',
  tools: [
    {
      name: 'my_tool',
      description: 'Does something useful',
      parameters: z.object({ input: z.string() }),
      execute: async ({ input }) => ({ result: input.toUpperCase() }),
    },
  ],
})
```

## License

[MIT](LICENSE)
