# @openvole/paw-xai

**Brain Paw powered by xAI Grok models.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-xai)](https://www.npmjs.com/package/@openvole/paw-xai)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-xai
```

## Config

```json
{
  "name": "@openvole/paw-xai",
  "allow": {
    "network": ["api.x.ai"],
    "env": ["XAI_API_KEY", "XAI_MODEL"]
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `XAI_API_KEY` | Yes | xAI API key |
| `XAI_MODEL` | No | Model name (default: `grok-3`) |

## Brain

Implements the Think phase using xAI's OpenAI-compatible API. Supports identity files (SOUL.md, USER.md, AGENT.md), session history, and memory injection.

## BRAIN.md

The system prompt is loaded from `.openvole/paws/paw-xai/BRAIN.md`. On first startup, the paw scaffolds a default prompt there. Edit this file to customize how the Brain reasons and responds.

The old `.openvole/BRAIN.md` path is no longer used.

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
