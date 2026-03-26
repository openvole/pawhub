import { z, type PawDefinition } from '@openvole/paw-sdk'
import { SessionStore } from './session.js'

let store: SessionStore | undefined

/** Current session ID — set during bootstrap */
let currentSessionId: string | undefined

/** Default TTL in minutes */
const DEFAULT_TTL = 60

/** Max messages to load during bootstrap */
const BOOTSTRAP_HISTORY_LIMIT = 50

/** Approximate max characters for session history (~4 chars per token, ~2000 token budget) */
const MAX_HISTORY_CHARS = 8000

/**
 * Prune session history for injection into Brain context.
 * Only user and brain messages are kept — tool results are excluded
 * because they belong to previous tasks and confuse the LLM.
 * Older messages are truncated, newest kept verbatim.
 * Total capped at MAX_HISTORY_CHARS token budget.
 */
function pruneSessionHistory(lines: string[]): string {
	// Filter to user/brain messages only
	const conversations: string[] = []
	for (const line of lines) {
		const closeBracket = line.indexOf(']')
		if (closeBracket === -1) continue
		const rest = line.substring(closeBracket + 2)
		const colonIdx = rest.indexOf(':')
		if (colonIdx === -1) continue
		const role = rest.substring(0, colonIdx).trim()
		if (role !== 'user' && role !== 'brain') continue

		const content = rest.substring(colonIdx + 1).trim()
		const timestamp = line.substring(0, closeBracket + 1)

		// Time decay: older messages truncated
		const age = lines.length - lines.indexOf(line)
		if (age > 10 && content.length > 150) {
			conversations.push(`${timestamp} ${role}: ${content.substring(0, 150)}...`)
		} else {
			conversations.push(line)
		}
	}

	// Token budget — keep newest, trim oldest
	let totalChars = 0
	const kept: string[] = []
	for (let i = conversations.length - 1; i >= 0; i--) {
		if (totalChars + conversations[i].length > MAX_HISTORY_CHARS) break
		kept.unshift(conversations[i])
		totalChars += conversations[i].length
	}

	return kept.join('\n')
}

function getTtl(): number {
	const envTtl = process.env.VOLE_SESSION_TTL
	if (envTtl) {
		const parsed = parseInt(envTtl, 10)
		if (!Number.isNaN(parsed) && parsed > 0) return parsed
	}
	return DEFAULT_TTL
}

