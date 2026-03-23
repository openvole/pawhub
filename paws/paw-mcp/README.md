# @openvole/paw-mcp

**MCP server bridge — connects MCP servers to OpenVole's tool registry.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-mcp)](https://www.npmjs.com/package/@openvole/paw-mcp)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-mcp
```

## Config

```json
{
  "name": "@openvole/paw-mcp",
  "allow": {}
}
```

Permissions are inherited from each MCP server's own configuration. Configure MCP servers in your `vole.config.json` under the `mcp` key.

## Environment Variables

No required environment variables. MCP server configs are in `.openvole/paws/paw-mcp/servers.json`.

## How It Works

This paw bridges any [Model Context Protocol](https://modelcontextprotocol.io/) server into OpenVole's tool registry. Tools provided by connected MCP servers appear alongside native paw tools — the Brain calls them by name without knowing the source.

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
