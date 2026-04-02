import type { PawDefinition, AgentContext, AgentMessage } from '@openvole/paw-sdk'
import { createCompactionLLM, type CompactionLLM } from './llm.js'

const DEFAULT_KEEP_RECENT = 10

/** Approximate chars per token for budget estimation */
const CHARS_PER_TOKEN = 4

let compactionLLM: CompactionLLM | null = null
let llmInitialized = false

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

// ============================================================
// Heuristic helpers (Level 0 — no LLM, free)
// ============================================================

/** Build a structured summary from messages (no LLM) */
function buildHeuristicSummary(messages: AgentMessage[]): string {
	const lines: string[] = []

	for (const msg of messages) {
		switch (msg.role) {
			case 'brain': {
				if (msg.toolCall) {
					const paramsStr = summarizeParams(msg.toolCall.params)
					lines.push(`- Called ${msg.toolCall.name}(${paramsStr})`)
				} else if (msg.content) {
					const truncated = msg.content.length > 100
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
					lines.push(`- Called ${msg.toolCall.name}(${paramsStr}) -> ${resultPreview}`)
				} else {
					lines.push(`- Tool result: ${summarizeContent(msg.content)}`)
				}
				break
			}
			case 'error': {
				const preview = msg.content.length > 120
					? msg.content.slice(0, 120) + '...'
					: msg.content
				lines.push(`- Error: ${preview}`)
				break
			}
			case 'user': {
				const truncated = msg.content.length > 100
					? msg.content.slice(0, 100) + '...'
					: msg.content
				lines.push(`- User: "${truncated}"`)
				break
			}
		}
	}

	return `[Context Summary — ${messages.length} messages compacted]\n${lines.join('\n')}`
}

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
			valStr = value.length > 40 ? `"${value.slice(0, 40)}..."` : `"${value}"`
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

function summarizeContent(content: string): string {
	if (!content) return 'empty'
	const lower = content.toLowerCase()
	const isError =
		lower.startsWith('error') ||
		lower.includes('"error"') ||
		lower.includes('"ok":false') ||
		lower.includes('"ok": false')
	return `${isError ? 'error' : 'success'} (${content.length} chars)`
}

/** Shrink a seen tool result in-place. Returns token savings. */
function shrinkToolResult(msg: AgentMessage): number {
	const oldTokens = estimateTokens(msg.content)
	const toolName = msg.toolCall?.name ?? 'tool'
	const status = summarizeContent(msg.content)
	const preview = msg.content.substring(0, 150)
	msg.content = `[${toolName}: ${status}] ${preview}...`
	return oldTokens - estimateTokens(msg.content)
}

// ============================================================
// LLM summarization (Level 1 — configurable model)
// ============================================================

const SUMMARIZATION_PROMPT = `Summarize this conversation history into a structured summary. Preserve:

1. **Task**: The original user request and any clarifications
2. **Progress**: What has been completed so far
3. **Decisions**: Key decisions made and their rationale
4. **Blockers**: Any unresolved issues or errors encountered
5. **Next Steps**: What needs to happen next
6. **Context**: Important facts, user preferences, constraints

Be concise but preserve all decision logic, identifiers (file paths, variable names, URLs), and rationale. Discard redundant tool outputs and exploratory dead-ends.

Format as structured text with the section headers above.

---
CONVERSATION HISTORY:
`

async function llmSummarize(messages: AgentMessage[]): Promise<string | null> {
	if (!compactionLLM) return null

	// Build conversation text for the LLM
	const lines: string[] = []
	for (const msg of messages) {
		const role = msg.role === 'brain' ? 'Assistant' : msg.role === 'tool_result' ? 'Tool' : msg.role.charAt(0).toUpperCase() + msg.role.slice(1)
		let content = msg.content
		// Truncate very long tool results to save on summarization tokens
		if (msg.role === 'tool_result' && content.length > 500) {
			content = content.substring(0, 500) + '... [truncated]'
		}
		if (msg.toolCall) {
			lines.push(`[${role}] Called ${msg.toolCall.name}`)
			lines.push(`[Tool Result] ${content}`)
		} else {
			lines.push(`[${role}] ${content}`)
		}
	}

	const prompt = SUMMARIZATION_PROMPT + lines.join('\n')
	const inputTokens = estimateTokens(prompt)

	try {
		const start = Date.now()
		const summary = await compactionLLM.summarize(prompt)
		const durationMs = Date.now() - start
		const outputTokens = estimateTokens(summary)
		// LLM summarization logged to file only (not console — in-process paw)
		return summary
	} catch (err) {
		// console.log(`[paw-compact] LLM summarization failed: ${err instanceof Error ? err.message : String(err)}`)
		return null
	}
}

// ============================================================
// Paw definition
// ============================================================

export const paw: PawDefinition = {
	name: '@openvole/paw-compact',
	version: '2.0.0',
	description:
		'Context compactor — heuristic trimming (default) + optional LLM summarization for higher-quality compaction',
	inProcess: true,

	hooks: {
		async onCompact(context: AgentContext): Promise<AgentContext> {
			const messages = context.messages
			const KEEP_RECENT = getKeepRecent()

			// Phase 1: Shrink large seen tool results in-place (always runs)
			let tokensSaved = 0
			const LARGE_RESULT_THRESHOLD = 500
			for (const msg of messages) {
				if (msg.role !== 'tool_result') continue
				if (msg.seenAtIteration === undefined) continue
				if (msg.content.length > LARGE_RESULT_THRESHOLD) {
					tokensSaved += shrinkToolResult(msg)
				}
			}
			if (tokensSaved > 0) {
				// console.log(`[paw-compact] Phase 1: shrunk seen tool results, saved ~${tokensSaved} tokens`)
			}

			// Phase 2: Full compaction (if enough messages)
			if (messages.length > KEEP_RECENT + 2) {
				const firstMessage = messages[0]
				const oldMessages = messages.slice(1, messages.length - KEEP_RECENT)
				const recentMessages = messages.slice(messages.length - KEEP_RECENT)

				// Initialize LLM on first use (lazy — don't slow down startup)
				if (!llmInitialized) {
					llmInitialized = true
					try {
						compactionLLM = await createCompactionLLM()
						if (compactionLLM) {
							// console.log(`[paw-compact] LLM compaction enabled: ${compactionLLM.provider}/${compactionLLM.model}`)
						}
					} catch {
						compactionLLM = null
					}
				}

				// Try LLM summarization first, fall back to heuristic
				let summary: string
				const llmSummary = await llmSummarize(oldMessages)
				if (llmSummary) {
					summary = `[LLM Summary — ${oldMessages.length} messages compacted]\n${llmSummary}`
					// console.log(`[paw-compact] Phase 2: LLM summarized ${oldMessages.length} messages`)
				} else {
					summary = buildHeuristicSummary(oldMessages)
					// console.log(`[paw-compact] Phase 2: heuristic summary of ${oldMessages.length} messages`)
				}

				context.messages = [
					firstMessage,
					{
						role: 'brain',
						content: summary,
						timestamp: Date.now(),
					},
					...recentMessages,
				]
			}

			return context
		},
	},

	async onLoad() {
		// LLM initialized lazily on first compaction (don't slow startup)
		const modelSpec = process.env.VOLE_COMPACT_MODEL
		if (modelSpec) {
			// console.log(`[paw-compact] LLM compaction configured: ${modelSpec} (will initialize on first use)`)
		}
	},

	async onUnload() {
		compactionLLM = null
		llmInitialized = false
	},
}
