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
| Antigravity | `antigravity` (`agy`) | — (uses CLI auth) | `ANTIGRAVITY_MODEL` | CLI default |
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

For free, deterministic tests without a real LLM, set `BRAIN_PROVIDER=mock`. No API key or network is used. Three modes:

- **Echo** (default): replies with the latest incoming message — useful for proving a message arrived and a reply round-trips. Set `BRAIN_MOCK_REPLY` to return a fixed string instead of echoing.
- **Scripted** (`BRAIN_MOCK_SCRIPT`): plays a fixed sequence of tool calls, then a final response. The value is JSON — an array of `{"tool","params"}` and `{"response"}` steps.
- **Scenario** (`BRAIN_MOCK_SCENARIO`): a path to a JSON file of pattern-matched rules — the mock picks the first rule whose `match` regex hits the user's message and plays its `steps` (real tool calls, then a reply). Strings interpolate live data: `{{user}}` (the user's message), `{{last_result}}` (the previous tool result), `{{last.some.field}}` (a dot-path into it — e.g. chain `agent_submit` into `agent_task_status` via `{{last.taskId}}`). `fallback` answers anything unmatched. Powers interactive, zero-cost demos — see the openvole repo's `examples/mission-control`.

```env
BRAIN_PROVIDER=mock
# Echo mode: fixed reply
BRAIN_MOCK_REPLY=hello from mock
# Scripted mode: call a tool, then respond
BRAIN_MOCK_SCRIPT='[{"tool":"net_message","params":{"to":"hub","text":"hi"}},{"response":"done"}]'
# Scenario mode: pattern-matched, interpolated (see examples/mission-control)
BRAIN_MOCK_SCENARIO=.openvole/paws/paw-brain/scenario.json
```

```json
{
  "rules": [
    { "match": ["fleet|agents"],
      "steps": [ {"tool": "agent_list"}, {"response": "The fleet:\n{{last_result}}"} ] }
  ],
  "fallback": "You said: {{user}} — try 'fleet'."
}
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

## Antigravity provider

Use the local, already-authenticated [Antigravity](https://antigravity.google) CLI (`agy`, the successor to the Gemini CLI) as the brain — no API key, it uses the CLI's own auth:

```env
BRAIN_PROVIDER=antigravity
```

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTIGRAVITY_CMD` | Path or name of the CLI binary | `agy` |
| `ANTIGRAVITY_MODEL` | Model to request (see `agy models`) | CLI default |
| `ANTIGRAVITY_AGENT` | Agent to run the session as | — |
| `ANTIGRAVITY_EFFORT` | Reasoning effort: `low` \| `medium` \| `high` | — |
| `ANTIGRAVITY_MODE` | Execution mode: `accept-edits` \| `plan` | — |
| `ANTIGRAVITY_SKIP_PERMISSIONS` | `1` to auto-approve tool permission prompts | — |
| `ANTIGRAVITY_SANDBOX` | `1` to run with terminal restrictions | — |
| `ANTIGRAVITY_ADD_DIR` | Comma-separated dirs to add to the workspace | — |
| `ANTIGRAVITY_CWD` | Working directory for the CLI | — |
| `ANTIGRAVITY_ARGS` | Extra CLI arguments | — |
| `ANTIGRAVITY_TIMEOUT_MS` | Per-call timeout in milliseconds | `600000` |
| `ANTIGRAVITY_MAX_PROMPT_BYTES` | Refuse prompts larger than this | `512000` |

`agy models` lists what your account can reach (`gemini-3.x`, `claude-*`, `gpt-oss-*`).

Two differences from the Claude Code provider worth knowing:

- **No MCP equivalent.** `agy` has no `--mcp-config`, so OpenVole's own tools cannot be exposed to it. Like `claude-code` without `CLAUDE_CODE_EXPOSE_TOOLS`, it runs its own agent loop with its own tools and returns a final text answer (no OpenVole tool calls).
- **The prompt is passed as a command-line argument** (`--print <prompt>`), not on stdin, so it is bounded by `ARG_MAX` (~1 MB). Oversized prompts fail fast with a clear error rather than a bare `E2BIG` — lower `loop.maxContextTokens` or raise `ANTIGRAVITY_MAX_PROMPT_BYTES`.

## Cost tracking

paw-brain reports token usage (input/output tokens, model, provider) back to core via `AgentPlan.usage`. Core uses this for per-task cost estimation.

- Cloud providers are priced from a built-in pricing table
- Local Ollama models (no `:cloud` suffix) show as free in `auto` mode
- Ollama cloud models (e.g. `kimi-k2.5:cloud`) are priced
- Set `costTracking: "enabled"` in loop config to track all providers
