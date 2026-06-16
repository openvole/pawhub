import type { Candle } from './providers.js'

export interface Trend {
	symbol: string
	price: number
	asOf: string
	changePct1d: number | null
	changePct5d: number | null
	changePct1mo: number | null
	sma20: number | null
	sma50: number | null
	high52w: number | null
	low52w: number | null
	pctFrom52wHigh: number | null
	avgVolume20: number | null
	volumeVsAvg: number | null
	rsi14: number | null
	signals: string[]
}

function sma(values: number[], n: number): number | null {
	if (values.length < n) return null
	const slice = values.slice(-n)
	return slice.reduce((a, b) => a + b, 0) / n
}

function pctChange(now: number, then: number): number | null {
	if (!then) return null
	return ((now - then) / then) * 100
}

/** Simple (non-Wilder) RSI over `period` closes. */
function rsi(closes: number[], period = 14): number | null {
	if (closes.length < period + 1) return null
	let gains = 0
	let losses = 0
	for (let i = closes.length - period; i < closes.length; i++) {
		const diff = closes[i] - closes[i - 1]
		if (diff >= 0) gains += diff
		else losses -= diff
	}
	const avgGain = gains / period
	const avgLoss = losses / period
	if (avgLoss === 0) return 100
	return 100 - 100 / (1 + avgGain / avgLoss)
}

/** Notable signals worth alerting on (subset of all signals). */
export const ALERT_SIGNALS = [
	'big-gain',
	'big-drop',
	'near-52w-high',
	'near-52w-low',
	'volume-spike',
]

export interface TrendOptions {
	/** Latest price (live quote) — overrides last candle close when present. */
	price?: number
	/** Headline 1-day % change from a live quote — overrides the candle-derived value. */
	changePct?: number
	moveAlertPct?: number
	volumeSpikeX?: number
}

/** Compute trend indicators + signals from a daily OHLCV series (ascending). */
export function computeTrend(symbol: string, candles: Candle[], opts: TrendOptions = {}): Trend {
	const closes = candles.map((c) => c.close)
	const volumes = candles.map((c) => c.volume)
	const last = candles[candles.length - 1]
	const price = opts.price ?? last?.close ?? 0
	const asOf = last?.date ?? ''

	const win52 = candles.slice(-252)
	const high52w = win52.length ? Math.max(...win52.map((c) => c.high)) : null
	const low52w = win52.length ? Math.min(...win52.map((c) => c.low)) : null
	const avgVolume20 = sma(volumes, 20)
	const lastVol = last?.volume ?? 0

	const changePct1d =
		opts.changePct ??
		(closes.length >= 2 ? pctChange(closes[closes.length - 1], closes[closes.length - 2]) : null)
	const changePct5d =
		closes.length >= 6 ? pctChange(closes[closes.length - 1], closes[closes.length - 6]) : null
	const changePct1mo =
		closes.length >= 22 ? pctChange(closes[closes.length - 1], closes[closes.length - 22]) : null
	const sma20 = sma(closes, 20)
	const sma50 = sma(closes, 50)
	const volumeVsAvg = avgVolume20 ? lastVol / avgVolume20 : null
	const pctFrom52wHigh = high52w ? pctChange(price, high52w) : null
	const rsi14 = rsi(closes, 14)

	const moveAlertPct = opts.moveAlertPct ?? 5
	const volumeSpikeX = opts.volumeSpikeX ?? 1.5
	const signals: string[] = []
	if (changePct1d != null && Math.abs(changePct1d) >= moveAlertPct) {
		signals.push(changePct1d > 0 ? 'big-gain' : 'big-drop')
	}
	if (sma50 != null) signals.push(price > sma50 ? 'above-sma50' : 'below-sma50')
	if (high52w != null && price >= high52w * 0.98) signals.push('near-52w-high')
	if (low52w != null && price <= low52w * 1.02) signals.push('near-52w-low')
	if (volumeVsAvg != null && volumeVsAvg >= volumeSpikeX) signals.push('volume-spike')
	if (rsi14 != null && rsi14 >= 70) signals.push('overbought')
	if (rsi14 != null && rsi14 <= 30) signals.push('oversold')

	return {
		symbol,
		price,
		asOf,
		changePct1d,
		changePct5d,
		changePct1mo,
		sma20,
		sma50,
		high52w,
		low52w,
		pctFrom52wHigh,
		avgVolume20,
		volumeVsAvg,
		rsi14,
		signals,
	}
}
