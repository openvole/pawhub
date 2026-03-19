import { z, type PawDefinition } from '@openvole/paw-sdk'
import { ShellExecutor } from './executor.js'

let executor: ShellExecutor | undefined

function getExecutor(): ShellExecutor {
	if (!executor) {
		throw new Error('ShellExecutor not initialized — paw not loaded')
	}
	return executor
}

export const paw: PawDefinition = {
	name: '@openvole/paw-shell',
	version: '0.1.0',
	description: 'Paw for executing shell commands with safety restrictions',

	tools: [
		{
			name: 'shell_exec',
			description:
				'Run a shell command synchronously and return its output (stdout, stderr, exit code)',
			parameters: z.object({
				command: z.string().describe('The shell command to execute'),
				cwd: z
					.string()
					.optional()
					.describe('Working directory (must be within allowed dirs)'),
				timeout_ms: z
					.number()
					.optional()
					.describe('Timeout in milliseconds (default 30000)'),
			}),
			async execute(params: unknown) {
				const { command, cwd, timeout_ms } = params as {
					command: string
					cwd?: string
					timeout_ms?: number
				}
				return getExecutor().exec(command, cwd, timeout_ms)
			},
		},
		{
			name: 'shell_exec_background',
			description:
				'Run a shell command in the background and return a process ID for later status checks',
			parameters: z.object({
				command: z.string().describe('The shell command to execute in the background'),
				cwd: z
					.string()
					.optional()
					.describe('Working directory (must be within allowed dirs)'),
			}),
			async execute(params: unknown) {
				const { command, cwd } = params as {
					command: string
					cwd?: string
				}
				return getExecutor().execBackground(command, cwd)
			},
		},
		{
			name: 'shell_status',
			description:
				'Check the status of a background process (running, exit code, output)',
			parameters: z.object({
				process_id: z.string().describe('The process ID returned by shell_exec_background'),
			}),
			async execute(params: unknown) {
				const { process_id } = params as { process_id: string }
				return getExecutor().status(process_id)
			},
		},
		{
			name: 'shell_kill',
			description: 'Kill a background process by its process ID',
			parameters: z.object({
				process_id: z.string().describe('The process ID to kill'),
			}),
			async execute(params: unknown) {
				const { process_id } = params as { process_id: string }
				getExecutor().kill(process_id)
				return { killed: true, process_id }
			},
		},
	],

	async onLoad() {
		const envDirs = process.env.VOLE_SHELL_ALLOWED_DIRS
		const allowedDirs = envDirs
			? envDirs.split(',').map((d) => d.trim()).filter(Boolean)
			: ['/app/workspace']

		executor = new ShellExecutor(allowedDirs)
		console.log(
			`[paw-shell] loaded — allowed dirs: ${allowedDirs.join(', ')}`,
		)
	},

	async onUnload() {
		if (executor) {
			executor.cleanup()
			executor = undefined
		}
		console.log('[paw-shell] unloaded')
	},
}
