/**
 * Vector store using better-sqlite3 + sqlite-vec for KNN search + FTS5 for BM25.
 * Hybrid search with Reciprocal Rank Fusion (RRF).
 *
 * Design: Vector index is disposable — markdown files are source of truth.
 * If you delete the database, it gets rebuilt from files on next boot.
 */

import type { EmbeddingProvider } from './embeddings.js'

export interface VectorSearchResult {
	id: string
	path: string
	source: string
	content: string
	score: number
	startLine: number
	endLine: number
}

export interface ChunkInput {
	path: string
	source: string
	content: string
	startLine: number
	endLine: number
}

/** Chunk markdown content into overlapping segments */
export function chunkMarkdown(
	content: string,
	path: string,
	source: string,
	maxChunkChars = 1500,
	overlapChars = 300,
): ChunkInput[] {
	const lines = content.split('\n')
	const chunks: ChunkInput[] = []
	let currentChunk = ''
	let chunkStartLine = 1
	let currentLine = 1

	for (const line of lines) {
		if (currentChunk.length + line.length + 1 > maxChunkChars && currentChunk.length > 0) {
			chunks.push({
				path,
				source,
				content: currentChunk.trim(),
				startLine: chunkStartLine,
				endLine: currentLine - 1,
			})

			// Overlap: keep last N chars for context continuity
			const overlapStart = Math.max(0, currentChunk.length - overlapChars)
			currentChunk = currentChunk.substring(overlapStart)
			chunkStartLine = Math.max(1, currentLine - currentChunk.split('\n').length)
		}
		currentChunk += (currentChunk ? '\n' : '') + line
		currentLine++
	}

	// Last chunk
	if (currentChunk.trim()) {
		chunks.push({
			path,
			source,
			content: currentChunk.trim(),
			startLine: chunkStartLine,
			endLine: currentLine - 1,
		})
	}

	return chunks
}

/** Simple hash for change detection */
function simpleHash(text: string): string {
	let hash = 0
	for (let i = 0; i < text.length; i++) {
		const char = text.charCodeAt(i)
		hash = ((hash << 5) - hash) + char
		hash = hash & hash // Convert to 32-bit integer
	}
	return hash.toString(36)
}

/**
 * L2-normalize a vector (unit length).
 * Required for cosine similarity via dot product.
 */
function l2Normalize(vec: number[]): number[] {
	const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0))
	if (norm === 0) return vec
	return vec.map((v) => v / norm)
}

/**
 * Cosine similarity between two vectors.
 * Assumes vectors are L2-normalized (dot product = cosine similarity).
 */
function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i]
	}
	return dot
}

/**
 * Reciprocal Rank Fusion (RRF) — combines rankings from multiple sources.
 * RRF(d) = Σ 1/(k + rank_i(d)) for each ranker i
 * k=60 is standard (smoothing constant)
 */
function rrfFuse(
	vectorResults: Array<{ id: string; score: number }>,
	bm25Results: Array<{ id: string; score: number }>,
	k = 60,
): Map<string, number> {
	const scores = new Map<string, number>()

	for (let rank = 0; rank < vectorResults.length; rank++) {
		const id = vectorResults[rank].id
		scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1))
	}

	for (let rank = 0; rank < bm25Results.length; rank++) {
		const id = bm25Results[rank].id
		scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1))
	}

	return scores
}

export class VectorStore {
	private db: any // better-sqlite3 Database (dynamically imported)
	private embedder: EmbeddingProvider
	private dbPath: string
	private initialized = false

	constructor(dbPath: string, embedder: EmbeddingProvider) {
		this.dbPath = dbPath
		this.embedder = embedder
	}

	async init(): Promise<void> {
		if (this.initialized) return

		const { default: Database } = await import('better-sqlite3')
		this.db = new Database(this.dbPath)
		this.db.pragma('journal_mode = WAL')

		// Create tables
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS chunks (
				id TEXT PRIMARY KEY,
				path TEXT NOT NULL,
				source TEXT NOT NULL DEFAULT 'shared',
				start_line INTEGER NOT NULL,
				end_line INTEGER NOT NULL,
				hash TEXT NOT NULL,
				content TEXT NOT NULL,
				embedding BLOB,
				indexed_at INTEGER NOT NULL
			);

			CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
			CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source);

