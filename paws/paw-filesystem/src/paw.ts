import { z, type PawDefinition } from '@openvole/paw-sdk'
import { SandboxedFs } from './fs.js'

let sandboxedFs: SandboxedFs | undefined

function getFs(): SandboxedFs {
	if (!sandboxedFs) {
		throw new Error('SandboxedFs not initialized — onLoad has not been called')
	}
	return sandboxedFs
}

export const paw: PawDefinition = {
	name: '@openvole/paw-filesystem',
	version: '0.1.0',
	description: 'Filesystem Paw for reading, writing, editing, and searching files',
	brain: false,

	tools: [
		{
			name: 'fs_read',
			description: 'Read a file. Supports offset and limit for large files.',
			parameters: z.object({
				path: z.string().describe('Absolute path to the file to read'),
				offset: z
					.number()
					.optional()
					.describe('Line offset to start reading from (0-based)'),
				limit: z
					.number()
					.optional()
					.describe('Maximum number of lines to read'),
			}),
			async execute(params: unknown) {
				const { path, offset, limit } = params as {
					path: string
					offset?: number
					limit?: number
				}
				return getFs().read(path, offset, limit)
			},
		},
		{
			name: 'fs_write',
			description: 'Write or create a file. Creates parent directories if needed.',
			parameters: z.object({
				path: z.string().describe('Absolute path to the file to write'),
				content: z.string().describe('Content to write to the file'),
			}),
			async execute(params: unknown) {
				const { path, content } = params as { path: string; content: string }
				return getFs().write(path, content)
			},
		},
		{
			name: 'fs_edit',
			description:
				'Search and replace in a file. Fails if the search string is not found.',
			parameters: z.object({
				path: z.string().describe('Absolute path to the file to edit'),
				search: z.string().describe('The exact string to search for'),
				replace: z.string().describe('The string to replace it with'),
			}),
			async execute(params: unknown) {
				const { path, search, replace } = params as {
					path: string
					search: string
					replace: string
				}
				return getFs().edit(path, search, replace)
			},
		},
		{
			name: 'fs_list',
			description: 'List directory contents. Optionally list recursively.',
			parameters: z.object({
				path: z.string().describe('Absolute path to the directory to list'),
				recursive: z
					.boolean()
					.optional()
					.describe('Whether to list recursively'),
			}),
			async execute(params: unknown) {
				const { path, recursive } = params as {
					path: string
					recursive?: boolean
				}
				return getFs().list(path, recursive)
			},
		},
		{
			name: 'fs_search',
			description:
				'Search for text in files within a directory. Returns matching lines.',
			parameters: z.object({
				path: z.string().describe('Absolute path to the directory to search'),
				pattern: z.string().describe('Text pattern to search for'),
				glob: z
					.string()
					.optional()
					.describe('Glob pattern to filter files (e.g. "**/*.ts")'),
			}),
			async execute(params: unknown) {
				const { path, pattern, glob } = params as {
					path: string
					pattern: string
					glob?: string
				}
				return getFs().search(path, pattern, glob)
			},
		},
		{
			name: 'fs_mkdir',
			description: 'Create a directory recursively.',
			parameters: z.object({
				path: z.string().describe('Absolute path to the directory to create'),
			}),
			async execute(params: unknown) {
				const { path } = params as { path: string }
				return getFs().mkdir(path)
			},
		},
	],

	async onLoad() {
		const envDirs = process.env.VOLE_FS_ALLOWED_DIRS
		const allowedDirs = envDirs
			? envDirs.split(',').map((d) => d.trim())
			: ['/app/workspace']

		sandboxedFs = new SandboxedFs(allowedDirs)
		console.log(
			`[paw-filesystem] loaded — allowed dirs: ${allowedDirs.join(', ')}`,
		)
	},

	async onUnload() {
		sandboxedFs = undefined
		console.log('[paw-filesystem] unloaded')
	},
}
