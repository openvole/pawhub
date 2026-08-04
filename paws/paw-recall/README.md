# @openvole/paw-recall

Memory with a memory model — typed records, hybrid retrieval with decay, pluggable storage backends. The successor to `@openvole/paw-memory`.

```bash
vole paw add @openvole/paw-recall
```

## Why not just files

paw-memory stores markdown and searches it. Nothing distinguishes an event from a fact, nothing decays, and retrieval cannot weigh *recent and important* against *textually similar*. paw-recall stores **records**:

| Kind | Holds | Decay half-life |
|---|---|---|
| `episodic` | events — what happened, in which task | 7 days |
| `semantic` | durable facts and preferences (default) | 90 days |
| `procedural` | how-tos that worked | 180 days |
| `entity` | profiles of people / projects / machines | 120 days |

Each record carries source scoping (same semantics as paw-memory: a source sees its own records plus `shared`), tags, entities, importance, provenance (task/session), and a pinned flag. **Pinned records never decay.**

Retrieval is one scoring function: `semantic·cosine + keyword·BM25 + recency + importance`, with MMR de-duplication so five restatements of the same fact don't crowd out the second thing you needed. With no embedding provider it degrades to keyword + recency + importance — never silently broken.

`MEMORY.md` still exists — as a **generated digest** of pinned and important records. Human-readable, git-friendly, but a view of the data rather than the data.

## Tools

| Tool | Does |
|---|---|
| `memory_search` | hybrid search; filters: `kind`, `source`, `tags` |
| `memory_write` | store a record — `kind`, `tags`, `entities`, `importance`, `pinned`, `ttl_hours` |
| `memory_read` | a record by id, or `"digest"` for the curated summary |
| `memory_list` | recent records, newest first |
| `memory_forget` | archive (excluded from recall, never deleted) |
| `memory_pin` | pin/unpin |

Tool names match paw-memory, and `memory_write(file, content)` / `memory_read("MEMORY.md")` still work (`MEMORY.md` → pinned semantic, daily files → episodic) — existing BRAIN.md prompts and skills keep working unchanged. **Run one memory paw, not both** — identical names conflict; paw-recall warns loudly if paw-memory is also loaded.

## Automatic memory

- **Bootstrap**: the digest plus records relevant to the task are injected into context, capped at ~5% of the context window.
- **Task outcomes**: completed tasks are recorded as episodic memory with their source and session (a heartbeat's work is remembered as heartbeat work).
- **Failures**: failed tool calls are captured (max 3 per task) — what the next run most needs to know.

## Migration from paw-memory

Automatic and one-time on first load: `MEMORY.md` bullets become pinned semantic records; daily logs become episodic records **backdated to their file date** so decay runs from when the memory was formed. Originals are never touched — rolling back to paw-memory keeps working.

## Storage backends

`VOLE_MEMORY_BACKEND=markdown` (default) — records as append-only JSONL plus the generated digest. Zero dependencies, crash-safe appends, fixed filenames (record ids never become file names, so Windows-reserved characters cannot break persistence).

Roadmap: `sqlite` (FTS5 via `node:sqlite`, no native addons) and `postgres` (pgvector, fleet-shared memory). Setting an unavailable backend fails loudly at load with the roadmap named.

## Configuration

```json
{
  "paws": [
    { "name": "@openvole/paw-recall",
      "allow": { "network": ["*"],
                 "env": ["VOLE_MEMORY_DIR", "VOLE_EMBEDDING_PROVIDER", "VOLE_EMBEDDING_MODEL", "OLLAMA_HOST", "OPENAI_API_KEY", "GEMINI_API_KEY"] } }
  ]
}
```

| Env | Default | |
|---|---|---|
| `VOLE_MEMORY_BACKEND` | `markdown` | storage driver |
| `VOLE_MEMORY_DIR` | `.openvole/paws/paw-recall` | data directory |
| `VOLE_EMBEDDING_PROVIDER` | auto-detect | `ollama` / `openai` / `gemini`; unset with no keys = keyword-only |

Embedding detection is identical to paw-memory (`OLLAMA_HOST`, `OPENAI_API_KEY`, `GEMINI_API_KEY`).
