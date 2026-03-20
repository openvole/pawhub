# @openvole/paw-claude

**Brain Paw powered by Anthropic Claude.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-claude)](https://www.npmjs.com/package/@openvole/paw-claude)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-claude
```

## Config

```json
{
  "name": "@openvole/paw-claude",
  "allow": {
    "network": ["api.anthropic.com"],
    "env": ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL", "ANTHROPIC_BASE_URL"]
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `ANTHROPIC_MODEL` | Model to use (e.g. `claude-sonnet-4-20250514`) |
| `ANTHROPIC_BASE_URL` | Custom API base URL (optional) |

## Brain

Implements the Think phase — receives the conversation context and registered tools, returns the next assistant message and any tool calls. Connects to the Anthropic API.

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
