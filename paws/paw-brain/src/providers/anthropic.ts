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

		// Monotonic counter for synthetic tool_use IDs — Anthropic requires every
		// tool_result to reference the tool_use_id of a preceding assistant tool_use
		// block. The core loop stores tool calls as AgentMessage.toolCall rather than
		// provider-specific IDs, so we synthesise IDs and pair them up.
		let toolUseSeq = 0

		for (const msg of messages) {
			switch (msg.role) {
				case 'user':
					result.push({ role: 'user', content: msg.content })
					break
				case 'brain': {
					// If this brain message recorded tool calls, reconstruct proper
					// Anthropic tool_use blocks so subsequent tool_result messages
					// reference valid tool_use_ids.
					if (msg.toolCall) {
						const blocks: Anthropic.ContentBlockParam[] = []
						// Add any text the brain emitted alongside the tool calls
						const textContent = msg.content?.replace(/^Calling tools:.*/, '').trim()
						if (textContent) {
							blocks.push({ type: 'text', text: textContent })
						}
						// Expand single or "multiple" tool calls
						const calls = msg.toolCall.name === 'multiple'
							? (msg.toolCall.params as Array<{ tool: string; params: unknown }>)
							: [{ tool: msg.toolCall.name, params: msg.toolCall.params }]
						for (const call of calls) {
							toolUseSeq++
							blocks.push({
								type: 'tool_use',
								id: `tool_${toolUseSeq}`,
								name: call.tool,
								input: (call.params as Record<string, unknown>) ?? {},
							})
						}
						result.push({ role: 'assistant', content: blocks })
					} else {
						result.push({ role: 'assistant', content: msg.content })
					}
					break
				}
				case 'tool_result': {
					// Pair with the next tool_use ID in sequence
					toolUseSeq++
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
								tool_use_id: `tool_${toolUseSeq}`,
								content: toolResultContent,
							},
						],
					})
					break
				}
				case 'error': {
					// Errors from tool execution are also tool_results with is_error.
					// Only wrap as tool_result if this error came from a tool call;
					// otherwise it is a system error (rate limit, stuck-loop hint, etc.)
					if (msg.toolCall) {
						toolUseSeq++
						result.push({
							role: 'user',
							content: [
								{
									type: 'tool_result',
									tool_use_id: `tool_${toolUseSeq}`,
									content: `Error: ${msg.content}`,
									is_error: true,
								},
							],
						})
					} else {
						result.push({ role: 'user', content: `Error: ${msg.content}` })
					}
					break
				}
			}
		}

		return result
	}

	private convertTools(tools: ToolSummary[]): Anthropic.Tool[] {
		return tools.map((tool) => {
			// ToolSummary.parameters is already JSON Schema (converted from Zod by core)
			const schema = (tool.parameters && typeof tool.parameters === 'object')
				? tool.parameters as Record<string, unknown>
				: { type: 'object', properties: {} }
			return {
				name: tool.name,
				description: tool.description,
				input_schema: {
					type: 'object' as const,
					...schema,
				},
			}
		})
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
