# @openvole/paw-calendar

**Google Calendar event management.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-calendar)](https://www.npmjs.com/package/@openvole/paw-calendar)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-calendar
```

## Config

```json
{
  "name": "@openvole/paw-calendar",
  "allow": {
    "network": ["www.googleapis.com", "oauth2.googleapis.com"],
    "env": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GOOGLE_CALENDAR_ID"]
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | Google OAuth refresh token |
| `GOOGLE_CALENDAR_ID` | Calendar ID (default `primary`) |

## Tools

| Tool | Description |
|------|-------------|
| `calendar_list_events` | List upcoming events from Google Calendar |
| `calendar_create_event` | Create a new event on Google Calendar |
| `calendar_update_event` | Update an existing event on Google Calendar |
| `calendar_delete_event` | Delete an event from Google Calendar |

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
