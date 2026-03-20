# @openvole/paw-telegram

**Telegram bot channel for OpenVole.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-telegram)](https://www.npmjs.com/package/@openvole/paw-telegram)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-telegram
```

## Config

```json
{
  "name": "@openvole/paw-telegram",
  "allow": {
    "network": ["api.telegram.org"],
    "env": ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOW_FROM"]
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token from @BotFather |
| `TELEGRAM_ALLOW_FROM` | Comma-separated list of allowed chat IDs |

## Tools

| Tool | Description |
|------|-------------|
| `telegram_send` | Send a message to a Telegram chat |
| `telegram_reply` | Reply to a specific message in a Telegram chat |
| `telegram_get_chat` | Get information about a Telegram chat |

Connects to Telegram as a bot, forwarding incoming messages to the agent and exposing tools for sending replies.

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
