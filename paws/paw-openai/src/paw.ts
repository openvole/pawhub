import OpenAI from 'openai'
import type {
	PawDefinition,
	AgentContext,
	AgentPlan,
	AgentMessage,
	PlannedAction,
	ToolSummary,
} from '@openvole/paw-sdk'

let client: OpenAI | undefined
let model: string = 'gpt-4o'

function getClient(): OpenAI | undefined {
	if (!client) {
		const apiKey = process.env.OPENAI_API_KEY
		if (!apiKey) {
			return undefined
		}
		model = process.env.OPENAI_MODEL || 'gpt-4o'
		client = new OpenAI({ apiKey })
	}
	return client
}

function convertMessages(
	systemPrompt: string,
	messages: AgentMessage[],
	sessionHistory?: string,
): OpenAI.ChatCompletionMessageParam[] {
	const result: OpenAI.ChatCompletionMessageParam[] = [
		{ role: 'system', content: systemPrompt },
	]

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
		if (!openai) {
			return {
				actions: [],
				response: 'OPENAI_API_KEY not set — paw-openai is not configured.',
				done: true,
			}
		}
		const start = Date.now()

		try {
			// System prompt is built by core — use it directly
			const systemPrompt = (context as Record<string, unknown>).systemPrompt as string | undefined
				?? 'You are an AI agent powered by OpenVole.'

			const sessionHistory = context.metadata?.sessionHistory as string | undefined
			const openaiMessages = convertMessages(systemPrompt, context.messages, sessionHistory)
			const openaiTools = convertTools(context.availableTools)

			console.log(
				`[paw-openai] chat request — model: ${model}, messages: ${openaiMessages.length}, tools: ${openaiTools.length}`,
			)

			const response = await openai.chat.completions.create({
				model,
				messages: openaiMessages,
				...(openaiTools.length > 0 ? { tools: openaiTools } : {}),
			})

			console.log(`[paw-openai] tokens — INPUT: ${response.usage?.prompt_tokens ?? '?'}, OUTPUT: ${response.usage?.completion_tokens ?? '?'} (model: ${model})`)

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

			const text = (choice.message.content || '').trim()

			if (!text) {
				return { actions: [], done: false }
			}

			return {
				actions: [],
				response: text,
				done: choice.finish_reason === 'stop',
			}
		} catch (error) {
			const durationMs = Date.now() - start
			const message = error instanceof Error ? error.message : String(error)
			console.log(`[paw-openai] think failed after ${durationMs}ms: ${message}`)
			return {
				actions: [],
				response: message,
				done: true,
			}
		}
	},

	async onLoad() {
		if (!process.env.OPENAI_API_KEY) {
			console.log('[paw-openai] OPENAI_API_KEY not set — paw will not function')
			return
		}
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
