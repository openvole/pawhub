import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export interface SessionMeta {
	createdAt: string
	lastActive: string
	source: string
	messageCount: number
}

/** A single transcript message. Content preserves newlines. */
export interface SessionMessage {
	ts: string
	role: string
	content: string
}

/** Parse one transcript line: JSONL (current) or legacy `[HH:MM:SS] role: content`. */
function parseTranscriptLine(line: string): SessionMessage | null {
	if (!line.trim()) return null
	if (line.startsWith('{')) {
		try {
			const obj = JSON.parse(line) as Partial<SessionMessage>
			if (typeof obj.role === 'string' && typeof obj.content === 'string') {
				return { ts: obj.ts ?? '', role: obj.role, content: obj.content }
			}
		} catch {
			return null
		}
		return null
	}
	// Legacy single-line format (multiline content was flattened on write)
	const m = line.match(/^\[([^\]]+)\] (user|brain|tool:[^\s:]*|[^:]+): ?(.*)$/)
	if (!m) return null
	return { ts: m[1], role: m[2], content: m[3] }
}

/**
 * Session ids are used verbatim as directory names, and channel sessions carry a colon
 * (`volenet:<peer>`, `telegram:<chat>`, `dashboard:<stamp>`). `:` is reserved on Windows, so on
 * NTFS the mkdir failed with EINVAL and every colon-named session silently lost its transcript —
 * chat looked fine live and came back empty. Names are therefore percent-encoded: reversible,
 * identical for ids that were already safe (`dashboard` stays `dashboard`), and legal on every
 * platform. Windows is the binding constraint: <>:"|?*, path separators, control characters, a
 * trailing dot or space, and the DOS device names are all off-limits. `%` itself is escaped so
 * decoding is unambiguous.
 */
