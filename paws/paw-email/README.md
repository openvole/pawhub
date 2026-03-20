# @openvole/paw-email

**Email via SMTP and IMAP.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-email)](https://www.npmjs.com/package/@openvole/paw-email)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-email
```

## Config

```json
{
  "name": "@openvole/paw-email",
  "allow": {
    "network": ["*"],
    "env": ["EMAIL_HOST", "EMAIL_PORT", "EMAIL_USER", "EMAIL_PASS", "EMAIL_IMAP_HOST", "EMAIL_IMAP_PORT"]
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `EMAIL_HOST` | SMTP server hostname |
| `EMAIL_PORT` | SMTP server port |
| `EMAIL_USER` | Email account username |
| `EMAIL_PASS` | Email account password |
| `EMAIL_IMAP_HOST` | IMAP server hostname |
| `EMAIL_IMAP_PORT` | IMAP server port |

## Tools

| Tool | Description |
|------|-------------|
| `email_send` | Send an email via SMTP |
| `email_search` | Search emails in a mailbox folder |
| `email_read` | Read a specific email by its message ID |
| `email_list_folders` | List available mailbox folders |

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
