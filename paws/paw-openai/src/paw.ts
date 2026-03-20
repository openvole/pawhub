import OpenAI from 'openai'
import type {
	PawDefinition,
	AgentContext,
	AgentPlan,
	AgentMessage,
	ActiveSkill,
	PlannedAction,
	ToolSummary,
} from '@openvole/paw-sdk'

let client: OpenAI | undefined
let model: string = 'gpt-4o'

function getClient(): OpenAI {
	if (!client) {
		const apiKey = process.env.OPENAI_API_KEY
		model = process.env.OPENAI_MODEL || 'gpt-4o'
		client = new OpenAI({ apiKey })
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
	systemPrompt: string,
	messages: AgentMessage[],
): OpenAI.ChatCompletionMessageParam[] {
	const result: OpenAI.ChatCompletionMessageParam[] = [
		{ role: 'system', content: systemPrompt },
	]

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
					role: 'tool',
					content: msg.content,
					tool_call_id: (msg as any).toolCallId || 'unknown',
				})
				break
			case 'error':
				result.push({
					role: 'tool',
					content: `Error: ${msg.content}`,
					tool_call_id: (msg as any).toolCallId || 'unknown',
				})
				break
		}
	}

	return result
}

function convertTools(
	tools: ToolSummary[],
): OpenAI.ChatCompletionTool[] {
	return tools.map((tool) => ({
		type: 'function' as const,
		function: {
			name: tool.name,
			description: tool.description,
			parameters: {
				type: 'object',
				properties: {},
			},
		},
	}))
}

function parseToolCalls(
	message: OpenAI.ChatCompletionMessage,
): PlannedAction[] {
	if (!message.tool_calls || message.tool_calls.length === 0) {
		return []
	}

	return message.tool_calls.map((call) => {
		let params: Record<string, unknown> = {}
		try {
			params = JSON.parse(call.function.arguments)
		} catch {
			// If arguments can't be parsed, use empty params
		}
		return {
			tool: call.function.name,
			params,
		}
	})
}

export const paw: PawDefinition = {
	name: '@openvole/paw-openai',
	version: '0.1.0',
	description: 'Brain Paw powered by OpenAI',
	brain: true,

	async think(context: AgentContext): Promise<AgentPlan> {
		const openai = getClient()
		const start = Date.now()

		try {
			const systemPrompt = buildSystemPrompt(
				context.activeSkills,
				context.availableTools,
			)

			const openaiMessages = convertMessages(systemPrompt, context.messages)
			const openaiTools = convertTools(context.availableTools)

			const response = await openai.chat.completions.create({
				model,
				messages: openaiMessages,
				...(openaiTools.length > 0 ? { tools: openaiTools } : {}),
			})

			const durationMs = Date.now() - start
			console.log(
				`[paw-openai] think completed in ${durationMs}ms (model: ${model})`,
			)

			const choice = response.choices[0]
			if (!choice) {
				return {
					actions: [],
					response: 'No response from OpenAI.',
					done: true,
				}
			}

			const actions = parseToolCalls(choice.message)

			if (actions.length > 0) {
				return {
					actions,
					execution: 'sequential',
				}
			}

			const text = choice.message.content || ''

			return {
				actions: [],
				response: text,
				done: choice.finish_reason === 'stop',
			}
		} catch (error) {
			const durationMs = Date.now() - start
			const message =
				error instanceof Error ? error.message : String(error)
			console.error(
				`[paw-openai] think failed after ${durationMs}ms: ${message}`,
			)

			return {
				actions: [],
				response: `Error communicating with OpenAI API: ${message}`,
				done: true,
			}
		}
	},

	async onLoad() {
		getClient()
		console.log(
			`[paw-openai] loaded — model: ${model}`,
		)
	},

	async onUnload() {
		client = undefined
		console.log('[paw-openai] unloaded')
	},
}
