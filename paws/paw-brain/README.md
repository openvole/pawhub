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

If `BRAIN_PROVIDER` is not set, paw-brain auto-detects the provider from available API keys in this order: Anthropic, OpenAI, Gemini, xAI, Ollama.

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

## Cost tracking

paw-brain reports token usage (input/output tokens, model, provider) back to core via `AgentPlan.usage`. Core uses this for per-task cost estimation.

- Cloud providers are priced from a built-in pricing table
- Local Ollama models (no `:cloud` suffix) show as free in `auto` mode
- Ollama cloud models (e.g. `kimi-k2.5:cloud`) are priced
- Set `costTracking: "enabled"` in loop config to track all providers
