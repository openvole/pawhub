import * as fs from 'node:fs/promises'
import * as path from 'node:path'
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

/** Cached identity files — loaded once on startup */
let identityContext: string | undefined

/** Custom brain prompt from BRAIN.md — overrides default system prompt if present */
let customBrainPrompt: string | undefined

/** Load BRAIN.md from .openvole/paws/paw-gemini/BRAIN.md — scaffolds from packaged default on first run */
async function loadBrainPrompt(): Promise<string | undefined> {
	const brainPath = path.resolve(process.cwd(), '.openvole', 'paws', 'paw-gemini', 'BRAIN.md')

	// Scaffold on first run: copy packaged BRAIN.md to local paw data dir
	try {
		await fs.access(brainPath)
	} catch {
		try {
			const pkgPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'BRAIN.md')
			const defaultContent = await fs.readFile(pkgPath, 'utf-8')
			await fs.mkdir(path.dirname(brainPath), { recursive: true })
			await fs.writeFile(brainPath, defaultContent, 'utf-8')
			console.log('[paw-gemini] scaffolded BRAIN.md to .openvole/paws/paw-gemini/')
		} catch {
			// No packaged BRAIN.md available
		}
	}

	// Always read from the local paw data dir
	try {
		const content = await fs.readFile(brainPath, 'utf-8')
		if (content.trim()) {
			return content.trim()
		}
	} catch {
		// No BRAIN.md
	}

	return undefined
}

/** Load identity files from .openvole/ (AGENT.md, USER.md, SOUL.md) */
async function loadIdentityFiles(): Promise<string> {
	const openvoleDir = path.resolve(process.cwd(), '.openvole')
	const files = [
		{ name: 'SOUL.md', section: 'Agent Identity' },
		{ name: 'USER.md', section: 'User Profile' },
		{ name: 'AGENT.md', section: 'Agent Rules' },
	]

	const parts: string[] = []
	for (const file of files) {
		try {
			const content = await fs.readFile(path.join(openvoleDir, file.name), 'utf-8')
			if (content.trim()) {
				parts.push(`## ${file.section}\n${content.trim()}`)
			}
		} catch {
			// File doesn't exist — skip
		}
	}

	return parts.join('\n\n')
}

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
	metadata?: Record<string, unknown>,
	identityCtx?: string,
	customBrain?: string,
): string {
	const now = new Date()
	const runtimeContext = `## Current Context
- Date: ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
- Time: ${now.toLocaleTimeString('en-US', { hour12: true })}
- Platform: ${process.platform}
- Model: ${model}`

	// Use custom BRAIN.md if provided, otherwise use default prompt
	const basePrompt = customBrain ?? 'You are an AI agent powered by OpenVole. You accomplish tasks by using tools step by step.'

	const parts: string[] = [basePrompt, '', runtimeContext]

	// Inject identity context (SOUL.md, USER.md, AGENT.md) if available
	if (identityCtx) {
		parts.push('')
		parts.push(identityCtx)
	}

	// Note: session history is injected as structured messages in convertMessages(), not here

	// Inject memory if available
	if (metadata?.memory && typeof metadata.memory === 'string') {
		parts.push('')
		parts.push('## Agent Memory')
		parts.push(metadata.memory)
	}

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

/** Estimate token count for a string (~4 chars per token) */
function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4)
}

/** Estimate total tokens for a Content list */
function estimateContentTokens(contents: Content[]): number {
	return contents.reduce((sum, c) => {
		const text = c.parts.map((p) => ('text' in p ? p.text || '' : JSON.stringify(p))).join('')
		return sum + estimateTokens(text) + 4
	}, 0)
}

/** Trim contents from oldest to fit within token budget */
function trimContentsToFit(
	contents: Content[],
	maxTokens: number,
	systemTokens: number,
	toolTokens: number,
): Content[] {
	const available = maxTokens - systemTokens - toolTokens - 500 // 500 token buffer for response

	if (available <= 0) {
		// System prompt + tools already exceed limit — keep only last 2 contents
		return contents.slice(-2)
	}

	// Trim from oldest until within budget
	let totalTokens = 0
	const kept: Content[] = []
	for (let i = contents.length - 1; i >= 0; i--) {
		const text = contents[i].parts.map((p) => ('text' in p ? p.text || '' : JSON.stringify(p))).join('')
		const msgTokens = estimateTokens(text) + 4
		if (totalTokens + msgTokens > available) break
		kept.unshift(contents[i])
		totalTokens += msgTokens
	}

	return kept
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
				context.metadata,
				identityContext,
				customBrainPrompt,
			)

			const sessionHistory = context.metadata?.sessionHistory as string | undefined
			let geminiContents = convertMessages(context.messages, sessionHistory)
			const geminiTools = convertTools(context.availableTools)

			// Estimate tool tokens
			const toolTokens = estimateTokens(JSON.stringify(geminiTools))
			const systemTokens = estimateTokens(systemPrompt)

			// Get max context from env or default (1M for Gemini)
			const maxContextTokens = Number(process.env.GEMINI_MAX_CONTEXT) || 1000000

			// Trim messages to fit within context limit
			const totalTokens = estimateContentTokens(geminiContents) + systemTokens + toolTokens
			if (totalTokens > maxContextTokens) {
				console.warn(
					`[paw-gemini] context ${totalTokens} tokens exceeds limit ${maxContextTokens}, trimming oldest messages`,
				)
				geminiContents = trimContentsToFit(geminiContents, maxContextTokens, systemTokens, toolTokens)
			}

			console.log(
				`[paw-gemini] chat request — model: ${model}, messages: ${geminiContents.length}, tools: ${geminiTools.length}, ~${estimateContentTokens(geminiContents) + systemTokens + toolTokens} tokens`,
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
		customBrainPrompt = await loadBrainPrompt()
		identityContext = await loadIdentityFiles()
		if (identityContext) {
			console.log('[paw-gemini] loaded identity files (SOUL.md, USER.md, AGENT.md)')
		}
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
