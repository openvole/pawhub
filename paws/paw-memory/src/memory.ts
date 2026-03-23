import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { BM25Index, type BM25Document } from './bm25.js'

export interface SearchResult {
	file: string
	source: string
	score: number
	snippet: string
}

export interface MemoryFile {
	name: string
	source: string
	size: number
	modified: string
}

/** Valid memory sources */
export type MemorySource = 'user' | 'paw' | 'heartbeat' | 'schedule' | 'shared'

/** Format today's date as YYYY-MM-DD */
function todayDate(): string {
	return new Date().toISOString().split('T')[0]
}

/** Format yesterday's date as YYYY-MM-DD */
function yesterdayDate(): string {
	const d = new Date()
	d.setDate(d.getDate() - 1)
	return d.toISOString().split('T')[0]
}

export class MemoryStore {
	private dir: string

	constructor(memoryDir: string) {
		this.dir = memoryDir
	}

	/** Ensure the memory directory and source subdirectories exist */
	async init(): Promise<void> {
		await fs.mkdir(this.dir, { recursive: true })
	}

	/**
	 * Read a memory file.
	 * MEMORY.md is always shared (no source scoping).
	 * Daily logs are scoped by source.
	 */
	async read(file: string, source?: MemorySource): Promise<string> {
		const filePath = this.resolve(file, source)
		try {
			return await fs.readFile(filePath, 'utf-8')
		} catch {
			return ''
		}
	}

	/**
	 * Write to a memory file.
	 * MEMORY.md is always shared.
	 * Daily logs ("today") are scoped by source.
	 */
	async write(
		file: string,
		content: string,
		mode: 'overwrite' | 'append' = 'append',
		source?: MemorySource,
	): Promise<void> {
		const filePath = this.resolve(file, source)
		await fs.mkdir(path.dirname(filePath), { recursive: true })

		if (mode === 'append') {
			const existing = await this.read(file, source)
			const separator = existing && !existing.endsWith('\n') ? '\n' : ''
			const timestamp = new Date().toLocaleTimeString('en-US', {
				hour12: false,
			})
			await fs.writeFile(
				filePath,
				`${existing}${separator}\n[${timestamp}] ${content}\n`,
				'utf-8',
			)
		} else {
			await fs.writeFile(filePath, content, 'utf-8')
		}
	}

	/**
	 * Search memory files using BM25 ranked retrieval.
	 * If source is specified, searches only that source's files + shared MEMORY.md.
	 * If source is "all", searches everything.
	 */
	async search(
		query: string,
		source?: MemorySource | 'all',
		limit = 10,
	): Promise<SearchResult[]> {
		const sources =
			source === 'all' || !source
				? await this.listSources()
				: [source, 'shared' as const]

		// Collect all documents for indexing
		const docs: (BM25Document & { file: string; source: string })[] = []

		for (const src of sources) {
			const srcDir =
				src === 'shared' ? this.dir : path.join(this.dir, src)
			const files = await this.listMdFiles(srcDir)

			for (const file of files) {
				const filePath = path.join(srcDir, file)
				try {
					const content = await fs.readFile(filePath, 'utf-8')
					if (content.trim()) {
						docs.push({
							id: `${src}/${file}`,
							content,
							file,
							source: src,
						})
					}
				} catch {
					// Skip unreadable files
				}
			}
		}

		if (docs.length === 0) return []

		// Build BM25 index and search
		const index = new BM25Index()
		index.index(docs)
		const ranked = index.search(query, limit)

		// Map results back to SearchResult format
		return ranked.map((r) => {
			const doc = docs.find((d) => d.id === r.id)!
			return {
				file: doc.file,
				source: doc.source,
				score: Math.round(r.score * 1000) / 1000,
				snippet: r.content.slice(0, 200),
			}
		})
	}

	/** List all memory files with metadata, optionally filtered by source */
	async list(source?: MemorySource | 'all'): Promise<MemoryFile[]> {
		const result: MemoryFile[] = []

		const sources =
			source === 'all' || !source
				? await this.listSources()
				: [source, 'shared' as const]

		for (const src of sources) {
			const srcDir =
				src === 'shared' ? this.dir : path.join(this.dir, src)
			const files = await this.listMdFiles(srcDir)

			for (const file of files) {
				try {
					const stat = await fs.stat(path.join(srcDir, file))
					result.push({
						name: file,
						source: src,
						size: stat.size,
						modified: stat.mtime.toISOString(),
					})
				} catch {
					// Skip
				}
			}
		}

		return result.sort((a, b) => b.modified.localeCompare(a.modified))
	}

	/** Resolve a file reference to an absolute path */
	private resolve(file: string, source?: MemorySource): string {
		// MEMORY.md is always in the root (shared)
		if (file === 'MEMORY.md') {
			return path.join(this.dir, 'MEMORY.md')
		}

		// Determine the directory — source-scoped or root
		const baseDir = source && source !== 'shared'
			? path.join(this.dir, source)
			: this.dir

		if (file === 'today') {
			return path.join(baseDir, `${todayDate()}.md`)
		}
		if (file === 'yesterday') {
			return path.join(baseDir, `${yesterdayDate()}.md`)
		}

		// Assume YYYY-MM-DD format
		const name = file.endsWith('.md') ? file : `${file}.md`
		const resolved = path.resolve(baseDir, name)
		if (!resolved.startsWith(path.resolve(this.dir))) {
			throw new Error('Invalid memory file path')
		}
		return resolved
	}

	/** Get all source directories that exist */
	private async listSources(): Promise<string[]> {
		const sources: string[] = ['shared']
		try {
			const entries = await fs.readdir(this.dir, { withFileTypes: true })
			for (const entry of entries) {
				if (entry.isDirectory()) {
					sources.push(entry.name)
				}
			}
		} catch {
			// Empty
		}
		return sources
	}

	/** Get all .md files in a directory */
	private async listMdFiles(dir: string): Promise<string[]> {
		try {
			const entries = await fs.readdir(dir)
			return entries.filter((f) => f.endsWith('.md'))
		} catch {
			return []
		}
	}
}
