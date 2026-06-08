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

## Features

- **Live monitoring** — paws (with health), tools, skills, tasks, schedules, and VoleNet peers, streamed over WebSocket (no polling)
- **Config editor** — edit `vole.config.json` from the browser across 8 sections (brain, heartbeat, loop, security/Docker, paws, tool profiles, agents, net)
- **Identity editor** — edit `SOUL.md`, `USER.md`, `AGENT.md`, `HEARTBEAT.md`, and `BRAIN.md`
- **One-click engine restart** — apply config/identity changes without the terminal
- **Live event log** — task lifecycle, paw/tool registration, crashes, rate limits

## How It Works

Starts a local web server with a WebSocket connection for real-time streaming of agent activity, and exposes the engine's config, identity, and restart controls so you can operate the agent entirely from your browser.

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
