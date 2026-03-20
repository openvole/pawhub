# @openvole/paw-session

**Session and conversation management.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-session)](https://www.npmjs.com/package/@openvole/paw-session)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-session
```

## Config

```json
{
  "name": "@openvole/paw-session",
  "allow": {
    "env": ["VOLE_SESSION_DIR", "VOLE_SESSION_TTL"]
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VOLE_SESSION_DIR` | Directory for storing session data |
| `VOLE_SESSION_TTL` | Session time-to-live before expiry |

## Tools

| Tool | Description |
|------|-------------|
| `session_history` | Read conversation history for a session |
| `session_clear` | Clear a session's transcript and metadata |
| `session_list` | List all active sessions with their last activity time |

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
