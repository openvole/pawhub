// Zero-dependency Hacker News client over the public Firebase API (https://github.com/HackerNews/API).
// No key, no auth — read-only JSON endpoints. Story-id lists + per-item lookups.

const HEADERS: Record<string, string> = {
	'User-Agent':
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
	Accept: 'application/json',
}

const BASE = 'https://hacker-news.firebaseio.com/v0'

const FEEDS: Record<string, string> = {
	top: 'topstories',
	new: 'newstories',
	best: 'beststories',
	ask: 'askstories',
	show: 'showstories',
	job: 'jobstories',
}

export type Feed = 'top' | 'new' | 'best' | 'ask' | 'show' | 'job'

export interface Story {
	id: number
	title: string
	by: string
	score: number
	comments: number
	url: string | null
	domain: string | null
	ageHours: number
	type: string
}

export interface Comment {
	id: number
	by: string
	text: string
	ageHours: number
}

export interface StoryDetail extends Story {
	text: string | null
	topComments: Comment[]
}

interface RawItem {
	id: number
	type?: string
	by?: string
	time?: number
	title?: string
	score?: number
	descendants?: number
	url?: string
	text?: string
	kids?: number[]
	deleted?: boolean
	dead?: boolean
}

async function fetchJson<T>(url: string, timeoutMs = 10_000): Promise<T | null> {
	const ctrl = new AbortController()
	const timer = setTimeout(() => ctrl.abort(), timeoutMs)
	try {
		const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal })
		if (!res.ok) return null
		return (await res.json()) as T
	} catch {
		return null
	} finally {
		clearTimeout(timer)
	}
}

function domainOf(url: string | undefined): string | null {
	if (!url) return null
	try {
		return new URL(url).hostname.replace(/^www\./, '')
	} catch {
		return null
	}
}

/** Whole-hours-ish age with one decimal, from a unix-seconds timestamp. */
function ageHours(unixSec: number | undefined): number {
	if (!unixSec) return 0
	return Math.max(0, Math.round((Date.now() / 1000 - unixSec) / 360) / 10)
}

/** HN comment/story text is HTML — flatten to readable plain text. */
function stripHtml(s: string | undefined): string {
	if (!s) return ''
	return s
		.replace(/<\/p>/gi, '\n\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#x27;|&#39;/g, "'")
		.replace(/&#x2F;/g, '/')
		.trim()
}

function toStory(it: RawItem): Story {
	return {
		id: it.id,
		title: it.title ?? '(untitled)',
		by: it.by ?? '',
		score: it.score ?? 0,
		comments: it.descendants ?? 0,
		url: it.url ?? null,
		domain: domainOf(it.url),
		ageHours: ageHours(it.time),
		type: it.type ?? 'story',
	}
}

/** Stories for a feed (newest data; up to 50). */
export async function getStories(feed: Feed, limit: number): Promise<Story[]> {
	const list = FEEDS[feed] ?? FEEDS.top
	const ids = await fetchJson<number[]>(`${BASE}/${list}.json`)
	if (!ids) return []
	const take = ids.slice(0, Math.min(Math.max(limit, 1), 50))
	const items = await Promise.all(take.map((id) => fetchJson<RawItem>(`${BASE}/item/${id}.json`)))
	return items
		.filter((it): it is RawItem => Boolean(it && !it.deleted && !it.dead))
		.map(toStory)
}

/** A single item plus its top-level comments (bounded), for reading or summarizing. */
export async function getStory(id: number, maxComments = 40): Promise<StoryDetail | null> {
	const it = await fetchJson<RawItem>(`${BASE}/item/${id}.json`)
	if (!it) return null
	const story = toStory(it)
	const kidIds = (it.kids ?? []).slice(0, maxComments)
	const kids = await Promise.all(kidIds.map((cid) => fetchJson<RawItem>(`${BASE}/item/${cid}.json`)))
	const topComments: Comment[] = kids
		.filter((c): c is RawItem => Boolean(c && !c.deleted && !c.dead && c.text))
		.map((c) => ({ id: c.id, by: c.by ?? '', text: stripHtml(c.text), ageHours: ageHours(c.time) }))
	return { ...story, text: it.text ? stripHtml(it.text) : null, topComments }
}
