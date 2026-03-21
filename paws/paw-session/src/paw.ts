import { z, type PawDefinition } from '@openvole/paw-sdk'
import { SessionStore } from './session.js'

let store: SessionStore | undefined

/** Current session ID — set during bootstrap */
let currentSessionId: string | undefined

/** Default TTL in minutes */
const DEFAULT_TTL = 60

/** Max messages to load during bootstrap */
const BOOTSTRAP_HISTORY_LIMIT = 20

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

			// Load recent history
			const history = await store.getHistory(sessionId, BOOTSTRAP_HISTORY_LIMIT)
			if (history) {
				context.metadata.sessionHistory = history
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

			// Record tool results (truncated to keep transcript manageable)
			const rawContent = result.success
				? typeof result.output === 'string'
					? result.output
					: JSON.stringify(result.output)
				: result.error?.message ?? 'error'
			const content = rawContent.length > 500
				? rawContent.substring(0, 500) + '... [truncated]'
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

		const { resolve } = await import('node:path')
		const sessionDir =
			process.env.VOLE_SESSION_DIR ||
			resolve(process.cwd(), '.openvole', 'sessions')
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
