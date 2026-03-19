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