const RESERVED_CHARS = /[<>:"/\\|?*%\u0000-\u001f]/g
const WINDOWS_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

function hexEscape(c: string): string {
	return `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
}

/** Directory name for a session id. A fixed point: encode(decode(name)) === name. */
function encodeSessionDir(sessionId: string): string {
	let name = sessionId.replace(RESERVED_CHARS, hexEscape)
	// Windows silently strips a trailing dot or space, colliding otherwise-distinct names.
	name = name.replace(/[. ]$/, hexEscape)
	if (WINDOWS_DEVICE_NAMES.test(name)) name = hexEscape(name[0]) + name.slice(1)
	return name
}

/** Inverse of encodeSessionDir. Sequences that are not valid %XX pass through untouched. */
function decodeSessionDir(name: string): string {
	return name.replace(/%([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(Number.parseInt(h, 16)))
}

/** Reject ids that could escape the store regardless of encoding. */
function sanitizeSessionId(sessionId: string): string {
	if (!sessionId || sessionId === '.' || sessionId === '..') {
		throw new Error(`Invalid session ID: "${sessionId}"`)
	}
	return sessionId
}

export class SessionStore {
	constructor(private baseDir: string) {}

	/** Ensure the base sessions directory exists and normalize pre-encoding directory names */
	async init(): Promise<void> {
		await fs.mkdir(this.baseDir, { recursive: true })
		// Directories created before names were encoded (`volenet:x` on POSIX) are renamed to
		// their canonical form so the same store reads them on every platform. Canonical names
		// are fixed points of encode∘decode, so this pass converges and never re-renames.
		try {
			const entries = await fs.readdir(this.baseDir, { withFileTypes: true })
			for (const entry of entries) {
				if (!entry.isDirectory()) continue
				const canonical = encodeSessionDir(decodeSessionDir(entry.name))
				if (canonical === entry.name) continue
				await fs
					.rename(path.join(this.baseDir, entry.name), path.join(this.baseDir, canonical))
					.catch(() => {
						/* target already exists or the dir is locked — leave the legacy dir in place */
					})
			}
		} catch {
			/* base dir unreadable — the first append will surface the real error */
		}
	}

	/** Get the directory path for a session */
	private sessionDir(sessionId: string): string {
		return path.join(this.baseDir, encodeSessionDir(sanitizeSessionId(sessionId)))
	}

	/** Get the transcript path for a session */
	private transcriptPath(sessionId: string): string {
		return path.join(this.sessionDir(sessionId), 'transcript.md')
	}

	/** Get the meta.json path for a session */
	private metaPath(sessionId: string): string {
		return path.join(this.sessionDir(sessionId), 'meta.json')
	}

	/** Read recent transcript messages (parses JSONL and legacy single-line entries) */
	async getMessages(sessionId: string, maxMessages?: number): Promise<SessionMessage[]> {
		const filePath = this.transcriptPath(sessionId)
		try {
			const content = await fs.readFile(filePath, 'utf-8')
			const messages: SessionMessage[] = []
			for (const line of content.split('\n')) {
				const msg = parseTranscriptLine(line)
				if (msg) messages.push(msg)
			}
			return maxMessages ? messages.slice(-maxMessages) : messages
		} catch {
			return []
		}
	}

	/** Append a message to the session transcript (JSONL — newlines in content preserved) */
	async appendMessage(sessionId: string, role: string, content: string): Promise<void> {
		const dir = this.sessionDir(sessionId)
		await fs.mkdir(dir, { recursive: true })

		const now = new Date()
		// 200k is a safety net against pathological single messages (a tool dumping megabytes),
		// not a display budget — the dashboard renders transcript entries in full, and prompt
		// injection is bounded separately at bootstrap. When the net does catch something, say so
		// in the text instead of ending mid-sentence.
		const MAX_ENTRY_CHARS = 200_000
		const bounded =
			content.length > MAX_ENTRY_CHARS
				? `${content.substring(0, MAX_ENTRY_CHARS)}\n… [truncated: message was ${content.length} chars]`
				: content
		const entry = `${JSON.stringify({
			ts: now.toISOString(),
			role,
			content: bounded,
		})}\n`

		await fs.appendFile(this.transcriptPath(sessionId), entry, 'utf-8')

		// Update or create meta
		const meta = await this.getMetaOrDefault(sessionId, now)
		meta.lastActive = now.toISOString()
		meta.messageCount += 1
		await this.writeMeta(sessionId, meta)
	}

	/** Trim a session's transcript to its most recent `maxMessages` entries (retention cap). */
	async trimToLast(sessionId: string, maxMessages: number): Promise<void> {
		if (!Number.isFinite(maxMessages) || maxMessages <= 0) return
		const filePath = this.transcriptPath(sessionId)
		try {
			const content = await fs.readFile(filePath, 'utf-8')
			const lines = content.split('\n').filter((l) => l.trim())
			if (lines.length <= maxMessages) return
			await fs.writeFile(filePath, `${lines.slice(-maxMessages).join('\n')}\n`, 'utf-8')
		} catch {
			// no transcript yet — nothing to trim
		}
	}

	/** Read meta.json for a session */
	async getMeta(sessionId: string): Promise<SessionMeta | null> {
		try {
			const raw = await fs.readFile(this.metaPath(sessionId), 'utf-8')
			return JSON.parse(raw) as SessionMeta
		} catch {
			return null
		}
	}

	/** Check if a session has expired */
	async isExpired(sessionId: string, ttlMinutes: number): Promise<boolean> {
		const meta = await this.getMeta(sessionId)
		if (!meta) return false // no session = not expired (doesn't exist)

		const lastActive = new Date(meta.lastActive).getTime()
		const now = Date.now()
		return now - lastActive > ttlMinutes * 60_000
	}

	/** Delete a session directory */
	async clear(sessionId: string): Promise<void> {
		const dir = this.sessionDir(sessionId)
		try {
			await fs.rm(dir, { recursive: true, force: true })
		} catch {
			// Ignore if doesn't exist
		}
	}

	/** List all sessions with their metadata */
	async list(): Promise<Array<{ sessionId: string; meta: SessionMeta | null }>> {
		try {
			const entries = await fs.readdir(this.baseDir, { withFileTypes: true })
			const sessions: Array<{ sessionId: string; meta: SessionMeta | null }> = []

			for (const entry of entries) {
				if (!entry.isDirectory()) continue
				// The directory name is the ENCODED id — decode before handing it back, and read
				// meta via the decoded id so the lookup re-encodes to this same directory.
				const sessionId = decodeSessionDir(entry.name)
				const meta = await this.getMeta(sessionId)
				sessions.push({ sessionId, meta })
			}

			return sessions
		} catch {
			return []
		}
	}

	/** Get existing meta or create a default */
	private async getMetaOrDefault(sessionId: string, now: Date): Promise<SessionMeta> {
		const existing = await this.getMeta(sessionId)
		if (existing) return existing

		return {
			createdAt: now.toISOString(),
			lastActive: now.toISOString(),
			source: '',
			messageCount: 0,
		}
	}

	/** Write meta.json */
	private async writeMeta(sessionId: string, meta: SessionMeta): Promise<void> {
		await fs.writeFile(this.metaPath(sessionId), JSON.stringify(meta, null, 2), 'utf-8')
	}
}
