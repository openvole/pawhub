# @openvole/paw-discord

**Discord bot channel for OpenVole.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-discord)](https://www.npmjs.com/package/@openvole/paw-discord)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-discord
```

## Config

```json
{
  "name": "@openvole/paw-discord",
  "allow": {
    "network": ["discord.com", "gateway.discord.gg"],
    "env": ["DISCORD_BOT_TOKEN", "DISCORD_ALLOW_FROM"]
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_BOT_TOKEN` | Discord bot token |
| `DISCORD_ALLOW_FROM` | Comma-separated list of allowed channel IDs |

## Tools

| Tool | Description |
|------|-------------|
| `discord_send` | Send a message to a Discord channel |
| `discord_reply` | Reply to a message in Discord |
| `discord_get_channel` | Get information about a Discord channel |

Connects to Discord as a bot, forwarding incoming messages to the agent and exposing tools for sending replies.

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
