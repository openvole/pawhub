import { z, type PawDefinition } from '@openvole/paw-sdk'
import { MemoryStore, type MemorySource } from './memory.js'

let store: MemoryStore | undefined

/** Current task source — set during bootstrap, used by tools */
let currentSource: MemorySource = 'user'

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
				await store.write(p.file, p.content, mode, p.source ?? currentSource)
				return { ok: true }
			},
		},
		{
			name: 'memory_search',
			description:
				'Search memory files for relevant content. By default searches the current source + shared MEMORY.md. Use source "all" to search everything.',
			parameters: z.object({
				query: z.string().describe('Search query'),
				source: z
					.enum(['user', 'paw', 'heartbeat', 'schedule', 'shared', 'all'])
					.optional()
					.describe('Scope to search. "all" searches every source. Defaults to current source + shared.'),
			}),
			async execute(params) {
				const { query, source } = params as { query: string; source?: MemorySource | 'all' }
				if (!store) throw new Error('Memory store not initialized')
				const results = await store.search(query, source ?? currentSource)
				return { ok: true, results }
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
	},

	async onLoad() {
		const memoryDir =
			process.env.VOLE_MEMORY_DIR ||
			new URL('../../../memory', import.meta.url).pathname
		store = new MemoryStore(memoryDir)
		await store.init()
		console.log(`[paw-memory] loaded — memory dir: ${memoryDir}`)
	},

	async onUnload() {
		store = undefined
		console.log('[paw-memory] unloaded')
	},
}
