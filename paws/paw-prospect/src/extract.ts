// Zero-dependency company-profile extraction. Fetches a public company website (homepage, and the
// About page if the homepage blurb is thin) and pulls a structured profile from <title>, meta/OG
// tags, JSON-LD Organization data, link hrefs, and lightweight tech fingerprints. On-demand,
// single-site — not a crawler. Sites are fetched with a browser-like User-Agent.

const HEADERS: Record<string, string> = {
	'User-Agent':
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
	Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
	'Accept-Language': 'en-US,en;q=0.9',
}

const MAX_BYTES = 1_500_000

export interface SocialLinks {
	linkedin?: string
	twitter?: string
	github?: string
	youtube?: string
	facebook?: string
	instagram?: string
}

export interface CompanyProfile {
	ok: boolean
	input: string
	url: string
	domain: string
	name: string | null
	tagline: string | null
	description: string | null
	logo: string | null
	industry: string | null
	location: string | null
	emails: string[]
	socials: SocialLinks
	techHints: string[]
	keyLinks: Array<{ label: string; url: string }>
	pages: string[]
	fetchedAt: string
	error?: string
}

/** Coerce user input (bare domain or full URL) into a normalized URL + hostname. */
export function normalizeInput(input: string): { url: string; domain: string } | null {
	const raw = input.trim()
	if (!raw) return null
	const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
	try {
		const u = new URL(withScheme)
		if (!u.hostname.includes('.')) return null
		return {
			url: u.origin + u.pathname.replace(/\/$/, ''),
			domain: u.hostname.replace(/^www\./, ''),
		}
	} catch {
		return null
	}
}

async function fetchHtml(
	url: string,
	timeoutMs = 12_000,
): Promise<{ finalUrl: string; html: string } | null> {
	const ctrl = new AbortController()
	const timer = setTimeout(() => ctrl.abort(), timeoutMs)
	try {
		const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: ctrl.signal })
		if (!res.ok) return null
		const ct = res.headers.get('content-type') ?? ''
		if (ct && !/html|xml/i.test(ct)) return null
		const text = await res.text()
		return { finalUrl: res.url || url, html: text.slice(0, MAX_BYTES) }
	} catch {
		return null
	} finally {
		clearTimeout(timer)
	}
}

function decodeEntities(s: string): string {
	return s
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#0?39;|&apos;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/&#(\d+);/g, (_, n: string) => {
			try {
				return String.fromCodePoint(Number(n))
			} catch {
				return ''
			}
		})
		.trim()
}

