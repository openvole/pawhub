/**
 * The record model is the product; storage is a driver detail.
 *
 * paw-memory stored markdown and searched it — storage with recall bolted on. Nothing
 * distinguished an event from a fact, nothing decayed, and retrieval could not weigh "recent and
 * important" against "textually similar". A record model fixes that, and it is also what makes
 * multiple storage backends possible at all: a driver can be swapped underneath a schema, not
 * underneath a pile of files.
 */

/** Task sources, kept identical to paw-memory so scoping semantics carry over. */
export type MemorySource = 'user' | 'paw' | 'heartbeat' | 'schedule' | 'shared'

export type MemoryKind = 'episodic' | 'semantic' | 'procedural' | 'entity'

export interface MemoryRecord {
	id: string
	kind: MemoryKind
	text: string
	source: MemorySource
	tags: string[]
	/** Names this record is about — a cheap entity graph without a graph database. */
	entities: string[]
	/** 0..1 — set on write, adjusted by consolidation (M3). */
	importance: number
	/** Pinned records never decay and always appear in the digest. */
	pinned: boolean
	createdAt: number
	updatedAt: number
	lastAccessed: number
	accessCount: number
	/** Epoch ms after which the record expires (rare — e.g. short-lived pointers). */
	expiresAt?: number
	/** Forgetting is archival, never deletion. */
	archived: boolean
	provenance: { taskId?: string; sessionId?: string; peerId?: string }
}

export interface RecordFilter {
	kind?: MemoryKind
	/** Match this source OR 'shared'. 'all' disables source scoping. */
	source?: MemorySource | 'all'
	tags?: string[]
	entities?: string[]
	includeArchived?: boolean
	pinnedOnly?: boolean
}

export interface ScoredRecord {
	record: MemoryRecord
	score: number
	/** Which signals contributed — surfaces why something was recalled. */
	signals: { semantic?: number; lexical?: number; recency: number; importance: number }
}

/**
 * A storage backend. Capability-flagged: when a driver lacks `fts` or `vector`, the engine
 * composes the missing signal in-paw (BM25 over scan, cosine over stored embeddings) — so every
 * driver gets the full scoring function, and a driver only implements what its store does well.
 */
export interface MemoryDriver {
	readonly name: string
	readonly caps: { fts: boolean; vector: boolean; shared: boolean }
	init(): Promise<void>
	append(record: MemoryRecord): Promise<void>
	update(record: MemoryRecord): Promise<void>
	get(id: string): Promise<MemoryRecord | null>
	scan(filter?: RecordFilter): Promise<MemoryRecord[]>
	/** Store/fetch an embedding for a record. Dims are provider-determined. */
	putEmbedding(id: string, embedding: Float32Array): Promise<void>
	getEmbeddings(): Promise<Map<string, Float32Array>>
	close(): Promise<void>
}

/** Half-life in days for the recency signal, per kind. Pinned records do not decay. */
export const HALF_LIFE_DAYS: Record<MemoryKind, number> = {
	episodic: 7,
	semantic: 90,
	procedural: 180,
	entity: 120,
}
