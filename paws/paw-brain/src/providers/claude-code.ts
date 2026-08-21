import { writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { execa } from 'execa'
import type { AgentMessage, ToolSummary } from '@openvole/paw-sdk'
import type { BrainProvider, ThinkResult } from '../types.js'
import { HOST_NOTE, renderPrompt } from './cli-prompt.js'

/** Expand a leading ~ to the user's home directory. */
const expandHome = (p: string): string => (p === '~' || p.startsWith('~/') ? p.replace(/^~/, homedir()) : p)

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
		// 30 minutes: this is a runaway guard, not a work cap. Agentic coding runs routinely
		// pass 10 minutes, and core puts no timeout on `think` at all.
		const timeout = Number(process.env.CLAUDE_CODE_TIMEOUT_MS) || 1_800_000
		// The paw inherits the engine's cwd, which the control plane sets to the agent directory.
		// Naming it rather than letting it be inherited: the CLI resolves every relative path and
		// every `~` against this, so an accidental cwd puts an agent's work in somebody else's tree.
		const cwd = process.env.CLAUDE_CODE_CWD || process.cwd()

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

		// The agent's own directory, so the CLI's file tools reach the workspace it is told to work
		// in. Without it the CLI is scoped to wherever it was launched and quietly prefers $HOME —
		// which is how one run's output landed in ~/.openvole instead of the agent's workspace.
		args.push('--add-dir', cwd)

		// `claude-ep` is just `CLAUDE_CONFIG_DIR=~/.claude-ep claude` — replicate via the child env.
		const env: Record<string, string> = {}
		if (process.env.CLAUDE_CODE_CONFIG_DIR)
			env.CLAUDE_CONFIG_DIR = expandHome(process.env.CLAUDE_CODE_CONFIG_DIR)

		// Without this, models see bare tool names (agent_list) in the OpenVole prompt but the
		// callable functions are prefixed (mcp__openvole__agent_list) — and may conclude the
		// tools are unavailable instead of bridging the naming gap.
		const notes = [HOST_NOTE]
		if (mcp) {
			notes.push(
				'# Tool naming\nEvery OpenVole tool named in these instructions is available to you as an MCP function prefixed `mcp__openvole__` — e.g. `agent_list` is callable as `mcp__openvole__agent_list`. Never claim an OpenVole tool is unavailable without checking for its prefixed form.\n\n# Memory\nThis agent\'s durable memory is OpenVole\'s memory system, NOT your own memory directory. When asked to remember, save, or recall something, use `mcp__openvole__memory_write` / `memory_read` / `memory_search` — other tools, dashboards, and synced peers only see memories stored there.',
			)
		}

		// The system prompt goes in as a *system* prompt.
		//
		// It used to ride in on stdin as the opening of the user message, which left the CLI's own
		// system prompt as the only authoritative voice in the run: OpenVole's identity, workspace
		// path and skills all arrived as advisory text a model is free to reason past. It did —
		// agents introduced themselves as the CLI, went looking for OpenVole skills in the CLI's
		// own skills directory, and wrote their output outside the workspace they had been given.
		args.push('--append-system-prompt', [systemPrompt, ...notes].join('\n\n---\n\n'))

		const prompt = renderPrompt('', messages, sessionHistory)
		const res = await execa(cmd, args, { input: prompt, cwd, timeout, reject: false, env, extendEnv: true })

		// A killed run must be reported as a timeout, not as whatever half-written output
		// happened to be on stdout when the signal landed. `think` has no IPC timeout above
		// us (core treats inference as unbounded), so this is the only clock in the path.
		if ((res as { timedOut?: boolean }).timedOut) {
			throw new Error(
				`claude-code timed out after ${Math.round(timeout / 1000)}s and was killed. ` +
					'Long agentic runs are normal — raise CLAUDE_CODE_TIMEOUT_MS for this agent ' +
					'(e.g. 3600000 for an hour).',
			)
		}

		const raw = res.stdout || ''
		let text = raw
		let envelope: Record<string, unknown> | null = null
		try {
			envelope = JSON.parse(raw) as Record<string, unknown>
		} catch {
			/* not JSON — use raw stdout */
		}
		if (envelope) {
			const result = envelope.result
			if (typeof result === 'string' && result.trim()) {
				text = result
			} else {
				// The CLI answered with an envelope carrying no result — it errored or was cut
				// off (e.g. is_error + stop_reason "tool_use" after hitting a turn/time limit).
				// Fail loudly: returning `raw` here dumped the whole JSON blob into the chat as
				// if the agent had written it, which is worse than a visible failure.
				const detail = [
					typeof envelope.subtype === 'string' ? envelope.subtype : null,
					typeof envelope.stop_reason === 'string' ? `stop_reason: ${envelope.stop_reason}` : null,
					typeof envelope.num_turns === 'number' ? `${envelope.num_turns} turns` : null,
					typeof envelope.duration_api_ms === 'number'
						? `${Math.round(envelope.duration_api_ms / 1000)}s`
						: null,
				]
					.filter(Boolean)
					.join(', ')
				throw new Error(
					`claude-code returned no result${detail ? ` (${detail})` : ''} — the CLI stopped before answering. ` +
						'Usually a turn or time limit on a long tool-using run: retry, narrow the task, or raise CLAUDE_CODE_TIMEOUT_MS.',
				)
			}
		}
		if (res.exitCode !== 0 && !text) {
			throw new Error(
				`claude-code: exit ${res.exitCode}${res.stderr ? ` — ${res.stderr.slice(0, 300)}` : ''}`,
			)
		}
		return { actions: [], response: text, done: true }
	}
}
