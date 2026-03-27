import type { PawDefinition, AgentContext, AgentPlan } from '@openvole/paw-sdk'
import { OllamaClient } from './ollama.js'

let client: OllamaClient | undefined

function getClient(): OllamaClient {
	if (!client) {
		const host = process.env.OLLAMA_HOST || 'http://localhost:11434'
		const model = process.env.OLLAMA_MODEL || 'qwen3:latest'
		client = new OllamaClient(host, model)
	}
	return client
}

export const paw: PawDefinition = {
	name: '@openvole/paw-ollama',
	version: '0.1.0',
	description: 'Brain Paw powered by Ollama for local LLM inference',
	brain: true,

	async think(context: AgentContext): Promise<AgentPlan> {
		const ollamaClient = getClient()
		const start = Date.now()

		try {
			// System prompt is built by core — use it directly
			const systemPrompt = (context as Record<string, unknown>).systemPrompt as string | undefined
				?? 'You are an AI agent powered by OpenVole.'

			const sessionHistory = context.metadata?.sessionHistory as string | undefined
			const response = await ollamaClient.chat(
				systemPrompt,
				context.messages,
				context.availableTools,
				sessionHistory,
			)

			const durationMs = Date.now() - start
			console.log(
				`[paw-ollama] think completed in ${durationMs}ms (model: ${ollamaClient.getModel()})`,
			)

			const actions = ollamaClient.parseToolCalls(response)

			console.log(
				`[paw-ollama] response — role: ${response.message.role}, content: ${(response.message.content || '').substring(0, 100)}, tool_calls: ${response.message.tool_calls?.length ?? 0}, actions: ${actions.length}`,
			)

			if (actions.length > 0) {
				return {
					actions,
					execution: 'sequential',
				}
			}

			const text = (response.message.content || '').trim()

			if (!text) {
				return { actions: [], done: false }
			}

			return {
				actions: [],
				response: text,
				done: true,
			}
		} catch (error) {
			const durationMs = Date.now() - start
			const message = error instanceof Error ? error.message : String(error)
			console.error(`[paw-ollama] think failed after ${durationMs}ms: ${message}`)
			return {
				actions: [],
				response: message,
				done: true,
			}
		}
	},

	async onLoad() {
		const ollamaClient = getClient()
		console.log(
			`[paw-ollama] loaded — model: ${ollamaClient.getModel()}, host: ${process.env.OLLAMA_HOST || 'http://localhost:11434'}`,
		)
	},

	async onUnload() {
		client = undefined
	},
}
