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
 * 4-layer session history pruning:
 * 1. Message count limit (already applied before this function)
 * 2. Time decay — recent messages full, older messages shortened
 * 3. Compaction — consecutive tool results compressed into summaries
 * 4. Token budget — trim from oldest until within character limit
 */
function pruneSessionHistory(lines: string[]): string {
	const total = lines.length

	// Layer 2: Time decay — recent messages get more space
	const decayed: string[] = []
	for (let i = 0; i < total; i++) {
		const age = total - i // 1 = newest, total = oldest
		const line = lines[i]

		// Extract role from line: [HH:MM:SS] role: content
		const closeBracket = line.indexOf(']')
		if (closeBracket === -1) continue
		const rest = line.substring(closeBracket + 2)
		const colonIdx = rest.indexOf(':')
		if (colonIdx === -1) continue
		const role = rest.substring(0, colonIdx).trim()
		const content = rest.substring(colonIdx + 1).trim()
		const timestamp = line.substring(0, closeBracket + 1)

		if (role === 'user' || role === 'brain') {
			// User and brain messages: full for recent, truncated for old
			if (age <= 10) {
				decayed.push(line) // recent — full content
			} else {
				const truncated = content.length > 150
					? content.substring(0, 150) + '...'
					: content
				decayed.push(`${timestamp} ${role}: ${truncated}`)
			}
		} else {
			// Tool results: brief for recent, just name for old
			if (age <= 5) {
				const truncated = content.length > 200
					? content.substring(0, 200) + '...'
					: content
				decayed.push(`${timestamp} ${role}: ${truncated}`)
			} else {
				// Old tool results — just record that it was called
				decayed.push(`${timestamp} ${role}: [called]`)
			}
		}
	}

	// Layer 3: Compact consecutive old tool calls into summaries
	const compacted: string[] = []
	let toolGroup: string[] = []

	for (const line of decayed) {
		const isOldTool = line.includes('[called]')
		if (isOldTool) {
			// Extract tool name
			const match = line.match(/\] (tool:\S+):/)
			if (match) toolGroup.push(match[1])
		} else {
			// Flush any accumulated tool group
			if (toolGroup.length > 0) {
				if (toolGroup.length <= 2) {
					compacted.push(...toolGroup.map((t) => `  ${t}`))
				} else {
					compacted.push(`  [${toolGroup.length} tool calls: ${[...new Set(toolGroup)].join(', ')}]`)
				}
				toolGroup = []
			}
			compacted.push(line)
		}
	}
	// Flush remaining
	if (toolGroup.length > 0) {
		if (toolGroup.length <= 2) {
			compacted.push(...toolGroup.map((t) => `  ${t}`))
		} else {
			compacted.push(`  [${toolGroup.length} tool calls: ${[...new Set(toolGroup)].join(', ')}]`)
		}
	}

	// Layer 4: Token budget — trim from oldest until within budget
	let totalChars = 0
	const budgetLines: string[] = []
	for (let i = compacted.length - 1; i >= 0; i--) {
		const lineLen = compacted[i].length
		if (totalChars + lineLen > MAX_HISTORY_CHARS) break
		budgetLines.unshift(compacted[i])
		totalChars += lineLen
	}

	return budgetLines.join('\n')
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
