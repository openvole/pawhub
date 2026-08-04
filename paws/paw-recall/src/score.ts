import { HALF_LIFE_DAYS, type MemoryRecord, type ScoredRecord } from './types.js'

/**
 * One scoring function over any backend:
 *
 *   score = w_sem·cosine + w_lex·bm25 + w_rec·exp(-age/half_life) + w_imp·importance + access boost
 *
 * Weights renormalize over the signals actually available — with no embedding provider the
 * lexical weight absorbs the semantic share instead of silently scoring everything lower.
 */

const W_SEMANTIC = 0.45
const W_LEXICAL = 0.3
const W_RECENCY = 0.15
const W_IMPORTANCE = 0.1
/** log-scaled bonus for records that keep getting recalled — capped so it can't dominate. */
const ACCESS_BOOST_MAX = 0.05

export function cosine(a: Float32Array, b: Float32Array): number {
	if (a.length !== b.length) return 0
	let dot = 0
	let na = 0
	let nb = 0
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i]
		na += a[i] * a[i]
		nb += b[i] * b[i]
	}
	if (na === 0 || nb === 0) return 0
	return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export function recencyScore(record: MemoryRecord, now: number): number {
	if (record.pinned) return 1
	const halfLifeMs = HALF_LIFE_DAYS[record.kind] * 24 * 60 * 60_000
	const age = Math.max(0, now - record.createdAt)
	return Math.exp((-Math.LN2 * age) / halfLifeMs)
}

export function scoreRecord(
	record: MemoryRecord,
	opts: {
		semantic?: number
		lexical?: number
		hasSemantic: boolean
		hasLexical: boolean
		now: number
	},
): ScoredRecord {
	const recency = recencyScore(record, opts.now)
	// Renormalize weights over available signals.
	let wSem = opts.hasSemantic ? W_SEMANTIC : 0
	let wLex = opts.hasLexical ? W_LEXICAL : 0
	const missing = W_SEMANTIC + W_LEXICAL - wSem - wLex
	if (missing > 0 && wSem + wLex > 0) {
		// Give the missing share to whichever text signal remains.
		if (wLex > 0) wLex += missing
		else wSem += missing
	}
	const accessBoost = Math.min(
		ACCESS_BOOST_MAX,
		(Math.log1p(record.accessCount) / 10) * ACCESS_BOOST_MAX * 10,
	)
	const score =
		wSem * (opts.semantic ?? 0) +
		wLex * (opts.lexical ?? 0) +
		W_RECENCY * recency +
		W_IMPORTANCE * record.importance +
		accessBoost
	return {
		record,
		score,
		signals: {
			semantic: opts.hasSemantic ? opts.semantic : undefined,
			lexical: opts.hasLexical ? opts.lexical : undefined,
			recency,
			importance: record.importance,
		},
	}
}

/** Token-set Jaccard similarity — the diversity metric when no embeddings exist. */
function jaccard(a: string, b: string): number {
	const ta = new Set(a.toLowerCase().split(/\W+/).filter(Boolean))
	const tb = new Set(b.toLowerCase().split(/\W+/).filter(Boolean))
	if (ta.size === 0 || tb.size === 0) return 0
	let inter = 0
	for (const t of ta) if (tb.has(t)) inter++
	return inter / (ta.size + tb.size - inter)
}

/**
 * Maximal Marginal Relevance: pick high-scoring results that are not near-duplicates of what is
 * already picked. Memory accumulates restatements of the same fact; returning five copies of it
 * crowds out the second-most-relevant thing the agent actually needed.
 */
export function mmr(
	candidates: ScoredRecord[],
	k: number,
	embeddings: Map<string, Float32Array>,
	lambda = 0.7,
): ScoredRecord[] {
	const picked: ScoredRecord[] = []
	const pool = [...candidates].sort((a, b) => b.score - a.score)
	while (picked.length < k && pool.length > 0) {
		let bestIdx = 0
		let bestVal = Number.NEGATIVE_INFINITY
		for (let i = 0; i < pool.length; i++) {
			const cand = pool[i]
			let maxSim = 0
			for (const p of picked) {
				const ea = embeddings.get(cand.record.id)
				const eb = embeddings.get(p.record.id)
				const sim = ea && eb ? cosine(ea, eb) : jaccard(cand.record.text, p.record.text)
				if (sim > maxSim) maxSim = sim
			}
			const val = lambda * cand.score - (1 - lambda) * maxSim
			if (val > bestVal) {
				bestVal = val
				bestIdx = i
			}
		}
		picked.push(pool.splice(bestIdx, 1)[0])
	}
	return picked
}
