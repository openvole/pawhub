import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { PawDefinition, AgentContext, AgentPlan } from '@openvole/paw-sdk'
import { OllamaClient } from './ollama.js'

let client: OllamaClient | undefined

/** Cached identity files — loaded once on startup */
let identityContext: string | undefined

/** Brain prompt — loaded from user's local dir or packaged default */
let customBrainPrompt: string | undefined

/** Load BRAIN.md from .openvole/paws/paw-ollama/BRAIN.md — scaffolds from packaged default on first run */
async function loadBrainPrompt(): Promise<string | undefined> {
	const brainPath = path.resolve(process.cwd(), '.openvole', 'paws', 'paw-ollama', 'BRAIN.md')

	// Scaffold on first run: copy packaged BRAIN.md to local paw data dir
	try {
		await fs.access(brainPath)
	} catch {
		try {
			const pkgPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'BRAIN.md')
			const defaultContent = await fs.readFile(pkgPath, 'utf-8')
			await fs.mkdir(path.dirname(brainPath), { recursive: true })
			await fs.writeFile(brainPath, defaultContent, 'utf-8')
			console.log('[paw-ollama] scaffolded BRAIN.md to .openvole/paws/paw-ollama/')
		} catch (err) {
			console.error('[paw-ollama] failed to scaffold BRAIN.md:', err)
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
				// Brain returned no text — let the loop retry
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
