import { execaCommand } from 'execa'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ResultPromise } from 'execa'

const MAX_OUTPUT_LENGTH = 10000
const MAX_BACKGROUND_PROCESSES = 10
const DEFAULT_TIMEOUT_MS = 30_000

const BLOCKED_PATTERNS = ['rm -rf /', 'mkfs', 'dd if=', ':(){', 'fork bomb']

export interface ExecResult {
	stdout: string
	stderr: string
	exitCode: number
	durationMs: number
}

export interface BackgroundExecResult {
	processId: string
}

export interface ProcessStatus {
	running: boolean
	exitCode?: number
	stdout?: string
	stderr?: string
}

interface BackgroundProcess {
	process: ResultPromise
	stdout: string
	stderr: string
	exitCode?: number
	running: boolean
}

function truncate(str: string): string {
	if (str.length > MAX_OUTPUT_LENGTH) {
		return str.slice(0, MAX_OUTPUT_LENGTH) + '\n... [truncated]'
	}
	return str
}

export class ShellExecutor {
	private allowedDirs: string[]
	private backgroundProcesses = new Map<string, BackgroundProcess>()

	constructor(allowedDirs: string[] = ['/app/workspace']) {
		this.allowedDirs = allowedDirs.map((d) => resolve(d))
	}

	private validateCwd(cwd: string): void {
		const resolved = resolve(cwd)
		const isAllowed = this.allowedDirs.some(
			(dir) => resolved === dir || resolved.startsWith(dir + '/'),
		)
		if (!isAllowed) {
			throw new Error(
				`Working directory "${cwd}" is not within allowed directories: ${this.allowedDirs.join(', ')}`,
			)
		}
	}

	private validateCommand(command: string): void {
		const lower = command.toLowerCase()
		for (const pattern of BLOCKED_PATTERNS) {
			if (lower.includes(pattern)) {
				throw new Error(`Command blocked: contains forbidden pattern "${pattern}"`)
			}
		}
	}

	async exec(command: string, cwd?: string, timeoutMs?: number): Promise<ExecResult> {
		const workDir = cwd || this.allowedDirs[0]
		this.validateCwd(workDir)
		this.validateCommand(command)

		const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS
		const start = Date.now()

		try {
			const result = await execaCommand(command, {
				cwd: workDir,
				timeout,
				shell: true,
				reject: false,
			})

			return {
				stdout: truncate(result.stdout),
				stderr: truncate(result.stderr),
				exitCode: result.exitCode ?? 0,
				durationMs: Date.now() - start,
			}
		} catch (error) {
			const durationMs = Date.now() - start
			const message = error instanceof Error ? error.message : String(error)
			return {
				stdout: '',
				stderr: truncate(message),
				exitCode: 1,
				durationMs,
			}
		}
	}

	async execBackground(command: string, cwd?: string): Promise<BackgroundExecResult> {
		const workDir = cwd || this.allowedDirs[0]
		this.validateCwd(workDir)
		this.validateCommand(command)

		if (this.backgroundProcesses.size >= MAX_BACKGROUND_PROCESSES) {
			throw new Error(
				`Maximum background processes reached (${MAX_BACKGROUND_PROCESSES}). Kill some before starting new ones.`,
			)
		}

		const processId = randomUUID()

		const proc = execaCommand(command, {
			cwd: workDir,
			shell: true,
			reject: false,
		})

		const entry: BackgroundProcess = {
			process: proc,
			stdout: '',
			stderr: '',
			running: true,
		}

		proc.then((result) => {
			entry.stdout = truncate(result.stdout)
			entry.stderr = truncate(result.stderr)
			entry.exitCode = result.exitCode ?? 0
			entry.running = false
		}).catch((error) => {
			const message = error instanceof Error ? error.message : String(error)
			entry.stderr = truncate(message)
			entry.exitCode = 1
			entry.running = false
		})

		this.backgroundProcesses.set(processId, entry)
		return { processId }
	}

	status(processId: string): ProcessStatus {
		const entry = this.backgroundProcesses.get(processId)
		if (!entry) {
			throw new Error(`No background process found with ID "${processId}"`)
		}

		return {
			running: entry.running,
			exitCode: entry.exitCode,
			stdout: entry.running ? undefined : entry.stdout,
			stderr: entry.running ? undefined : entry.stderr,
		}
	}

	kill(processId: string): void {
		const entry = this.backgroundProcesses.get(processId)
		if (!entry) {
			throw new Error(`No background process found with ID "${processId}"`)
		}

		if (entry.running) {
			entry.process.kill()
			entry.running = false
			entry.exitCode = 137
		}

		this.backgroundProcesses.delete(processId)
	}

	cleanup(): void {
		for (const [id, entry] of this.backgroundProcesses) {
			if (entry.running) {
				entry.process.kill()
			}
		}
		this.backgroundProcesses.clear()
	}
}
