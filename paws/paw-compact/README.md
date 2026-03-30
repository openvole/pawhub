# @openvole/paw-compact

**Context compaction — heuristic trimming (default) + optional LLM summarization.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-compact)](https://www.npmjs.com/package/@openvole/paw-compact)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-compact
```

## Compaction Levels

### Level 0: Heuristic (default, free)

No LLM needed. Two-phase approach:
1. **Phase 1**: Shrink seen tool results in-place (works even with few messages)
2. **Phase 2**: Replace old messages with structured summary (tool calls, results, errors)

### Level 1: LLM Summarization (opt-in)

Uses a configurable LLM to produce structured summaries preserving task context, decisions, blockers, and next steps. Falls back to Level 0 if LLM unavailable.

```env
# Use a cheap local model
VOLE_COMPACT_MODEL=ollama/llama3.1:8b

# Or a cloud model
VOLE_COMPACT_MODEL=openai/gpt-4o-mini
VOLE_COMPACT_MODEL=gemini/gemini-2.0-flash
```

## Config

```json
{
  "name": "@openvole/paw-compact",
  "allow": {
    "network": ["*"],
    "env": ["VOLE_COMPACT_KEEP_RECENT", "VOLE_COMPACT_MODEL",
            "OLLAMA_HOST", "OPENAI_API_KEY", "GEMINI_API_KEY"]
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VOLE_COMPACT_KEEP_RECENT` | Number of recent messages to keep uncompacted (default: 10) |
| `VOLE_COMPACT_MODEL` | LLM for summarization in `provider/model` format. If not set, auto-detects or uses heuristic |

## How It Works

Runs in-process as part of the kernel's context management. When context exceeds 75% of `maxContextTokens`:

1. **Phase 1** always runs — shrinks large tool results the Brain has already seen
2. **Phase 2** runs if enough messages — LLM summarizes old messages (or heuristic if no LLM)
3. Result: first user message + summary + recent messages

The LLM client initializes lazily on first compaction, not at startup.

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
