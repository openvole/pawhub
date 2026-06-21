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

/** Validates sessionId to prevent path traversal */
function sanitizeSessionId(sessionId: string): string {
	// Strip any path separators or parent directory references
	const sanitized = sessionId.replace(/[/\\]/g, '_').replace(/\.\./g, '_')
	if (!sanitized || sanitized === '.' || sanitized === '..') {
		throw new Error(`Invalid session ID: "${sessionId}"`)
	}
	return sanitized
}

export class SessionStore {
	constructor(private baseDir: string) {}

	/** Ensure the base sessions directory exists */
	async init(): Promise<void> {
		await fs.mkdir(this.baseDir, { recursive: true })
	}

	/** Get the directory path for a session */
	private sessionDir(sessionId: string): string {
		return path.join(this.baseDir, sanitizeSessionId(sessionId))
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
		const entry = `${JSON.stringify({
			ts: now.toISOString(),
			role,
			content: content.substring(0, 4000),
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
				const meta = await this.getMeta(entry.name)
				sessions.push({ sessionId: entry.name, meta })
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
