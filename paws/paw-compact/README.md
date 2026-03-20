# @openvole/paw-compact

**Context compaction — summarizes old messages to free context window space.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-compact)](https://www.npmjs.com/package/@openvole/paw-compact)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-compact
```

## Config

```json
{
  "name": "@openvole/paw-compact",
  "allow": {
    "env": ["VOLE_COMPACT_KEEP_RECENT"]
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VOLE_COMPACT_KEEP_RECENT` | Number of recent messages to keep uncompacted |

## How It Works

Runs in-process as part of the kernel's context management. When the conversation exceeds the context window, older messages are summarized and replaced with a compact summary, preserving the most recent exchanges intact.

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
