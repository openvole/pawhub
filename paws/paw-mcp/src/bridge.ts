import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export interface McpServerConfig {
	name: string
	command: string
	args?: string[]
	env?: Record<string, string>
}

interface ConnectedServer {
	config: McpServerConfig
	client: Client
	transport: StdioClientTransport
}

export interface DiscoveredTool {
	serverName: string
	toolName: string
	description: string
	inputSchema: unknown
}

export class McpBridge {
	private servers: Map<string, ConnectedServer> = new Map()
	private configs: McpServerConfig[]

	constructor(configs: McpServerConfig[]) {
		this.configs = configs
	}

	/**
	 * Connect to all configured MCP servers and discover their tools.
	 */
	async connect(): Promise<DiscoveredTool[]> {
		const allTools: DiscoveredTool[] = []

		for (const config of this.configs) {
			try {
				const tools = await this.connectServer(config)
				allTools.push(...tools)
			} catch (err) {
				console.error(
					`[paw-mcp] Failed to connect to MCP server "${config.name}":`,
					err instanceof Error ? err.message : err,
				)
			}
		}

		return allTools
	}

	private async connectServer(config: McpServerConfig): Promise<DiscoveredTool[]> {
		console.log(`[paw-mcp] Connecting to MCP server "${config.name}" (${config.command})...`)

		// Resolve env values — supports $VAR references to pull from process.env
		const resolvedEnv = config.env ? resolveEnvRefs(config.env) : undefined

		const transport = new StdioClientTransport({
			command: config.command,
			args: config.args,
			env: resolvedEnv ? { ...process.env, ...resolvedEnv } as Record<string, string> : undefined,
		})

		const client = new Client({
			name: `openvole-paw-mcp/${config.name}`,
			version: '0.1.0',
		})

		await client.connect(transport)

		// Handle server process exit
		transport.onclose = () => {
			console.error(`[paw-mcp] MCP server "${config.name}" disconnected`)
			this.servers.delete(config.name)
		}

		this.servers.set(config.name, { config, client, transport })

		// Discover tools
		const result = await client.listTools()
		const tools: DiscoveredTool[] = (result.tools ?? []).map((tool) => ({
			serverName: config.name,
			toolName: tool.name,
			description: tool.description ?? '',
			inputSchema: tool.inputSchema,
		}))

		console.log(
			`[paw-mcp] Discovered ${tools.length} tool(s) from "${config.name}": ${tools.map((t) => t.toolName).join(', ')}`,
		)

		return tools
	}

	/**
	 * Execute a tool on a specific MCP server.
	 */
	async executeTool(serverName: string, toolName: string, params: unknown): Promise<unknown> {
		const server = this.servers.get(serverName)
		if (!server) {
			throw new Error(`MCP server "${serverName}" is not connected`)
		}

		const result = await server.client.callTool({
			name: toolName,
			arguments: (params ?? {}) as Record<string, unknown>,
		})

		// MCP callTool returns { content: [...], isError?: boolean }
		if (result.isError) {
			const text = Array.isArray(result.content)
				? result.content
						.filter((c): c is { type: 'text'; text: string } => c.type === 'text')
						.map((c) => c.text)
						.join('\n')
				: String(result.content)
			throw new Error(`MCP tool "${toolName}" error: ${text}`)
		}

		// Return the content array as-is for flexibility
		return result.content
	}

	/**
	 * Shut down all MCP server connections.
	 */
	async close(): Promise<void> {
		const closePromises: Promise<void>[] = []

		for (const [name, server] of this.servers) {
			console.log(`[paw-mcp] Closing MCP server "${name}"...`)
			closePromises.push(
				server.transport.close().catch((err) => {
					console.error(
						`[paw-mcp] Error closing MCP server "${name}":`,
						err instanceof Error ? err.message : err,
					)
				}),
			)
		}

		await Promise.all(closePromises)
		this.servers.clear()
	}
}

/**
 * Load MCP server configs from the local paw config directory.
 *
 * Resolution order:
 *   1. .openvole/paws/paw-mcp/servers.json (user config — preferred)
 *   2. Paw's own directory/servers.json (package default — fallback)
 */
export async function loadMcpServerConfigs(): Promise<McpServerConfig[]> {
	const projectRoot = process.cwd()
	const localConfigPath = resolve(projectRoot, '.openvole', 'paws', 'paw-mcp', 'servers.json')
	const pawRoot = resolve(import.meta.dirname ?? '.', '..')
	const packageConfigPath = resolve(pawRoot, 'servers.json')

	// Try local config first
	for (const configPath of [localConfigPath, packageConfigPath]) {
		try {
			const raw = await readFile(configPath, 'utf-8')
			const parsed = JSON.parse(raw)
			const servers: McpServerConfig[] = Array.isArray(parsed) ? parsed : parsed.servers ?? []
			console.log(`[paw-mcp] Loaded ${servers.length} server config(s) from ${configPath}`)
			return servers
		} catch {
			// Try next path
		}
	}

	console.log(`[paw-mcp] No servers.json found`)
	return []
}

/**
 * Resolve env value references.
 * Values starting with $ are looked up from process.env.
 * Example: { "GITHUB_TOKEN": "$GITHUB_TOKEN" } → pulls from host env.
 * Plain values are passed through as-is.
 */
function resolveEnvRefs(env: Record<string, string>): Record<string, string> {
	const resolved: Record<string, string> = {}
	for (const [key, value] of Object.entries(env)) {
		if (value.startsWith('$')) {
			const envKey = value.slice(1)
			const envValue = process.env[envKey]
			if (envValue) {
				resolved[key] = envValue
			} else {
				console.warn(`[paw-mcp] Env var ${envKey} referenced but not set`)
			}
		} else {
			resolved[key] = value
		}
	}
	return resolved
}
