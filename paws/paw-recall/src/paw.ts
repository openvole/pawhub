import { type PawDefinition, z } from '@openvole/paw-sdk'
import { MarkdownDriver } from './drivers/markdown.js'
import { createEmbeddingProvider } from './embeddings.js'
import { RecallEngine, defaultDigestPath } from './engine.js'
import { importFromPawMemory } from './importer.js'
import type { MemoryKind, MemorySource, ScoredRecord } from './types.js'

let engine: RecallEngine | undefined

/** Current task source — set during bootstrap, used to scope reads and default writes. */
let currentSource: MemorySource = 'user'
/** Provenance for auto-captured records, set during bootstrap. */
let currentTask: { taskId?: string; sessionId?: string } = {}
/** Failed-tool capture is capped per task so a retry loop cannot flood episodic memory. */
let failuresCapturedThisTask = 0
const MAX_FAILURES_PER_TASK = 3

const KINDS = ['episodic', 'semantic', 'procedural', 'entity'] as const
const SOURCES = ['user', 'paw', 'heartbeat', 'schedule', 'shared'] as const

function renderResult(s: ScoredRecord) {
	return {
		id: s.record.id,
		kind: s.record.kind,
		text: s.record.text.substring(0, 500),
		score: Number(s.score.toFixed(4)),
		source: s.record.source,
		tags: s.record.tags,
		pinned: s.record.pinned,
		created: new Date(s.record.createdAt).toISOString(),
		provenance: s.record.provenance,
	}
}

