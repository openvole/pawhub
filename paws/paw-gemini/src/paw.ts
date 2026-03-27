import {
	GoogleGenerativeAI,
	type GenerativeModel,
	type Content,
	type Part,
	type FunctionDeclaration,
	type Tool as GeminiTool,
	SchemaType,
} from '@google/generative-ai'
import type {
	PawDefinition,
	AgentContext,
	AgentPlan,
	AgentMessage,
	PlannedAction,
	ToolSummary,
} from '@openvole/paw-sdk'

let genAI: GoogleGenerativeAI | undefined
let generativeModel: GenerativeModel | undefined
let model: string = 'gemini-2.0-flash'

function getModel(): GenerativeModel {
	if (!generativeModel) {
		const apiKey = process.env.GEMINI_API_KEY
		if (!apiKey) {
			throw new Error('GEMINI_API_KEY environment variable is required')
		}
		model = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
		genAI = new GoogleGenerativeAI(apiKey)
		generativeModel = genAI.getGenerativeModel({ model })
	}
	return generativeModel
}

function convertMessages(
	messages: AgentMessage[],
	sessionHistory?: string,
): Content[] {
	const result: Content[] = []

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
				result.push({ role: 'user', parts: [{ text: content }] })
			} else if (role === 'brain') {
				result.push({ role: 'model', parts: [{ text: content }] })
			}
			// Tool results in session history are skipped as structured messages
			// — they were already seen by the Brain in previous tasks
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
			case 'brain':
				result.push({
					role: 'model',
					parts: [{ text: msg.content }],
				})
				break
			case 'tool_result': {
				const toolParts: Part[] = [
					{
						functionResponse: {
							name: (msg as any).toolName || 'unknown',
							response: { result: msg.content },
						},
					},
				]
				// Attach image as Gemini inlineData part if present
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
				result.push({
					role: 'function',
					parts: [
						{
							functionResponse: {
								name: (msg as any).toolName || 'unknown',
								response: { error: msg.content },
							},
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
): GeminiTool[] {
	if (tools.length === 0) return []

	const functionDeclarations: FunctionDeclaration[] = tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: {
			type: SchemaType.OBJECT,
			properties: {},
		},
	}))

	return [{ functionDeclarations }]
}

function parseToolCalls(
	parts: Part[],
): PlannedAction[] {
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

export const paw: PawDefinition = {
	name: '@openvole/paw-gemini',
	version: '0.1.0',
	description: 'Brain Paw powered by Google Gemini',
	brain: true,

	async think(context: AgentContext): Promise<AgentPlan> {
		const geminiModel = getModel()
		const start = Date.now()

		try {
			// System prompt is built by core — use it directly
			const systemPrompt = (context as Record<string, unknown>).systemPrompt as string | undefined
				?? 'You are an AI agent powered by OpenVole.'

			const sessionHistory = context.metadata?.sessionHistory as string | undefined
			const geminiContents = convertMessages(context.messages, sessionHistory)
			const geminiTools = convertTools(context.availableTools)

			console.log(
				`[paw-gemini] chat request — model: ${model}, messages: ${geminiContents.length}, tools: ${geminiTools.length}`,
			)

			const chat = geminiModel.startChat({
				history: geminiContents.slice(0, -1),
				systemInstruction: { role: 'user', parts: [{ text: systemPrompt }] },
				tools: geminiTools.length > 0 ? geminiTools : undefined,
			})

			// Send the last message (or a default if empty)
			const lastContent = geminiContents[geminiContents.length - 1]
			const lastParts = lastContent?.parts || [{ text: '' }]

			const response = await chat.sendMessage(lastParts)

			console.log(`[paw-gemini] tokens — INPUT: ${response.response.usageMetadata?.promptTokenCount ?? '?'}, OUTPUT: ${response.response.usageMetadata?.candidatesTokenCount ?? '?'} (model: ${model})`)

			const durationMs = Date.now() - start
			console.log(
				`[paw-gemini] think completed in ${durationMs}ms (model: ${model})`,
			)

			const candidate = response.response.candidates?.[0]
			if (!candidate) {
				return {
					actions: [],
					response: 'No response from Gemini.',
					done: true,
				}
			}

			const actions = parseToolCalls(candidate.content.parts)

			if (actions.length > 0) {
				return {
					actions,
					execution: 'sequential',
				}
			}

			const text = candidate.content.parts
				.filter((part): part is Part & { text: string } => 'text' in part && part.text.trim() !== '')
				.map((part) => part.text)
				.join('')

			if (!text) {
				// Gemini returned no text — likely a function call response with no accompanying text
				// Don't mark as done so the loop continues
				return {
					actions: [],
					done: false,
				}
			}

			return {
				actions: [],
				response: text,
				done: true,
			}
		} catch (error) {
			const durationMs = Date.now() - start
			const message = error instanceof Error ? error.message : String(error)
			console.log(`[paw-gemini] think failed after ${durationMs}ms: ${message}`)
			return {
				actions: [],
				response: message,
				done: true,
			}
		}
	},

	async onLoad() {
		getModel()
		console.log(
			`[paw-gemini] loaded — model: ${model}`,
		)
	},

	async onUnload() {
		generativeModel = undefined
		genAI = undefined
		console.log('[paw-gemini] unloaded')
	},
}
