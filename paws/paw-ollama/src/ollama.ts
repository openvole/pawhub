import { Ollama, type ChatResponse, type Message, type Tool } from 'ollama'
import type {
	AgentMessage,
	ActiveSkill,
	PlannedAction,
	ToolSummary,
} from '@openvole/paw-sdk'

export class OllamaClient {
	private client: Ollama
	private model: string

	constructor(
		host: string = 'http://localhost:11434',
		model: string = 'qwen3:latest',
	) {
		this.client = new Ollama({ host })
		this.model = model
	}

	getModel(): string {
		return this.model
	}

	/**
	 * Build the system prompt from active skills and available tools.
	 */
	buildSystemPrompt(
		activeSkills: ActiveSkill[],
		availableTools: ToolSummary[],
		metadata?: Record<string, unknown>,
		identityContext?: string,
	): string {
		const now = new Date()
		const parts: string[] = [
			`You are an AI agent powered by OpenVole. You accomplish tasks by using tools step by step.

## Current Context
- Date: ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
- Time: ${now.toLocaleTimeString('en-US', { hour12: true })}
- Platform: ${process.platform}
- Model: ${this.model}

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
- Store credentials and personal identifiers ONLY in the vault — never in memory or workspace`,
		]

		// Inject identity context (SOUL.md, USER.md, AGENT.md) if available
		if (identityContext) {
			parts.push('')
			parts.push(identityContext)
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

	/**
	 * Convert AgentMessage[] to Ollama Message[].
	 */
	convertMessages(
		systemPrompt: string,
		messages: AgentMessage[],
	): Message[] {
		const result: Message[] = [{ role: 'system', content: systemPrompt }]

		for (const msg of messages) {
			switch (msg.role) {
				case 'user':
					result.push({ role: 'user', content: msg.content })
					break
				case 'brain':
					result.push({ role: 'assistant', content: msg.content })
					break
				case 'tool_result':
					result.push({ role: 'tool', content: msg.content })
					break
				case 'error':
					result.push({
						role: 'tool',
						content: `Error: ${msg.content}`,
					})
					break
			}
		}

		return result
	}

	/**
	 * Convert ToolSummary[] to Ollama Tool[] for function calling.
	 */
	convertTools(tools: ToolSummary[]): Tool[] {
		return tools.map((tool) => ({
			type: 'function',
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

	/**
	 * Send a chat request to Ollama and return the raw response.
	 */
	async chat(
		systemPrompt: string,
		messages: AgentMessage[],
		tools: ToolSummary[],
	): Promise<ChatResponse> {
		const ollamaMessages = this.convertMessages(systemPrompt, messages)
		const ollamaTools = this.convertTools(tools)

		console.log(
			`[paw-ollama] chat request — model: ${this.model}, messages: ${ollamaMessages.length}, tools: ${ollamaTools.length}`,
		)
		return this.client.chat({
			model: this.model,
			messages: ollamaMessages,
			tools: ollamaTools.length > 0 ? ollamaTools : undefined,
			stream: false,
		})
	}

	/**
	 * Extract PlannedAction[] from Ollama tool_calls.
	 */
	parseToolCalls(response: ChatResponse): PlannedAction[] {
		if (!response.message.tool_calls || response.message.tool_calls.length === 0) {
			return []
		}

		return response.message.tool_calls.map((call) => ({
			tool: call.function.name,
			params: call.function.arguments,
		}))
	}
}