export const paw: PawDefinition = {
	name: '@openvole/paw-recall',
	version: '0.1.0',
	description:
		'Memory with a memory model — typed records, hybrid retrieval with decay, pluggable storage backends',

	tools: [
		{
			name: 'memory_search',
			description:
				'Search memory. Hybrid retrieval: semantic + keyword + recency + importance, de-duplicated. Returns records with ids — pass an id to memory_read, memory_pin, or memory_forget.',
			parameters: z.object({
				query: z.string().describe('What to recall'),
				limit: z.number().optional().describe('Max results. Default 10.'),
				kind: z
					.enum(KINDS)
					.optional()
					.describe('episodic = events, semantic = facts, procedural = how-tos, entity = profiles'),
				source: z
					.enum([...SOURCES, 'all'] as const)
					.optional()
					.describe('Scope. Defaults to current task source + shared. "all" searches everything.'),
				tags: z.array(z.string()).optional().describe('Only records carrying one of these tags'),
			}),
			async execute(params) {
				const p = params as {
					query: string
					limit?: number
					kind?: MemoryKind
					source?: MemorySource | 'all'
					tags?: string[]
				}
				if (!engine) throw new Error('Memory engine not initialized')
				const results = await engine.search(
					p.query,
					{ kind: p.kind, source: p.source ?? currentSource, tags: p.tags },
					p.limit ?? 10,
				)
				return { ok: true, results: results.map(renderResult) }
			},
		},
		{
			name: 'memory_write',
			description:
				'Store a memory. Choose the kind: episodic (something that happened), semantic (a durable fact or preference — the default), procedural (a how-to that worked), entity (a profile of a person/project/machine). Pin what must never fade.',
			parameters: z.object({
				text: z.string().optional().describe('The memory to store'),
				kind: z.enum(KINDS).optional().describe('Default: semantic'),
				tags: z.array(z.string()).optional(),
				entities: z
					.array(z.string())
					.optional()
					.describe('Names this memory is about (people, projects, machines)'),
				importance: z.number().optional().describe('0..1 — how much this should outrank peers. Default 0.5.'),
				pinned: z.boolean().optional().describe('Pinned memories never decay and appear in the digest'),
				ttl_hours: z.number().optional().describe('Expire after this many hours (rare)'),
				source: z.enum(SOURCES).optional().describe('Defaults to the current task source'),
				// paw-memory compatibility: older prompts call memory_write(file, content).
				file: z.string().optional().describe('Deprecated (paw-memory compat) — use kind/pinned instead'),
				content: z.string().optional().describe('Deprecated alias for text'),
			}),
			async execute(params) {
				const p = params as {
					text?: string
					content?: string
					file?: string
					kind?: MemoryKind
					tags?: string[]
					entities?: string[]
					importance?: number
					pinned?: boolean
					ttl_hours?: number
					source?: MemorySource
				}
				if (!engine) throw new Error('Memory engine not initialized')
				const text = p.text ?? p.content
				if (!text?.trim()) return { ok: false, error: 'text is empty' }
				// Compat mapping: MEMORY.md meant "curated, durable" → pinned semantic; a daily
				// log meant "what happened today" → episodic.
				const compatPinned = p.file === 'MEMORY.md' ? true : undefined
				const compatKind: MemoryKind | undefined =
					p.file && p.file !== 'MEMORY.md' ? 'episodic' : undefined
				const rec = await engine.write({
					text,
					kind: p.kind ?? compatKind ?? 'semantic',
					source: p.source ?? currentSource,
					tags: p.tags,
					entities: p.entities,
					importance: p.importance,
					pinned: p.pinned ?? compatPinned,
					ttlHours: p.ttl_hours,
					provenance: currentTask,
				})
				return { ok: true, id: rec.id, kind: rec.kind, pinned: rec.pinned }
			},
		},
		{
			name: 'memory_read',
			description:
				'Read a memory record by id, or pass "digest" (or no id) for the curated summary of pinned and important memories.',
			parameters: z.object({
				id: z.string().optional().describe('Record id from memory_search, or "digest"'),
			}),
			async execute(params) {
				const { id } = params as { id?: string }
				if (!engine) throw new Error('Memory engine not initialized')
				if (!id || id === 'digest' || id === 'MEMORY.md') {
					return { ok: true, content: await engine.generateDigest() }
				}
				const rec = await engine.get(id)
				if (!rec) return { ok: false, error: `No record ${id}` }
				return { ok: true, record: { ...rec, provenance: rec.provenance } }
			},
		},
		{
			name: 'memory_list',
			description: 'List recent memory records, newest first.',
			parameters: z.object({
				kind: z.enum(KINDS).optional(),
				source: z.enum([...SOURCES, 'all'] as const).optional(),
				limit: z.number().optional().describe('Default 20'),
			}),
			async execute(params) {
				const p = params as { kind?: MemoryKind; source?: MemorySource | 'all'; limit?: number }
				if (!engine) throw new Error('Memory engine not initialized')
				const records = await engine.list(
					{ kind: p.kind, source: p.source ?? currentSource },
					p.limit ?? 20,
				)
				return {
					ok: true,
					records: records.map((r) => ({
						id: r.id,
						kind: r.kind,
						text: r.text.substring(0, 200),
						source: r.source,
						pinned: r.pinned,
						created: new Date(r.createdAt).toISOString(),
					})),
				}
			},
		},
		{
			name: 'memory_forget',
			description:
				'Archive a memory record — it stops being recalled but is never deleted (recoverable by the operator).',
			parameters: z.object({ id: z.string().describe('Record id from memory_search') }),
			async execute(params) {
				const { id } = params as { id: string }
				if (!engine) throw new Error('Memory engine not initialized')
				const ok = await engine.archive(id)
				return ok ? { ok: true, archived: id } : { ok: false, error: `No record ${id}` }
			},
		},
		{
			name: 'memory_pin',
			description: 'Pin (or unpin) a memory — pinned memories never decay and appear in the digest.',
			parameters: z.object({
				id: z.string().describe('Record id from memory_search'),
				pinned: z.boolean().optional().describe('Default true'),
			}),
			async execute(params) {
				const { id, pinned } = params as { id: string; pinned?: boolean }
				if (!engine) throw new Error('Memory engine not initialized')
				const ok = await engine.setPinned(id, pinned ?? true)
				return ok ? { ok: true, id, pinned: pinned ?? true } : { ok: false, error: `No record ${id}` }
			},
		},
	],

	hooks: {
		async onBootstrap(context) {
			if (!engine) return context
			currentSource = ((context.metadata.taskSource as string) || 'user') as MemorySource
			currentTask = {
				taskId: context.taskId,
				sessionId: context.metadata.sessionId as string | undefined,
			}
			failuresCapturedThisTask = 0

			// Digest + records relevant to this task, under a budget derived from the context
			// window: memory informs the task, it must not crowd it out.
			const maxTokens = (context.metadata.maxContextTokens as number) || 128_000
			const charBudget = Math.min(8000, Math.floor(maxTokens * 4 * 0.05))
			const parts: string[] = []

			const digest = await engine.generateDigest()
			if (digest.split('\n').length > 5) parts.push(digest)

			const taskInput = context.messages.find((m) => m.role === 'user')?.content
			if (taskInput) {
				const hits = await engine.search(taskInput.substring(0, 1000), { source: currentSource }, 8)
				const fresh = hits.filter((h) => !h.record.pinned) // digest already carries pinned
				if (fresh.length > 0) {
					parts.push(
						'## Relevant Memories\n' +
							fresh
								.map((h) => `- [${h.record.kind}] ${h.record.text.replace(/\s+/g, ' ').substring(0, 240)}`)
								.join('\n'),
					)
				}
			}

			if (parts.length > 0) {
				context.metadata.memory = parts.join('\n\n').substring(0, charBudget)
			}
			return context
		},

		async onObserve(result) {
			if (!engine) return
			// Failures are what the next run most needs to remember — capped so a retry loop
			// cannot flood episodic memory with the same error.
			if (result.success || failuresCapturedThisTask >= MAX_FAILURES_PER_TASK) return
			failuresCapturedThisTask++
			const detail =
				typeof result.output === 'string' ? result.output : JSON.stringify(result.output ?? '')
			try {
				await engine.write({
					text: `Tool ${result.toolName} failed: ${detail.substring(0, 400)}`,
					kind: 'episodic',
					source: currentSource,
					importance: 0.4,
					tags: ['auto', 'failure', `tool:${result.toolName}`],
					provenance: currentTask,
				})
			} catch {
				// never break the loop for a memory write
			}
		},
	},

	async onLoad() {
		const { resolve } = await import('node:path')
		const backend = process.env.VOLE_MEMORY_BACKEND || 'markdown'
		if (backend !== 'markdown') {
			throw new Error(
				`[paw-recall] backend "${backend}" is not available yet (roadmap: sqlite, postgres). Unset VOLE_MEMORY_BACKEND or set it to "markdown".`,
			)
		}
		const dir =
			process.env.VOLE_MEMORY_DIR || resolve(process.cwd(), '.openvole', 'paws', 'paw-recall')

		const embedder = await createEmbeddingProvider()
		const driver = new MarkdownDriver(dir)
		engine = new RecallEngine(driver, embedder, defaultDigestPath(dir))
		await engine.init()

		// One-time import of paw-memory data (marker-guarded; originals untouched).
		const oldDir = resolve(process.cwd(), '.openvole', 'paws', 'paw-memory')
		const imported = await importFromPawMemory(engine, oldDir, dir).catch((err) => ({
			skipped: `import failed: ${err instanceof Error ? err.message : err}`,
		}))
		if ('imported' in imported && imported.imported > 0) {
			console.log(`[paw-recall] imported ${imported.imported} records from paw-memory`)
		}

		// Capture task completions as episodic memory — the event carries source and session, so
		// heartbeat runs are remembered as heartbeat work, not misfiled as the user's.
		if (process.send) {
			const { createIpcTransport } = await import('@openvole/paw-sdk')
			const transport = createIpcTransport()
			transport.subscribe(['task:completed'])
			transport.onBusEvent((event, data) => {
				if (event !== 'task:completed' || !engine) return
				const d = data as { taskId?: string; result?: string; sessionId?: string; source?: string }
				if (!d.result || d.result.length < 40) return
				void engine
					.write({
						text: `Task outcome: ${d.result.substring(0, 500)}`,
						kind: 'episodic',
						source: (d.source as MemorySource) || 'user',
						importance: 0.3,
						tags: ['auto', 'task'],
						provenance: { taskId: d.taskId, sessionId: d.sessionId },
					})
					.catch(() => {})
			})

			// Loud warning when paw-memory is also loaded — same tool names would conflict and
			// auto-prefix, and the brain would see two memories that do not share data.
			try {
				const paws = (await transport.query('paws')) as Array<{ name?: string }>
				if (paws?.some((p) => p.name === '@openvole/paw-memory')) {
					console.warn(
						'[paw-recall] WARNING: @openvole/paw-memory is also loaded. Run one memory paw, not both — their identical tool names will conflict. Remove paw-memory from vole.config.json; paw-recall imported its data.',
					)
				}
			} catch {
				// query unavailable (older core) — skip the check
			}
		}

		console.log(
			`[paw-recall] loaded — backend: markdown, dir: ${dir}, embeddings: ${embedder ? `${embedder.name}/${embedder.model}` : 'disabled (lexical-only)'}`,
		)
	},

	async onUnload() {
		await engine?.close()
		engine = undefined
		console.log('[paw-recall] unloaded')
	},
}