export const paw: PawDefinition = {
	name: '@openvole/paw-session',
	version: '0.1.0',
	description: 'Session management — per-session transcript and metadata tracking',

	tools: [
		{
			name: 'session_history',
			description: 'Read conversation history for a session. Uses the current session if no sessionId is provided.',
			parameters: z.object({
				sessionId: z
					.string()
					.optional()
					.describe('The session ID to read history for. Defaults to the current session.'),
				maxMessages: z
					.number()
					.optional()
					.describe('Maximum number of messages to return. Returns all if omitted.'),
			}),
			async execute(params) {
				const { sessionId, maxMessages } = params as {
					sessionId?: string
					maxMessages?: number
				}
				if (!store) throw new Error('Session store not initialized')

				const id = sessionId ?? currentSessionId
				if (!id) {
					return { ok: false, error: 'No session ID provided and no active session' }
				}

				const history = await store.getHistory(id, maxMessages)
				const meta = await store.getMeta(id)
				return { ok: true, sessionId: id, history, meta }
			},
		},
		{
			name: 'session_clear',
			description: 'Clear a session — removes its transcript and metadata.',
			parameters: z.object({
				sessionId: z.string().describe('The session ID to clear'),
			}),
			async execute(params) {
				const { sessionId } = params as { sessionId: string }
				if (!store) throw new Error('Session store not initialized')

				await store.clear(sessionId)
				return { ok: true, cleared: sessionId }
			},
		},
		{
			name: 'session_list',
			description: 'List all active sessions with their last activity time.',
			parameters: z.object({}),
			async execute() {
				if (!store) throw new Error('Session store not initialized')

				const sessions = await store.list()
				return {
					ok: true,
					sessions: sessions.map((s) => ({
						sessionId: s.sessionId,
						lastActive: s.meta?.lastActive ?? null,
						messageCount: s.meta?.messageCount ?? 0,
						source: s.meta?.source ?? '',
					})),
				}
			},
		},
	],

	hooks: {
		async onBootstrap(context) {
			if (!store) return context

			const sessionId = context.metadata.sessionId as string | undefined
			currentSessionId = sessionId
			if (!sessionId) return context

			const ttl = getTtl()

			// Check if session is expired
			const expired = await store.isExpired(sessionId, ttl)
			if (expired) {
				// Archive by clearing — start fresh
				console.log(`[paw-session] Session "${sessionId}" expired (TTL: ${ttl}m), starting fresh`)
				await store.clear(sessionId)
			}

			// Load recent history with 4-layer pruning
			const rawHistory = await store.getHistory(sessionId, BOOTSTRAP_HISTORY_LIMIT)
			if (rawHistory) {
				const lines = rawHistory.split('\n').filter((l) => l.startsWith('['))
				if (lines.length > 0) {
					context.metadata.sessionHistory = pruneSessionHistory(lines)
				}
			}

			// Append the user's input to the transcript
			const userMessage = context.messages.find((m) => m.role === 'user')
			if (userMessage) {
				const source = (context.metadata.taskSource as string) ?? ''
				// Ensure meta has the source set
				const meta = await store.getMeta(sessionId)
				if (meta && !meta.source) {
					meta.source = source
					// Source will be updated via appendMessage's meta write
				}
				await store.appendMessage(sessionId, 'user', userMessage.content)
			}

			return context
		},

		async onObserve(result) {
			if (!store || !currentSessionId) return

			// Record tool results — truncated to keep transcript manageable
			const rawContent = result.success
				? typeof result.output === 'string'
					? result.output
					: JSON.stringify(result.output)
				: result.error?.message ?? 'error'
			const content = rawContent.length > 300
				? rawContent.substring(0, 300) + '...'
				: rawContent

			await store.appendMessage(
				currentSessionId,
				`tool:${result.toolName}`,
				content,
			)
		},
	},

	async onLoad() {
		// Subscribe to task completion to record brain responses in session
		const { createIpcTransport } = await import('@openvole/paw-sdk')
		const busTransport = createIpcTransport()
		busTransport.subscribe(['task:completed'])
		busTransport.onBusEvent(async (event, data) => {
			if (event === 'task:completed' && store && currentSessionId) {
				const taskData = data as { result?: string }
				if (taskData.result) {
					const content = taskData.result.length > 1000
						? taskData.result.substring(0, 1000) + '... [truncated]'
						: taskData.result
					await store.appendMessage(currentSessionId, 'brain', content)
				}
			}
		})

		const { resolve, join } = await import('node:path')
		const fsModule = await import('node:fs/promises')
		const sessionDir =
			process.env.VOLE_SESSION_DIR ||
			resolve(process.cwd(), '.openvole', 'paws', 'paw-session')

		// Auto-migrate from old location (.openvole/sessions/ → .openvole/paws/paw-session/)
		try {
			const oldDir = resolve(process.cwd(), '.openvole', 'sessions')
			const entries = await fsModule.readdir(oldDir).catch(() => [] as string[])
			if (entries.length > 0 && oldDir !== sessionDir) {
				console.log(`[paw-session] migrating data from ${oldDir} to ${sessionDir}`)
				await fsModule.mkdir(sessionDir, { recursive: true })
				for (const entry of entries) {
					const src = join(oldDir, entry)
					const dest = join(sessionDir, entry)
					const srcStat = await fsModule.stat(src)
					try { await fsModule.stat(dest) } catch {
						if (srcStat.isDirectory()) {
							await fsModule.cp(src, dest, { recursive: true })
						} else {
							await fsModule.rename(src, dest)
						}
					}
				}
				// Clean up old directory
				await fsModule.rm(oldDir, { recursive: true }).catch(() => {})
				console.log(`[paw-session] migration complete`)
			}
		} catch { /* no old data */ }

		store = new SessionStore(sessionDir)
		await store.init()
		console.log(`[paw-session] loaded — session dir: ${sessionDir}`)
	},

	async onUnload() {
		store = undefined
		currentSessionId = undefined
		console.log('[paw-session] unloaded')
	},
}
