import type { AgentMessage, PlannedAction, ToolSummary } from '@openvole/paw-sdk'

export interface ThinkResult {
	actions: PlannedAction[]
	response?: string
	done?: boolean
	inputTokens?: number | string
	outputTokens?: number | string
}

export interface BrainProvider {
	readonly name: string
	readonly model: string

	think(
		systemPrompt: string,
		messages: AgentMessage[],
		tools: ToolSummary[],
		sessionHistory?: string,
	): Promise<ThinkResult>
}
