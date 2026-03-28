import type { PawDefinition, AgentContext, AgentMessage } from '@openvole/paw-sdk'

const DEFAULT_KEEP_RECENT = 10

/** Approximate chars per token for budget estimation */
const CHARS_PER_TOKEN = 4

function getKeepRecent(): number {
	const env = process.env.VOLE_COMPACT_KEEP_RECENT
	if (env) {
		const parsed = parseInt(env, 10)
		if (!isNaN(parsed) && parsed > 0) return parsed
	}
	return DEFAULT_KEEP_RECENT
}

function estimateTokens(text: string): number {
	if (!text) return 0
	const trimmed = text.trimStart()
	const isJson = trimmed.startsWith('{') || trimmed.startsWith('[')
	return Math.ceil(text.length / (isJson ? 2 : CHARS_PER_TOKEN))
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
					const paramsStr = summarizeParams(msg.toolCall.params)
					lines.push(`- Called ${msg.toolCall.name}(${paramsStr})`)
				} else if (msg.content) {
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

	return `[Context Summary — ${messages.length} messages compacted]\n${lines.join('\n')}`
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

	const lower = content.toLowerCase()
	const isError =
		lower.startsWith('error') ||
		lower.includes('"error"') ||
		lower.includes('"ok":false') ||
		lower.includes('"ok": false')
	const status = isError ? 'error' : 'success'

	return `${status} (${content.length} chars)`
}

/**
 * Shrink a tool result in-place to a compact summary.
 * Returns the token savings.
 */
function shrinkToolResult(msg: AgentMessage): number {
	const oldTokens = estimateTokens(msg.content)
	const toolName = msg.toolCall?.name ?? 'tool'
	const preview = msg.content.substring(0, 150)
	const status = summarizeContent(msg.content)
	msg.content = `[${toolName}: ${status}] ${preview}...`
	return oldTokens - estimateTokens(msg.content)
}

export const paw: PawDefinition = {
	name: '@openvole/paw-compact',
	version: '1.1.0',
	description:
		'Context compactor — token-aware compaction with in-place tool result shrinking and structured summarization',
	inProcess: true,

	hooks: {
		async onCompact(context: AgentContext): Promise<AgentContext> {
			const messages = context.messages
			const KEEP_RECENT = getKeepRecent()

			// Phase 1: Shrink large tool results that Brain has already seen
			// This works even with few messages — targets the token hogs
			let tokensSaved = 0
			const LARGE_RESULT_THRESHOLD = 500 // chars
			for (const msg of messages) {
				if (msg.role !== 'tool_result') continue
				// Only shrink results the Brain has already processed
				if (msg.seenAtIteration === undefined) continue
				if (msg.content.length > LARGE_RESULT_THRESHOLD) {
					tokensSaved += shrinkToolResult(msg)
				}
			}

			if (tokensSaved > 0) {
				console.log(`[paw-compact] Phase 1: shrunk seen tool results, saved ~${tokensSaved} tokens`)
			}

			// Phase 2: If enough messages, do full structured compaction
			// (keep first message + summary + recent messages)
			if (messages.length > KEEP_RECENT + 2) {
				const firstMessage = messages[0]
				const oldMessages = messages.slice(1, messages.length - KEEP_RECENT)
				const recentMessages = messages.slice(messages.length - KEEP_RECENT)

				const summary = buildSummary(oldMessages)

				context.messages = [
					firstMessage,
					{
						role: 'brain',
						content: summary,
						timestamp: Date.now(),
					},
					...recentMessages,
				]

				console.log(
					`[paw-compact] Phase 2: compacted ${oldMessages.length} old messages into summary`,
				)
			}

			return context
		},
	},

	async onLoad() {
		// Silent — in-process paw
	},

	async onUnload() {
		// Silent
	},
}
