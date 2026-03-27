import { Ollama, type Message, type Tool } from 'ollama'
import type { AgentMessage, PlannedAction, ToolSummary } from '@openvole/paw-sdk'
import type { BrainProvider, ThinkResult } from '../types.js'

export class OllamaProvider implements BrainProvider {
	readonly name = 'ollama'
	readonly model: string
	private client: Ollama

	constructor(host: string, model: string) {
		this.model = model
		this.client = new Ollama({ host })
	}

	async think(
		systemPrompt: string,
		messages: AgentMessage[],
		tools: ToolSummary[],
		sessionHistory?: string,
	): Promise<ThinkResult> {
		const ollamaMessages = this.convertMessages(systemPrompt, messages, sessionHistory)
		const ollamaTools = this.convertTools(tools)

		const response = await this.client.chat({
			model: this.model,
			messages: ollamaMessages,
			tools: ollamaTools.length > 0 ? ollamaTools : undefined,
			stream: false,
		})

		const inputTokens = (response as Record<string, unknown>).prompt_eval_count ?? '?'
		const outputTokens = (response as Record<string, unknown>).eval_count ?? '?'

		if (response.message.tool_calls && response.message.tool_calls.length > 0) {
			const actions: PlannedAction[] = response.message.tool_calls.map((call) => ({
				tool: call.function.name,
				params: call.function.arguments,
			}))
			return { actions, inputTokens, outputTokens }
		}

		const text = (response.message.content || '').trim()

		return {
			actions: [],
			response: text || undefined,
			done: text ? true : false,
			inputTokens,
			outputTokens,
		}
	}

	private convertMessages(
		systemPrompt: string,
		messages: AgentMessage[],
		sessionHistory?: string,
	): Message[] {
		const result: Message[] = [{ role: 'system', content: systemPrompt }]

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
				case 'tool_result': {
					const toolMsg: Message = { role: 'tool', content: msg.content }
					if (msg.imageBase64 && msg.imageMimeType) {
						toolMsg.images = [msg.imageBase64]
					}
					result.push(toolMsg)
					break
				}
				case 'error':
					result.push({
						role: 'tool',
						content: `Error: ${msg.content}`,
					})
					break
			}
		}

		return result
	}

	private convertTools(tools: ToolSummary[]): Tool[] {
		return tools.map((tool) => {
			const params = (tool as { parameters?: Record<string, unknown> }).parameters
			return {
				type: 'function',
				function: {
					name: tool.name,
					description: tool.description,
					parameters: params ?? {
						type: 'object',
						properties: {},
					},
				},
			}
		})
	}
}
