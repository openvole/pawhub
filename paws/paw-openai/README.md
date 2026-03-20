# @openvole/paw-openai

**Brain Paw powered by OpenAI.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-openai)](https://www.npmjs.com/package/@openvole/paw-openai)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-openai
```

## Config

```json
{
  "name": "@openvole/paw-openai",
  "allow": {
    "network": ["api.openai.com"],
    "env": ["OPENAI_API_KEY", "OPENAI_MODEL"]
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENAI_MODEL` | Model to use (e.g. `gpt-4o`) |

## Brain

Implements the Think phase — receives the conversation context and registered tools, returns the next assistant message and any tool calls. Connects to the OpenAI API.

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
