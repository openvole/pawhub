import type { PawDefinition, AgentContext, AgentPlan } from '@openvole/paw-sdk'
import type { BrainProvider } from './types.js'

let provider: BrainProvider | undefined
let fallbackProvider: BrainProvider | undefined

/**
 * Resolve provider from environment variables.
 *
 * Priority:
 *   1. BRAIN_PROVIDER explicitly set (anthropic, openai, gemini, ollama, xai)
 *   2. Auto-detect from available API keys
 *
 * Generic env vars (BRAIN_API_KEY, BRAIN_MODEL, BRAIN_BASE_URL) are used
 * as defaults, with provider-specific vars taking precedence.
 */
async function resolveProvider(): Promise<BrainProvider> {
	const brainProvider = process.env.BRAIN_PROVIDER?.toLowerCase()
	const brainApiKey = process.env.BRAIN_API_KEY
	const brainModel = process.env.BRAIN_MODEL
	const brainBaseURL = process.env.BRAIN_BASE_URL

	// Explicit provider selection
	if (brainProvider) {
		return createProvider(brainProvider, brainApiKey, brainModel, brainBaseURL)
	}

	// Auto-detect from available API keys
	if (process.env.ANTHROPIC_API_KEY) {
		return createProvider('anthropic', brainApiKey, brainModel, brainBaseURL)
	}
	if (process.env.OPENAI_API_KEY) {
		return createProvider('openai', brainApiKey, brainModel, brainBaseURL)
	}
	if (process.env.GEMINI_API_KEY) {
		return createProvider('gemini', brainApiKey, brainModel, brainBaseURL)
	}
	if (process.env.XAI_API_KEY) {
		return createProvider('xai', brainApiKey, brainModel, brainBaseURL)
	}
	// Ollama doesn't need an API key — default fallback
	return createProvider('ollama', brainApiKey, brainModel, brainBaseURL)
}

/** Resolve fallback provider from BRAIN_FALLBACK env var */
async function resolveFallbackProvider(): Promise<BrainProvider | undefined> {
	const fallbackName = process.env.BRAIN_FALLBACK?.toLowerCase()
	if (!fallbackName) return undefined

	const brainApiKey = process.env.BRAIN_API_KEY
	const brainModel = process.env.BRAIN_FALLBACK_MODEL
	const brainBaseURL = process.env.BRAIN_FALLBACK_BASE_URL

	try {
		return await createProvider(fallbackName, brainApiKey, brainModel, brainBaseURL)
	} catch (err) {
		console.log(`[paw-brain] Failed to create fallback provider "${fallbackName}": ${err instanceof Error ? err.message : String(err)}`)
		return undefined
	}
}

async function createProvider(
	name: string,
	brainApiKey?: string,
	brainModel?: string,
	brainBaseURL?: string,
): Promise<BrainProvider> {
	switch (name) {
		case 'anthropic':
		case 'claude': {
			const { AnthropicProvider } = await import('./providers/anthropic.js')
			const apiKey = process.env.ANTHROPIC_API_KEY ?? brainApiKey
			if (!apiKey) throw new Error('ANTHROPIC_API_KEY or BRAIN_API_KEY is required for anthropic provider')
			const model = process.env.ANTHROPIC_MODEL ?? brainModel ?? 'claude-sonnet-4-20250514'
			return new AnthropicProvider(apiKey, model, brainBaseURL)
		}
		case 'openai': {
			const { OpenAIProvider } = await import('./providers/openai.js')
			const apiKey = process.env.OPENAI_API_KEY ?? brainApiKey
			if (!apiKey) throw new Error('OPENAI_API_KEY or BRAIN_API_KEY is required for openai provider')
			const model = process.env.OPENAI_MODEL ?? brainModel ?? 'gpt-4o'
			return new OpenAIProvider(apiKey, model, brainBaseURL)
		}
		case 'gemini':
		case 'google': {
			const { GeminiProvider } = await import('./providers/gemini.js')
			const apiKey = process.env.GEMINI_API_KEY ?? brainApiKey
			if (!apiKey) throw new Error('GEMINI_API_KEY or BRAIN_API_KEY is required for gemini provider')
			const model = process.env.GEMINI_MODEL ?? brainModel ?? 'gemini-2.5-flash'
			return new GeminiProvider(apiKey, model)
		}
		case 'xai':
		case 'grok': {
			const { OpenAIProvider } = await import('./providers/openai.js')
			const apiKey = process.env.XAI_API_KEY ?? brainApiKey
			if (!apiKey) throw new Error('XAI_API_KEY or BRAIN_API_KEY is required for xai provider')
			const model = process.env.XAI_MODEL ?? brainModel ?? 'grok-3'
			const baseURL = brainBaseURL ?? 'https://api.x.ai/v1'
			return new OpenAIProvider(apiKey, model, baseURL, 'xai')
		}
		case 'ollama': {
			const { OllamaProvider } = await import('./providers/ollama.js')
			const host = brainBaseURL ?? process.env.OLLAMA_HOST ?? 'http://localhost:11434'
			const model = process.env.OLLAMA_MODEL ?? brainModel ?? 'qwen3:latest'
			return new OllamaProvider(host, model)
		}
		default:
			throw new Error(`Unknown brain provider: "${name}". Supported: anthropic, openai, gemini, xai, ollama`)
	}
}

