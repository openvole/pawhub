import * as crypto from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { BM25Index } from './bm25.js'
import type { EmbeddingProvider } from './embeddings.js'
import { cosine, mmr, scoreRecord } from './score.js'
import type {
	MemoryDriver,
	MemoryKind,
	MemoryRecord,
	MemorySource,
	RecordFilter,
	ScoredRecord,
} from './types.js'

/** How many candidates each signal contributes before fusion — recall breadth, not the result cap. */
const CANDIDATE_POOL = 50
/** Digest regeneration is debounced: at most once per this interval, plus once on close. */
const DIGEST_DEBOUNCE_MS = 60_000
const DIGEST_MAX_LINES = 40

export interface WriteInput {
	text: string
	kind?: MemoryKind
	source?: MemorySource
	tags?: string[]
	entities?: string[]
	importance?: number
	pinned?: boolean
	ttlHours?: number
	provenance?: { taskId?: string; sessionId?: string; peerId?: string }
}

/**
 * The retrieval engine: composes whatever the driver lacks (BM25 when no fts, in-paw cosine when
 * no vector search) so every backend answers the same scoring function.
 */
export class RecallEngine {
	private bm25: BM25Index | null = null
	private bm25Dirty = true
	private digestTimer: ReturnType<typeof setTimeout> | null = null
	private digestDirty = false

	constructor(
		private driver: MemoryDriver,
		private embedder: EmbeddingProvider | null,
		private digestPath: string,
	) {}

	async init(): Promise<void> {
		await this.driver.init()
	}

	async write(input: WriteInput): Promise<MemoryRecord> {
		const now = Date.now()
		const text = input.text.trim().substring(0, 8000)
		if (!text) throw new Error('memory_write: text is empty')
		const record: MemoryRecord = {
			id: crypto.randomUUID(),
			kind: input.kind ?? 'semantic',
			text,
			source: input.source ?? 'user',
			tags: input.tags ?? [],
			entities: input.entities ?? [],
			importance: clamp01(input.importance ?? 0.5),
			pinned: input.pinned ?? false,
			createdAt: now,
			updatedAt: now,
			lastAccessed: now,
			accessCount: 0,
			...(input.ttlHours ? { expiresAt: now + input.ttlHours * 3_600_000 } : {}),
			archived: false,
			provenance: input.provenance ?? {},
		}
		await this.driver.append(record)
		this.bm25Dirty = true
		if (this.embedder && !this.driver.caps.vector) {
			try {
				const vec = await this.embedder.embed(text)
				await this.driver.putEmbedding(record.id, Float32Array.from(vec))
			} catch (err) {
				console.log(
					`[paw-recall] embedding failed (record kept, lexical-only): ${err instanceof Error ? err.message : err}`,
				)
			}
		}
		this.markDigestDirty()
		return record
	}

	async get(id: string): Promise<MemoryRecord | null> {
		const rec = await this.driver.get(id)
		if (rec) {
			rec.lastAccessed = Date.now()
			rec.accessCount++
			await this.driver.update(rec)
		}
		return rec
	}

	async archive(id: string): Promise<boolean> {
		const rec = await this.driver.get(id)
		if (!rec) return false
		rec.archived = true
		rec.updatedAt = Date.now()
		await this.driver.update(rec)
		this.bm25Dirty = true
		this.markDigestDirty()
		return true
	}

	async setPinned(id: string, pinned: boolean): Promise<boolean> {
		const rec = await this.driver.get(id)
		if (!rec) return false
		rec.pinned = pinned
		rec.updatedAt = Date.now()
		await this.driver.update(rec)
		this.markDigestDirty()
		return true
	}

	async list(filter?: RecordFilter, limit = 20): Promise<MemoryRecord[]> {
		const all = await this.driver.scan(filter)
		return all.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
	}

