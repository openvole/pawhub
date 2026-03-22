# @openvole/paw-ollama

**Brain Paw powered by Ollama for local LLM inference.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-ollama)](https://www.npmjs.com/package/@openvole/paw-ollama)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-ollama
```

## Config

```json
{
  "name": "@openvole/paw-ollama",
  "allow": {
    "network": ["127.0.0.1"],
    "env": ["OLLAMA_MODEL", "OLLAMA_HOST"]
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OLLAMA_MODEL` | Model name to use (e.g. `llama3`) |
| `OLLAMA_HOST` | Ollama server address (default `http://127.0.0.1:11434`) |

## Brain

Implements the Think phase — receives the conversation context and registered tools, returns the next assistant message and any tool calls. Uses a locally running Ollama instance.

## BRAIN.md

The system prompt is loaded from `.openvole/paws/paw-ollama/BRAIN.md`. On first startup, the paw scaffolds a default prompt there. Edit this file to customize how the Brain reasons and responds.

The old `.openvole/BRAIN.md` path is no longer used.

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
