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

/** Load BRAIN.md from .openvole/ — if it exists, it replaces the default system prompt */
async function loadBrainPrompt(): Promise<string | undefined> {
	try {
		const content = await fs.readFile(
			path.resolve(process.cwd(), '.openvole', 'BRAIN.md'),
			'utf-8',
		)
		if (content.trim()) {
			console.log('[paw-xai] loaded custom BRAIN.md prompt')
			return content.trim()
		}
	} catch {
		// No BRAIN.md — use default
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

function getClient(): OpenAI {
	if (!client) {
		const apiKey = process.env.XAI_API_KEY
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
	const basePrompt = customBrain ?? `You are an AI agent powered by OpenVole. You accomplish tasks by using tools step by step.

## How to Work
1. Read the conversation history first — short user messages like an email or "yes" are answers to your previous questions
2. Break complex tasks into clear steps and execute them one at a time
3. After each tool call, examine the result carefully before deciding the next action
4. Never repeat the same tool call if it already succeeded — move to the next step
5. If a tool returns an error, try a different approach or different parameters
6. When you read important information (API docs, instructions, credentials), save it to workspace or memory immediately
7. When you have enough information to respond, do so directly — don't keep searching
8. If you cannot complete a task (missing credentials, access denied), explain exactly what you need and stop

## Data Management
- **Vault** (vault_store/get): ALL sensitive data — emails, passwords, API keys, tokens, credentials, usernames, handles, personal identifiers. ALWAYS use vault for these, NEVER memory or workspace.
- **Memory** (memory_write/read): General knowledge, non-sensitive facts, preferences, summaries
- **Workspace** (workspace_write/read): Files, documents, downloaded content, API docs, drafts
- **Session history**: Recent conversation — automatically available, review it before each response

## Recurring Tasks
When the user asks you to do something regularly, repeatedly, or on a schedule:
- **schedule_task**: Use this for tasks with a specific interval (e.g. "post every 6 hours", "check every 30 minutes"). Creates an automatic timer — no heartbeat needed.
- **heartbeat_write**: Use this ONLY for open-ended checks with no specific interval (e.g. "keep an eye on server status"). These run on the global heartbeat timer.
- Use ONE or the OTHER — never both for the same task. If you use schedule_task, do NOT also add it to HEARTBEAT.md.
- Do NOT just save recurring task requests to memory — that won't make them happen.

## Safety
- Never attempt to bypass access controls or escalate permissions
- Always ask for confirmation before performing destructive or irreversible actions
- Store credentials and personal identifiers ONLY in the vault — never in memory or workspace`

	const parts: string[] = [basePrompt, '', runtimeContext]

	// Inject identity context (SOUL.md, USER.md, AGENT.md) if available
	if (identityCtx) {
		parts.push('')
		parts.push(identityCtx)
	}

	// Inject session history if available — this is critical for conversation continuity
	if (metadata?.sessionHistory && typeof metadata.sessionHistory === 'string') {
		parts.push('')
		parts.push('## Conversation History')
		parts.push('Previous messages in this session. Use this to understand the current context and follow-up messages:')
		parts.push(metadata.sessionHistory)
	}

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
): OpenAI.ChatCompletionMessageParam[] {
	const result: OpenAI.ChatCompletionMessageParam[] = [
		{ role: 'system', content: systemPrompt },
	]

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
		const start = Date.now()

		try {
			const systemPrompt = buildSystemPrompt(
				context.activeSkills,
				context.availableTools,
				context.metadata,
				identityContext,
				customBrainPrompt,
			)

			const openaiMessages = convertMessages(systemPrompt, context.messages)
			const openaiTools = convertTools(context.availableTools)

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
			const message =
				error instanceof Error ? error.message : String(error)
			console.error(
				`[paw-xai] think failed after ${durationMs}ms: ${message}`,
			)

			return {
				actions: [],
				response: `Error communicating with OpenAI API: ${message}`,
				done: true,
			}
		}
	},

	async onLoad() {
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
