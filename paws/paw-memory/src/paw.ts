import { z, type PawDefinition } from '@openvole/paw-sdk'
import { MemoryStore, type MemorySource } from './memory.js'
import { VectorStore } from './vector-store.js'
import { createEmbeddingProvider, type EmbeddingProvider } from './embeddings.js'

let store: MemoryStore | undefined
let vectorStore: VectorStore | undefined
let embedder: EmbeddingProvider | null = null

/** Current task source — set during bootstrap, used by tools */
let currentSource: MemorySource = 'user'

/** Track successful tool calls for auto-extraction */
let successfulToolCalls = 0
const AUTO_EXTRACT_INTERVAL = 10
const learnedPatterns = new Set<string>()

/** Index a file into the vector store (if available) */
async function indexFileIfNeeded(file: string, source: MemorySource, content: string): Promise<void> {
	if (!vectorStore || !content.trim()) return
	try {
		const count = await vectorStore.indexFile(file, source, content, Date.now())
		if (count > 0) {
			console.log(`[paw-memory] Indexed ${count} chunks from ${file}`)
		}
	} catch (err) {
		console.log(`[paw-memory] Vector indexing failed for ${file}: ${err instanceof Error ? err.message : String(err)}`)
	}
}

export const paw: PawDefinition = {
	name: '@openvole/paw-memory',
	version: '0.1.0',
	description: 'Persistent memory — markdown-based long-term and daily memory with source isolation',

	tools: [
		{
			name: 'memory_read',
			description:
				'Read a memory file. "MEMORY.md" is shared long-term memory. Daily logs are scoped by task source (user, paw, heartbeat).',
			parameters: z.object({
				file: z
					.string()
					.describe(
						'"MEMORY.md" for long-term memory, "today"/"yesterday" for daily logs, or "YYYY-MM-DD" for a specific date',
					),
				source: z
					.enum(['user', 'paw', 'heartbeat', 'schedule', 'shared'])
					.optional()
					.describe('Memory source scope. Defaults to the current task source.'),
			}),
			async execute(params) {
				const { file, source } = params as { file: string; source?: MemorySource }
				if (!store) throw new Error('Memory store not initialized')
				const content = await store.read(file, source ?? currentSource)
				return { ok: true, content }
			},
		},
		{
			name: 'memory_write',
			description:
				'Write or append to a memory file. "MEMORY.md" is shared across all sources. Daily logs are scoped by task source.',
			parameters: z.object({
				file: z
					.string()
					.describe(
						'"MEMORY.md" for long-term memory, or "today" for the current source\'s daily log',
					),
				content: z.string().describe('The content to write or append'),
				mode: z
					.enum(['overwrite', 'append'])
					.optional()
					.describe('"overwrite" replaces the file, "append" adds to the end with timestamp. Default: append.'),
				append: z
					.boolean()
					.optional()
					.describe('Alias for mode — if true, appends (default behavior)'),
				source: z
					.enum(['user', 'paw', 'heartbeat', 'schedule', 'shared'])
					.optional()
					.describe('Memory source scope. Defaults to the current task source.'),
			}),
			async execute(params) {
				const p = params as {
					file: string
					content: string
					mode?: 'overwrite' | 'append'
					append?: boolean
					source?: MemorySource
				}
				if (!store) throw new Error('Memory store not initialized')
				// Accept both "mode" and "append" params
				const mode = p.mode ?? (p.append === false ? 'overwrite' : 'append')
				const src = p.source ?? currentSource
				await store.write(p.file, p.content, mode, src)
				// Auto-index for vector search
				const fullContent = await store.read(p.file, src)
				await indexFileIfNeeded(p.file, src, fullContent)
				return { ok: true }
			},
		},
		{
			name: 'memory_search',
			description:
				'Search memory using hybrid retrieval (semantic + keyword). Returns results scored by relevance. Falls back to keyword-only (BM25) if vector search is unavailable. By default searches the current source + shared MEMORY.md. Use source "all" to search everything.',
			parameters: z.object({
				query: z.string().describe('Search query'),
				limit: z
					.number()
					.optional()
					.describe('Maximum number of results to return. Default: 10.'),
				source: z
					.enum(['user', 'paw', 'heartbeat', 'schedule', 'shared', 'all'])
					.optional()
					.describe('Scope to search. "all" searches every source. Defaults to current source + shared.'),
			}),
			async execute(params) {
				const { query, limit, source } = params as {
					query: string
					limit?: number
					source?: MemorySource | 'all'
				}
				if (!store) throw new Error('Memory store not initialized')

				// Use hybrid search if vector store is available
				if (vectorStore) {
					try {
						const sourceFilter = source === 'all' ? undefined : (source ?? currentSource)
						const results = await vectorStore.search(query, {
							source: sourceFilter,
							limit: limit ?? 10,
							temporalDecayDays: 30,
						})
						return {
							ok: true,
							searchMode: 'hybrid',
							results: results.map((r) => ({
								file: r.path,
								source: r.source,
								score: r.score,
								snippet: r.content.slice(0, 300),
								lines: `${r.startLine}-${r.endLine}`,
							})),
						}
					} catch (err) {
						console.log(`[paw-memory] Hybrid search failed, falling back to BM25: ${err instanceof Error ? err.message : String(err)}`)
					}
				}

				// Fallback: BM25 only
				const results = await store.search(
					query,
					source ?? currentSource,
					limit ?? 10,
				)
				return { ok: true, searchMode: 'bm25', results }
			},
		},
		{
			name: 'memory_list',
			description: 'List memory files. Defaults to the current source + shared. Use "all" to see everything.',
			parameters: z.object({
				source: z
					.enum(['user', 'paw', 'heartbeat', 'schedule', 'shared', 'all'])
					.optional()
					.describe('Scope to list. Defaults to current source + shared.'),
			}),
			async execute(params) {
				const { source } = params as { source?: MemorySource | 'all' }
				if (!store) throw new Error('Memory store not initialized')
				const files = await store.list(source ?? currentSource)
				return { ok: true, files }
			},
		},
	],

	hooks: {
		async onCompact(context) {
			if (!store) return context

			// Before compaction, extract key facts from messages that will be compacted
			const messages = context.messages
			const KEEP_RECENT = 10
			if (messages.length <= KEEP_RECENT + 2) return context

			const oldMessages = messages.slice(1, messages.length - KEEP_RECENT)
			const facts: string[] = []

			for (const msg of oldMessages) {
				// Extract user preferences and corrections
				if (msg.role === 'user' && msg.content.length > 20) {
					const lower = msg.content.toLowerCase()
					if (lower.includes('remember') || lower.includes('always') || lower.includes('never') ||
						lower.includes('prefer') || lower.includes('don\'t') || lower.includes('my ')) {
						facts.push(`User said: "${msg.content.substring(0, 200)}"`)
					}
				}
				// Extract successful tool patterns (what worked)
				if (msg.role === 'tool_result' && msg.toolCall?.name) {
					const lower = msg.content.toLowerCase()
					if (lower.includes('"ok":true') || lower.includes('"ok": true') || lower.includes('"success"')) {
						if (msg.content.length > 500) {
							// Large successful result — note what tool was used for what
							facts.push(`Used ${msg.toolCall.name} successfully`)
						}
					}
				}
			}

			if (facts.length > 0) {
				const entry = `### Auto-extracted (compaction)\n${facts.join('\n')}`
				try {
					await store.write('today', entry, 'append', currentSource)
					console.log(`[paw-memory] Extracted ${facts.length} facts before compaction`)
				} catch (err) {
					console.log(`[paw-memory] Failed to save compaction facts: ${err instanceof Error ? err.message : String(err)}`)
				}
			}

			return context
		},

		async onBootstrap(context) {
			if (!store) return context

			// Set the current source from task metadata
			const taskSource = context.metadata.taskSource as string | undefined
			currentSource = (taskSource as MemorySource) || 'user'

			// Load MEMORY.md (shared) + source-scoped today + yesterday
			const longTerm = await store.read('MEMORY.md')
			const today = await store.read('today', currentSource)
			const yesterday = await store.read('yesterday', currentSource)

			const memoryContext: string[] = []

			if (longTerm) {
				memoryContext.push('## Long-term Memory\n' + longTerm)
			}
			if (yesterday) {
				memoryContext.push(`## Yesterday (${currentSource})\n` + yesterday)
			}
			if (today) {
				memoryContext.push(`## Today (${currentSource})\n` + today)
			}

			if (memoryContext.length > 0) {
				context.metadata.memory = memoryContext.join('\n\n')
			}

			return context
		},

		async onObserve(result) {
			if (!store) return
			if (!result.success) return

			successfulToolCalls++

			// Track tool usage patterns
			const toolName = result.toolName
			const output = typeof result.output === 'string' ? result.output : JSON.stringify(result.output)

			// Auto-extract every N successful tool calls
			if (successfulToolCalls % AUTO_EXTRACT_INTERVAL === 0) {
				const patterns: string[] = []

				// Note frequently used tools
				const pattern = `tool:${toolName}`
				if (!learnedPatterns.has(pattern)) {
					learnedPatterns.add(pattern)
					patterns.push(`- Frequently used tool: ${toolName}`)
				}

				// Detect API keys or credentials in results (warn, don't store)
				const lower = output.toLowerCase()
				if (lower.includes('api_key') || lower.includes('token') || lower.includes('password')) {
					patterns.push(`- Warning: ${toolName} returned sensitive data — use vault for storage`)
				}

				if (patterns.length > 0) {
					try {
						const entry = `### Auto-learned (iteration ${successfulToolCalls})\n${patterns.join('\n')}`
						await store.write('today', entry, 'append', currentSource)
						console.log(`[paw-memory] Auto-extracted ${patterns.length} patterns at tool call #${successfulToolCalls}`)
					} catch {
						// Silent — don't break the loop for memory writes
					}
				}
			}
		},
	},

	async onLoad() {
		const { resolve, join } = await import('node:path')
		const fsModule = await import('node:fs/promises')
		const memoryDir =
			process.env.VOLE_MEMORY_DIR ||
			resolve(process.cwd(), '.openvole', 'paws', 'paw-memory')

		// Auto-migrate from old location (.openvole/memory/ → .openvole/paws/paw-memory/)
		try {
			const oldDir = resolve(process.cwd(), '.openvole', 'memory')
			const entries = await fsModule.readdir(oldDir).catch(() => [] as string[])
			if (entries.length > 0 && oldDir !== memoryDir) {
				console.log(`[paw-memory] migrating data from ${oldDir} to ${memoryDir}`)
				await fsModule.mkdir(memoryDir, { recursive: true })
				for (const entry of entries) {
					const src = join(oldDir, entry)
					const dest = join(memoryDir, entry)
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
				console.log(`[paw-memory] migration complete`)
			}
		} catch { /* no old data */ }

		store = new MemoryStore(memoryDir)
		await store.init()

		// Initialize vector store if an embedding provider is available
		try {
			embedder = await createEmbeddingProvider()
			if (embedder) {
				const dbPath = join(memoryDir, 'vectors.db')
				vectorStore = new VectorStore(dbPath, embedder)
				await vectorStore.init()

				// Index existing memory files
				const files = await store.list('all')
				let indexed = 0
				for (const file of files) {
					const content = await store.read(file.name, file.source as MemorySource)
					if (content.trim()) {
						const count = await vectorStore.indexFile(
							`${file.source}/${file.name}`,
							file.source,
							content,
							new Date(file.modified).getTime(),
						)
						indexed += count
					}
				}
				console.log(
					`[paw-memory] loaded — memory dir: ${memoryDir}, vector search: ${embedder.name}/${embedder.model} (${vectorStore.getFileCount()} files, ${vectorStore.getChunkCount()} chunks)`,
				)
			} else {
				console.log(`[paw-memory] loaded — memory dir: ${memoryDir}, vector search: disabled (no embedding provider)`)
			}
		} catch (err) {
			console.log(`[paw-memory] loaded — memory dir: ${memoryDir}, vector search: failed (${err instanceof Error ? err.message : String(err)})`)
			vectorStore = undefined
		}
	},

	async onUnload() {
		if (vectorStore) {
			vectorStore.close()
			vectorStore = undefined
		}
		embedder = null
		store = undefined
		console.log('[paw-memory] unloaded')
	},
}
