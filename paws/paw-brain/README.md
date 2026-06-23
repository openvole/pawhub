# @openvole/paw-brain

Unified Brain Paw for OpenVole — a single paw that supports multiple LLM providers.

## Supported Providers

| Provider | `BRAIN_PROVIDER` | API Key Env | Model Env | Default Model |
|----------|-----------------|-------------|-----------|---------------|
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` |
| OpenAI | `openai` | `OPENAI_API_KEY` | `OPENAI_MODEL` | `gpt-4o` |
| Google Gemini | `gemini` | `GEMINI_API_KEY` | `GEMINI_MODEL` | `gemini-2.5-flash` |
| xAI | `xai` | `XAI_API_KEY` | `XAI_MODEL` | `grok-3` |
| Ollama | `ollama` | — | `OLLAMA_MODEL` | `qwen3:latest` |
| Claude Code | `claude-code` | — (uses CLI auth) | `CLAUDE_CODE_MODEL` | CLI default |
| Mock | `mock` | — | `BRAIN_MODEL` | `mock` |

## Configuration

### Option 1: Generic env vars

```env
BRAIN_PROVIDER=gemini
BRAIN_API_KEY=your-api-key
BRAIN_MODEL=gemini-2.5-flash
```

### Option 2: Provider-specific env vars

```env
GEMINI_API_KEY=your-api-key
GEMINI_MODEL=gemini-2.5-flash
```

Provider-specific vars take precedence over generic `BRAIN_*` vars.

### Option 3: Auto-detect

If `BRAIN_PROVIDER` is not set, paw-brain auto-detects the provider in this order: Anthropic, OpenAI, Gemini, xAI (whichever API key is present), then Ollama if `OLLAMA_HOST` or `OLLAMA_MODEL` is set. If none are configured it exits with a clear error — it no longer silently defaults to Ollama.

### vole.config.json

```json
{
  "brain": "@openvole/paw-brain",
  "paws": [
    {
      "name": "@openvole/paw-brain",
      "allow": {
        "network": ["*"],
        "env": ["BRAIN_PROVIDER", "BRAIN_API_KEY", "BRAIN_MODEL", "BRAIN_BASE_URL",
                "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL",
                "OPENAI_API_KEY", "OPENAI_MODEL",
                "GEMINI_API_KEY", "GEMINI_MODEL",
                "XAI_API_KEY", "XAI_MODEL",
                "OLLAMA_HOST", "OLLAMA_MODEL"]
      }
    }
  ]
}
```

## Switching providers

Just change `BRAIN_PROVIDER` and the corresponding API key — no config file changes needed:

```env
# Switch from Gemini to Claude
BRAIN_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

## Mock provider (testing)

For free, deterministic tests without a real LLM, set `BRAIN_PROVIDER=mock`. No API key or network is used. Two modes:

- **Echo** (default): replies with the latest incoming message — useful for proving a message arrived and a reply round-trips. Set `BRAIN_MOCK_REPLY` to return a fixed string instead of echoing.
- **Scripted** (`BRAIN_MOCK_SCRIPT`): plays a fixed sequence of tool calls, then a final response. The value is JSON — an array of `{"tool","params"}` and `{"response"}` steps.

```env
BRAIN_PROVIDER=mock
# Echo mode: fixed reply
BRAIN_MOCK_REPLY=hello from mock
# Scripted mode: call a tool, then respond
BRAIN_MOCK_SCRIPT='[{"tool":"net_message","params":{"to":"hub","text":"hi"}},{"response":"done"}]'
```

## Fallback provider

If the primary provider errors (rate limit, timeout, outage), paw-brain can automatically retry with a fallback:

```env
BRAIN_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...

BRAIN_FALLBACK=openai
OPENAI_API_KEY=sk-...
BRAIN_FALLBACK_MODEL=gpt-4o          # optional
```

The fallback is only used when the primary throws an error — not for empty responses or tool narration.

## Claude Code provider

Use the local, already-authenticated [Claude Code](https://claude.ai/code) CLI as the brain — no API key, it uses the CLI's own auth:

```env
BRAIN_PROVIDER=claude-code
```

| Variable | Description | Default |
|----------|-------------|---------|
| `CLAUDE_CODE_CMD` | Path or name of the CLI binary | `claude` |
| `CLAUDE_CODE_CONFIG_DIR` | Config dir to run the CLI against (e.g. `~/.claude-ep`) | — |
| `CLAUDE_CODE_MODEL` | Model to request from the CLI | CLI default |
| `CLAUDE_CODE_PERMISSION_MODE` | Permission mode passed to the CLI | — |
| `CLAUDE_CODE_ARGS` | Extra CLI arguments | — |
| `CLAUDE_CODE_TIMEOUT_MS` | Per-call timeout in milliseconds | — |
| `CLAUDE_CODE_EXPOSE_TOOLS` | Set to `1` to let Claude Code call OpenVole's own tools over MCP | — |

When `CLAUDE_CODE_EXPOSE_TOOLS=1`, the brain connects Claude Code to the space's MCP endpoint (`/mcp/<space>`) so it can call OpenVole tools directly.

## Cost tracking

paw-brain reports token usage (input/output tokens, model, provider) back to core via `AgentPlan.usage`. Core uses this for per-task cost estimation.

- Cloud providers are priced from a built-in pricing table
- Local Ollama models (no `:cloud` suffix) show as free in `auto` mode
- Ollama cloud models (e.g. `kimi-k2.5:cloud`) are priced
- Set `costTracking: "enabled"` in loop config to track all providers
