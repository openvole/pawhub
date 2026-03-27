import OpenAI from 'openai'
import type { AgentMessage, PlannedAction, ToolSummary } from '@openvole/paw-sdk'
import type { BrainProvider, ThinkResult } from '../types.js'

export class OpenAIProvider implements BrainProvider {
	readonly name: string
	readonly model: string
	private client: OpenAI

	constructor(apiKey: string, model: string, baseURL?: string, providerName?: string) {
		this.model = model
		this.name = providerName ?? 'openai'
		this.client = new OpenAI({
			apiKey,
			...(baseURL ? { baseURL } : {}),
		})
	}

	async think(
		systemPrompt: string,
		messages: AgentMessage[],
		tools: ToolSummary[],
		sessionHistory?: string,
	): Promise<ThinkResult> {
		const openaiMessages = this.convertMessages(systemPrompt, messages, sessionHistory)
		const openaiTools = this.convertTools(tools)

		const response = await this.client.chat.completions.create({
			model: this.model,
			messages: openaiMessages,
			...(openaiTools.length > 0 ? { tools: openaiTools } : {}),
		})

		const choice = response.choices[0]
		if (!choice) {
			return {
				actions: [],
				response: `No response from ${this.name}.`,
				done: true,
				inputTokens: response.usage?.prompt_tokens,
				outputTokens: response.usage?.completion_tokens,
			}
		}

		const actions = this.parseToolCalls(choice.message)

		if (actions.length > 0) {
			return {
				actions,
				inputTokens: response.usage?.prompt_tokens,
				outputTokens: response.usage?.completion_tokens,
			}
		}

		const text = (choice.message.content || '').trim()

		return {
			actions: [],
			response: text || undefined,
			done: text ? choice.finish_reason === 'stop' : false,
			inputTokens: response.usage?.prompt_tokens,
			outputTokens: response.usage?.completion_tokens,
		}
	}

	private convertMessages(
		systemPrompt: string,
		messages: AgentMessage[],
		sessionHistory?: string,
	): OpenAI.ChatCompletionMessageParam[] {
		const result: OpenAI.ChatCompletionMessageParam[] = [
			{ role: 'system', content: systemPrompt },
		]

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
				case 'user': {
					if (msg.imageBase64 && msg.imageMimeType) {
						result.push({
							role: 'user',
							content: [
								{ type: 'text', text: msg.content },
								{
									type: 'image_url',
									image_url: { url: `data:${msg.imageMimeType};base64,${msg.imageBase64}` },
								},
							],
						})
					} else {
						result.push({ role: 'user', content: msg.content })
					}
					break
				}
				case 'brain':
					result.push({ role: 'assistant', content: msg.content })
					break
				case 'tool_result': {
					result.push({
						role: 'tool',
						content: msg.content,
						tool_call_id: (msg as any).toolCallId || 'unknown',
					})
					if (msg.imageBase64 && msg.imageMimeType) {
						result.push({
							role: 'user',
							content: [
								{ type: 'text', text: '[Image from tool result]' },
								{
									type: 'image_url',
									image_url: { url: `data:${msg.imageMimeType};base64,${msg.imageBase64}` },
								},
							],
						})
					}
					break
				}
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

	private convertTools(tools: ToolSummary[]): OpenAI.ChatCompletionTool[] {
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

	private parseToolCalls(message: OpenAI.ChatCompletionMessage): PlannedAction[] {
		if (!message.tool_calls || message.tool_calls.length === 0) {
			return []
		}
		return message.tool_calls.map((call) => {
			let params: Record<string, unknown> = {}
			try {
				params = JSON.parse(call.function.arguments)
			} catch {}
			return { tool: call.function.name, params }
		})
	}
}
