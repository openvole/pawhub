# @openvole/paw-dashboard

**Real-time web dashboard for agent monitoring.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-dashboard)](https://www.npmjs.com/package/@openvole/paw-dashboard)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-dashboard
```

## Config

```json
{
  "name": "@openvole/paw-dashboard",
  "allow": {
    "listen": [3001],
    "env": ["VOLE_DASHBOARD_PORT"]
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VOLE_DASHBOARD_PORT` | Port for the dashboard web server (default `3001`) |

## How It Works

Starts a local web server with a WebSocket connection for real-time streaming of agent activity. View conversations, tool calls, and system events in your browser.

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
