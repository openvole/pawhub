/**
 * Embedding provider abstraction.
 * Auto-detects available provider from environment (same pattern as paw-brain).
 * Supports Ollama (local, free), OpenAI, and Gemini.
 */

export interface EmbeddingProvider {
	readonly name: string
	readonly model: string
	readonly dimensions: number
	embed(text: string): Promise<number[]>
	embedBatch(texts: string[]): Promise<number[][]>
}

/** Ollama embeddings — local, free, default */
class OllamaEmbeddings implements EmbeddingProvider {
	readonly name = 'ollama'
	readonly model: string
	readonly dimensions: number
	private host: string

	constructor(host: string, model: string, dimensions: number) {
		this.host = host
		this.model = model
		this.dimensions = dimensions
	}

	async embed(text: string): Promise<number[]> {
		const response = await fetch(`${this.host}/api/embeddings`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: this.model, prompt: text }),
		})
		if (!response.ok) {
			throw new Error(`Ollama embedding failed: ${response.status} ${await response.text()}`)
		}
		const data = await response.json() as { embedding: number[] }
		return data.embedding
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		// Ollama doesn't support batch — sequential
		const results: number[][] = []
		for (const text of texts) {
			results.push(await this.embed(text))
		}
		return results
	}
}

/** OpenAI embeddings */
class OpenAIEmbeddings implements EmbeddingProvider {
	readonly name = 'openai'
	readonly model: string
	readonly dimensions: number
	private apiKey: string
	private baseURL: string

	constructor(apiKey: string, model: string, dimensions: number, baseURL?: string) {
		this.apiKey = apiKey
		this.model = model
		this.dimensions = dimensions
		this.baseURL = baseURL ?? 'https://api.openai.com/v1'
	}

	async embed(text: string): Promise<number[]> {
		const results = await this.embedBatch([text])
		return results[0]
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		const response = await fetch(`${this.baseURL}/embeddings`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				model: this.model,
				input: texts,
			}),
		})
		if (!response.ok) {
			throw new Error(`OpenAI embedding failed: ${response.status} ${await response.text()}`)
		}
		const data = await response.json() as {
			data: Array<{ embedding: number[] }>
		}
		return data.data.map((d) => d.embedding)
	}
}

/** Gemini embeddings */
class GeminiEmbeddings implements EmbeddingProvider {
	readonly name = 'gemini'
	readonly model: string
	readonly dimensions: number
	private apiKey: string

	constructor(apiKey: string, model: string, dimensions: number) {
		this.apiKey = apiKey
		this.model = model
		this.dimensions = dimensions
	}

	async embed(text: string): Promise<number[]> {
		const response = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${this.apiKey}`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					model: `models/${this.model}`,
					content: { parts: [{ text }] },
				}),
			},
		)
		if (!response.ok) {
			throw new Error(`Gemini embedding failed: ${response.status} ${await response.text()}`)
		}
		const data = await response.json() as {
			embedding: { values: number[] }
		}
		return data.embedding.values
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		const response = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:batchEmbedContents?key=${this.apiKey}`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					requests: texts.map((text) => ({
						model: `models/${this.model}`,
						content: { parts: [{ text }] },
					})),
				}),
			},
		)
		if (!response.ok) {
			throw new Error(`Gemini batch embedding failed: ${response.status} ${await response.text()}`)
		}
		const data = await response.json() as {
			embeddings: Array<{ values: number[] }>
		}
		return data.embeddings.map((e) => e.values)
	}
}

/**
 * Auto-detect and create embedding provider from environment.
 * Priority: Ollama (if host reachable) → OpenAI → Gemini → null
 */
export async function createEmbeddingProvider(): Promise<EmbeddingProvider | null> {
	// Check explicit config
	const provider = process.env.VOLE_EMBEDDING_PROVIDER?.toLowerCase()

	if (provider === 'ollama' || (!provider && process.env.OLLAMA_HOST)) {
		const host = process.env.OLLAMA_HOST ?? 'http://localhost:11434'
		const model = process.env.VOLE_EMBEDDING_MODEL ?? 'nomic-embed-text'
		const dims = parseInt(process.env.VOLE_EMBEDDING_DIMS ?? '768', 10)
		// Check if Ollama is reachable
		try {
			const resp = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(2000) })
			if (resp.ok) {
				return new OllamaEmbeddings(host, model, dims)
			}
		} catch {
			// Ollama not reachable — fall through
		}
	}

	if (provider === 'openai' || (!provider && process.env.OPENAI_API_KEY)) {
		const apiKey = process.env.OPENAI_API_KEY!
		const model = process.env.VOLE_EMBEDDING_MODEL ?? 'text-embedding-3-small'
		const dims = parseInt(process.env.VOLE_EMBEDDING_DIMS ?? '1536', 10)
		const baseURL = process.env.VOLE_EMBEDDING_BASE_URL
		return new OpenAIEmbeddings(apiKey, model, dims, baseURL)
	}

	if (provider === 'gemini' || (!provider && process.env.GEMINI_API_KEY)) {
		const apiKey = process.env.GEMINI_API_KEY!
		const model = process.env.VOLE_EMBEDDING_MODEL ?? 'text-embedding-004'
		const dims = parseInt(process.env.VOLE_EMBEDDING_DIMS ?? '768', 10)
		return new GeminiEmbeddings(apiKey, model, dims)
	}

	// No embedding provider available
	return null
}
