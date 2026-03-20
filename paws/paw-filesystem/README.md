# @openvole/paw-filesystem

**File system operations for reading, writing, editing, and searching files.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-filesystem)](https://www.npmjs.com/package/@openvole/paw-filesystem)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-filesystem
```

## Config

```json
{
  "name": "@openvole/paw-filesystem",
  "allow": {
    "filesystem": ["/app/workspace"],
    "env": ["VOLE_FS_ALLOWED_DIRS"]
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VOLE_FS_ALLOWED_DIRS` | Comma-separated list of directories the paw can access |

## Tools

| Tool | Description |
|------|-------------|
| `fs_read` | Read a file |
| `fs_write` | Write or create a file |
| `fs_edit` | Search and replace in a file |
| `fs_list` | List directory contents |
| `fs_search` | Search for text in files |
| `fs_mkdir` | Create a directory |

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
