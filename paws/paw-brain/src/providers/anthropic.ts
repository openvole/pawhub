import Anthropic from '@anthropic-ai/sdk'
import type { AgentMessage, PlannedAction, ToolSummary } from '@openvole/paw-sdk'
import type { BrainProvider, ThinkResult } from '../types.js'

export class AnthropicProvider implements BrainProvider {
	readonly name = 'anthropic'
	readonly model: string
	private client: Anthropic

	constructor(apiKey: string, model: string, baseURL?: string) {
		this.model = model
		this.client = new Anthropic({
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
		const anthropicMessages = this.convertMessages(messages, sessionHistory)
		const anthropicTools = this.convertTools(tools)

		const response = await this.client.messages.create({
			model: this.model,
			max_tokens: 4096,
			system: systemPrompt,
			messages: anthropicMessages,
			...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
		})

		const actions = this.parseToolCalls(response)

		if (actions.length > 0) {
			return {
				actions,
				inputTokens: response.usage.input_tokens,
				outputTokens: response.usage.output_tokens,
			}
		}

		const text = response.content
			.filter((block): block is Anthropic.TextBlock => block.type === 'text')
			.map((block) => block.text)
			.join('')
			.trim()

		return {
			actions: [],
			response: text || undefined,
			done: text ? response.stop_reason === 'end_turn' : false,
			inputTokens: response.usage.input_tokens,
			outputTokens: response.usage.output_tokens,
		}
	}

	private convertMessages(
		messages: AgentMessage[],
		sessionHistory?: string,
	): Anthropic.MessageParam[] {
		const result: Anthropic.MessageParam[] = []

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
					const toolResultContent: Anthropic.ToolResultBlockParam['content'] = [
						{ type: 'text', text: msg.content },
					]
					if (msg.imageBase64 && msg.imageMimeType) {
						toolResultContent.push({
							type: 'image',
							source: {
								type: 'base64',
								media_type: msg.imageMimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
								data: msg.imageBase64,
							},
						})
					}
					result.push({
						role: 'user',
						content: [
							{
								type: 'tool_result',
								tool_use_id: (msg as any).toolUseId || 'unknown',
								content: toolResultContent,
							},
						],
					})
					break
				}
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

	private convertTools(tools: ToolSummary[]): Anthropic.Tool[] {
		return tools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			input_schema: {
				type: 'object' as const,
				properties: {},
			},
		}))
	}

	private parseToolCalls(response: Anthropic.Message): PlannedAction[] {
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
}
