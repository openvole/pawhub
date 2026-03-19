import { z, type PawDefinition, type ToolDefinition } from '@openvole/paw-sdk'
import { McpBridge, loadMcpServerConfigs, type DiscoveredTool } from './bridge.js'

let bridge: McpBridge | undefined

function buildToolDefinition(tool: DiscoveredTool, mcpBridge: McpBridge): ToolDefinition {
	const qualifiedName = `${tool.serverName}_${tool.toolName}`

	return {
		name: qualifiedName,
		description: tool.description || `MCP tool ${tool.toolName} from ${tool.serverName}`,
		// Use z.any() passthrough — actual validation happens on the MCP server side
		parameters: z.any(),
		execute: async (params: unknown) => {
			return mcpBridge.executeTool(tool.serverName, tool.toolName, params)
		},
	}
}

export const paw: PawDefinition = {
	name: '@openvole/paw-mcp',
	version: '0.1.0',
	description: 'Bridges MCP servers into OpenVole\'s tool registry',

	// Tools are populated dynamically in onLoad
	tools: [],

	async onLoad() {
		const configs = await loadMcpServerConfigs()

		if (configs.length === 0) {
			console.log('[paw-mcp] No MCP servers configured — paw loaded with no tools')
			return
		}

		bridge = new McpBridge(configs)
		const discoveredTools = await bridge.connect()

		// Build tool definitions and populate the tools array
		const toolDefs = discoveredTools.map((t) => buildToolDefinition(t, bridge!))
		// Mutate the tools array so the runtime picks them up
		paw.tools!.push(...toolDefs)

		console.log(`[paw-mcp] Registered ${toolDefs.length} tool(s) from ${configs.length} MCP server(s)`)
	},

	async onUnload() {
		if (bridge) {
			await bridge.close()
			bridge = undefined
		}
		// Clear registered tools
		paw.tools!.length = 0
	},
}
