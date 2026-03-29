import { z, type PawDefinition } from '@openvole/paw-sdk'

async function fetchAndParse(url: string) {
	const response = await fetch(url, {
		headers: { 'User-Agent': 'OpenVole/2.0 (Web Scraper)' },
	})
	if (!response.ok) {
		throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
	}
	const html = await response.text()
	const { load } = await import('cheerio')
	return load(html)
}

export const paw: PawDefinition = {
	name: '@openvole/paw-scraper',
	version: '1.0.0',
	description: 'Extract structured data from web pages',

	tools: [
		{
			name: 'scrape_page',
			description: 'Fetch a URL and extract structured content: title, headings, main text, links, and metadata. Lighter than browser_navigate — no JavaScript execution.',
			parameters: z.object({
				url: z.string().describe('URL to scrape'),
				max_text_length: z.number().optional().describe('Max text length to return (default: 5000)'),
			}),
			async execute(params) {
				const { url, max_text_length } = params as { url: string; max_text_length?: number }
				const $ = await fetchAndParse(url)
				const maxLen = max_text_length ?? 5000

				// Remove scripts, styles, nav, footer
				$('script, style, nav, footer, header, aside, .sidebar, .nav, .footer, .header').remove()

				const title = $('title').text().trim()
				const description = $('meta[name="description"]').attr('content') ?? ''
				const headings = $('h1, h2, h3').map((_, el) => $(el).text().trim()).get().slice(0, 20)
				let text = $('body').text().replace(/\s+/g, ' ').trim()
				if (text.length > maxLen) text = text.substring(0, maxLen) + '...'

				const links = $('a[href]').map((_, el) => ({
					text: $(el).text().trim(),
					href: $(el).attr('href'),
				})).get().filter((l) => l.text && l.href).slice(0, 50)

				return { ok: true, title, description, headings, text, linkCount: links.length, links: links.slice(0, 20) }
			},
		},
		{
			name: 'scrape_links',
			description: 'Extract all links from a web page with their text and URLs.',
			parameters: z.object({
				url: z.string().describe('URL to scrape'),
				filter: z.string().optional().describe('Filter links containing this text (case-insensitive)'),
			}),
			async execute(params) {
				const { url, filter } = params as { url: string; filter?: string }
				const $ = await fetchAndParse(url)

				let links = $('a[href]').map((_, el) => ({
					text: $(el).text().trim(),
					href: $(el).attr('href'),
				})).get().filter((l) => l.text && l.href)

				if (filter) {
					const lower = filter.toLowerCase()
					links = links.filter((l) =>
						l.text.toLowerCase().includes(lower) ||
						(l.href?.toLowerCase().includes(lower) ?? false),
					)
				}

				return { ok: true, count: links.length, links: links.slice(0, 100) }
			},
		},
		{
			name: 'scrape_tables',
			description: 'Extract HTML tables from a web page as structured arrays. Each table becomes an array of row objects.',
			parameters: z.object({
				url: z.string().describe('URL to scrape'),
				table_index: z.number().optional().describe('Index of specific table to extract (0-based). Default: all tables.'),
			}),
			async execute(params) {
				const { url, table_index } = params as { url: string; table_index?: number }
				const $ = await fetchAndParse(url)

				const tables: Array<{ index: number; headers: string[]; rows: string[][] }> = []

				$('table').each((idx, table) => {
					if (table_index !== undefined && idx !== table_index) return

					const headers: string[] = []
					$(table).find('thead th, tr:first-child th').each((_, th) => {
						headers.push($(th).text().trim())
					})

					const rows: string[][] = []
					$(table).find('tbody tr, tr').each((rowIdx, tr) => {
						if (rowIdx === 0 && headers.length > 0) return // skip header row
						const cells: string[] = []
						$(tr).find('td, th').each((_, td) => {
							cells.push($(td).text().trim())
						})
						if (cells.length > 0) rows.push(cells)
					})

					tables.push({ index: idx, headers, rows: rows.slice(0, 100) })
				})

				return { ok: true, count: tables.length, tables }
			},
		},
		{
			name: 'scrape_selector',
			description: 'Extract content matching a CSS selector from a web page.',
			parameters: z.object({
				url: z.string().describe('URL to scrape'),
				selector: z.string().describe('CSS selector (e.g. ".article-body", "#content", "div.price")'),
				attribute: z.string().optional().describe('Extract an attribute instead of text (e.g. "href", "src")'),
			}),
			async execute(params) {
				const { url, selector, attribute } = params as { url: string; selector: string; attribute?: string }
				const $ = await fetchAndParse(url)

				const results = $(selector).map((_, el) => {
					if (attribute) {
						return $(el).attr(attribute) ?? ''
					}
					return $(el).text().trim()
				}).get().filter(Boolean).slice(0, 50)

				return { ok: true, count: results.length, results }
			},
		},
	],

	async onLoad() {
		console.log('[paw-scraper] loaded')
	},
	async onUnload() {
		console.log('[paw-scraper] unloaded')
	},
}