function clip(s: string, n: number): string {
	const t = s.replace(/\s+/g, ' ').trim()
	return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** Read a meta tag's content by property/name (attribute order independent). */
function metaContent(html: string, keys: string[]): string | null {
	for (const key of keys) {
		const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
		const re = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i')
		const tag = html.match(re)?.[0]
		const content = tag?.match(/content=["']([^"']*)["']/i)?.[1]
		if (content?.trim()) return decodeEntities(content)
	}
	return null
}

function titleTag(html: string): string | null {
	const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
	return m ? decodeEntities(m[1].replace(/\s+/g, ' ')) : null
}

/** First JSON-LD block describing an Organization-like entity. */
function jsonLdOrg(html: string): Record<string, unknown> {
	const blocks = html.matchAll(
		/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
	)
	for (const b of blocks) {
		try {
			const parsed = JSON.parse(b[1].trim()) as unknown
			const list = Array.isArray(parsed)
				? parsed
				: ((parsed as Record<string, unknown>)['@graph'] as unknown[]) ?? [parsed]
			for (const item of list) {
				const it = item as Record<string, unknown>
				const type = it?.['@type']
				const types = Array.isArray(type) ? type : [type]
				if (types.some((t) => /Organization|Corporation|LocalBusiness/i.test(String(t)))) return it
			}
		} catch {
			/* skip malformed JSON-LD */
		}
	}
	return {}
}

const SOCIAL_HOSTS: Array<[keyof SocialLinks, RegExp]> = [
	['linkedin', /linkedin\.com\/(?:company|in|school)\/[^"'\s)]+/i],
	['github', /github\.com\/[^"'\s/)]+/i],
	['youtube', /youtube\.com\/[^"'\s)]+/i],
	['facebook', /facebook\.com\/[^"'\s)]+/i],
	['instagram', /instagram\.com\/[^"'\s/)]+/i],
	['twitter', /(?:twitter|x)\.com\/[^"'\s/)]+/i],
]

function extractSocials(html: string): SocialLinks {
	const out: SocialLinks = {}
	const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1])
	for (const href of hrefs) {
		for (const [key, re] of SOCIAL_HOSTS) {
			if (out[key]) continue
			const hit = href.match(re)?.[0]
			if (hit) out[key] = hit.startsWith('http') ? hit : `https://${hit.replace(/^\/\//, '')}`
		}
	}
	return out
}

function extractEmails(html: string): string[] {
	const set = new Set<string>()
	for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) set.add(m[1].toLowerCase())
	return [...set].slice(0, 5)
}

const TECH: Array<[string, RegExp]> = [
	['WordPress', /wp-content|wp-includes/i],
	['Shopify', /cdn\.shopify\.com|myshopify|Shopify\.theme/i],
	['Webflow', /assets\.website-files\.com|wf-/i],
	['Wix', /wixstatic\.com|_wixCss/i],
	['Squarespace', /squarespace\.com|static1\.squarespace/i],
	['Next.js', /__NEXT_DATA__|\/_next\//i],
	['React', /data-reactroot|react-dom(?:\.production)?\.min\.js/i],
	['Vue', /vue(?:\.runtime)?(?:\.min)?\.js|data-v-[0-9a-f]{8}/i],
	['HubSpot', /js\.hs-scripts\.com|hubspot/i],
	['Google Analytics', /googletagmanager\.com|google-analytics\.com|gtag\(/i],
	['Segment', /cdn\.segment\.com/i],
	['Intercom', /widget\.intercom\.io/i],
	['Stripe', /js\.stripe\.com/i],
	['Cloudflare', /cdnjs\.cloudflare\.com|cdn-cgi\//i],
]

function detectTech(html: string): string[] {
	return TECH.filter(([, re]) => re.test(html)).map(([name]) => name)
}

const KEY_PAGES: Array<[string, RegExp]> = [
	['About', /about(?:-us)?\b/i],
	['Careers', /careers|\/jobs\b/i],
	['Pricing', /pricing|\/plans\b/i],
	['Contact', /contact/i],
	['Blog', /\/blog|\/news/i],
]

function extractKeyLinks(html: string, base: string): Array<{ label: string; url: string }> {
	const found = new Map<string, string>()
	for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>/gi)) {
		const href = m[1]
		if (href.startsWith('#') || /^(?:mailto|tel|javascript):/i.test(href)) continue
		for (const [label, re] of KEY_PAGES) {
			if (found.has(label) || !re.test(href)) continue
			try {
				found.set(label, new URL(href, base).href)
			} catch {
				/* skip unparseable href */
			}
		}
	}
	return [...found.entries()].map(([label, url]) => ({ label, url }))
}

function extractLogo(html: string, base: string, jsonld: Record<string, unknown>): string | null {
	const ld = jsonld.logo
	const fromLd =
		typeof ld === 'string' ? ld : ((ld as Record<string, unknown>)?.url as string | undefined)
	const candidate =
		fromLd ||
		metaContent(html, ['og:image', 'twitter:image']) ||
		html.match(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*>/i)?.[0]?.match(/href=["']([^"']+)["']/i)?.[1]
	if (!candidate) return null
	try {
		return new URL(candidate, base).href
	} catch {
		return null
	}
}

function extractLocation(jsonld: Record<string, unknown>): string | null {
	const a = jsonld.address
	if (!a) return null
	if (typeof a === 'string') return a
	const addr = a as Record<string, unknown>
	const parts = [
		addr.streetAddress,
		addr.addressLocality,
		addr.addressRegion,
		addr.postalCode,
		addr.addressCountry,
	].filter((p): p is string => typeof p === 'string' && p.length > 0)
	return parts.length ? parts.join(', ') : null
}

function firstParagraph(html: string): string | null {
	const body = html
		.replace(/<script[\s\S]*?<\/script>/gi, '')
		.replace(/<style[\s\S]*?<\/style>/gi, '')
	const m = body.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
	if (!m) return null
	const text = decodeEntities(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))
	return text.length > 40 ? text : null
}

/** "Acme — Best widgets" / "Acme | Home" → "Acme"; falls back to the domain label. */
function cleanName(raw: string | null, domain: string): string | null {
	if (!raw) {
		const base = domain.split('.')[0]
		return base ? base.charAt(0).toUpperCase() + base.slice(1) : null
	}
	const head = raw.split(/\s*[|–—:·]\s*|\s+[-]\s+/)[0].trim()
	return head.length >= 2 ? head : raw.trim()
}

function emptyProfile(input: string, fetchedAt: string, error: string): CompanyProfile {
	return {
		ok: false,
		input,
		url: '',
		domain: '',
		name: null,
		tagline: null,
		description: null,
		logo: null,
		industry: null,
		location: null,
		emails: [],
		socials: {},
		techHints: [],
		keyLinks: [],
		pages: [],
		fetchedAt,
		error,
	}
}

/** Fetch a company site and return a structured profile. Deterministic — no LLM. */
export async function lookupCompany(input: string): Promise<CompanyProfile> {
	const fetchedAt = new Date().toISOString()
	const norm = normalizeInput(input)
	if (!norm) return emptyProfile(input, fetchedAt, 'Not a valid URL or domain.')

	const home = await fetchHtml(norm.url)
	if (!home) {
		return {
			...emptyProfile(input, fetchedAt, 'Could not fetch the site (blocked, offline, or not HTML).'),
			url: norm.url,
			domain: norm.domain,
		}
	}

	const base = home.finalUrl
	const jsonld = jsonLdOrg(home.html)
	const title = titleTag(home.html)
	const ogTitle = metaContent(home.html, ['og:title', 'twitter:title'])
	const siteName = metaContent(home.html, ['og:site_name'])
	const ldName = typeof jsonld.name === 'string' ? jsonld.name : null

	const name = cleanName(ldName || siteName || ogTitle || title, norm.domain)
	const taglineRaw = ogTitle && ogTitle !== name ? ogTitle : title && title !== name ? title : null
	const ldDesc = typeof jsonld.description === 'string' ? jsonld.description : null
	let description = ldDesc || metaContent(home.html, ['og:description', 'description', 'twitter:description'])

	const keyLinks = extractKeyLinks(home.html, base)
	const pages = [base]

	// Thin homepage blurb? Pull a richer description from the About page.
	if (!description || description.length < 80) {
		const aboutUrl = keyLinks.find((l) => l.label === 'About')?.url ?? `${norm.url}/about`
		const about = await fetchHtml(aboutUrl)
		if (about) {
			pages.push(about.finalUrl)
			const aboutDesc = metaContent(about.html, ['og:description', 'description']) || firstParagraph(about.html)
			if (aboutDesc && aboutDesc.length > (description?.length ?? 0)) description = aboutDesc
		}
	}

	return {
		ok: true,
		input,
		url: base,
		domain: norm.domain,
		name,
		tagline: taglineRaw ? clip(taglineRaw, 160) : null,
		description: description ? clip(description, 600) : null,
		logo: extractLogo(home.html, base, jsonld),
		industry: typeof jsonld.industry === 'string' ? jsonld.industry : null,
		location: extractLocation(jsonld),
		emails: extractEmails(home.html),
		socials: extractSocials(home.html),
		techHints: detectTech(home.html),
		keyLinks,
		pages,
		fetchedAt,
	}
}
