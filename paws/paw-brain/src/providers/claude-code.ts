import { writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import type { AgentMessage, ToolSummary } from '@openvole/paw-sdk'
import type { BrainProvider, ThinkResult } from '../types.js'

/** Expand a leading ~ to the user's home directory. */
const expandHome = (p: string): string => (p === '~' || p.startsWith('~/') ? p.replace(/^~/, homedir()) : p)

/** Flatten the OpenVole conversation into a single prompt for the Claude Code CLI. */
function renderPrompt(systemPrompt: string, messages: AgentMessage[], sessionHistory?: string): string {
	const parts: string[] = []
	if (systemPrompt) parts.push(systemPrompt)
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

let cachedMcpConfigPath: string | null | undefined

/**
 * When CLAUDE_CODE_EXPOSE_TOOLS is on, write a `--mcp-config` that points Claude Code at the
 * control plane's MCP endpoint for this space — so Claude Code can call OpenVole's own tools
 * (as `mcp__openvole__<tool>`) in addition to its built-ins. The control plane injects
 * VOLE_DASHBOARD_URL / VOLE_SPACE_ID / VOLE_DASHBOARD_TOKEN into the engine's environment.
 */
async function mcpConfigPath(): Promise<string | undefined> {
	if (cachedMcpConfigPath !== undefined) return cachedMcpConfigPath ?? undefined
	const expose = process.env.CLAUDE_CODE_EXPOSE_TOOLS
	const url = process.env.VOLE_DASHBOARD_URL
	const space = process.env.VOLE_SPACE_ID
	if (!(expose === '1' || expose === 'true') || !url || !space) {
		cachedMcpConfigPath = null
		return undefined
	}
	const cfg = {
		mcpServers: {
			openvole: {
				type: 'http',
				url: `${url}/mcp/${encodeURIComponent(space)}`,
				headers: process.env.VOLE_DASHBOARD_TOKEN
					? { 'x-vole-token': process.env.VOLE_DASHBOARD_TOKEN }
					: {},
			},
		},
	}
	const file = join(tmpdir(), `openvole-mcp-${space}.json`)
	await writeFile(file, JSON.stringify(cfg))
	cachedMcpConfigPath = file
	return file
}

/**
 * ClaudeCodeProvider — uses the local, authenticated Claude Code CLI as the brain.
 *
 * Like the mock provider, it returns a plain text response and **no** OpenVole tool calls:
 * Claude Code runs its own agent loop (with its own tools) and we return its final answer.
 * No API key — it uses the local CLI's own auth, configurable via `CLAUDE_CODE_CONFIG_DIR`
 * (e.g. `~/.claude-ep`). Shares the `CLAUDE_CODE_*` env conventions with paw-claude-code.
 */
export class ClaudeCodeProvider implements BrainProvider {
	readonly name = 'claude-code'
	readonly model: string

	constructor(model: string) {
		this.model = model
	}

	async think(
		systemPrompt: string,
		messages: AgentMessage[],
		_tools: ToolSummary[],
		sessionHistory?: string,
	): Promise<ThinkResult> {
		const cmd = process.env.CLAUDE_CODE_CMD || 'claude'
		const timeout = Number(process.env.CLAUDE_CODE_TIMEOUT_MS) || 600_000
		const cwd = process.env.CLAUDE_CODE_CWD || undefined

		const args = ['-p', '--output-format', 'json']
		const model =
			process.env.CLAUDE_CODE_MODEL || (this.model && this.model !== 'claude-code' ? this.model : undefined)
		if (model) args.push('--model', model)
		if (process.env.CLAUDE_CODE_PERMISSION_MODE)
			args.push('--permission-mode', process.env.CLAUDE_CODE_PERMISSION_MODE)
		if (process.env.CLAUDE_CODE_ARGS) args.push(...process.env.CLAUDE_CODE_ARGS.split(' ').filter(Boolean))

		// Expose OpenVole's own tools to Claude Code via the control plane's MCP endpoint.
		const mcp = await mcpConfigPath()
		if (mcp) args.push('--mcp-config', mcp, '--strict-mcp-config')

		// `claude-ep` is just `CLAUDE_CONFIG_DIR=~/.claude-ep claude` — replicate via the child env.
		const env: Record<string, string> = {}
		if (process.env.CLAUDE_CODE_CONFIG_DIR)
			env.CLAUDE_CONFIG_DIR = expandHome(process.env.CLAUDE_CODE_CONFIG_DIR)

		const prompt = renderPrompt(systemPrompt, messages, sessionHistory)
		const res = await execa(cmd, args, { input: prompt, cwd, timeout, reject: false, env, extendEnv: true })

		const raw = res.stdout || ''
		let text = raw
		try {
			const j = JSON.parse(raw) as { result?: string; is_error?: boolean }
			if (typeof j.result === 'string') text = j.result
		} catch {
			/* not JSON — use raw stdout */
		}
		if (res.exitCode !== 0 && !text) {
			throw new Error(
				`claude-code: exit ${res.exitCode}${res.stderr ? ` — ${res.stderr.slice(0, 300)}` : ''}`,
			)
		}
		return { actions: [], response: text, done: true }
	}
}
