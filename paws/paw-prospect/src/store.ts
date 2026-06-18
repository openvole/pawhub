import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { CompanyProfile } from './extract.js'

/** Paw data dir — the sandbox grants write access here automatically. */
export function dataDir(): string {
	return (
		process.env.VOLE_PROSPECT_DIR ||
		path.resolve(process.cwd(), '.openvole', 'paws', 'paw-prospect')
	)
}

const HISTORY_FILE = 'history.jsonl'

export interface HistoryEntry {
	domain: string
	name: string | null
	url: string
	logo: string | null
	at: string
}

/** Record a successful lookup, de-duplicated by domain, newest first (capped at 200). */
export async function recordLookup(profile: CompanyProfile): Promise<void> {
	if (!profile.ok) return
	const dir = dataDir()
	await fs.mkdir(dir, { recursive: true })
	const entry: HistoryEntry = {
		domain: profile.domain,
		name: profile.name,
		url: profile.url,
		logo: profile.logo,
		at: profile.fetchedAt,
	}
	const existing = await readHistory(200)
	const next = [entry, ...existing.filter((e) => e.domain !== profile.domain)].slice(0, 200)
	await fs.writeFile(
		path.join(dir, HISTORY_FILE),
		`${next.map((e) => JSON.stringify(e)).join('\n')}\n`,
		'utf-8',
	)
}

/** Recent lookups, newest first. */
export async function readHistory(limit = 50): Promise<HistoryEntry[]> {
	try {
		const raw = await fs.readFile(path.join(dataDir(), HISTORY_FILE), 'utf-8')
		return raw
			.trim()
			.split('\n')
			.filter(Boolean)
			.slice(0, limit)
			.map((l) => JSON.parse(l) as HistoryEntry)
	} catch {
		return []
	}
}

export async function clearHistory(): Promise<void> {
	try {
		await fs.rm(path.join(dataDir(), HISTORY_FILE))
	} catch {
		/* nothing to clear */
	}
}
