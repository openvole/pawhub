import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { PawDefinition, AgentContext, AgentPlan } from '@openvole/paw-sdk'
import { OllamaClient } from './ollama.js'

let client: OllamaClient | undefined

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
			console.log('[paw-ollama] loaded custom BRAIN.md prompt')
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
				context.metadata,
				identityContext,
				customBrainPrompt,
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

			console.log(
				`[paw-ollama] response — role: ${response.message.role}, content: ${(response.message.content || '').substring(0, 100)}, tool_calls: ${response.message.tool_calls?.length ?? 0}, actions: ${actions.length}`,
			)

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
			const stack =
				error instanceof Error ? error.stack : undefined
			console.error(
				`[paw-ollama] think failed after ${durationMs}ms: ${message}`,
			)
			if (stack) console.error(`[paw-ollama] stack: ${stack}`)
			// Log request details for debugging
			console.error(
				`[paw-ollama] model: ${ollamaClient.getModel()}, host: ${process.env.OLLAMA_HOST || 'http://localhost:11434'}, messages: ${context.messages.length}, tools: ${context.availableTools.length}`,
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
		customBrainPrompt = await loadBrainPrompt()
		identityContext = await loadIdentityFiles()
		if (identityContext) {
			console.log('[paw-ollama] loaded identity files (SOUL.md, USER.md, AGENT.md)')
		}
		console.log(
			`[paw-ollama] loaded — model: ${ollamaClient.getModel()}, host: ${process.env.OLLAMA_HOST || 'http://localhost:11434'}`,
		)
	},

	async onUnload() {
		client = undefined
		console.log('[paw-ollama] unloaded')
	},
}
