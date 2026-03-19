import puppeteer, { type Browser, type Page } from 'puppeteer'

const ELEMENT_TIMEOUT = 5000
const MAX_SCREENSHOT_BYTES = 100_000
const MAX_CONTENT_CHARS = 20_000

export class BrowserManager {
	private browser: Browser | null = null
	private page: Page | null = null

	async launch(): Promise<void> {
		const headlessEnv = process.env.VOLE_BROWSER_HEADLESS
		const headless = headlessEnv === 'false' ? false : true

		this.browser = await puppeteer.launch({
			headless,
			args: [
				'--no-sandbox',
				'--disable-setuid-sandbox',
				'--disable-gpu',
				'--disable-dev-shm-usage',
			],
		})

		this.page = await this.browser.newPage()
		await this.page.setViewport({ width: 1280, height: 720 })
		await this.page.setUserAgent(
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
		)
	}

	private getPage(): Page {
		if (!this.page) {
			throw new Error('Browser not launched. Call launch() first.')
		}
		return this.page
	}

	async navigate(url: string): Promise<{ url: string; title: string }> {
		const page = this.getPage()
		try {
			await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
			const title = await page.title()
			return { url: page.url(), title }
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			throw new Error(`Failed to navigate to ${url}: ${message}`)
		}
	}

	async click(selector: string): Promise<{ clicked: true }> {
		const page = this.getPage()
		try {
			await page.waitForSelector(selector, { timeout: ELEMENT_TIMEOUT })
			await Promise.all([
				page.click(selector),
				page.waitForNavigation({ waitUntil: 'load', timeout: 5000 }).catch(() => {
					// Navigation may not be triggered — that's fine
				}),
			])
			return { clicked: true }
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			throw new Error(`Failed to click "${selector}": ${message}`)
		}
	}

	async type(selector: string, text: string): Promise<{ typed: true }> {
		const page = this.getPage()
		try {
			await page.waitForSelector(selector, { timeout: ELEMENT_TIMEOUT })
			await page.type(selector, text)
			return { typed: true }
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			throw new Error(`Failed to type into "${selector}": ${message}`)
		}
	}

	async screenshot(): Promise<string> {
		const page = this.getPage()
		try {
			const buffer = await page.screenshot({
				fullPage: true,
				encoding: 'base64',
			})
			const base64 = typeof buffer === 'string' ? buffer : Buffer.from(buffer).toString('base64')
			if (base64.length > MAX_SCREENSHOT_BYTES) {
				return base64.slice(0, MAX_SCREENSHOT_BYTES)
			}
			return base64
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			throw new Error(`Failed to take screenshot: ${message}`)
		}
	}

	async getContent(): Promise<{ text: string; accessibilityTree: InteractiveElement[] }> {
		const page = this.getPage()
		try {
			const text = await page.evaluate(() => {
				return document.body?.innerText || ''
			})

			const accessibilityTree = await page.evaluate(() => {
				const elements: { tag: string; text: string; selector: string; type?: string; href?: string; name?: string; role?: string }[] = []
				const interactiveSelectors = 'a, button, input, select, textarea, [role="button"], [role="link"], [role="tab"]'
				const nodes = document.querySelectorAll(interactiveSelectors)

				nodes.forEach((el, index) => {
					const tag = el.tagName.toLowerCase()
					const text = (el as HTMLElement).innerText?.trim() || el.getAttribute('aria-label') || el.getAttribute('placeholder') || ''
					const type = el.getAttribute('type') || undefined
					const href = el.getAttribute('href') || undefined
					const name = el.getAttribute('name') || undefined
					const role = el.getAttribute('role') || undefined

					// Build a reasonable selector
					let selector = tag
					const id = el.getAttribute('id')
					if (id) {
						selector = `#${id}`
					} else if (name) {
						selector = `${tag}[name="${name}"]`
					} else {
						// Use nth-of-type as fallback
						const parent = el.parentElement
						if (parent) {
							const siblings = Array.from(parent.querySelectorAll(`:scope > ${tag}`))
							const idx = siblings.indexOf(el)
							if (siblings.length > 1) {
								selector = `${tag}:nth-of-type(${idx + 1})`
							}
						}
					}

					elements.push({
						tag,
						text: text.slice(0, 100),
						selector,
						...(type && { type }),
						...(href && { href: href.slice(0, 200) }),
						...(name && { name }),
						...(role && { role }),
					})
				})

				return elements
			})

			const truncatedText = text.length > MAX_CONTENT_CHARS ? text.slice(0, MAX_CONTENT_CHARS) + '\n... [truncated]' : text

			return { text: truncatedText, accessibilityTree }
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			throw new Error(`Failed to get page content: ${message}`)
		}
	}

	async evaluate(script: string): Promise<string> {
		const page = this.getPage()
		try {
			const result = await page.evaluate(script)
			return typeof result === 'string' ? result : JSON.stringify(result, null, 2)
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			throw new Error(`Failed to evaluate script: ${message}`)
		}
	}

	async close(): Promise<void> {
		if (this.page) {
			await this.page.close().catch(() => {})
			this.page = null
		}
		if (this.browser) {
			await this.browser.close().catch(() => {})
			this.browser = null
		}
	}
}

export interface InteractiveElement {
	tag: string
	text: string
	selector: string
	type?: string
	href?: string
	name?: string
	role?: string
}
