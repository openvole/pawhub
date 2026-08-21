import type { AgentMessage } from '@openvole/paw-sdk'

/**
 * What a CLI brain needs told about being an OpenVole agent rather than a coding session.
 *
 * Every line here answers something an agent actually got wrong in the field. These CLIs arrive
 * with a complete idea of what they are, and several of their concepts collide with OpenVole's
 * under the same names — "skill" most of all. Left unsaid, a CLI resolves the collision in favour
 * of its own meaning and then reports OpenVole's version as missing.
 */
export const HOST_NOTE = `# You are running as an OpenVole agent

You are the brain of the OpenVole agent described above, not a coding session in whatever CLI is
hosting you. The instructions above are that agent's — its identity, workspace and standing rules
outrank your defaults wherever the two differ.

**Skills.** The skills listed above are OpenVole skills. They do not live in \`~/.claude/skills\`
and are not your own CLI's skills. Read one with the OpenVole \`skill_read\` tool and run its
scripts with \`skill_run_script\`; \`skill_list_files\` shows what a skill contains. A skill
named in these instructions **is** available — if you cannot see it, you are looking in the wrong
place, so check with \`skill_read\` before reporting it missing.

**Workspace.** Write into the workspace directory named above, using its absolute path. It is this
agent's own directory and is not \`~/.openvole\` — the home-directory one belongs to a different
installation, and work written there is lost to this agent.

**Your reply ends the run.** Nothing of yours keeps running after you answer: there is no
background pipeline, no picking this up later, no checking back. If work is unfinished, say what
is done and what is not. Never report progress you have not made or describe work as still
running — schedule it with \`schedule_task\` or leave it for the next turn instead.`

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
