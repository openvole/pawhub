import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import OpenAI from 'openai'
import type {
	PawDefinition,
	AgentContext,
	AgentPlan,
	AgentMessage,
	ActiveSkill,
	PlannedAction,
	ToolSummary,
} from '@openvole/paw-sdk'

let client: OpenAI | undefined
let model: string = 'grok-3'

/** Cached identity files — loaded once on startup */
let identityContext: string | undefined

/** Custom brain prompt from BRAIN.md — overrides default system prompt if present */
let customBrainPrompt: string | undefined

/** Load BRAIN.md from .openvole/paws/paw-xai/BRAIN.md — scaffolds from packaged default on first run */
async function loadBrainPrompt(): Promise<string | undefined> {
	const brainPath = path.resolve(process.cwd(), '.openvole', 'paws', 'paw-xai', 'BRAIN.md')

	// Scaffold on first run: copy packaged BRAIN.md to local paw data dir
	try {
		await fs.access(brainPath)
	} catch {
		try {
			const pkgPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'BRAIN.md')
			const defaultContent = await fs.readFile(pkgPath, 'utf-8')
			await fs.mkdir(path.dirname(brainPath), { recursive: true })
			await fs.writeFile(brainPath, defaultContent, 'utf-8')
			console.log('[paw-xai] scaffolded BRAIN.md to .openvole/paws/paw-xai/')
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

function getClient(): OpenAI | undefined {
	if (!client) {
		const apiKey = process.env.XAI_API_KEY
		if (!apiKey) {
			return undefined
		}
		model = process.env.XAI_MODEL || 'grok-3'
		client = new OpenAI({ apiKey, baseURL: 'https://api.x.ai/v1' })
	}
	return client
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

/** Estimate token count for a string (~4 chars per token) */
function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4)
}

/** Estimate total tokens for a message list */
function estimateMessageTokens(messages: OpenAI.ChatCompletionMessageParam[]): number {
	return messages.reduce((sum, m) => {
		const content = typeof m.content === 'string' ? m.content || '' : JSON.stringify(m.content)
		return sum + estimateTokens(content) + 4
	}, 0)
}

/** Trim messages from oldest (after system prompt) to fit within token budget */
function trimToFit(
	messages: OpenAI.ChatCompletionMessageParam[],
	maxTokens: number,
	toolTokens: number,
): OpenAI.ChatCompletionMessageParam[] {
	const systemMsg = messages[0] // always keep system prompt
	const rest = messages.slice(1)

	const systemContent = typeof systemMsg.content === 'string' ? systemMsg.content || '' : JSON.stringify(systemMsg.content)
	const systemTokens = estimateTokens(systemContent) + 4
	const available = maxTokens - systemTokens - toolTokens - 500 // 500 token buffer for response

	if (available <= 0) {
		// System prompt + tools already exceed limit — keep only system + last 2 messages
		return [systemMsg, ...rest.slice(-2)]
	}

	// Trim from oldest until within budget
	let totalTokens = 0
	const kept: OpenAI.ChatCompletionMessageParam[] = []
	for (let i = rest.length - 1; i >= 0; i--) {
		const content = typeof rest[i].content === 'string' ? rest[i].content || '' : JSON.stringify(rest[i].content)
		const msgTokens = estimateTokens(content) + 4
		if (totalTokens + msgTokens > available) break
		kept.unshift(rest[i])
		totalTokens += msgTokens
	}

	return [systemMsg, ...kept]
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
	name: '@openvole/paw-xai',
	version: '0.1.0',
	description: 'Brain Paw powered by OpenAI',
	brain: true,

	async think(context: AgentContext): Promise<AgentPlan> {
		const openai = getClient()
		if (!openai) {
			return {
				actions: [],
				response: 'XAI_API_KEY not set — paw-xai is not configured.',
				done: true,
			}
		}
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
			let openaiMessages = convertMessages(systemPrompt, context.messages, sessionHistory)
			const openaiTools = convertTools(context.availableTools)

			// Estimate tool tokens
			const toolTokens = estimateTokens(JSON.stringify(openaiTools))

			// Get max context from env or default (131072 for xAI)
			const maxContextTokens = Number(process.env.XAI_MAX_CONTEXT) || 131072

			// Trim messages to fit within context limit
			const totalTokens = estimateMessageTokens(openaiMessages) + toolTokens
			if (totalTokens > maxContextTokens) {
				console.warn(
					`[paw-xai] context ${totalTokens} tokens exceeds limit ${maxContextTokens}, trimming oldest messages`,
				)
				openaiMessages = trimToFit(openaiMessages, maxContextTokens, toolTokens)
			}

			console.log(
				`[paw-xai] chat request — model: ${model}, messages: ${openaiMessages.length}, tools: ${openaiTools.length}, ~${estimateMessageTokens(openaiMessages) + toolTokens} tokens`,
			)

			const response = await openai.chat.completions.create({
				model,
				messages: openaiMessages,
				...(openaiTools.length > 0 ? { tools: openaiTools } : {}),
			})

			const durationMs = Date.now() - start
			console.log(
				`[paw-xai] think completed in ${durationMs}ms (model: ${model})`,
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

			const text = choice.message.content || ''

			return {
				actions: [],
				response: text,
				done: choice.finish_reason === 'stop',
			}
		} catch (error) {
			const durationMs = Date.now() - start
			const message = error instanceof Error ? error.message : String(error)
			console.error(`[paw-xai] think failed after ${durationMs}ms: ${message}`)
			return {
				actions: [],
				response: message,
				done: true,
			}
		}
	},

	async onLoad() {
		if (!process.env.XAI_API_KEY) {
			console.log('[paw-xai] XAI_API_KEY not set — paw will not function')
			return
		}
		getClient()
		customBrainPrompt = await loadBrainPrompt()
		identityContext = await loadIdentityFiles()
		if (identityContext) {
			console.log('[paw-xai] loaded identity files (SOUL.md, USER.md, AGENT.md)')
		}
		console.log(
			`[paw-xai] loaded — model: ${model}`,
		)
	},

	async onUnload() {
		client = undefined
		console.log('[paw-xai] unloaded')
	},
}