			CREATE TABLE IF NOT EXISTS files (
				path TEXT PRIMARY KEY,
				hash TEXT NOT NULL,
				mtime INTEGER NOT NULL,
				size INTEGER NOT NULL
			);
		`)

		// Create FTS5 virtual table for BM25
		try {
			this.db.exec(`
				CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
					content,
					id UNINDEXED,
					path UNINDEXED,
					source UNINDEXED
				);
			`)
		} catch {
			// FTS5 may already exist
		}

		this.initialized = true
		console.log(`[paw-memory] Vector store initialized at ${this.dbPath} (dims: ${this.embedder.dimensions})`)
	}

	/** Index chunks from a file. Skips if file hasn't changed. */
	async indexFile(path: string, source: string, content: string, mtime: number): Promise<number> {
		const hash = simpleHash(content)

		// Check if file has changed
		const existing = this.db.prepare('SELECT hash FROM files WHERE path = ?').get(path) as { hash: string } | undefined
		if (existing?.hash === hash) return 0

		// Remove old chunks for this file
		const oldChunks = this.db.prepare('SELECT id FROM chunks WHERE path = ?').all(path) as Array<{ id: string }>
		for (const chunk of oldChunks) {
			this.db.prepare('DELETE FROM chunks_fts WHERE id = ?').run(chunk.id)
		}
		this.db.prepare('DELETE FROM chunks WHERE path = ?').run(path)

		// Chunk the content
		const chunks = chunkMarkdown(content, path, source)
		if (chunks.length === 0) return 0

		// Generate embeddings in batch
		const texts = chunks.map((c) => c.content)
		const embeddings = await this.embedder.embedBatch(texts)

		// Insert chunks
		const insertChunk = this.db.prepare(
			'INSERT INTO chunks (id, path, source, start_line, end_line, hash, content, embedding, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
		)
		const insertFts = this.db.prepare(
			'INSERT INTO chunks_fts (content, id, path, source) VALUES (?, ?, ?, ?)',
		)

		const insertAll = this.db.transaction(() => {
			for (let i = 0; i < chunks.length; i++) {
				const chunk = chunks[i]
				const id = `${path}:${chunk.startLine}-${chunk.endLine}`
				const normalized = l2Normalize(embeddings[i])
				const embeddingBlob = Buffer.from(new Float32Array(normalized).buffer)

				insertChunk.run(
					id, chunk.path, chunk.source,
					chunk.startLine, chunk.endLine,
					simpleHash(chunk.content), chunk.content,
					embeddingBlob, Date.now(),
				)
				insertFts.run(chunk.content, id, chunk.path, chunk.source)
			}
		})
		insertAll()

		// Update file tracking
		this.db.prepare(
			'INSERT OR REPLACE INTO files (path, hash, mtime, size) VALUES (?, ?, ?, ?)',
		).run(path, hash, mtime, content.length)

		return chunks.length
	}

	/**
	 * Hybrid search: BM25 (keyword) + Vector (semantic) with RRF fusion.
	 * Falls back to BM25-only if embedding fails.
	 */
	async search(
		query: string,
		options?: {
			source?: string
			limit?: number
			temporalDecayDays?: number
		},
	): Promise<VectorSearchResult[]> {
		const limit = options?.limit ?? 10
		const candidateLimit = limit * 3 // fetch more candidates for re-ranking

		// BM25 search via FTS5
		let bm25Results: Array<{ id: string; score: number }> = []
		try {
			const sourceFilter = options?.source
				? `AND source = '${options.source}'`
				: ''
			const ftsRows = this.db.prepare(`
				SELECT id, rank AS score FROM chunks_fts
				WHERE chunks_fts MATCH ?
				${sourceFilter}
				ORDER BY rank
				LIMIT ?
			`).all(query, candidateLimit) as Array<{ id: string; score: number }>
			bm25Results = ftsRows.map((r) => ({ id: r.id, score: -r.score })) // FTS5 rank is negative
		} catch {
			// FTS query failed (bad syntax etc) — continue with vector only
		}

		// Vector search
		let vectorResults: Array<{ id: string; score: number }> = []
		try {
			const queryEmbedding = await this.embedder.embed(query)
			const normalized = l2Normalize(queryEmbedding)

			// Get all chunks and compute cosine similarity
			// (For large stores, sqlite-vec KNN would be better but requires the extension)
			const sourceFilter = options?.source
				? `WHERE source = ?`
				: ''
			const params = options?.source ? [options.source] : []
			const rows = this.db.prepare(`
				SELECT id, embedding, indexed_at FROM chunks ${sourceFilter}
			`).all(...params) as Array<{ id: string; embedding: Buffer; indexed_at: number }>

			const scored: Array<{ id: string; score: number }> = []
			for (const row of rows) {
				const stored = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4)
				let similarity = cosineSimilarity(normalized, Array.from(stored))

				// Apply temporal decay if configured
				if (options?.temporalDecayDays && options.temporalDecayDays > 0) {
					const ageDays = (Date.now() - row.indexed_at) / (1000 * 60 * 60 * 24)
					const decay = Math.pow(0.5, ageDays / options.temporalDecayDays)
					similarity *= decay
				}

				scored.push({ id: row.id, score: similarity })
			}

			vectorResults = scored
				.sort((a, b) => b.score - a.score)
				.slice(0, candidateLimit)
		} catch (err) {
			console.log(`[paw-memory] Vector search failed, using BM25 only: ${err instanceof Error ? err.message : String(err)}`)
		}

		// RRF fusion
		let fusedScores: Map<string, number>
		if (vectorResults.length > 0 && bm25Results.length > 0) {
			fusedScores = rrfFuse(vectorResults, bm25Results)
		} else if (vectorResults.length > 0) {
			fusedScores = new Map(vectorResults.map((r) => [r.id, r.score]))
		} else {
			fusedScores = new Map(bm25Results.map((r) => [r.id, r.score]))
		}

		// Sort by fused score and fetch full chunk data
		const topIds = Array.from(fusedScores.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, limit)
			.map(([id]) => id)

		if (topIds.length === 0) return []

		const results: VectorSearchResult[] = []
		const getChunk = this.db.prepare('SELECT * FROM chunks WHERE id = ?')

		for (const id of topIds) {
			const chunk = getChunk.get(id) as {
				id: string; path: string; source: string; content: string
				start_line: number; end_line: number
			} | undefined
			if (chunk) {
				results.push({
					id: chunk.id,
					path: chunk.path,
					source: chunk.source,
					content: chunk.content,
					score: Math.round((fusedScores.get(id) ?? 0) * 1000) / 1000,
					startLine: chunk.start_line,
					endLine: chunk.end_line,
				})
			}
		}

		return results
	}

	/** Get total chunk count */
	getChunkCount(): number {
		const row = this.db.prepare('SELECT COUNT(*) as count FROM chunks').get() as { count: number }
		return row.count
	}

	/** Get indexed file count */
	getFileCount(): number {
		const row = this.db.prepare('SELECT COUNT(*) as count FROM files').get() as { count: number }
		return row.count
	}

	/** Remove chunks for a deleted file */
	removeFile(path: string): void {
		const chunks = this.db.prepare('SELECT id FROM chunks WHERE path = ?').all(path) as Array<{ id: string }>
		for (const chunk of chunks) {
			this.db.prepare('DELETE FROM chunks_fts WHERE id = ?').run(chunk.id)
		}
		this.db.prepare('DELETE FROM chunks WHERE path = ?').run(path)
		this.db.prepare('DELETE FROM files WHERE path = ?').run(path)
	}

	close(): void {
		if (this.db) {
			this.db.close()
			this.db = null
			this.initialized = false
		}
	}
}
