import type { PawDefinition, AgentContext, AgentMessage } from '@openvole/paw-sdk'

const DEFAULT_KEEP_RECENT = 10

function getKeepRecent(): number {
	const env = process.env.VOLE_COMPACT_KEEP_RECENT
	if (env) {
		const parsed = parseInt(env, 10)
		if (!isNaN(parsed) && parsed > 0) return parsed
	}
	return DEFAULT_KEEP_RECENT
}

/**
 * Build a structured summary from a list of messages being compacted.
 * No LLM needed — extracts tool calls, results, brain responses, and errors.
 */
function buildSummary(messages: AgentMessage[]): string {
	const lines: string[] = []

	for (const msg of messages) {
		switch (msg.role) {
			case 'brain': {
				if (msg.toolCall) {
					// Brain issued a tool call
					const paramsStr = summarizeParams(msg.toolCall.params)
					lines.push(`- Called ${msg.toolCall.name}(${paramsStr})`)
				} else if (msg.content) {
					// Brain text response
					const truncated =
						msg.content.length > 100
							? msg.content.slice(0, 100) + '...'
							: msg.content
					lines.push(`- Brain: "${truncated}"`)
				}
				break
			}
			case 'tool_result': {
				if (msg.toolCall) {
					const paramsStr = summarizeParams(msg.toolCall.params)
					const resultPreview = summarizeContent(msg.content)
					lines.push(
						`- Called ${msg.toolCall.name}(${paramsStr}) -> ${resultPreview}`,
					)
				} else {
					const resultPreview = summarizeContent(msg.content)
					lines.push(`- Tool result: ${resultPreview}`)
				}
				break
			}
			case 'error': {
				const errorPreview =
					msg.content.length > 120
						? msg.content.slice(0, 120) + '...'
						: msg.content
				lines.push(`- Error: ${errorPreview}`)
				break
			}
			case 'user': {
				const truncated =
					msg.content.length > 100
						? msg.content.slice(0, 100) + '...'
						: msg.content
				lines.push(`- User: "${truncated}"`)
				break
			}
		}
	}

	return `[Context Summary \u2014 ${messages.length} messages compacted]\n${lines.join('\n')}`
}

/** Summarize tool params to a compact key: value string */
function summarizeParams(params: unknown): string {
	if (params == null) return ''
	if (typeof params === 'string') {
		return params.length > 60 ? params.slice(0, 60) + '...' : params
	}
	if (typeof params !== 'object') return String(params)

	const obj = params as Record<string, unknown>
	const parts: string[] = []
	for (const [key, value] of Object.entries(obj)) {
		let valStr: string
		if (typeof value === 'string') {
			valStr =
				value.length > 40
					? `"${value.slice(0, 40)}..."`
					: `"${value}"`
		} else if (value == null) {
			continue
		} else {
			valStr = JSON.stringify(value)
			if (valStr.length > 40) valStr = valStr.slice(0, 40) + '...'
		}
		parts.push(`${key}: ${valStr}`)
	}
	return parts.join(', ')
}

/** Summarize content string — success/failure indicator + char count */
function summarizeContent(content: string): string {
	if (!content) return 'empty'

	// Try to detect success/failure from common patterns
	const lower = content.toLowerCase()
	const isError =
		lower.startsWith('error') ||
		lower.includes('"error"') ||
		lower.includes('"ok":false') ||
		lower.includes('"ok": false')
	const status = isError ? 'error' : 'success'

	return `${status} (${content.length} chars)`
}

export const paw: PawDefinition = {
	name: '@openvole/paw-compact',
	version: '0.1.0',
	description:
		'Default context compactor — keeps first message + recent messages, replaces middle with structured summary',
	inProcess: true,

	hooks: {
		async onCompact(context: AgentContext): Promise<AgentContext> {
			const messages = context.messages
			const KEEP_RECENT = getKeepRecent()

			// Nothing to compact if we don't have enough messages
			if (messages.length <= KEEP_RECENT + 2) return context

			const firstMessage = messages[0] // original user input
			const oldMessages = messages.slice(1, messages.length - KEEP_RECENT)
			const recentMessages = messages.slice(
				messages.length - KEEP_RECENT,
			)

			// Build structured summary from old messages
			const summary = buildSummary(oldMessages)

			// Replace with: first message + summary + recent messages
			context.messages = [
				firstMessage,
				{
					role: 'brain',
					content: summary,
					timestamp: Date.now(),
				},
				...recentMessages,
			]

			return context
		},
	},

	async onLoad() {
		// Logged to file via paw-loader, silent on console (in-process paw)
	},

	async onUnload() {
		// Silent
	},
}