	async search(query: string, filter?: RecordFilter, limit = 10): Promise<ScoredRecord[]> {
		const candidates = await this.driver.scan(filter)
		if (candidates.length === 0) return []
		const now = Date.now()

		// Lexical signal — driver fts when it has one, in-paw BM25 otherwise.
		const lexical = new Map<string, number>()
		if (!this.driver.caps.fts) {
			if (this.bm25Dirty || !this.bm25) {
				this.bm25 = new BM25Index()
				const all = await this.driver.scan({ source: 'all' })
				this.bm25.index(all.map((rec) => ({ id: rec.id, content: rec.text })))
				this.bm25Dirty = false
			}
			let max = 0
			const hits = this.bm25.search(query, CANDIDATE_POOL)
			for (const h of hits) if (h.score > max) max = h.score
			for (const h of hits) lexical.set(h.id, max > 0 ? h.score / max : 0)
		}

		// Semantic signal — in-paw cosine over stored embeddings.
		const semantic = new Map<string, number>()
		let embeddings = new Map<string, Float32Array>()
		if (this.embedder && !this.driver.caps.vector) {
			try {
				const qvec = Float32Array.from(await this.embedder.embed(query))
				embeddings = await this.driver.getEmbeddings()
				for (const rec of candidates) {
					const vec = embeddings.get(rec.id)
					if (vec) semantic.set(rec.id, Math.max(0, cosine(qvec, vec)))
				}
			} catch (err) {
				console.log(
					`[paw-recall] query embedding failed, lexical-only: ${err instanceof Error ? err.message : err}`,
				)
			}
		}

		const scored = candidates.map((rec) =>
			scoreRecord(rec, {
				semantic: semantic.get(rec.id),
				lexical: lexical.get(rec.id),
				hasSemantic: semantic.size > 0,
				hasLexical: lexical.size > 0,
				now,
			}),
		)
		// Drop records with no text-signal at all unless nothing has one (pure-recency browse).
		const withText = scored.filter(
			(s) => (s.signals.semantic ?? 0) > 0 || (s.signals.lexical ?? 0) > 0,
		)
		const pool = withText.length > 0 ? withText : scored
		const picked = mmr(pool, limit, embeddings)

		// Touch access stats on what was actually recalled (fire-and-forget).
		void Promise.all(
			picked.map(async (s) => {
				s.record.lastAccessed = now
				s.record.accessCount++
				await this.driver.update(s.record).catch(() => {})
			}),
		)
		return picked
	}

	/** The generated human view: pinned records grouped by kind, then top-importance semantic. */
	async generateDigest(): Promise<string> {
		const pinned = await this.driver.scan({ pinnedOnly: true, source: 'all' })
		const semantic = (await this.driver.scan({ kind: 'semantic', source: 'all' }))
			.filter((r) => !r.pinned)
			.sort((a, b) => b.importance - a.importance)
		const entity = (await this.driver.scan({ kind: 'entity', source: 'all' }))
			.filter((r) => !r.pinned)
			.sort((a, b) => b.importance - a.importance)

		const lines: string[] = [
			'# Memory Digest',
			'',
			'_Generated by paw-recall — edit records via memory tools, not this file._',
			'',
		]
		let budget = DIGEST_MAX_LINES
		const emit = (header: string, records: MemoryRecord[]) => {
			if (records.length === 0 || budget <= 0) return
			lines.push(`## ${header}`, '')
			for (const r of records) {
				if (budget-- <= 0) break
				lines.push(`- ${r.text.replace(/\s+/g, ' ').substring(0, 200)}`)
			}
			lines.push('')
		}
		emit(
			'Pinned',
			pinned.sort((a, b) => b.importance - a.importance),
		)
		emit('Facts', semantic.slice(0, 15))
		emit('Entities', entity.slice(0, 10))
		return lines.join('\n')
	}

	private markDigestDirty(): void {
		this.digestDirty = true
		if (this.digestTimer) return
		this.digestTimer = setTimeout(() => {
			this.digestTimer = null
			void this.flushDigest()
		}, DIGEST_DEBOUNCE_MS)
		// Never hold the process open for a digest write.
		this.digestTimer.unref?.()
	}

	async flushDigest(): Promise<void> {
		if (!this.digestDirty) return
		this.digestDirty = false
		try {
			const tmp = `${this.digestPath}.tmp`
			await fs.writeFile(tmp, `${await this.generateDigest()}\n`, 'utf-8')
			await fs.rename(tmp, this.digestPath)
		} catch (err) {
			console.log(`[paw-recall] digest write failed: ${err instanceof Error ? err.message : err}`)
		}
	}

	async close(): Promise<void> {
		if (this.digestTimer) {
			clearTimeout(this.digestTimer)
			this.digestTimer = null
		}
		await this.flushDigest()
		await this.driver.close()
	}
}

function clamp01(n: number): number {
	return Math.max(0, Math.min(1, n))
}

export function defaultDigestPath(dir: string): string {
	return path.join(dir, 'MEMORY.md')
}
