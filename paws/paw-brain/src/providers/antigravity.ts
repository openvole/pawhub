import { homedir } from 'node:os'
import { execa } from 'execa'
import type { AgentMessage, ToolSummary } from '@openvole/paw-sdk'
import type { BrainProvider, ThinkResult } from '../types.js'
import { renderPrompt } from './cli-prompt.js'

/** Expand a leading ~ to the user's home directory. */
const expandHome = (p: string): string => (p === '~' || p.startsWith('~/') ? p.replace(/^~/, homedir()) : p)

const isTrue = (v?: string): boolean => v === '1' || v === 'true'

/**
 * `agy` takes the prompt as an argv VALUE (`--print <prompt>`), not on stdin the way `claude -p`
 * does. argv is bounded by ARG_MAX (1 MB on macOS, and the environment is charged to the same
 * budget), so oversized prompts are refused with an actionable error rather than letting the OS
 * fail the spawn with a bare E2BIG.
 */
const DEFAULT_MAX_PROMPT_BYTES = 512_000

/**
 * AntigravityProvider — uses the local, authenticated Antigravity CLI (`agy`) as the brain.
 *
 * Like the claude-code provider, it returns a plain text response and **no** OpenVole tool calls:
 * `agy` runs its own agent loop with its own tools and we return its final answer. No API key — it
 * uses the CLI's own auth.
 *
 * Note: `agy` has no `--mcp-config` equivalent, so unlike claude-code there is currently no way to
 * expose OpenVole's own tools to it. It reaches models via its own account (`agy models` lists
 * them — gemini-3.x, claude-*, gpt-oss-*).
 */
export class AntigravityProvider implements BrainProvider {
	readonly name = 'antigravity'
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
		const cmd = process.env.ANTIGRAVITY_CMD || 'agy'
		// 30 minutes — same reasoning as claude-code: a runaway guard, not a work cap.
		const timeout = Number(process.env.ANTIGRAVITY_TIMEOUT_MS) || 1_800_000
		const cwd = process.env.ANTIGRAVITY_CWD || undefined

		const prompt = renderPrompt(systemPrompt, messages, sessionHistory)
		const maxBytes = Number(process.env.ANTIGRAVITY_MAX_PROMPT_BYTES) || DEFAULT_MAX_PROMPT_BYTES
		const bytes = Buffer.byteLength(prompt, 'utf8')
		if (bytes > maxBytes) {
			throw new Error(
				`antigravity: prompt is ${bytes} bytes, over the ${maxBytes} byte limit (agy takes the prompt as a command-line argument, capped by ARG_MAX). Lower loop.maxContextTokens or raise ANTIGRAVITY_MAX_PROMPT_BYTES.`,
			)
		}

		const args = ['--print', prompt]

		const model =
			process.env.ANTIGRAVITY_MODEL ||
			(this.model && this.model !== 'antigravity' ? this.model : undefined)
		if (model) args.push('--model', model)
		if (process.env.ANTIGRAVITY_AGENT) args.push('--agent', process.env.ANTIGRAVITY_AGENT)
		if (process.env.ANTIGRAVITY_EFFORT) args.push('--effort', process.env.ANTIGRAVITY_EFFORT)
		if (process.env.ANTIGRAVITY_MODE) args.push('--mode', process.env.ANTIGRAVITY_MODE)
		if (isTrue(process.env.ANTIGRAVITY_SKIP_PERMISSIONS)) args.push('--dangerously-skip-permissions')
		if (isTrue(process.env.ANTIGRAVITY_SANDBOX)) args.push('--sandbox')
		for (const dir of (process.env.ANTIGRAVITY_ADD_DIR || '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)) {
			args.push('--add-dir', expandHome(dir))
		}
		// agy's own print-mode wait defaults to 5m — keep it in step with our timeout so the CLI
		// does not give up before we do. Go duration syntax.
		args.push('--print-timeout', `${Math.max(1, Math.round(timeout / 1000))}s`)
		if (process.env.ANTIGRAVITY_ARGS) args.push(...process.env.ANTIGRAVITY_ARGS.split(' ').filter(Boolean))

		const res = await execa(cmd, args, { cwd, timeout, reject: false })

		if ((res as { timedOut?: boolean }).timedOut) {
			throw new Error(
				`antigravity timed out after ${Math.round(timeout / 1000)}s and was killed. ` +
					'Raise ANTIGRAVITY_TIMEOUT_MS for long runs.',
			)
		}

		// `agy --print` writes the answer as plain text (no JSON envelope).
		const text = (res.stdout || '').trim()
		if (res.exitCode !== 0 && !text) {
			throw new Error(
				`antigravity: exit ${res.exitCode}${res.stderr ? ` — ${res.stderr.slice(0, 300)}` : ''}`,
			)
		}
		return { actions: [], response: text, done: true }
	}
}
