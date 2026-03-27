import { Ollama, type ChatResponse, type Message, type Tool } from 'ollama'
import type {
	AgentMessage,
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
	 * Convert AgentMessage[] to Ollama Message[].
	 * Session history injected as structured user/assistant messages.
	 */
	convertMessages(
		systemPrompt: string,
		messages: AgentMessage[],
		sessionHistory?: string,
	): Message[] {
		const result: Message[] = [{ role: 'system', content: systemPrompt }]

		// Inject session history as structured user/assistant messages
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
	 * Send a chat request to Ollama. Context is pre-trimmed by core.
	 */
	async chat(
		systemPrompt: string,
		messages: AgentMessage[],
		tools: ToolSummary[],
		sessionHistory?: string,
	): Promise<ChatResponse> {
		const ollamaMessages = this.convertMessages(systemPrompt, messages, sessionHistory)
		const ollamaTools = this.convertTools(tools)

		const response = await this.client.chat({
			model: this.model,
			messages: ollamaMessages,
			tools: ollamaTools.length > 0 ? ollamaTools : undefined,
			stream: false,
		})

		// Log actual token usage from API response
		const inputTokens = (response as Record<string, unknown>).prompt_eval_count ?? '?'
		const outputTokens = (response as Record<string, unknown>).eval_count ?? '?'
		console.log(
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
