import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import type {
	PawDefinition,
	AgentContext,
	AgentPlan,
	AgentMessage,
	ActiveSkill,
	PlannedAction,
	ToolSummary,
} from '@openvole/paw-sdk'

let client: Anthropic | undefined
let model: string = 'claude-sonnet-4-20250514'

/** Cached identity files — loaded once on startup */
let identityContext: string | undefined

/** Custom brain prompt from BRAIN.md — overrides default system prompt if present */
let customBrainPrompt: string | undefined

/** Load BRAIN.md from .openvole/paws/paw-claude/BRAIN.md — scaffolds from packaged default on first run */
async function loadBrainPrompt(): Promise<string | undefined> {
	const brainPath = path.resolve(process.cwd(), '.openvole', 'paws', 'paw-claude', 'BRAIN.md')

	// Scaffold on first run: copy packaged BRAIN.md to local paw data dir
	try {
		await fs.access(brainPath)
	} catch {
		try {
			const pkgPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'BRAIN.md')
			const defaultContent = await fs.readFile(pkgPath, 'utf-8')
			await fs.mkdir(path.dirname(brainPath), { recursive: true })
			await fs.writeFile(brainPath, defaultContent, 'utf-8')
			console.log('[paw-claude] scaffolded BRAIN.md to .openvole/paws/paw-claude/')
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

function getClient(): Anthropic {
	if (!client) {
		const apiKey = process.env.ANTHROPIC_API_KEY
		const baseURL = process.env.ANTHROPIC_BASE_URL
		model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514'
		client = new Anthropic({
			apiKey,
			...(baseURL ? { baseURL } : {}),
		})
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
	messages: AgentMessage[],
	sessionHistory?: string,
): Anthropic.MessageParam[] {
	const result: Anthropic.MessageParam[] = []

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
					role: 'user',
					content: [
						{
							type: 'tool_result',
							tool_use_id: (msg as any).toolUseId || 'unknown',
							content: msg.content,
						},
					],
				})
				break
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

function convertTools(
	tools: ToolSummary[],
): Anthropic.Tool[] {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: {
			type: 'object' as const,
			properties: {},
		},
	}))
}

/** Estimate token count for a string (~4 chars per token) */
function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4)
}

/** Estimate total tokens for Anthropic messages (system prompt counted separately) */
function estimateMessageTokens(messages: Anthropic.MessageParam[]): number {
	return messages.reduce((sum, m) => {
		const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
		return sum + estimateTokens(content) + 4
	}, 0)
}

/** Trim messages from oldest to fit within token budget */
function trimToFit(
	messages: Anthropic.MessageParam[],
	maxTokens: number,
	systemTokens: number,
	toolTokens: number,
): Anthropic.MessageParam[] {
	const available = maxTokens - systemTokens - toolTokens - 500 // 500 token buffer for response

	if (available <= 0) {
		// System prompt + tools already exceed limit — keep only last 2 messages
		return messages.slice(-2)
	}

	// Trim from oldest until within budget
	let totalTokens = 0
	const kept: Anthropic.MessageParam[] = []
	for (let i = messages.length - 1; i >= 0; i--) {
		const content = typeof messages[i].content === 'string' ? messages[i].content as string : JSON.stringify(messages[i].content)
		const msgTokens = estimateTokens(content) + 4
		if (totalTokens + msgTokens > available) break
		kept.unshift(messages[i])
		totalTokens += msgTokens
	}

	return kept
}

function parseToolCalls(
	response: Anthropic.Message,
): PlannedAction[] {
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

export const paw: PawDefinition = {
	name: '@openvole/paw-claude',
	version: '0.1.0',
	description: 'Brain Paw powered by Anthropic Claude',
	brain: true,

	async think(context: AgentContext): Promise<AgentPlan> {
		const anthropic = getClient()
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
			let anthropicMessages = convertMessages(context.messages, sessionHistory)
			const anthropicTools = convertTools(context.availableTools)

			// Estimate tool tokens
			const toolTokens = estimateTokens(JSON.stringify(anthropicTools))
			const systemTokens = estimateTokens(systemPrompt)

			// Get max context from env or default (200K for Claude)
			const maxContextTokens = Number(process.env.ANTHROPIC_MAX_CONTEXT) || 200000

			// Trim messages to fit within context limit
			const totalTokens = estimateMessageTokens(anthropicMessages) + systemTokens + toolTokens
			if (totalTokens > maxContextTokens) {
				console.warn(
					`[paw-claude] context ${totalTokens} tokens exceeds limit ${maxContextTokens}, trimming oldest messages`,
				)
				anthropicMessages = trimToFit(anthropicMessages, maxContextTokens, systemTokens, toolTokens)
			}

			console.log(
				`[paw-claude] chat request — model: ${model}, messages: ${anthropicMessages.length}, tools: ${anthropicTools.length}, ~${estimateMessageTokens(anthropicMessages) + systemTokens + toolTokens} tokens`,
			)

			const response = await anthropic.messages.create({
				model,
				max_tokens: 4096,
				system: systemPrompt,
				messages: anthropicMessages,
				...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
			})

			console.log(`[paw-claude] tokens — INPUT: ${response.usage.input_tokens}, OUTPUT: ${response.usage.output_tokens} (model: ${model})`)

			const durationMs = Date.now() - start
			console.log(
				`[paw-claude] think completed in ${durationMs}ms (model: ${model})`,
			)

			const actions = parseToolCalls(response)

			if (actions.length > 0) {
				return {
					actions,
					execution: 'sequential',
				}
			}

			// Extract text response
			const text = response.content
				.filter((block): block is Anthropic.TextBlock => block.type === 'text')
				.map((block) => block.text)
				.join('')
				.trim()

			if (!text) {
				return { actions: [], done: false }
			}

			return {
				actions: [],
				response: text,
				done: response.stop_reason === 'end_turn',
			}
		} catch (error) {
			const durationMs = Date.now() - start
			const message = error instanceof Error ? error.message : String(error)
			console.log(`[paw-claude] think failed after ${durationMs}ms: ${message}`)
			return {
				actions: [],
				response: message,
				done: true,
			}
		}
	},

	async onLoad() {
		getClient()
		customBrainPrompt = await loadBrainPrompt()
		identityContext = await loadIdentityFiles()
		if (identityContext) {
			console.log('[paw-claude] loaded identity files (SOUL.md, USER.md, AGENT.md)')
		}
		console.log(
			`[paw-claude] loaded — model: ${model}`,
		)
	},

	async onUnload() {
		client = undefined
		console.log('[paw-claude] unloaded')
	},
}
