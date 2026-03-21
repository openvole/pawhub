# @openvole/paw-resend

**Email sending Paw powered by Resend.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-resend)](https://www.npmjs.com/package/@openvole/paw-resend)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-resend
```

## Config

```json
{
  "name": "@openvole/paw-resend",
  "allow": {
    "network": ["api.resend.com"],
    "env": ["RESEND_API_KEY", "RESEND_FROM"]
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RESEND_API_KEY` | Yes | Resend API key (from https://resend.com) |
| `RESEND_FROM` | No | Default sender email (default: `onboarding@resend.dev`) |

## Tools

| Tool | Description |
|------|-------------|
| `resend_send` | Send a plain text email |
| `resend_send_html` | Send an HTML email |
| `resend_batch` | Send multiple emails in one batch |

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
