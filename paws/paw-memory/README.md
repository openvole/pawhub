# @openvole/paw-memory

**Persistent memory with hybrid semantic + keyword search.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-memory)](https://www.npmjs.com/package/@openvole/paw-memory)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-memory
```

## Features

- **Hybrid search**: BM25 keyword + vector semantic similarity with Reciprocal Rank Fusion (RRF)
- **Auto-detects embedding provider**: Ollama (local, free), OpenAI, Gemini — zero config needed
- **Temporal decay**: Older memories score lower (configurable half-life, default 30 days)
- **Source isolation**: Memories scoped by task source (user, paw, heartbeat, schedule)
- **Disposable index**: Vector index is rebuilt from markdown files — delete `vectors.db` anytime
- **Graceful degradation**: Falls back to BM25-only when no embedding provider available
- **Auto-extraction**: Extracts key facts before compaction, tool patterns on observe

## Config

```json
{
  "name": "@openvole/paw-memory",
  "allow": {
    "network": ["*"],
    "env": ["VOLE_MEMORY_DIR", "VOLE_EMBEDDING_PROVIDER", "VOLE_EMBEDDING_MODEL",
            "OLLAMA_HOST", "OPENAI_API_KEY", "GEMINI_API_KEY"]
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VOLE_MEMORY_DIR` | Directory for storing memory files |
| `VOLE_EMBEDDING_PROVIDER` | Embedding provider: `ollama`, `openai`, `gemini` (auto-detected if not set) |
| `VOLE_EMBEDDING_MODEL` | Embedding model name (default: `nomic-embed-text` for Ollama, `text-embedding-3-small` for OpenAI) |
| `VOLE_EMBEDDING_DIMS` | Embedding dimensions (default: 768 for Ollama/Gemini, 1536 for OpenAI) |

## Tools

| Tool | Description |
|------|-------------|
| `memory_read` | Read a memory file (MEMORY.md or a daily log) |
| `memory_write` | Write or append to a memory file (auto-indexes for vector search) |
| `memory_search` | Hybrid search — semantic + keyword with RRF fusion. Falls back to BM25-only |
| `memory_list` | List all memory files with dates |

## Search Modes

- **Hybrid** (when embedding provider available): Combines BM25 keyword matching with vector cosine similarity. Results fused via RRF for best of both.
- **BM25-only** (fallback): Standard keyword-based ranked retrieval. Always available.

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
