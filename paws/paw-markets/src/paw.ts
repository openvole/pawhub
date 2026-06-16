import { type PawDefinition, z } from '@openvole/paw-sdk'
import { ALERT_SIGNALS, type Trend, computeTrend } from './indicators.js'
import { type AlertRow, alertsConfigured, dispatchAlerts } from './notify.js'
import {
	type Candle,
	type Quote,
	getDailyHistory,
	getNews,
	getQuote,
	hasRealtime,
} from './providers.js'
import {
	appendAlerts,
	readAlertsTail,
	readReport,
	readWatchlist,
	saveReport,
	writeWatchlist,
} from './store.js'

interface PollCfg {
	pollSeconds: number
	moveAlertPct: number
	volumeSpikeX: number
	spacingMs: number
}

let pollCfg: PollCfg = { pollSeconds: 900, moveAlertPct: 5, volumeSpikeX: 1.5, spacingMs: 300 }
let timer: ReturnType<typeof setInterval> | undefined
const historyCache = new Map<string, { date: string; candles: Candle[] }>()
const seenAlerts = new Set<string>()
let lastAlertDay = ''
let lastRunAt = 0

const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms))
const up = (s: string): string => s.trim().toUpperCase()
const round2 = (n: number): number => Math.round(n * 100) / 100
const round1 = (n: number): number => Math.round(n * 10) / 10
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Current weekday (0=Sun) and minutes-past-midnight in US Eastern time. */
function nowET(): { weekday: number; minutes: number } {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: 'America/New_York',
		hourCycle: 'h23',
		weekday: 'short',
		hour: '2-digit',
		minute: '2-digit',
	}).formatToParts(new Date())
	const map: Record<string, string> = {}
	for (const p of parts) map[p.type] = p.value
	const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
	return {
		weekday: days.indexOf(map.weekday ?? ''),
		minutes: Number(map.hour) * 60 + Number(map.minute),
	}
}

/** US regular session, 9:30–16:00 ET, Mon–Fri. Ignores market holidays. */
function isMarketOpen(): boolean {
	const { weekday, minutes } = nowET()
	if (weekday < 1 || weekday > 5) return false
	return minutes >= 9 * 60 + 30 && minutes < 16 * 60
}

function fmtTrend(t: Trend, source: string): Record<string, unknown> {
	const r = (n: number | null): number | null => (n == null ? null : round2(n))
	return {
		symbol: t.symbol,
		price: r(t.price),
		asOf: t.asOf,
		source,
		changePct1d: r(t.changePct1d),
		changePct5d: r(t.changePct5d),
		changePct1mo: r(t.changePct1mo),
		sma20: r(t.sma20),
		sma50: r(t.sma50),
		high52w: r(t.high52w),
		low52w: r(t.low52w),
		pctFrom52wHigh: r(t.pctFrom52wHigh),
		volumeVsAvg: r(t.volumeVsAvg),
		rsi14: t.rsi14 == null ? null : round1(t.rsi14),
		signals: t.signals,
	}
}

