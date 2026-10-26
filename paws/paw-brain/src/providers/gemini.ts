import {
	GoogleGenerativeAI,
	type GenerativeModel,
	type Content,
	type Part,
	type FunctionDeclaration,
	type Tool as GeminiTool,
	SchemaType,
} from '@google/generative-ai'
import type { AgentMessage, PlannedAction, ToolSummary } from '@openvole/paw-sdk'
import type { BrainProvider, ThinkResult } from '../types.js'

export class GeminiProvider implements BrainProvider {
	readonly name = 'gemini'
	readonly model: string
	private generativeModel: GenerativeModel

	constructor(apiKey: string, model: string) {
		this.model = model
		const genAI = new GoogleGenerativeAI(apiKey)
		this.generativeModel = genAI.getGenerativeModel({ model })
	}

	async think(
		systemPrompt: string,
		messages: AgentMessage[],
		tools: ToolSummary[],
		sessionHistory?: string,
	): Promise<ThinkResult> {
		const geminiContents = this.convertMessages(messages, sessionHistory)
		const geminiTools = this.convertTools(tools)

		const chat = this.generativeModel.startChat({
			history: geminiContents.slice(0, -1),
			systemInstruction: { role: 'user', parts: [{ text: systemPrompt }] },
			tools: geminiTools.length > 0 ? geminiTools : undefined,
		})

		const lastContent = geminiContents[geminiContents.length - 1]
		const lastParts = lastContent?.parts || [{ text: '' }]

		const response = await chat.sendMessage(lastParts)

		const candidate = response.response.candidates?.[0]
		if (!candidate) {
			return {
				actions: [],
				response: 'No response from Gemini.',
				done: true,
				inputTokens: response.response.usageMetadata?.promptTokenCount,
				outputTokens: response.response.usageMetadata?.candidatesTokenCount,
			}
		}

		const actions = this.parseToolCalls(candidate.content.parts)

		if (actions.length > 0) {
			return {
				actions,
				inputTokens: response.response.usageMetadata?.promptTokenCount,
				outputTokens: response.response.usageMetadata?.candidatesTokenCount,
			}
		}

		const text = candidate.content.parts
			.filter((part): part is Part & { text: string } => 'text' in part && part.text.trim() !== '')
			.map((part) => part.text)
			.join('')

		return {
			actions: [],
			response: text || undefined,
			done: text ? true : false,
			inputTokens: response.response.usageMetadata?.promptTokenCount,
			outputTokens: response.response.usageMetadata?.candidatesTokenCount,
		}
	}

	private convertMessages(
		messages: AgentMessage[],
		sessionHistory?: string,
	): Content[] {
		const result: Content[] = []

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
					result.push({ role: 'user', parts: [{ text: content }] })
				} else if (role === 'brain') {
					result.push({ role: 'model', parts: [{ text: content }] })
				}
			}
		}

		for (const msg of messages) {
			switch (msg.role) {
				case 'user':
					result.push({
						role: 'user',
						parts: [{ text: msg.content }],
					})
					break
				case 'brain': {
					// If this brain message recorded tool calls, reconstruct proper
					// Gemini functionCall parts so subsequent functionResponse parts
					// are valid.
					if (msg.toolCall) {
						const parts: Part[] = []
						const textContent = msg.content?.replace(/^Calling tools:.*/, '').trim()
						if (textContent) {
							parts.push({ text: textContent })
						}
						const calls = msg.toolCall.name === 'multiple'
							? (msg.toolCall.params as Array<{ tool: string; params: unknown }>)
							: [{ tool: msg.toolCall.name, params: msg.toolCall.params }]
						for (const call of calls) {
							parts.push({
								functionCall: {
									name: call.tool,
									args: (call.params as Record<string, unknown>) ?? {},
								},
							})
						}
						result.push({ role: 'model', parts })
					} else {
						result.push({
							role: 'model',
							parts: [{ text: msg.content }],
						})
					}
					break
				}
				case 'tool_result': {
					const toolParts: Part[] = [
						{
							functionResponse: {
								name: msg.toolCall?.name || 'unknown',
								response: { result: msg.content },
							},
						},
					]
					if (msg.imageBase64 && msg.imageMimeType) {
						toolParts.push({
							inlineData: {
								mimeType: msg.imageMimeType,
								data: msg.imageBase64,
							},
						})
					}
					result.push({
						role: 'function',
						parts: toolParts,
					})
					break
				}
				case 'error':
					// Only emit as functionResponse if this error came from a tool call
					if (msg.toolCall) {
						result.push({
							role: 'function',
							parts: [
								{
									functionResponse: {
										name: msg.toolCall.name,
										response: { error: msg.content },
									},
								},
							],
						})
					} else {
						result.push({
							role: 'user',
							parts: [{ text: `Error: ${msg.content}` }],
						})
					}
					break
			}
		}

		return result
	}

	private convertTools(tools: ToolSummary[]): GeminiTool[] {
		if (tools.length === 0) return []

		const functionDeclarations: FunctionDeclaration[] = tools.map((tool) => {
			// ToolSummary.parameters is already JSON Schema (converted from Zod by core).
			// Gemini expects its own schema format but accepts JSON Schema-like objects.
			if (tool.parameters && typeof tool.parameters === 'object') {
				const schema = tool.parameters as Record<string, unknown>
				return {
					name: tool.name,
					description: tool.description,
					parameters: {
						type: SchemaType.OBJECT,
						properties: {},
						...schema,
					},
				}
			}
			return {
				name: tool.name,
				description: tool.description,
				parameters: { type: SchemaType.OBJECT, properties: {} },
			}
		})

		return [{ functionDeclarations }]
	}

	private parseToolCalls(parts: Part[]): PlannedAction[] {
		const actions: PlannedAction[] = []
		for (const part of parts) {
			if ('functionCall' in part && part.functionCall) {
				actions.push({
					tool: part.functionCall.name,
					params: (part.functionCall.args as Record<string, unknown>) || {},
				})
			}
		}
		return actions
	}
}
