# @openvole/paw-slack

**Slack bot channel for OpenVole.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-slack)](https://www.npmjs.com/package/@openvole/paw-slack)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-slack
```

## Config

```json
{
  "name": "@openvole/paw-slack",
  "allow": {
    "network": ["slack.com"],
    "listen": [3002],
    "env": ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET", "SLACK_APP_TOKEN", "SLACK_ALLOW_FROM"]
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth token |
| `SLACK_SIGNING_SECRET` | Slack app signing secret |
| `SLACK_APP_TOKEN` | Slack app-level token for Socket Mode |
| `SLACK_ALLOW_FROM` | Comma-separated list of allowed channel IDs |

## Tools

| Tool | Description |
|------|-------------|
| `slack_send` | Send a message to a Slack channel |
| `slack_reply` | Reply in a Slack thread |
| `slack_get_channel` | Get information about a Slack channel |

Connects to Slack as a bot, forwarding incoming messages to the agent and exposing tools for sending replies.

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
