import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { MemoryDriver, MemoryRecord, RecordFilter } from '../types.js'

/**
 * The default driver: records as append-only JSONL, embeddings in a sidecar, and a generated
 * `MEMORY.md` digest for humans.
 *
 * Layout (all fixed filenames — record ids never become file names, so there is nothing for a
 * Windows filesystem to reject; the paw-session lesson, designed out):
 *
 *   records.jsonl     one JSON record per line; the LAST line for an id wins, so updates and
 *                     archival are appends — crash-safe, no read-modify-write of the whole file
 *   embeddings.jsonl  {id, b64} lines, Float32Array base64 — lazily loaded, rebuilt on compact
 *   MEMORY.md         generated digest (pinned + top-importance records) — a VIEW, not the data
 *
 * The JSONL is compacted (rewritten with only live lines) when dead lines outnumber live ones.
 */
export class MarkdownDriver implements MemoryDriver {
	readonly name = 'markdown'
	readonly caps = { fts: false, vector: false, shared: false }

	private records = new Map<string, MemoryRecord>()
	/** Lines written since load, including superseded ones — drives compaction. */
	private lineCount = 0
	private embeddings: Map<string, Float32Array> | null = null

	constructor(private dir: string) {}

	private get recordsPath(): string {
		return path.join(this.dir, 'records.jsonl')
	}
	private get embeddingsPath(): string {
		return path.join(this.dir, 'embeddings.jsonl')
	}

	async init(): Promise<void> {
		await fs.mkdir(this.dir, { recursive: true })
		try {
			const raw = await fs.readFile(this.recordsPath, 'utf-8')
			for (const line of raw.split('\n')) {
				if (!line.trim()) continue
				this.lineCount++
				try {
					const rec = JSON.parse(line) as MemoryRecord
					if (rec?.id) this.records.set(rec.id, rec)
				} catch {
					// torn final line from a crash mid-append — skip it
				}
			}
		} catch {
			// no records yet
		}
		if (this.lineCount > 2 * this.records.size + 64) await this.compact()
	}

	async append(record: MemoryRecord): Promise<void> {
		this.records.set(record.id, record)
		this.lineCount++
		await fs.appendFile(this.recordsPath, `${JSON.stringify(record)}\n`, 'utf-8')
	}

	/** Updates are appends — last line for an id wins on load. */
	async update(record: MemoryRecord): Promise<void> {
		await this.append(record)
	}

	async get(id: string): Promise<MemoryRecord | null> {
		return this.records.get(id) ?? null
	}

	async scan(filter?: RecordFilter): Promise<MemoryRecord[]> {
		const now = Date.now()
		const out: MemoryRecord[] = []
		for (const rec of this.records.values()) {
			if (!filter?.includeArchived && rec.archived) continue
			if (rec.expiresAt && rec.expiresAt < now) continue
			if (filter?.kind && rec.kind !== filter.kind) continue
			if (filter?.pinnedOnly && !rec.pinned) continue
			if (filter?.source && filter.source !== 'all') {
				// A source sees its own records plus shared — same scoping paw-memory had.
				if (rec.source !== filter.source && rec.source !== 'shared') continue
			}
			if (filter?.tags?.length && !filter.tags.some((t) => rec.tags.includes(t))) continue
			if (filter?.entities?.length && !filter.entities.some((e) => rec.entities.includes(e)))
				continue
			out.push(rec)
		}
		return out
	}

	async putEmbedding(id: string, embedding: Float32Array): Promise<void> {
		if (this.embeddings) this.embeddings.set(id, embedding)
		const b64 = Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength).toString(
			'base64',
		)
		await fs.appendFile(this.embeddingsPath, `${JSON.stringify({ id, b64 })}\n`, 'utf-8')
	}

	async getEmbeddings(): Promise<Map<string, Float32Array>> {
		if (this.embeddings) return this.embeddings
		const map = new Map<string, Float32Array>()
		try {
			const raw = await fs.readFile(this.embeddingsPath, 'utf-8')
			for (const line of raw.split('\n')) {
				if (!line.trim()) continue
				try {
					const { id, b64 } = JSON.parse(line) as { id: string; b64: string }
					const buf = Buffer.from(b64, 'base64')
					map.set(id, new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4))
				} catch {
					// skip torn line
				}
			}
		} catch {
			// none yet
		}
		this.embeddings = map
		return map
	}

	/** Rewrite both files with only live data. Atomic via temp + rename. */
	private async compact(): Promise<void> {
		const tmp = `${this.recordsPath}.tmp`
		const lines = [...this.records.values()].map((r) => JSON.stringify(r)).join('\n')
		await fs.writeFile(tmp, lines ? `${lines}\n` : '', 'utf-8')
		await fs.rename(tmp, this.recordsPath)
		this.lineCount = this.records.size
		const emb = await this.getEmbeddings()
		const keep: string[] = []
		for (const [id, vec] of emb) {
			if (!this.records.has(id)) {
				emb.delete(id)
				continue
			}
			const b64 = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength).toString('base64')
			keep.push(JSON.stringify({ id, b64 }))
		}
		const etmp = `${this.embeddingsPath}.tmp`
		await fs.writeFile(etmp, keep.length ? `${keep.join('\n')}\n` : '', 'utf-8')
		await fs.rename(etmp, this.embeddingsPath)
	}

	async close(): Promise<void> {
		// nothing held open — appends are per-call
	}
}
