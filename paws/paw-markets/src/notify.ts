// Channel alerts — brain-free, direct to webhooks/bot APIs. No dependency on other paws.

export interface AlertRow {
	symbol: string
	signal: string
	price: number
	changePct1d: number | null
	ts?: string
}

function emojiFor(signal: string): string {
	if (signal === 'big-gain') return '📈'
	if (signal === 'big-drop') return '📉'
	if (signal === 'volume-spike') return '🔊'
	if (signal === 'near-52w-high') return '🚀'
	if (signal === 'near-52w-low') return '🔻'
	return '⚠️'
}

export function formatAlert(a: AlertRow): string {
	const chg = a.changePct1d == null ? '' : ` ${a.changePct1d > 0 ? '+' : ''}${a.changePct1d}%`
	return `${emojiFor(a.signal)} ${a.symbol}${chg} — ${a.signal.replace(/-/g, ' ')} @ $${a.price}`
}

async function post(url: string, body: unknown): Promise<void> {
	await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	})
}

async function sendSlack(text: string): Promise<void> {
	const url = process.env.MARKETS_SLACK_WEBHOOK
	if (!url) return
	try {
		await post(url, { text })
	} catch {
		/* best-effort */
	}
}

async function sendTelegram(text: string): Promise<void> {
	const token = process.env.MARKETS_TELEGRAM_TOKEN
	const chatId = process.env.MARKETS_TELEGRAM_CHAT_ID
	if (!token || !chatId) return
	try {
		await post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chatId, text })
	} catch {
		/* best-effort */
	}
}

/** Generic JSON webhook — `{content}` also satisfies Discord incoming webhooks. */
async function sendWebhook(text: string, alerts: AlertRow[]): Promise<void> {
	const url = process.env.MARKETS_WEBHOOK_URL
	if (!url) return
	try {
		await post(url, { content: text, alerts })
	} catch {
		/* best-effort */
	}
}

/** True if at least one channel is configured. */
export function alertsConfigured(): boolean {
	return Boolean(
		process.env.MARKETS_SLACK_WEBHOOK ||
			(process.env.MARKETS_TELEGRAM_TOKEN && process.env.MARKETS_TELEGRAM_CHAT_ID) ||
			process.env.MARKETS_WEBHOOK_URL,
	)
}

/** Push new alerts to every configured channel. Deterministic — no LLM. */
export async function dispatchAlerts(alerts: AlertRow[]): Promise<void> {
	if (alerts.length === 0 || !alertsConfigured()) return
	const text = alerts.map(formatAlert).join('\n')
	await Promise.allSettled([sendSlack(text), sendTelegram(text), sendWebhook(text, alerts)])
}
