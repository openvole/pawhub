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
		customBrainPrompt?: string,
	): string {
		const now = new Date()
		const runtimeContext = `## Current Context
- Date: ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
- Time: ${now.toLocaleTimeString('en-US', { hour12: true })}
- Platform: ${process.platform}
- Model: ${this.model}`

		// Use BRAIN.md prompt (loaded from user's local dir or packaged default)
		const basePrompt = customBrainPrompt ?? 'You are an AI agent powered by OpenVole. You accomplish tasks by using tools step by step.'

		const parts: string[] = [basePrompt, '', runtimeContext]

		// Inject identity context (SOUL.md, USER.md, AGENT.md) if available
		if (identityContext) {
			parts.push('')
			parts.push(identityContext)
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

	/**
	 * Convert AgentMessage[] to Ollama Message[].
	 */
	convertMessages(
		systemPrompt: string,
		messages: AgentMessage[],
		sessionHistory?: string,
	): Message[] {
		const result: Message[] = [{ role: 'system', content: systemPrompt }]

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
		return tools.map((tool) => {
			// Parameters are pre-converted to JSON Schema by the core
			const params = (tool as { parameters?: Record<string, unknown> }).parameters

			return {
				type: 'function',
				function: {
					name: tool.name,
					description: tool.description,
					parameters: params ?? {
						type: 'object',
						properties: {},
					},
				},
			}
		})
	}

	/**
	 * Send a chat request to Ollama and return the raw response.
	 */
	/** Estimate token count for a string (~4 chars per token) */
	private estimateTokens(text: string): number {
		return Math.ceil(text.length / 4)
	}

	/** Estimate total tokens for a message list */
	private estimateMessageTokens(messages: Message[]): number {
		return messages.reduce((sum, m) => sum + this.estimateTokens(m.content) + 4, 0)
	}

	/** Trim messages from oldest (after system prompt) to fit within token budget */
	private trimToFit(messages: Message[], maxTokens: number, toolTokens: number): Message[] {
		const systemMsg = messages[0] // always keep system prompt
		const rest = messages.slice(1)

		const systemTokens = this.estimateTokens(systemMsg.content) + 4
		const available = maxTokens - systemTokens - toolTokens - 500 // 500 token buffer for response

		if (available <= 0) {
			// System prompt + tools already exceed limit — keep only system + last 2 messages
			return [systemMsg, ...rest.slice(-2)]
		}

		// Trim from oldest until within budget
		let totalTokens = 0
		const kept: Message[] = []
		for (let i = rest.length - 1; i >= 0; i--) {
			const msgTokens = this.estimateTokens(rest[i].content) + 4
			if (totalTokens + msgTokens > available) break
			kept.unshift(rest[i])
			totalTokens += msgTokens
		}

		return [systemMsg, ...kept]
	}

	async chat(
		systemPrompt: string,
		messages: AgentMessage[],
		tools: ToolSummary[],
		sessionHistory?: string,
	): Promise<ChatResponse> {
		let ollamaMessages = this.convertMessages(systemPrompt, messages, sessionHistory)
		const ollamaTools = this.convertTools(tools)

		// Estimate tool tokens
		const toolTokens = this.estimateTokens(JSON.stringify(ollamaTools))

		// Get max context from env or default (128K for most Ollama models)
		const maxContextTokens = Number(process.env.OLLAMA_MAX_CONTEXT) || 128000

		// Trim messages to fit within context limit
		const totalTokens = this.estimateMessageTokens(ollamaMessages) + toolTokens
		if (totalTokens > maxContextTokens) {
			console.warn(
				`[paw-ollama] context ${totalTokens} tokens exceeds limit ${maxContextTokens}, trimming oldest messages`,
			)
			ollamaMessages = this.trimToFit(ollamaMessages, maxContextTokens, toolTokens)
		}

		const response = await this.client.chat({
			model: this.model,
			messages: ollamaMessages,
			tools: ollamaTools.length > 0 ? ollamaTools : undefined,
			stream: false,
		})

		// Log actual token usage from API response (stderr so paw-loader captures it)
		const inputTokens = (response as Record<string, unknown>).prompt_eval_count ?? '?'
		const outputTokens = (response as Record<string, unknown>).eval_count ?? '?'
		console.error(
			`[paw-ollama] tokens — INPUT: ${inputTokens}, OUTPUT: ${outputTokens} (model: ${this.model})`,
		)

		return response
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
