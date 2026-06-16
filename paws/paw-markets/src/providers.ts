// Free US-equity data layer. Default (no key) = Nasdaq's public quote/historical API, which serves
// reliably without authentication. Keyed providers are preferred when configured: Twelve Data for
// quotes + history, Finnhub for real-time quotes. Yahoo's v8 chart API is kept only as a
// last-resort fallback (it rate-limits aggressively → 429). News via Yahoo RSS. All endpoints are
// unofficial and sent with a browser-like User-Agent.

export interface Candle {
	date: string
	open: number
	high: number
	low: number
	close: number
	volume: number
}

export interface Quote {
	symbol: string
	price: number
	changePct: number | null
	asOf: string
	source: 'finnhub' | 'twelvedata' | 'nasdaq' | 'yahoo'
}

export interface NewsItem {
	title: string
	url: string
	publishedAt: string
}

const HEADERS = {
	'User-Agent':
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
	Accept: 'application/json,text/plain,*/*',
	'Accept-Language': 'en-US,en;q=0.9',
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface ChartResult {
	candles: Candle[]
	price: number
	asOf: string
}

/** True if real-time quotes are available (a Finnhub key is configured). */
export function hasRealtime(): boolean {
	return Boolean(process.env.FINNHUB_KEY)
}

function rangeFor(days: number): string {
	if (days <= 30) return '1mo'
	if (days <= 90) return '3mo'
	if (days <= 180) return '6mo'
	if (days <= 400) return '1y'
	return '2y'
}

/** Yahoo v8 chart → daily candles (ascending) + the latest price. Tries query1 then query2,
 *  with a short retry on 429, since the unofficial endpoint rate-limits aggressively. */
async function getChart(symbol: string, range: string): Promise<ChartResult> {
	const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']
	let lastErr = 'unknown'
	for (const host of hosts) {
		const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`
		try {
			let res = await fetch(url, { headers: HEADERS })
			if (res.status === 429) {
				await sleep(900)
				res = await fetch(url, { headers: HEADERS })
			}
			if (!res.ok) {
				lastErr = `HTTP ${res.status}`
				continue
			}
			const json = (await res.json()) as {
				chart?: {
					result?: Array<{
						timestamp?: number[]
						meta?: { regularMarketPrice?: number; regularMarketTime?: number }
						indicators?: { quote?: Array<Record<string, Array<number | null>>> }
					}>
					error?: { description?: string }
				}
			}
			const r = json?.chart?.result?.[0]
			if (!r) {
				lastErr = json?.chart?.error?.description ?? 'no data'
				continue
			}
			const ts = r.timestamp ?? []
			const q = r.indicators?.quote?.[0] ?? {}
			const candles: Candle[] = []
			for (let i = 0; i < ts.length; i++) {
				const close = q.close?.[i]
				if (close == null) continue
				candles.push({
					date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
					open: q.open?.[i] ?? close,
					high: q.high?.[i] ?? close,
					low: q.low?.[i] ?? close,
					close,
					volume: q.volume?.[i] ?? 0,
				})
			}
			const price = r.meta?.regularMarketPrice ?? candles[candles.length - 1]?.close ?? 0
			const asOf = r.meta?.regularMarketTime
				? new Date(r.meta.regularMarketTime * 1000).toISOString()
				: new Date().toISOString()
			return { candles, price, asOf }
		} catch (e) {
			lastErr = e instanceof Error ? e.message : String(e)
		}
	}
	throw new Error(`yahoo chart ${symbol} -> ${lastErr}`)
}

const NASDAQ_HEADERS = { ...HEADERS, Accept: 'application/json' }

const parseMoney = (s: string | undefined): number =>
	s ? Number(s.replace(/[$,]/g, '')) : Number.NaN

/** "06/15/2026" → "2026-06-15" */
const mmddyyyyToISO = (s: string): string => {
	const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
	return m ? `${m[3]}-${m[1]}-${m[2]}` : s
}

/** Nasdaq public daily history (no key). Returns ascending candles. */
async function nasdaqHistory(symbol: string, days: number): Promise<Candle[]> {
	const to = new Date()
	const from = new Date(to.getTime() - (days + 10) * 86_400_000)
	const fmt = (d: Date): string => d.toISOString().slice(0, 10)
	const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical?assetclass=stocks&fromdate=${fmt(from)}&todate=${fmt(to)}&limit=9999`
	const res = await fetch(url, { headers: NASDAQ_HEADERS })
	if (!res.ok) throw new Error(`nasdaq history ${symbol} -> ${res.status}`)
	const j = (await res.json()) as {
		data?: {
			tradesTable?: {
				rows?: Array<{
					date: string
					open: string
					high: string
					low: string
					close: string
					volume: string
				}>
			}
		}
	}
	const rows = j?.data?.tradesTable?.rows
	if (!rows?.length) throw new Error(`nasdaq: no history for ${symbol}`)
	return rows
		.map((r) => ({
			date: mmddyyyyToISO(r.date),
			open: parseMoney(r.open),
			high: parseMoney(r.high),
			low: parseMoney(r.low),
			close: parseMoney(r.close),
			volume: Number((r.volume ?? '').replace(/,/g, '')) || 0,
		}))
		.filter((c) => Number.isFinite(c.close))
		.reverse()
}

/** Nasdaq public latest quote (no key; real-time during market hours). */
async function nasdaqQuote(symbol: string): Promise<Quote> {
	const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/info?assetclass=stocks`
	const res = await fetch(url, { headers: NASDAQ_HEADERS })
	if (!res.ok) throw new Error(`nasdaq quote ${symbol} -> ${res.status}`)
	const j = (await res.json()) as {
		data?: { primaryData?: { lastSalePrice?: string; percentageChange?: string } }
	}
	const pd = j?.data?.primaryData
	const price = parseMoney(pd?.lastSalePrice)
	if (!Number.isFinite(price)) throw new Error(`nasdaq: no quote for ${symbol}`)
	const pct = pd?.percentageChange ? Number(pd.percentageChange.replace(/[%+]/g, '')) : Number.NaN
	return {
		symbol,
		price,
		changePct: Number.isFinite(pct) ? pct : null,
		asOf: new Date().toISOString(),
		source: 'nasdaq',
	}
}

/** Daily OHLCV history (ascending by date). Twelve Data (keyed) → Nasdaq → Yahoo. */
export async function getDailyHistory(symbol: string, days = 400): Promise<Candle[]> {
	const tdKey = process.env.TWELVEDATA_KEY
	if (tdKey) {
		try {
			return await tdHistory(symbol, tdKey, Math.min(Math.max(days, 60), 5000))
		} catch {
			/* fall back to free providers */
		}
	}
	try {
		return await nasdaqHistory(symbol, days)
	} catch {
		/* fall back to Yahoo */
	}
	const { candles } = await getChart(symbol, rangeFor(days))
	return candles
}

async function tdHistory(symbol: string, key: string, outputsize: number): Promise<Candle[]> {
	const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=${outputsize}&apikey=${key}`
	const res = await fetch(url, { headers: HEADERS })
	if (!res.ok) throw new Error(`twelvedata ts ${symbol} -> ${res.status}`)
	const j = (await res.json()) as {
		message?: string
		values?: Array<{
			datetime: string
			open: string
			high: string
			low: string
			close: string
			volume: string
		}>
	}
	if (!j.values?.length) throw new Error(`twelvedata: ${j.message ?? 'no data'}`)
	return j.values
		.map((v) => ({
			date: v.datetime,
			open: Number(v.open),
			high: Number(v.high),
			low: Number(v.low),
			close: Number(v.close),
			volume: Number(v.volume) || 0,
		}))
		.reverse()
}

/** Latest quote — Finnhub (real-time) when FINNHUB_KEY is set, else Yahoo (delayed, no key). */
export async function getQuote(symbol: string): Promise<Quote> {
	const key = process.env.FINNHUB_KEY
	if (key) {
		const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`
		const res = await fetch(url, { headers: HEADERS })
		if (res.ok) {
			const d = (await res.json()) as { c?: number; dp?: number; t?: number }
			if (typeof d.c === 'number' && d.c > 0) {
				return {
					symbol,
					price: d.c,
					changePct: typeof d.dp === 'number' ? d.dp : null,
					asOf: d.t ? new Date(d.t * 1000).toISOString() : new Date().toISOString(),
					source: 'finnhub',
				}
			}
		}
	}
	const tdKey = process.env.TWELVEDATA_KEY
	if (tdKey) {
		try {
			return await tdQuote(symbol, tdKey)
		} catch {
			/* fall back to free providers */
		}
	}
	try {
		return await nasdaqQuote(symbol)
	} catch {
		/* fall back to Yahoo */
	}
	const { candles, price, asOf } = await getChart(symbol, '5d')
	const closes = candles.map((c) => c.close)
	const prev = closes.length >= 2 ? closes[closes.length - 2] : null
	const changePct = prev ? ((price - prev) / prev) * 100 : null
	return { symbol, price, changePct, asOf, source: 'yahoo' }
}

async function tdQuote(symbol: string, key: string): Promise<Quote> {
	const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${key}`
	const res = await fetch(url, { headers: HEADERS })
	if (!res.ok) throw new Error(`twelvedata quote ${symbol} -> ${res.status}`)
	const j = (await res.json()) as {
		close?: string
		percent_change?: string
		datetime?: string
		timestamp?: number
		message?: string
	}
	const price = Number(j.close)
	if (!Number.isFinite(price)) throw new Error(`twelvedata: ${j.message ?? 'no quote'}`)
	return {
		symbol,
		price,
		changePct: j.percent_change != null ? Number(j.percent_change) : null,
		asOf: j.timestamp
			? new Date(j.timestamp * 1000).toISOString()
			: (j.datetime ?? new Date().toISOString()),
		source: 'twelvedata',
	}
}

/** Recent news headlines via Yahoo Finance RSS — no key. */
export async function getNews(symbol: string, limit = 10): Promise<NewsItem[]> {
	const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`
	let xml: string
	try {
		const res = await fetch(url, { headers: HEADERS })
		if (!res.ok) return []
		xml = await res.text()
	} catch {
		return []
	}
	const items: NewsItem[] = []
	const itemRe = /<item>([\s\S]*?)<\/item>/g
	let m: RegExpExecArray | null = itemRe.exec(xml)
	while (m && items.length < limit) {
		const block = m[1]
		const title = unescapeXml(pickTag(block, 'title'))
		if (title) {
			items.push({ title, url: pickTag(block, 'link'), publishedAt: pickTag(block, 'pubDate') })
		}
		m = itemRe.exec(xml)
	}
	return items
}

function pickTag(block: string, tag: string): string {
	const m = block.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`))
	return m ? m[1].trim() : ''
}

function unescapeXml(s: string): string {
	return s
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&')
}
