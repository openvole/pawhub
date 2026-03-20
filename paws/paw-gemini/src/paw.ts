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
	ActiveSkill,
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
): Content[] {
	const result: Content[] = []

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
			case 'tool_result':
				result.push({
					role: 'function',
					parts: [
						{
							functionResponse: {
								name: (msg as any).toolName || 'unknown',
								response: { result: msg.content },
							},
						},
					],
				})
				break
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
			const systemPrompt = buildSystemPrompt(
				context.activeSkills,
				context.availableTools,
			)

			const geminiContents = convertMessages(context.messages)
			const geminiTools = convertTools(context.availableTools)

			const chat = geminiModel.startChat({
				history: geminiContents.slice(0, -1),
				systemInstruction: { role: 'user', parts: [{ text: systemPrompt }] },
				tools: geminiTools.length > 0 ? geminiTools : undefined,
			})

			// Send the last message (or a default if empty)
			const lastContent = geminiContents[geminiContents.length - 1]
			const lastParts = lastContent?.parts || [{ text: '' }]

			const response = await chat.sendMessage(lastParts)

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
				.filter((part): part is Part & { text: string } => 'text' in part)
				.map((part) => part.text)
				.join('')

			return {
				actions: [],
				response: text,
				done: true,
			}
		} catch (error) {
			const durationMs = Date.now() - start
			const message =
				error instanceof Error ? error.message : String(error)
			console.error(
				`[paw-gemini] think failed after ${durationMs}ms: ${message}`,
			)

			return {
				actions: [],
				response: `Error communicating with Gemini API: ${message}`,
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
