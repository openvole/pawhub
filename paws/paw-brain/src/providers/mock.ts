import type { AgentMessage, PlannedAction, ToolSummary } from '@openvole/paw-sdk'
import type { BrainProvider, ThinkResult } from '../types.js'

/** A step in BRAIN_MOCK_SCRIPT: either a tool call or a final text response. */
type ScriptStep = { tool: string; params?: Record<string, unknown> } | { response: string }

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

	constructor(model: string, script?: ScriptStep[]) {
		this.model = model
		this.script = script ?? []
	}

	async think(
		_systemPrompt: string,
		messages: AgentMessage[],
		_tools: ToolSummary[],
		_sessionHistory?: string,
	): Promise<ThinkResult> {
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
