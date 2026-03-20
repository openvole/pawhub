# @openvole/paw-memory

**Persistent memory — markdown-based long-term and daily memory.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-memory)](https://www.npmjs.com/package/@openvole/paw-memory)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-memory
```

## Config

```json
{
  "name": "@openvole/paw-memory",
  "allow": {
    "env": ["VOLE_MEMORY_DIR"]
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VOLE_MEMORY_DIR` | Directory for storing memory files |

## Tools

| Tool | Description |
|------|-------------|
| `memory_read` | Read a memory file (MEMORY.md or a daily log) |
| `memory_write` | Write or append to a memory file |
| `memory_search` | Search across all memory files for relevant content |
| `memory_list` | List all memory files with dates |

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
