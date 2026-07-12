import { readFileSync } from 'node:fs'
import type { AgentMessage, PlannedAction, ToolSummary } from '@openvole/paw-sdk'
import type { BrainProvider, ThinkResult } from '../types.js'

/** A step in BRAIN_MOCK_SCRIPT: either a tool call or a final text response. */
type ScriptStep = { tool: string; params?: Record<string, unknown> } | { response: string }

/** Scenario mode (BRAIN_MOCK_SCENARIO): pattern-matched, multi-step, interpolated. */
interface ScenarioRule {
	/** Case-insensitive regexes tried against the latest user message; first rule that hits wins. */
	match: string[]
	steps: ScriptStep[]
}
interface Scenario {
	rules: ScenarioRule[]
	/** Reply when no rule matches. */
	fallback?: string
}

/**
 * Resolve {{tokens}} against the run so canned text can carry live data:
 *   {{user}}         — the latest user message
 *   {{last_result}}  — the latest tool result (pretty-printed JSON when parseable)
 *   {{last.a.b.0}}   — a dot-path into the parsed latest tool result
 */
function interpolate(text: string, messages: AgentMessage[]): string {
	const lastUser = [...messages].reverse().find((m) => m.role === 'user')
	const lastTool = [...messages].reverse().find((m) => m.role === 'tool_result')
	const raw = typeof lastTool?.content === 'string' ? lastTool.content : JSON.stringify(lastTool?.content ?? null)
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		parsed = undefined
	}
	return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, token: string) => {
		if (token === 'user') return String(lastUser?.content ?? '')
		if (token === 'last_result') {
			return parsed !== undefined ? JSON.stringify(parsed, null, 2) : (raw ?? '(no result yet)')
		}
		if (token.startsWith('last.')) {
			let cur: unknown = parsed
			for (const key of token.slice(5).split('.')) {
				if (cur == null || typeof cur !== 'object') return '(missing)'
				cur = (cur as Record<string, unknown>)[key]
			}
			return typeof cur === 'string' ? cur : JSON.stringify(cur ?? '(missing)')
		}
		return `{{${token}}}`
	})
}

function interpolateParams(
	params: Record<string, unknown>,
	messages: AgentMessage[],
): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const [k, v] of Object.entries(params)) {
		if (typeof v === 'string') out[k] = interpolate(v, messages)
		else if (v && typeof v === 'object' && !Array.isArray(v))
			out[k] = interpolateParams(v as Record<string, unknown>, messages)
		else out[k] = v
	}
	return out
}

/**
 * MockProvider — a zero-cost, deterministic "brain" for testing. No network, no LLM.
 *
 * Two modes:
 *  - Echo (default): replies with the latest incoming message. Ideal for a
 *    receiver/hub — proves a message arrived and a reply round-trips. Set
 *    BRAIN_MOCK_REPLY to return a fixed string instead of echoing.
 *  - Scripted (BRAIN_MOCK_SCRIPT): plays a fixed sequence of tool calls, then a
 *    final response. Ideal for a sender that must call a specific tool
 *    (e.g. net_message) deterministically. Example:
 *      BRAIN_MOCK_SCRIPT='[{"tool":"net_message","params":{"to":"hub","text":"hi"}},{"response":"done"}]'
 */
export class MockProvider implements BrainProvider {
	readonly name = 'mock'
	readonly model: string
	private script: ScriptStep[]
	private step = 0
	private scenario: Scenario | undefined
	private activeSteps: ScriptStep[] | undefined

	constructor(model: string, script?: ScriptStep[]) {
		this.model = model
		this.script = script ?? []
		const scenarioPath = process.env.BRAIN_MOCK_SCENARIO
		if (scenarioPath) {
			try {
				this.scenario = JSON.parse(readFileSync(scenarioPath, 'utf-8')) as Scenario
			} catch (err) {
				console.error(`[paw-brain:mock] failed to load scenario ${scenarioPath}:`, err)
			}
		}
	}

	async think(
		_systemPrompt: string,
		messages: AgentMessage[],
		_tools: ToolSummary[],
		_sessionHistory?: string,
	): Promise<ThinkResult> {
		// Scenario mode: pattern-match the user message, then play that rule's steps —
		// tool calls run for real; responses interpolate live results ({{last_result}}, {{last.x}}).
		if (this.scenario) {
			const fresh = !messages.some((m) => m.role !== 'user')
			if (fresh) {
				this.step = 0
				const lastUser = [...messages].reverse().find((m) => m.role === 'user')
				const text = String(lastUser?.content ?? '')
				const rule = this.scenario.rules.find((r) =>
					r.match.some((rx) => {
						try {
							return new RegExp(rx, 'i').test(text)
						} catch {
							return false
						}
					}),
				)
				this.activeSteps = rule?.steps
			}
			if (!this.activeSteps) {
				const fallback = this.scenario.fallback ?? "I'm a scripted demo brain — try one of my magic words!"
				return { actions: [], response: interpolate(fallback, messages), done: true, inputTokens: 0, outputTokens: 0 }
			}
			const stepDef = this.activeSteps[Math.min(this.step, this.activeSteps.length - 1)]
			this.step++
			if ('tool' in stepDef) {
				const actions: PlannedAction[] = [
					{ tool: stepDef.tool, params: interpolateParams(stepDef.params ?? {}, messages) },
				]
				return { actions, inputTokens: 0, outputTokens: 0 }
			}
			return {
				actions: [],
				response: interpolate(stepDef.response, messages),
				done: true,
				inputTokens: 0,
				outputTokens: 0,
			}
		}

		// Scripted mode: drive a deterministic sequence of tool calls + a final reply.
		if (this.script.length > 0) {
			// Reset at the start of each fresh run (no brain/tool messages yet).
			if (!messages.some((m) => m.role !== 'user')) this.step = 0
			const stepDef = this.script[Math.min(this.step, this.script.length - 1)]
			this.step++
			if ('tool' in stepDef) {
				const actions: PlannedAction[] = [{ tool: stepDef.tool, params: stepDef.params ?? {} }]
				return { actions, inputTokens: 0, outputTokens: 0 }
			}
			return { actions: [], response: stepDef.response, done: true, inputTokens: 0, outputTokens: 0 }
		}

		// Echo mode: fixed reply, or echo the latest user/peer message.
		const fixed = process.env.BRAIN_MOCK_REPLY
		if (fixed) {
			return { actions: [], response: fixed, done: true, inputTokens: 0, outputTokens: 0 }
		}
		const lastUser = [...messages].reverse().find((m) => m.role === 'user')
		const incoming = lastUser?.content ?? '(no input)'
		return {
			actions: [],
			response: `[mock reply] ${incoming}`,
			done: true,
			inputTokens: 0,
			outputTokens: 0,
		}
	}
}
