# @openvole/paw-whatsapp

**WhatsApp messaging channel for OpenVole.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-whatsapp)](https://www.npmjs.com/package/@openvole/paw-whatsapp)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-whatsapp
```

## Config

```json
{
  "name": "@openvole/paw-whatsapp",
  "allow": {
    "network": ["web.whatsapp.com", "*.whatsapp.net"],
    "env": ["WHATSAPP_SESSION_DATA", "WHATSAPP_ALLOW_FROM"]
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WHATSAPP_SESSION_DATA` | WhatsApp Web session data |
| `WHATSAPP_ALLOW_FROM` | Comma-separated list of allowed phone numbers |

## Tools

| Tool | Description |
|------|-------------|
| `whatsapp_send` | Send a message via WhatsApp |
| `whatsapp_get_chat` | Get information about a WhatsApp chat |

Connects to WhatsApp Web, forwarding incoming messages to the agent and exposing tools for sending replies.

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