/** Build a snapshot of the whole watchlist + detect new alerts. Pure data — no LLM. */
async function buildReport(): Promise<Record<string, unknown>> {
	const symbols = await readWatchlist()
	const today = new Date().toISOString().slice(0, 10)
	if (today !== lastAlertDay) {
		seenAlerts.clear()
		lastAlertDay = today
	}
	const open = isMarketOpen()
	const rows: Record<string, unknown>[] = []
	const newAlerts: Record<string, unknown>[] = []

	for (const sym of symbols) {
		try {
			let hc = historyCache.get(sym)
			if (!hc || hc.date !== today) {
				const candles = await getDailyHistory(sym)
				if (candles.length) {
					hc = { date: today, candles }
					historyCache.set(sym, hc)
				}
			}
			const candles = hc?.candles ?? []
			let quote: Quote | null = null
			if (open || candles.length === 0) {
				try {
					quote = await getQuote(sym)
				} catch {
					/* fall back to candle close */
				}
			}
			if (candles.length === 0 && !quote) {
				rows.push({ symbol: sym, error: 'no data' })
				continue
			}
			const t = computeTrend(sym, candles, {
				price: quote?.price,
				changePct: quote?.changePct ?? undefined,
				moveAlertPct: pollCfg.moveAlertPct,
				volumeSpikeX: pollCfg.volumeSpikeX,
			})
			rows.push({
				...fmtTrend(t, quote?.source ?? (candles.length ? 'yahoo' : 'none')),
				spark: candles.slice(-30).map((c) => round2(c.close)),
			})

			for (const sig of t.signals) {
				if (!ALERT_SIGNALS.includes(sig)) continue
				const k = `${sym}:${sig}:${today}`
				if (seenAlerts.has(k)) continue
				seenAlerts.add(k)
				newAlerts.push({
					ts: new Date().toISOString(),
					symbol: sym,
					signal: sig,
					price: round2(t.price),
					changePct1d: t.changePct1d == null ? null : round2(t.changePct1d),
				})
			}
			await sleep(pollCfg.spacingMs)
		} catch (err) {
			rows.push({ symbol: sym, error: errMsg(err) })
		}
	}

	await appendAlerts(newAlerts)
	await dispatchAlerts(newAlerts as unknown as AlertRow[])
	const report = {
		generatedAt: new Date().toISOString(),
		marketOpen: open,
		realtime: hasRealtime(),
		symbols: rows,
		newAlerts,
		recentAlerts: await readAlertsTail(30),
	}
	await saveReport(report)
	return report
}

