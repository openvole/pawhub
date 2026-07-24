import type { AgentMessage } from '@openvole/paw-sdk'

/**
 * Flatten the OpenVole conversation into a single prompt for a CLI-backed brain.
 *
 * CLI brains (claude-code, antigravity) take one blob of text rather than a structured message
 * array, so roles are rendered as labels and the sections are joined with rules. `extraNote`
 * carries provider-specific guidance (e.g. MCP tool naming) just after the system prompt.
 */
export function renderPrompt(
	systemPrompt: string,
	messages: AgentMessage[],
	sessionHistory?: string,
	extraNote?: string,
): string {
	const parts: string[] = []
	if (systemPrompt) parts.push(systemPrompt)
	if (extraNote) parts.push(extraNote)
	if (sessionHistory) parts.push(`# Earlier conversation\n${sessionHistory}`)
	const transcript = messages
		.map((m) => {
			const who =
				m.role === 'user'
					? 'User'
					: m.role === 'brain'
						? 'Assistant'
						: m.role === 'tool_result'
							? 'Tool result'
							: String(m.role)
			const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
			return `${who}: ${content}`
		})
		.join('\n\n')
	parts.push(`# Conversation\n${transcript}\n\nAssistant:`)
	return parts.join('\n\n---\n\n')
}
