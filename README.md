<p align="center">
  <img src="https://raw.githubusercontent.com/openvole/pawhub/main/assets/paw.png" alt="PawHub" width="150">
</p>

<h1 align="center">PawHub</h1>

<p align="center">
  <strong>Official Paws for <a href="https://github.com/openvole/openvole">OpenVole</a> — the microkernel AI agent framework.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
</p>

## Paws

### Brain Paws (5)

| Package | Description | npm |
|---------|-------------|-----|
| `@openvole/paw-ollama` | Local LLM via Ollama | [![npm](https://img.shields.io/npm/v/@openvole/paw-ollama)](https://www.npmjs.com/package/@openvole/paw-ollama) |
| `@openvole/paw-claude` | Anthropic Claude | [![npm](https://img.shields.io/npm/v/@openvole/paw-claude)](https://www.npmjs.com/package/@openvole/paw-claude) |
| `@openvole/paw-openai` | OpenAI GPT | [![npm](https://img.shields.io/npm/v/@openvole/paw-openai)](https://www.npmjs.com/package/@openvole/paw-openai) |
| `@openvole/paw-gemini` | Google Gemini | [![npm](https://img.shields.io/npm/v/@openvole/paw-gemini)](https://www.npmjs.com/package/@openvole/paw-gemini) |
| `@openvole/paw-xai` | xAI Grok | [![npm](https://img.shields.io/npm/v/@openvole/paw-xai)](https://www.npmjs.com/package/@openvole/paw-xai) |

### Channel Paws (4)

| Package | Description | npm |
|---------|-------------|-----|
| `@openvole/paw-telegram` | Telegram bot | [![npm](https://img.shields.io/npm/v/@openvole/paw-telegram)](https://www.npmjs.com/package/@openvole/paw-telegram) |
| `@openvole/paw-slack` | Slack bot | [![npm](https://img.shields.io/npm/v/@openvole/paw-slack)](https://www.npmjs.com/package/@openvole/paw-slack) |
| `@openvole/paw-discord` | Discord bot | [![npm](https://img.shields.io/npm/v/@openvole/paw-discord)](https://www.npmjs.com/package/@openvole/paw-discord) |
| `@openvole/paw-whatsapp` | WhatsApp | [![npm](https://img.shields.io/npm/v/@openvole/paw-whatsapp)](https://www.npmjs.com/package/@openvole/paw-whatsapp) |

### Tool Paws (8)

| Package | Description | npm |
|---------|-------------|-----|
| `@openvole/paw-browser` | Browser automation (Puppeteer) | [![npm](https://img.shields.io/npm/v/@openvole/paw-browser)](https://www.npmjs.com/package/@openvole/paw-browser) |
| `@openvole/paw-shell` | Shell command execution | [![npm](https://img.shields.io/npm/v/@openvole/paw-shell)](https://www.npmjs.com/package/@openvole/paw-shell) |
| `@openvole/paw-filesystem` | File system operations | [![npm](https://img.shields.io/npm/v/@openvole/paw-filesystem)](https://www.npmjs.com/package/@openvole/paw-filesystem) |
| `@openvole/paw-mcp` | MCP server bridge (1000+ tools) | [![npm](https://img.shields.io/npm/v/@openvole/paw-mcp)](https://www.npmjs.com/package/@openvole/paw-mcp) |
| `@openvole/paw-email` | Email (SMTP/IMAP) | [![npm](https://img.shields.io/npm/v/@openvole/paw-email)](https://www.npmjs.com/package/@openvole/paw-email) |
| `@openvole/paw-resend` | Email via Resend API | [![npm](https://img.shields.io/npm/v/@openvole/paw-resend)](https://www.npmjs.com/package/@openvole/paw-resend) |
| `@openvole/paw-github` | GitHub API | [![npm](https://img.shields.io/npm/v/@openvole/paw-github)](https://www.npmjs.com/package/@openvole/paw-github) |
| `@openvole/paw-calendar` | Google Calendar | [![npm](https://img.shields.io/npm/v/@openvole/paw-calendar)](https://www.npmjs.com/package/@openvole/paw-calendar) |

### Infrastructure Paws

| Package | Description | npm |
|---------|-------------|-----|
| `@openvole/paw-memory` | Persistent memory with source isolation | [![npm](https://img.shields.io/npm/v/@openvole/paw-memory)](https://www.npmjs.com/package/@openvole/paw-memory) |
| `@openvole/paw-session` | Session/conversation management | [![npm](https://img.shields.io/npm/v/@openvole/paw-session)](https://www.npmjs.com/package/@openvole/paw-session) |
| `@openvole/paw-compact` | Context compaction (in-process) | [![npm](https://img.shields.io/npm/v/@openvole/paw-compact)](https://www.npmjs.com/package/@openvole/paw-compact) |
| `@openvole/paw-dashboard` | Real-time web dashboard | [![npm](https://img.shields.io/npm/v/@openvole/paw-dashboard)](https://www.npmjs.com/package/@openvole/paw-dashboard) |

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

## How Paws Work

When a Paw is loaded, its tools are registered into the **Tool Registry** — a flat list that the Brain sees alongside core tools and MCP tools. The Brain calls them by name without knowing which Paw provides them.

```
vole> summarize my unread emails

Brain sees:
  email_search (paw-email) → searches inbox
  email_read (paw-email) → reads each email
  browser_navigate (paw-browser) → if needed
  memory_write (paw-memory) → saves summary
```

You can also call any registered tool directly from the CLI — no Brain involved:

```bash
npx vole tool call email_search '{"query":"is:unread","limit":5}'
npx vole tool call github_create_issue '{"repo":"myorg/myrepo","title":"Bug","body":"..."}'
npx vole tool call calendar_list_events '{"days":7}'
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
