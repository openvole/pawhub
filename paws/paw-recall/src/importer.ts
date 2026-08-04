import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { RecallEngine } from './engine.js'
import type { MemorySource } from './types.js'

/**
 * One-time import from a paw-memory data directory.
 *
 * Mapping: `MEMORY.md` bullets/paragraphs → pinned semantic records (that file was the curated
 * layer, so its content is what the operator chose to keep); per-source daily logs
 * (`<source>/YYYY-MM-DD.md`) → episodic records dated from the filename. The original files are
 * never touched — a rollback to paw-memory keeps working.
 */

const SOURCES: MemorySource[] = ['user', 'paw', 'heartbeat', 'schedule', 'shared']
const MARKER = '.imported-from-paw-memory'

/** Split markdown into rememberable units: bullets and paragraphs, headers dropped. */
function splitUnits(md: string): string[] {
	const units: string[] = []
	let paragraph: string[] = []
	const flush = () => {
		const text = paragraph.join(' ').trim()
		if (text.length >= 8) units.push(text)
		paragraph = []
	}
	for (const raw of md.split('\n')) {
		const line = raw.trim()
		if (!line || line.startsWith('#')) {
			flush()
			continue
		}
		if (/^[-*] /.test(line)) {
			flush()
			const text = line.replace(/^[-*] /, '').trim()
			if (text.length >= 8) units.push(text)
			continue
		}
		paragraph.push(line)
	}
	flush()
	return units.map((u) => u.substring(0, 2000))
}

export async function importFromPawMemory(
	engine: RecallEngine,
	oldDir: string,
	markerDir: string,
): Promise<{ imported: number } | { skipped: string }> {
	const marker = path.join(markerDir, MARKER)
	try {
		await fs.access(marker)
		return { skipped: 'already imported' }
	} catch {
		// not yet imported
	}
	try {
		await fs.access(oldDir)
	} catch {
		return { skipped: 'no paw-memory data found' }
	}

	let imported = 0

	// Curated long-term memory → pinned semantic.
	const longTerm = await fs.readFile(path.join(oldDir, 'MEMORY.md'), 'utf-8').catch(() => '')
	for (const text of splitUnits(longTerm)) {
		await engine.write({
			text,
			kind: 'semantic',
			source: 'shared',
			pinned: true,
			importance: 0.8,
			tags: ['imported'],
		})
		imported++
	}

	// Daily logs → episodic, dated from the filename so decay starts from when it happened.
	for (const source of SOURCES) {
		const dir = path.join(oldDir, source)
		const files = await fs.readdir(dir).catch(() => [] as string[])
		for (const file of files) {
			const m = file.match(/^(\d{4}-\d{2}-\d{2})\.md$/)
			if (!m) continue
			const dayMs = Date.parse(`${m[1]}T12:00:00Z`)
			const body = await fs.readFile(path.join(dir, file), 'utf-8').catch(() => '')
			for (const text of splitUnits(body)) {
				const rec = await engine.write({
					text,
					kind: 'episodic',
					source,
					importance: 0.3,
					tags: ['imported'],
				})
				// Backdate after the fact — write() stamps now, but decay must run from the day
				// the memory was actually formed or a month of old logs all look fresh.
				if (Number.isFinite(dayMs)) {
					rec.createdAt = dayMs
					rec.updatedAt = dayMs
					rec.lastAccessed = dayMs
					await enginePatch(engine, rec)
				}
				imported++
			}
		}
	}

	await fs.mkdir(markerDir, { recursive: true })
	await fs.writeFile(marker, `${new Date().toISOString()} imported=${imported} from=${oldDir}\n`)
	return { imported }
}

/** Write the backdated record through the engine's driver without re-embedding. */
async function enginePatch(
	engine: RecallEngine,
	rec: import('./types.js').MemoryRecord,
): Promise<void> {
	const driver = (engine as unknown as { driver: import('./types.js').MemoryDriver }).driver
	await driver.update(rec)
}
