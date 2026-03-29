/**
 * Lightweight LLM client for compaction summarization.
 * Uses direct fetch — no SDK dependencies.
 * Supports Ollama, OpenAI-compatible, and Gemini APIs.
 */

export interface CompactionLLM {
	readonly provider: string
	readonly model: string
	summarize(prompt: string): Promise<string>
}

/** Ollama LLM */
class OllamaLLM implements CompactionLLM {
	readonly provider = 'ollama'
	readonly model: string
	private host: string

	constructor(host: string, model: string) {
		this.host = host
		this.model = model
	}

	async summarize(prompt: string): Promise<string> {
		const response = await fetch(`${this.host}/api/generate`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: this.model,
				prompt,
				stream: false,
				options: { temperature: 0.3, num_predict: 2000 },
			}),
		})
		if (!response.ok) throw new Error(`Ollama generate failed: ${response.status}`)
		const data = await response.json() as { response: string }
		return data.response
	}
}

/** OpenAI-compatible LLM (also works for xAI, local vLLM, etc.) */
class OpenAILLM implements CompactionLLM {
	readonly provider: string
	readonly model: string
	private apiKey: string
	private baseURL: string

	constructor(apiKey: string, model: string, baseURL?: string, provider?: string) {
		this.apiKey = apiKey
		this.model = model
		this.baseURL = baseURL ?? 'https://api.openai.com/v1'
		this.provider = provider ?? 'openai'
	}

	async summarize(prompt: string): Promise<string> {
		const response = await fetch(`${this.baseURL}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				model: this.model,
				messages: [{ role: 'user', content: prompt }],
				temperature: 0.3,
				max_tokens: 2000,
			}),
		})
		if (!response.ok) throw new Error(`OpenAI generate failed: ${response.status}`)
		const data = await response.json() as { choices: Array<{ message: { content: string } }> }
		return data.choices[0]?.message?.content ?? ''
	}
}

/** Gemini LLM */
class GeminiLLM implements CompactionLLM {
	readonly provider = 'gemini'
	readonly model: string
	private apiKey: string

	constructor(apiKey: string, model: string) {
		this.apiKey = apiKey
		this.model = model
	}

	async summarize(prompt: string): Promise<string> {
		const response = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					contents: [{ parts: [{ text: prompt }] }],
					generationConfig: { temperature: 0.3, maxOutputTokens: 2000 },
				}),
			},
		)
		if (!response.ok) throw new Error(`Gemini generate failed: ${response.status}`)
		const data = await response.json() as {
			candidates: Array<{ content: { parts: Array<{ text: string }> } }>
		}
		return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
	}
}

/**
 * Create compaction LLM from VOLE_COMPACT_MODEL env var.
 *
 * Format: "provider/model" — e.g.:
 *   "ollama/llama3.1:8b"
 *   "openai/gpt-4o-mini"
 *   "gemini/gemini-2.0-flash"
 *
 * Falls back to auto-detect from available API keys.
 * Returns null if no LLM available (heuristic compaction continues).
 */
export async function createCompactionLLM(): Promise<CompactionLLM | null> {
	const modelSpec = process.env.VOLE_COMPACT_MODEL

	if (modelSpec) {
		const slashIdx = modelSpec.indexOf('/')
		if (slashIdx === -1) {
			console.log(`[paw-compact] Invalid VOLE_COMPACT_MODEL format: "${modelSpec}". Expected "provider/model".`)
			return null
		}
		const provider = modelSpec.substring(0, slashIdx).toLowerCase()
		const model = modelSpec.substring(slashIdx + 1)
		return createLLMByProvider(provider, model)
	}

	// Auto-detect: prefer cheap/local options
	const ollamaHost = process.env.OLLAMA_HOST ?? 'http://localhost:11434'
	try {
		const resp = await fetch(`${ollamaHost}/api/tags`, { signal: AbortSignal.timeout(2000) })
		if (resp.ok) {
			return new OllamaLLM(ollamaHost, 'llama3.1:8b')
		}
	} catch {}

	if (process.env.OPENAI_API_KEY) {
		return new OpenAILLM(process.env.OPENAI_API_KEY, 'gpt-4o-mini')
	}

	if (process.env.GEMINI_API_KEY) {
		return new GeminiLLM(process.env.GEMINI_API_KEY, 'gemini-2.0-flash')
	}

	return null
}

function createLLMByProvider(provider: string, model: string): CompactionLLM | null {
	switch (provider) {
		case 'ollama': {
			const host = process.env.OLLAMA_HOST ?? 'http://localhost:11434'
			return new OllamaLLM(host, model)
		}
		case 'openai': {
			const apiKey = process.env.OPENAI_API_KEY
			if (!apiKey) { console.log('[paw-compact] OPENAI_API_KEY required for openai compaction model'); return null }
			return new OpenAILLM(apiKey, model)
		}
		case 'gemini': {
			const apiKey = process.env.GEMINI_API_KEY
			if (!apiKey) { console.log('[paw-compact] GEMINI_API_KEY required for gemini compaction model'); return null }
			return new GeminiLLM(apiKey, model)
		}
		case 'anthropic': {
			const apiKey = process.env.ANTHROPIC_API_KEY
			if (!apiKey) { console.log('[paw-compact] ANTHROPIC_API_KEY required for anthropic compaction model'); return null }
			// Anthropic uses messages API but we can wrap it as OpenAI-compatible
			return new OpenAILLM(apiKey, model, 'https://api.anthropic.com/v1', 'anthropic')
		}
		case 'xai': {
			const apiKey = process.env.XAI_API_KEY
			if (!apiKey) { console.log('[paw-compact] XAI_API_KEY required for xai compaction model'); return null }
			return new OpenAILLM(apiKey, model, 'https://api.x.ai/v1', 'xai')
		}
		default:
			console.log(`[paw-compact] Unknown compaction provider: "${provider}"`)
			return null
	}
}
