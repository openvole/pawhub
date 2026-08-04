/**
 * BM25 (Best Matching 25) ranking algorithm
 * Ranks documents by relevance to a query using term frequency and inverse document frequency
 */

export interface BM25Document {
	id: string
	content: string
	tokens?: string[]
}

export interface BM25Result {
	id: string
	score: number
	content: string
}

export class BM25Index {
	private docs: BM25Document[] = []
	private avgDl = 0 // average document length
	private df: Map<string, number> = new Map() // document frequency per term
	private k1 = 1.5 // term frequency saturation
	private b = 0.75 // length normalization

	/** Tokenize text: lowercase, split on non-alphanumeric, filter short tokens */
	private tokenize(text: string): string[] {
		return text
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter((t) => t.length > 1)
	}

	/** Add documents to the index */
	index(docs: BM25Document[]): void {
		this.docs = docs.map((d) => ({
			...d,
			tokens: this.tokenize(d.content),
		}))

		// Calculate average document length
		const totalLen = this.docs.reduce(
			(sum, d) => sum + (d.tokens?.length ?? 0),
			0,
		)
		this.avgDl = this.docs.length > 0 ? totalLen / this.docs.length : 0

		// Calculate document frequency for each term
		this.df.clear()
		for (const doc of this.docs) {
			const seen = new Set<string>()
			for (const token of doc.tokens ?? []) {
				if (!seen.has(token)) {
					seen.add(token)
					this.df.set(token, (this.df.get(token) ?? 0) + 1)
				}
			}
		}
	}

	/** Search and rank documents by relevance */
	search(query: string, limit = 10): BM25Result[] {
		const queryTokens = this.tokenize(query)
		if (queryTokens.length === 0 || this.docs.length === 0) return []

		const N = this.docs.length
		const scores: BM25Result[] = []

		for (const doc of this.docs) {
			const docTokens = doc.tokens ?? []
			const dl = docTokens.length
			let score = 0

			// Count term frequencies in this document
			const tf = new Map<string, number>()
			for (const token of docTokens) {
				tf.set(token, (tf.get(token) ?? 0) + 1)
			}

			for (const term of queryTokens) {
				const termFreq = tf.get(term) ?? 0
				if (termFreq === 0) continue

				const docFreq = this.df.get(term) ?? 0
				// IDF with smoothing
				const idf = Math.log(
					1 + (N - docFreq + 0.5) / (docFreq + 0.5),
				)
				// BM25 term score
				const tfNorm =
					(termFreq * (this.k1 + 1)) /
					(termFreq +
						this.k1 * (1 - this.b + (this.b * dl) / this.avgDl))
				score += idf * tfNorm
			}

			if (score > 0) {
				scores.push({ id: doc.id, score, content: doc.content })
			}
		}

		// Sort by score descending, take top N
		return scores.sort((a, b) => b.score - a.score).slice(0, limit)
	}
}
