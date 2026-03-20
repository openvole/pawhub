import Anthropic from '@anthropic-ai/sdk'
import type {
	PawDefinition,
	AgentContext,
	AgentPlan,
	AgentMessage,
	ActiveSkill,
	PlannedAction,
	ToolSummary,
} from '@openvole/paw-sdk'

let client: Anthropic | undefined
let model: string = 'claude-sonnet-4-20250514'

function getClient(): Anthropic {
	if (!client) {
		const apiKey = process.env.ANTHROPIC_API_KEY
		const baseURL = process.env.ANTHROPIC_BASE_URL
		model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514'
		client = new Anthropic({
			apiKey,
			...(baseURL ? { baseURL } : {}),
		})
	}
	return client
}

function buildSystemPrompt(
	activeSkills: ActiveSkill[],
	availableTools: ToolSummary[],
): string {
	const parts: string[] = ['You are an AI agent powered by OpenVole.']

	if (activeSkills.length > 0) {
		parts.push('')
		parts.push('## Available Skills')
		parts.push(
			'The following skills are available. Use the skill_read tool to load full instructions when a skill is relevant to the current task.',
		)
		for (const skill of activeSkills) {
			parts.push(`- **${skill.name}**: ${skill.description}`)
		}
	}

	if (availableTools.length > 0) {
		parts.push('')
		parts.push('## Available Tools')
		parts.push(
			'You have access to the following tools. Use function calling to invoke them when needed.',
		)
		for (const tool of availableTools) {
			parts.push(`- **${tool.name}** (from ${tool.pawName}): ${tool.description}`)
		}
	}

	return parts.join('\n')
}

function convertMessages(
	messages: AgentMessage[],
): Anthropic.MessageParam[] {
	const result: Anthropic.MessageParam[] = []

	for (const msg of messages) {
		switch (msg.role) {
			case 'user':
				result.push({ role: 'user', content: msg.content })
				break
			case 'brain':
				result.push({ role: 'assistant', content: msg.content })
				break
			case 'tool_result':
				result.push({
					role: 'user',
					content: [
						{
							type: 'tool_result',
							tool_use_id: (msg as any).toolUseId || 'unknown',
							content: msg.content,
						},
					],
				})
				break
			case 'error':
				result.push({
					role: 'user',
					content: [
						{
							type: 'tool_result',
							tool_use_id: (msg as any).toolUseId || 'unknown',
							content: `Error: ${msg.content}`,
							is_error: true,
						},
					],
				})
				break
		}
	}

	return result
}

function convertTools(
	tools: ToolSummary[],
): Anthropic.Tool[] {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: {
			type: 'object' as const,
			properties: {},
		},
	}))
}

function parseToolCalls(
	response: Anthropic.Message,
): PlannedAction[] {
	const actions: PlannedAction[] = []

	for (const block of response.content) {
		if (block.type === 'tool_use') {
			actions.push({
				tool: block.name,
				params: block.input as Record<string, unknown>,
			})
		}
	}

	return actions
}

export const paw: PawDefinition = {
	name: '@openvole/paw-claude',
	version: '0.1.0',
	description: 'Brain Paw powered by Anthropic Claude',
	brain: true,

	async think(context: AgentContext): Promise<AgentPlan> {
		const anthropic = getClient()
		const start = Date.now()

		try {
			const systemPrompt = buildSystemPrompt(
				context.activeSkills,
				context.availableTools,
			)

			const anthropicMessages = convertMessages(context.messages)
			const anthropicTools = convertTools(context.availableTools)

			const response = await anthropic.messages.create({
				model,
				max_tokens: 4096,
				system: systemPrompt,
				messages: anthropicMessages,
				...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
			})

			const durationMs = Date.now() - start
			console.log(
				`[paw-claude] think completed in ${durationMs}ms (model: ${model})`,
			)

			const actions = parseToolCalls(response)

			if (actions.length > 0) {
				return {
					actions,
					execution: 'sequential',
				}
			}

			// Extract text response
			const text = response.content
				.filter((block): block is Anthropic.TextBlock => block.type === 'text')
				.map((block) => block.text)
				.join('')

			return {
				actions: [],
				response: text,
				done: response.stop_reason === 'end_turn',
			}
		} catch (error) {
			const durationMs = Date.now() - start
			const message =
				error instanceof Error ? error.message : String(error)
			console.error(
				`[paw-claude] think failed after ${durationMs}ms: ${message}`,
			)

			return {
				actions: [],
				response: `Error communicating with Anthropic API: ${message}`,
				done: true,
			}
		}
	},

	async onLoad() {
		getClient()
		console.log(
			`[paw-claude] loaded — model: ${model}`,
		)
	},

	async onUnload() {
		client = undefined
		console.log('[paw-claude] unloaded')
	},
}
