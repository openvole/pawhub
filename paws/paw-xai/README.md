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
  "brain": "@openvole/paw-xai",
  "paws": [
    {
      "name": "@openvole/paw-xai",
      "allow": {
        "network": ["api.x.ai"],
        "env": ["XAI_API_KEY", "XAI_MODEL"]
      }
    }
  ]
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `XAI_API_KEY` | Yes | xAI API key |
| `XAI_MODEL` | No | Model name (default: `grok-3`) |

## Brain

Implements the Think phase using xAI's OpenAI-compatible API. Supports BRAIN.md, identity files (SOUL.md, USER.md, AGENT.md), session history, and memory injection.

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
