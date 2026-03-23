# @openvole/paw-msteams

**Microsoft Teams bot channel for OpenVole.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-msteams)](https://www.npmjs.com/package/@openvole/paw-msteams)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-msteams
```

## Config

Add the paw to your `vole.config.json`:

```json
{
  "name": "@openvole/paw-msteams",
  "allow": {
    "network": ["login.microsoftonline.com", "smba.trafficmanager.net", "*.botframework.com"],
    "listen": [3978],
    "env": ["MSTEAMS_APP_ID", "MSTEAMS_APP_PASSWORD", "MSTEAMS_TENANT_ID", "MSTEAMS_PORT", "MSTEAMS_ALLOW_FROM"]
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MSTEAMS_APP_ID` | Yes | Microsoft App ID from Azure Bot registration |
| `MSTEAMS_APP_PASSWORD` | Yes | Client secret from Azure Bot registration |
| `MSTEAMS_TENANT_ID` | No | Azure AD tenant ID (for single-tenant bots) |
| `MSTEAMS_PORT` | No | HTTP server port (default: `3978`) |
| `MSTEAMS_ALLOW_FROM` | No | Comma-separated list of allowed user names/IDs |

## Azure Bot Registration

1. Go to the [Azure Portal](https://portal.azure.com) and create a new **Azure Bot** resource.
2. Under **Configuration**, note the **Microsoft App ID**.
3. Go to **Manage Password** and create a new **Client Secret** — this is your App Password.
4. Under **Channels**, add **Microsoft Teams** as a channel.
5. In your Teams admin center, allow sideloading or publish the bot to your organization.

## Setup

1. Set the required environment variables.
2. Start OpenVole with the paw enabled.
3. The bot listens on `http://localhost:3978/api/messages` for incoming Bot Framework messages.
4. Configure your Azure Bot's **Messaging Endpoint** to point to this URL (use a tunnel like ngrok for local development).

## Tools

| Tool | Description |
|------|-------------|
| `msteams_send` | Send a message to a specific Teams conversation |
| `msteams_reply` | Reply to the current Teams conversation |
| `msteams_get_conversations` | List active Teams conversations |

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