export const paw: PawDefinition = {
	name: '@openvole/paw-markets',
	version: '0.1.0',
	description:
		'US stock market tracking, news, and trend monitoring — brain-free polling + commentary tools',
	category: 'infrastructure',

	tools: [
		{
			name: 'stock_quote',
			description: 'Latest price and 1-day change for one or more US tickers.',
			parameters: z.object({
				symbols: z.array(z.string()).describe('Tickers, e.g. ["AAPL","MSFT","NVDA"]'),
			}),
			async execute(params) {
				const { symbols } = params as { symbols: string[] }
				const quotes: Record<string, unknown>[] = []
				for (const s of symbols.map(up)) {
					try {
						const q = await getQuote(s)
						quotes.push({
							symbol: s,
							price: round2(q.price),
							changePct: q.changePct == null ? null : round2(q.changePct),
							asOf: q.asOf,
							source: q.source,
						})
					} catch (e) {
						quotes.push({ symbol: s, error: errMsg(e) })
					}
					await sleep(250)
				}
				return { ok: true, realtime: hasRealtime(), quotes }
			},
		},
		{
			name: 'stock_trend',
			description:
				'Computed trend indicators for a US ticker: % change (1d/5d/1mo), SMA20/50, 52-week high/low, volume vs average, RSI, and signal flags.',
			parameters: z.object({ symbol: z.string().describe('Ticker, e.g. AAPL') }),
			async execute(params) {
				const symbol = up((params as { symbol: string }).symbol)
				const candles = await getDailyHistory(symbol)
				if (!candles.length) return { ok: false, symbol, error: 'no history available' }
				let quote: Quote | null = null
				try {
					quote = await getQuote(symbol)
				} catch {
					/* use candle close */
				}
				const t = computeTrend(symbol, candles, {
					price: quote?.price,
					changePct: quote?.changePct ?? undefined,
					moveAlertPct: pollCfg.moveAlertPct,
					volumeSpikeX: pollCfg.volumeSpikeX,
				})
				return { ok: true, ...fmtTrend(t, quote?.source ?? 'yahoo') }
			},
		},
		{
			name: 'stock_history',
			description: 'Daily closing prices for a US ticker (for charts).',
			parameters: z.object({
				symbol: z.string().describe('Ticker, e.g. AAPL'),
				days: z.number().optional().describe('Lookback days (default 120)'),
			}),
			async execute(params) {
				const { symbol, days } = params as { symbol: string; days?: number }
				const sym = up(symbol)
				const candles = await getDailyHistory(sym, days ?? 120)
				return {
					ok: true,
					symbol: sym,
					points: candles.map((c) => ({ d: c.date, c: round2(c.close) })),
				}
			},
		},
		{
			name: 'stock_news',
			description: 'Recent news headlines for a US ticker (Yahoo Finance RSS).',
			parameters: z.object({
				symbol: z.string().describe('Ticker, e.g. AAPL'),
				limit: z.number().optional().describe('Max headlines (default 10)'),
			}),
			async execute(params) {
				const { symbol, limit } = params as { symbol: string; limit?: number }
				const sym = up(symbol)
				const news = await getNews(sym, limit ?? 10)
				return { ok: true, symbol: sym, count: news.length, news }
			},
		},
		{
			name: 'stock_watchlist',
			description: "Manage the tracked watchlist. action: 'list' | 'add' | 'remove'.",
			parameters: z.object({
				action: z.enum(['list', 'add', 'remove']),
				symbols: z.array(z.string()).optional().describe('Tickers for add/remove'),
			}),
			async execute(params) {
				const { action, symbols } = params as {
					action: 'list' | 'add' | 'remove'
					symbols?: string[]
				}
				let list = await readWatchlist()
				if (action === 'add' && symbols?.length) {
					list = [...new Set([...list, ...symbols.map(up)])]
					await writeWatchlist(list)
				} else if (action === 'remove' && symbols?.length) {
					const rm = new Set(symbols.map(up))
					list = list.filter((s) => !rm.has(s))
					await writeWatchlist(list)
				}
				return { ok: true, watchlist: list }
			},
		},
		{
			name: 'market_report',
			description:
				'Latest snapshot of the watchlist (quotes, trends, new alerts). Call this, then comment on the trends. Pass refresh:true to force a fresh poll.',
			parameters: z.object({
				refresh: z.boolean().optional().describe('Force a fresh poll instead of the cached report'),
			}),
			async execute(params) {
				const { refresh } = params as { refresh?: boolean }
				let report = refresh ? null : await readReport()
				const gen = report?.generatedAt
				const stale =
					typeof gen === 'string' && Date.now() - Date.parse(gen) > pollCfg.pollSeconds * 2000
				if (!report || stale) report = await buildReport()
				return { ok: true, report }
			},
		},
	],

	async onLoad() {
		pollCfg = {
			pollSeconds: Number(process.env.MARKETS_POLL_SECONDS) || 900,
			moveAlertPct: Number(process.env.MARKETS_MOVE_ALERT_PCT) || 5,
			volumeSpikeX: Number(process.env.MARKETS_VOLUME_SPIKE_X) || 1.5,
			spacingMs: 300,
		}

		// Seed the watchlist from MARKETS_SYMBOLS on first run (then it's user-managed).
		const existing = await readWatchlist()
		if (existing.length === 0 && process.env.MARKETS_SYMBOLS) {
			const seed = process.env.MARKETS_SYMBOLS.split(',').map(up).filter(Boolean)
			if (seed.length) await writeWatchlist(seed)
		}

		const tick = async (): Promise<void> => {
			try {
				// When the market is closed, refresh at most hourly (respect free-tier limits).
				if (!isMarketOpen() && Date.now() - lastRunAt < 3_600_000) return
				lastRunAt = Date.now()
				await buildReport()
			} catch (err) {
				console.error(`[paw-markets] poll error: ${errMsg(err)}`)
			}
		}

		timer = setInterval(() => {
			void tick()
		}, pollCfg.pollSeconds * 1000)
		if (typeof timer.unref === 'function') timer.unref()
		void tick()

		console.log(
			`[paw-markets] polling every ${pollCfg.pollSeconds}s — quotes: ${hasRealtime() ? 'finnhub (realtime)' : 'yahoo/twelvedata (delayed)'}; alerts: ${alertsConfigured() ? 'on' : 'off'}; panel: embedded`,
		)
	},

	async onUnload() {
		if (timer) {
			clearInterval(timer)
			timer = undefined
		}
	},
}