export const paw: PawDefinition = {
	name: '@openvole/paw-brain',
	version: '1.0.0',
	description: 'Unified Brain Paw — multi-provider LLM adapter',
	brain: true,

	async think(context: AgentContext): Promise<AgentPlan> {
		if (!provider) {
			provider = await resolveProvider()
		}
		const start = Date.now()
		const tag = `[paw-brain:${provider.name}]`

		try {
			const systemPrompt = (context as Record<string, unknown>).systemPrompt as string | undefined
				?? 'You are an AI agent powered by OpenVole.'

			const sessionHistory = context.metadata?.sessionHistory as string | undefined

			console.log(
				`${tag} think — model: ${provider.model}, messages: ${context.messages.length}, tools: ${context.availableTools.length}`,
			)

			const result = await provider.think(
				systemPrompt,
				context.messages,
				context.availableTools,
				sessionHistory,
			)

			const durationMs = Date.now() - start
			console.log(
				`${tag} tokens — INPUT: ${result.inputTokens ?? '?'}, OUTPUT: ${result.outputTokens ?? '?'} (${durationMs}ms)`,
			)

			const usage = {
				inputTokens: typeof result.inputTokens === 'number' ? result.inputTokens : undefined,
				outputTokens: typeof result.outputTokens === 'number' ? result.outputTokens : undefined,
				model: provider.model,
				provider: provider.name,
			}

			if (result.actions.length > 0) {
				return {
					actions: result.actions,
					execution: 'sequential',
					usage,
				}
			}

			if (!result.response) {
				return { actions: [], done: false, usage }
			}

			return {
				actions: [],
				response: result.response,
				done: result.done ?? true,
				usage,
			}
		} catch (error) {
			const durationMs = Date.now() - start
			const message = error instanceof Error ? error.message : String(error)
			console.log(`${tag} think failed after ${durationMs}ms: ${message}`)

			// Try fallback provider if available
			if (fallbackProvider) {
				console.log(`${tag} Attempting fallback provider: ${fallbackProvider.name}/${fallbackProvider.model}`)
				try {
					const fallbackResult = await fallbackProvider.think(
						systemPrompt,
						context.messages,
						context.availableTools,
						sessionHistory,
					)
					const fbDuration = Date.now() - start
					console.log(
						`[paw-brain:${fallbackProvider.name}] fallback tokens — INPUT: ${fallbackResult.inputTokens ?? '?'}, OUTPUT: ${fallbackResult.outputTokens ?? '?'} (${fbDuration}ms)`,
					)

					const fbUsage = {
						inputTokens: typeof fallbackResult.inputTokens === 'number' ? fallbackResult.inputTokens : undefined,
						outputTokens: typeof fallbackResult.outputTokens === 'number' ? fallbackResult.outputTokens : undefined,
						model: fallbackProvider.model,
						provider: fallbackProvider.name,
					}

					if (fallbackResult.actions.length > 0) {
						return { actions: fallbackResult.actions, execution: 'sequential' as const, usage: fbUsage }
					}
					if (!fallbackResult.response) {
						return { actions: [], done: false, usage: fbUsage }
					}
					return {
						actions: [],
						response: fallbackResult.response,
						done: fallbackResult.done ?? true,
						usage: fbUsage,
					}
				} catch (fbError) {
					const fbMsg = fbError instanceof Error ? fbError.message : String(fbError)
					console.log(`[paw-brain:${fallbackProvider.name}] fallback also failed: ${fbMsg}`)
				}
			}

			return {
				actions: [],
				response: message,
				done: true,
			}
		}
	},

	async onLoad() {
		provider = await resolveProvider()
		fallbackProvider = await resolveFallbackProvider()
		const fbInfo = fallbackProvider ? `, fallback: ${fallbackProvider.name}/${fallbackProvider.model}` : ''
		console.log(
			`[paw-brain] loaded — provider: ${provider.name}, model: ${provider.model}${fbInfo}`,
		)
	},

	async onUnload() {
		provider = undefined
		console.log('[paw-brain] unloaded')
	},
}
