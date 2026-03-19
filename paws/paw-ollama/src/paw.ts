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
			const systemPrompt = ollamaClient.buildSystemPrompt(
				context.activeSkills,
				context.availableTools,
			)

			const response = await ollamaClient.chat(
				systemPrompt,
				context.messages,
				context.availableTools,
			)

			const durationMs = Date.now() - start
			console.log(
				`[paw-ollama] think completed in ${durationMs}ms (model: ${ollamaClient.getModel()})`,
			)

			const actions = ollamaClient.parseToolCalls(response)

			if (actions.length > 0) {
				return {
					actions,
					execution: 'sequential',
				}
			}

			const text = response.message.content || ''

			// If the model produced a text response, return it as done
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
				`[paw-ollama] think failed after ${durationMs}ms: ${message}`,
			)

			// Check for connection errors (Ollama not running)
			const isConnectionError =
				message.includes('ECONNREFUSED') ||
				message.includes('fetch failed') ||
				message.includes('ENOTFOUND')

			return {
				actions: [],
				response: isConnectionError
					? 'Ollama is not running or unreachable. Please start Ollama and try again.'
					: `Error communicating with Ollama: ${message}`,
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
		console.log('[paw-ollama] unloaded')
	},
}
