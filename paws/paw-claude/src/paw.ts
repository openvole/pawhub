import Anthropic from '@anthropic-ai/sdk'
import type {
	PawDefinition,
	AgentContext,
	AgentPlan,
	AgentMessage,
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

function convertMessages(
	messages: AgentMessage[],
	sessionHistory?: string,
): Anthropic.MessageParam[] {
	const result: Anthropic.MessageParam[] = []

	// Inject session history as structured messages (before current task messages)
	if (sessionHistory) {
		for (const line of sessionHistory.split('\n')) {
			if (!line.startsWith('[')) continue
			const closeBracket = line.indexOf(']')
			if (closeBracket === -1) continue
			const rest = line.substring(closeBracket + 2)
			const colonIdx = rest.indexOf(':')
			if (colonIdx === -1) continue
			const role = rest.substring(0, colonIdx).trim()
			const content = rest.substring(colonIdx + 1).trim()

			if (role === 'user') {
				result.push({ role: 'user', content })
			} else if (role === 'brain') {
				result.push({ role: 'assistant', content })
			}
			// Tool results in session history are skipped as structured messages
			// — they were already seen by the Brain in previous tasks
		}
	}

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
			// System prompt is built by core — use it directly
			const systemPrompt = (context as Record<string, unknown>).systemPrompt as string | undefined
				?? 'You are an AI agent powered by OpenVole.'

			const sessionHistory = context.metadata?.sessionHistory as string | undefined
			const anthropicMessages = convertMessages(context.messages, sessionHistory)
			const anthropicTools = convertTools(context.availableTools)

			console.log(
				`[paw-claude] chat request — model: ${model}, messages: ${anthropicMessages.length}, tools: ${anthropicTools.length}`,
			)

			const response = await anthropic.messages.create({
				model,
				max_tokens: 4096,
				system: systemPrompt,
				messages: anthropicMessages,
				...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
			})

			console.log(`[paw-claude] tokens — INPUT: ${response.usage.input_tokens}, OUTPUT: ${response.usage.output_tokens} (model: ${model})`)

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
				.trim()

			if (!text) {
				return { actions: [], done: false }
			}

			return {
				actions: [],
				response: text,
				done: response.stop_reason === 'end_turn',
			}
		} catch (error) {
			const durationMs = Date.now() - start
			const message = error instanceof Error ? error.message : String(error)
			console.log(`[paw-claude] think failed after ${durationMs}ms: ${message}`)
			return {
				actions: [],
				response: message,
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
