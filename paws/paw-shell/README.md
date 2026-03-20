# @openvole/paw-shell

**Shell command execution with safety restrictions.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-shell)](https://www.npmjs.com/package/@openvole/paw-shell)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-shell
```

## Config

```json
{
  "name": "@openvole/paw-shell",
  "allow": {
    "filesystem": ["/app/workspace"],
    "env": ["VOLE_SHELL_ALLOWED_DIRS"]
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VOLE_SHELL_ALLOWED_DIRS` | Comma-separated list of directories the shell can access |

## Tools

| Tool | Description |
|------|-------------|
| `shell_exec` | Run a shell command synchronously and return its output |
| `shell_exec_background` | Run a shell command in the background and return a process ID |
| `shell_status` | Check the status of a background process by its process ID |
| `shell_kill` | Kill a background process by its process ID |

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
