# @openvole/paw-gemini

**Brain Paw powered by Google Gemini.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-gemini)](https://www.npmjs.com/package/@openvole/paw-gemini)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-gemini
```

## Config

```json
{
  "name": "@openvole/paw-gemini",
  "allow": {
    "network": ["generativelanguage.googleapis.com"],
    "env": ["GEMINI_API_KEY", "GEMINI_MODEL"]
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Google Gemini API key |
| `GEMINI_MODEL` | Model to use (e.g. `gemini-pro`) |

## Brain

Implements the Think phase — receives the conversation context and registered tools, returns the next assistant message and any tool calls. Connects to the Google Gemini API.

## BRAIN.md

The system prompt is loaded from `.openvole/paws/paw-gemini/BRAIN.md`. On first startup, the paw scaffolds a default prompt there. Edit this file to customize how the Brain reasons and responds.

The old `.openvole/BRAIN.md` path is no longer used.

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
