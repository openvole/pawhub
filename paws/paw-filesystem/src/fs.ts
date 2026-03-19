import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { glob } from 'glob'

const MAX_READ_CHARS = 50000
const MAX_SEARCH_RESULTS = 100

export class SandboxedFs {
	private allowedDirs: string[]

	constructor(allowedDirs: string[] = ['/app/workspace']) {
		this.allowedDirs = allowedDirs.map((d) => path.resolve(d))
	}

	validatePath(filePath: string): string {
		const resolved = path.resolve(filePath)
		const allowed = this.allowedDirs.some(
			(dir) => resolved === dir || resolved.startsWith(dir + path.sep),
		)
		if (!allowed) {
			throw new Error(
				`Path "${resolved}" is outside allowed directories: ${this.allowedDirs.join(', ')}`,
			)
		}
		return resolved
	}

	async read(
		filePath: string,
		offset?: number,
		limit?: number,
	): Promise<{ content: string; lines: number; size: number }> {
		const resolved = this.validatePath(filePath)
		const stat = await fs.stat(resolved)
		const raw = await fs.readFile(resolved, 'utf-8')

		let lines = raw.split('\n')
		if (offset !== undefined && offset > 0) {
			lines = lines.slice(offset)
		}
		if (limit !== undefined && limit > 0) {
			lines = lines.slice(0, limit)
		}

		let content = lines.join('\n')
		if (content.length > MAX_READ_CHARS) {
			content = content.slice(0, MAX_READ_CHARS)
			content += '\n... [truncated]'
		}

		return { content, lines: lines.length, size: stat.size }
	}

	async write(
		filePath: string,
		content: string,
	): Promise<{ written: true; size: number }> {
		const resolved = this.validatePath(filePath)
		await fs.mkdir(path.dirname(resolved), { recursive: true })
		await fs.writeFile(resolved, content, 'utf-8')
		const stat = await fs.stat(resolved)
		return { written: true, size: stat.size }
	}

	async edit(
		filePath: string,
		search: string,
		replace: string,
	): Promise<{ edited: true; occurrences: number }> {
		const resolved = this.validatePath(filePath)
		const content = await fs.readFile(resolved, 'utf-8')

		if (!content.includes(search)) {
			throw new Error(
				`Search string not found in "${resolved}"`,
			)
		}

		let occurrences = 0
		const updated = content.replaceAll(search, () => {
			occurrences++
			return replace
		})

		await fs.writeFile(resolved, updated, 'utf-8')
		return { edited: true, occurrences }
	}

	async list(
		dirPath: string,
		recursive?: boolean,
	): Promise<
		Array<{ name: string; type: 'file' | 'directory'; size: number; modified: string }>
	> {
		const resolved = this.validatePath(dirPath)

		if (recursive) {
			const matches = await glob('**/*', {
				cwd: resolved,
				dot: false,
				withFileTypes: true,
			})

			const results: Array<{
				name: string
				type: 'file' | 'directory'
				size: number
				modified: string
			}> = []

			for (const entry of matches) {
				const fullPath = path.join(resolved, entry.relative())
				try {
					const stat = await fs.stat(fullPath)
					results.push({
						name: entry.relative(),
						type: stat.isDirectory() ? 'directory' : 'file',
						size: stat.size,
						modified: stat.mtime.toISOString(),
					})
				} catch {
					// skip entries we can't stat
				}
			}

			return results
		}

		const entries = await fs.readdir(resolved, { withFileTypes: true })
		const results: Array<{
			name: string
			type: 'file' | 'directory'
			size: number
			modified: string
		}> = []

		for (const entry of entries) {
			const fullPath = path.join(resolved, entry.name)
			const stat = await fs.stat(fullPath)
			results.push({
				name: entry.name,
				type: entry.isDirectory() ? 'directory' : 'file',
				size: stat.size,
				modified: stat.mtime.toISOString(),
			})
		}

		return results
	}

	async search(
		dirPath: string,
		pattern: string,
		fileGlob?: string,
	): Promise<Array<{ file: string; line: string; lineNumber: number; content: string }>> {
		const resolved = this.validatePath(dirPath)

		const globPattern = fileGlob || '**/*'
		const files = await glob(globPattern, {
			cwd: resolved,
			nodir: true,
			dot: false,
		})

		const results: Array<{
			file: string
			line: string
			lineNumber: number
			content: string
		}> = []

		for (const file of files) {
			if (results.length >= MAX_SEARCH_RESULTS) break

			const fullPath = path.join(resolved, file)
			try {
				const content = await fs.readFile(fullPath, 'utf-8')
				const lines = content.split('\n')

				for (let i = 0; i < lines.length; i++) {
					if (results.length >= MAX_SEARCH_RESULTS) break

					if (lines[i].includes(pattern)) {
						results.push({
							file,
							line: lines[i],
							lineNumber: i + 1,
							content: lines[i],
						})
					}
				}
			} catch {
				// skip files we can't read (binary, permissions, etc.)
			}
		}

		return results
	}

	async mkdir(dirPath: string): Promise<{ created: true }> {
		const resolved = this.validatePath(dirPath)
		await fs.mkdir(resolved, { recursive: true })
		return { created: true }
	}
}
