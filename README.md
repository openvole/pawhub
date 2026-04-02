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

### Brain

| Package | Description | npm |
|---------|-------------|-----|
| `@openvole/paw-brain` | **Unified multi-provider brain** (Anthropic, OpenAI, Gemini, xAI, Ollama) | [![npm](https://img.shields.io/npm/v/@openvole/paw-brain)](https://www.npmjs.com/package/@openvole/paw-brain) |
| `@openvole/paw-ollama` | *(deprecated)* Local LLM via Ollama | [![npm](https://img.shields.io/npm/v/@openvole/paw-ollama)](https://www.npmjs.com/package/@openvole/paw-ollama) |
| `@openvole/paw-claude` | *(deprecated)* Anthropic Claude | [![npm](https://img.shields.io/npm/v/@openvole/paw-claude)](https://www.npmjs.com/package/@openvole/paw-claude) |
| `@openvole/paw-openai` | *(deprecated)* OpenAI GPT | [![npm](https://img.shields.io/npm/v/@openvole/paw-openai)](https://www.npmjs.com/package/@openvole/paw-openai) |
| `@openvole/paw-gemini` | *(deprecated)* Google Gemini | [![npm](https://img.shields.io/npm/v/@openvole/paw-gemini)](https://www.npmjs.com/package/@openvole/paw-gemini) |
| `@openvole/paw-xai` | *(deprecated)* xAI Grok | [![npm](https://img.shields.io/npm/v/@openvole/paw-xai)](https://www.npmjs.com/package/@openvole/paw-xai) |

### Channel Paws (6)

| Package | Description | npm |
|---------|-------------|-----|
| `@openvole/paw-telegram` | Telegram bot | [![npm](https://img.shields.io/npm/v/@openvole/paw-telegram)](https://www.npmjs.com/package/@openvole/paw-telegram) |
| `@openvole/paw-slack` | Slack bot | [![npm](https://img.shields.io/npm/v/@openvole/paw-slack)](https://www.npmjs.com/package/@openvole/paw-slack) |
| `@openvole/paw-discord` | Discord bot | [![npm](https://img.shields.io/npm/v/@openvole/paw-discord)](https://www.npmjs.com/package/@openvole/paw-discord) |
| `@openvole/paw-whatsapp` | WhatsApp | [![npm](https://img.shields.io/npm/v/@openvole/paw-whatsapp)](https://www.npmjs.com/package/@openvole/paw-whatsapp) |
| `@openvole/paw-msteams` | Microsoft Teams | [![npm](https://img.shields.io/npm/v/@openvole/paw-msteams)](https://www.npmjs.com/package/@openvole/paw-msteams) |
| `@openvole/paw-voice-call` | Voice calls (Twilio) | [![npm](https://img.shields.io/npm/v/@openvole/paw-voice-call)](https://www.npmjs.com/package/@openvole/paw-voice-call) |

### Tool Paws

| Package | Description | npm |
|---------|-------------|-----|
| `@openvole/paw-browser` | Browser automation (Puppeteer) | [![npm](https://img.shields.io/npm/v/@openvole/paw-browser)](https://www.npmjs.com/package/@openvole/paw-browser) |
| `@openvole/paw-shell` | Shell command execution | [![npm](https://img.shields.io/npm/v/@openvole/paw-shell)](https://www.npmjs.com/package/@openvole/paw-shell) |
| `@openvole/paw-filesystem` | File system operations | [![npm](https://img.shields.io/npm/v/@openvole/paw-filesystem)](https://www.npmjs.com/package/@openvole/paw-filesystem) |
| `@openvole/paw-mcp` | MCP server bridge | [![npm](https://img.shields.io/npm/v/@openvole/paw-mcp)](https://www.npmjs.com/package/@openvole/paw-mcp) |
| `@openvole/paw-email` | Email (SMTP/IMAP) | [![npm](https://img.shields.io/npm/v/@openvole/paw-email)](https://www.npmjs.com/package/@openvole/paw-email) |
| `@openvole/paw-resend` | Email via Resend API | [![npm](https://img.shields.io/npm/v/@openvole/paw-resend)](https://www.npmjs.com/package/@openvole/paw-resend) |
| `@openvole/paw-github` | GitHub API | [![npm](https://img.shields.io/npm/v/@openvole/paw-github)](https://www.npmjs.com/package/@openvole/paw-github) |
| `@openvole/paw-calendar` | Google Calendar | [![npm](https://img.shields.io/npm/v/@openvole/paw-calendar)](https://www.npmjs.com/package/@openvole/paw-calendar) |
| `@openvole/paw-tts` | Text-to-speech (ElevenLabs, OpenAI) | [![npm](https://img.shields.io/npm/v/@openvole/paw-tts)](https://www.npmjs.com/package/@openvole/paw-tts) |
| `@openvole/paw-stt` | Speech-to-text (OpenAI Whisper) | [![npm](https://img.shields.io/npm/v/@openvole/paw-stt)](https://www.npmjs.com/package/@openvole/paw-stt) |
| `@openvole/paw-computer` | Desktop automation (mouse, keyboard, screen) | [![npm](https://img.shields.io/npm/v/@openvole/paw-computer)](https://www.npmjs.com/package/@openvole/paw-computer) |
| `@openvole/paw-database` | PostgreSQL, MySQL, SQLite queries | [![npm](https://img.shields.io/npm/v/@openvole/paw-database)](https://www.npmjs.com/package/@openvole/paw-database) |
| `@openvole/paw-scraper` | Structured web data extraction (cheerio) | [![npm](https://img.shields.io/npm/v/@openvole/paw-scraper)](https://www.npmjs.com/package/@openvole/paw-scraper) |
| `@openvole/paw-pdf` | Read, merge, split PDFs (pdf-lib) | [![npm](https://img.shields.io/npm/v/@openvole/paw-pdf)](https://www.npmjs.com/package/@openvole/paw-pdf) |
| `@openvole/paw-image` | Resize, crop, watermark, compress images (sharp) | [![npm](https://img.shields.io/npm/v/@openvole/paw-image)](https://www.npmjs.com/package/@openvole/paw-image) |
| `@openvole/paw-social` | Twitter/X and LinkedIn posting | [![npm](https://img.shields.io/npm/v/@openvole/paw-social)](https://www.npmjs.com/package/@openvole/paw-social) |

### Infrastructure Paws

| Package | Description | npm |
|---------|-------------|-----|
| `@openvole/paw-memory` | Persistent memory — hybrid semantic + keyword search | [![npm](https://img.shields.io/npm/v/@openvole/paw-memory)](https://www.npmjs.com/package/@openvole/paw-memory) |
| `@openvole/paw-session` | Session/conversation management | [![npm](https://img.shields.io/npm/v/@openvole/paw-session)](https://www.npmjs.com/package/@openvole/paw-session) |
| `@openvole/paw-compact` | Context compaction — heuristic + optional LLM summarization | [![npm](https://img.shields.io/npm/v/@openvole/paw-compact)](https://www.npmjs.com/package/@openvole/paw-compact) |
| `@openvole/paw-dashboard` | Real-time web dashboard | [![npm](https://img.shields.io/npm/v/@openvole/paw-dashboard)](https://www.npmjs.com/package/@openvole/paw-dashboard) |

## Install

```bash
npm install @openvole/paw-brain @openvole/paw-memory @openvole/paw-dashboard
```

Then add to `vole.config.json`:

```json
{
  "brain": "@openvole/paw-brain",
  "paws": [
    { "name": "@openvole/paw-brain", "allow": { "network": ["*"], "env": ["BRAIN_PROVIDER", "BRAIN_API_KEY", "BRAIN_MODEL", "OLLAMA_HOST", "OLLAMA_MODEL", "GEMINI_API_KEY", "GEMINI_MODEL"] } },
    { "name": "@openvole/paw-memory", "allow": { "network": ["*"], "env": ["VOLE_MEMORY_DIR", "OLLAMA_HOST"] } },
    { "name": "@openvole/paw-dashboard", "allow": { "listen": [3001] } }
  ]
}
```

## VoleNet Compatibility

Several paws have built-in VoleNet support for distributed deployments:

- **paw-dashboard** — VoleNet panel showing connected peers, leader status, and remote tool execution feed
- **paw-memory** — Cross-peer memory sync (write propagation + remote search)
- **paw-session** — Session transcript replication across devices

Any paw's tools can be shared across VoleNet instances — remote tools appear in the coordinator's registry and work transparently.

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

## Contributing

We welcome new Paws! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on creating and submitting Paws.

## License

[MIT](LICENSE)
