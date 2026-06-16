import * as fs from 'node:fs/promises'
import * as path from 'node:path'

/** Paw data dir — sandbox grants write access to this automatically. */
export function dataDir(): string {
	return (
		process.env.VOLE_MARKETS_DIR || path.resolve(process.cwd(), '.openvole', 'paws', 'paw-markets')
	)
}

export async function readWatchlist(): Promise<string[]> {
	try {
		const raw = await fs.readFile(path.join(dataDir(), 'watchlist.json'), 'utf-8')
		const parsed = JSON.parse(raw) as { symbols?: string[] }
		return Array.isArray(parsed.symbols) ? parsed.symbols : []
	} catch {
		return []
	}
}

export async function writeWatchlist(symbols: string[]): Promise<void> {
	const dir = dataDir()
	await fs.mkdir(dir, { recursive: true })
	await fs.writeFile(
		path.join(dir, 'watchlist.json'),
		`${JSON.stringify({ symbols }, null, 2)}\n`,
		'utf-8',
	)
}

export async function saveReport(report: unknown): Promise<void> {
	const dir = path.join(dataDir(), 'reports')
	await fs.mkdir(dir, { recursive: true })
	await fs.writeFile(path.join(dir, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf-8')
}

export async function readReport(): Promise<Record<string, unknown> | null> {
	try {
		const raw = await fs.readFile(path.join(dataDir(), 'reports', 'latest.json'), 'utf-8')
		return JSON.parse(raw) as Record<string, unknown>
	} catch {
		return null
	}
}

export async function appendAlerts(alerts: Array<Record<string, unknown>>): Promise<void> {
	if (alerts.length === 0) return
	const dir = dataDir()
	await fs.mkdir(dir, { recursive: true })
	const lines = `${alerts.map((a) => JSON.stringify(a)).join('\n')}\n`
	await fs.appendFile(path.join(dir, 'alerts.jsonl'), lines, 'utf-8')
}

/** Most recent alerts (newest first) from alerts.jsonl. */
export async function readAlertsTail(limit = 50): Promise<Record<string, unknown>[]> {
	try {
		const raw = await fs.readFile(path.join(dataDir(), 'alerts.jsonl'), 'utf-8')
		const lines = raw.trim().split('\n').filter(Boolean)
		return lines
			.slice(-limit)
			.reverse()
			.map((l) => JSON.parse(l) as Record<string, unknown>)
	} catch {
		return []
	}
}
