import { z, type PawDefinition, type ToolDefinition } from '@openvole/paw-sdk'
import { McpBridge, loadMcpServerConfigs, saveMcpServerConfigs, type DiscoveredTool, type McpServerConfig } from './bridge.js'

let bridge: McpBridge | undefined

function buildToolDefinition(tool: DiscoveredTool, mcpBridge: McpBridge): ToolDefinition {
	const qualifiedName = `${tool.serverName}_${tool.toolName}`

	return {
		name: qualifiedName,
		description: tool.description || `MCP tool ${tool.toolName} from ${tool.serverName}`,
		parameters: z.any(),
		execute: async (params: unknown) => {
			return mcpBridge.executeTool(tool.serverName, tool.toolName, params)
		},
	}
}

/** Late-register tools with the core */
async function lateRegisterTools(toolDefs: ToolDefinition[]): Promise<void> {
	try {
		const { createIpcTransport } = await import('@openvole/paw-sdk')
		const t = createIpcTransport()
		t.send('register_tools', {
			tools: toolDefs.map((td) => ({ name: td.name, description: td.description })),
		})
	} catch {
		// Core may not see them until next query
	}
}

export const paw: PawDefinition = {
	name: '@openvole/paw-mcp',
	version: '0.1.0',
	description: 'Bridges MCP servers into OpenVole\'s tool registry',

	tools: [
		{
			name: 'mcp_add_server',
			description: 'Add and connect a new MCP server at runtime. Persists to servers.json.',
			parameters: z.object({
				name: z.string().describe('Unique name for the MCP server'),
				command: z.string().describe('Command to start the server (e.g. "npx")'),
				args: z.array(z.string()).optional().describe('Command arguments (e.g. ["-y", "@modelcontextprotocol/server-github"])'),
				env: z.record(z.string()).optional().describe('Environment variables. Use $VAR to reference host env vars.'),
			}),
			async execute(params) {
				const { name, command, args, env } = params as McpServerConfig
				if (!bridge) {
					return { ok: false, error: 'MCP bridge not initialized' }
				}
				try {
					const discovered = await bridge.addServer({ name, command, args, env })
					const toolDefs = discovered.map((t) => buildToolDefinition(t, bridge!))
					paw.tools!.push(...toolDefs)
					await lateRegisterTools(toolDefs)

					// Persist to servers.json
					const configs = await loadMcpServerConfigs()
					configs.push({ name, command, args, env })
					await saveMcpServerConfigs(configs)

					return {
						ok: true,
						server: name,
						tools_discovered: discovered.map((t) => `${t.serverName}_${t.toolName}`),
					}
				} catch (err) {
					return { ok: false, error: err instanceof Error ? err.message : String(err) }
				}
			},
		},
		{
			name: 'mcp_remove_server',
			description: 'Disconnect and remove an MCP server. Removes from servers.json.',
			parameters: z.object({
				name: z.string().describe('Name of the MCP server to remove'),
			}),
			async execute(params) {
				const { name } = params as { name: string }
				if (!bridge) {
					return { ok: false, error: 'MCP bridge not initialized' }
				}
				try {
					const removedTools = await bridge.removeServer(name)

					// Remove tool definitions from paw
					paw.tools = paw.tools!.filter((t) => !removedTools.includes(t.name))

					// Persist to servers.json
					const configs = await loadMcpServerConfigs()
					const updated = configs.filter((c) => c.name !== name)
					await saveMcpServerConfigs(updated)

					return { ok: true, server: name, tools_removed: removedTools }
				} catch (err) {
					return { ok: false, error: err instanceof Error ? err.message : String(err) }
				}
			},
		},
		{
			name: 'mcp_list_servers',
			description: 'List all connected MCP servers and their status.',
			parameters: z.object({}),
			async execute() {
				if (!bridge) {
					return { ok: true, servers: [] }
				}
				return { ok: true, servers: bridge.listServers() }
			},
		},
	],

	async onLoad() {
		const configs = await loadMcpServerConfigs()

		bridge = new McpBridge(configs)

		if (configs.length === 0) {
			console.log('[paw-mcp] No MCP servers configured')
			return
		}

		const discoveredTools = await bridge.connect()

		// Build tool definitions and add to the tools array
		const toolDefs = discoveredTools.map((t) => buildToolDefinition(t, bridge!))
		paw.tools!.push(...toolDefs)

		// Late-register discovered tools with the core
		lateRegisterTools(toolDefs)

		console.log(`[paw-mcp] Registered ${toolDefs.length} tool(s) from ${configs.length} MCP server(s)`)
	},

	async onUnload() {
		if (bridge) {
			await bridge.close()
			bridge = undefined
		}
		// Keep management tools, clear MCP tools
		paw.tools = paw.tools!.filter((t) =>
			['mcp_add_server', 'mcp_remove_server', 'mcp_list_servers'].includes(t.name),
		)
	},
}
