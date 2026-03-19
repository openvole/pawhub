import { z, type PawDefinition } from '@openvole/paw-sdk'
import { BrowserManager } from './browser.js'

let browser: BrowserManager | undefined

function getBrowser(): BrowserManager {
	if (!browser) {
		throw new Error('Browser not initialized. The paw has not been loaded yet.')
	}
	return browser
}

export const paw: PawDefinition = {
	name: '@openvole/paw-browser',
	version: '0.1.0',
	description: 'Browser automation Paw for web browsing, interaction, and screenshots',

	tools: [
		{
			name: 'browser_navigate',
			description: 'Navigate to a URL in the browser. Returns the page URL and title after loading.',
			parameters: z.object({
				url: z.string().describe('The URL to navigate to'),
			}),
			async execute(params: unknown) {
				const { url } = params as { url: string }
				return getBrowser().navigate(url)
			},
		},
		{
			name: 'browser_click',
			description: 'Click an element on the page by CSS selector. Waits for the element and any triggered navigation.',
			parameters: z.object({
				selector: z.string().describe('CSS selector of the element to click'),
			}),
			async execute(params: unknown) {
				const { selector } = params as { selector: string }
				return getBrowser().click(selector)
			},
		},
		{
			name: 'browser_type',
			description: 'Type text into an input element identified by CSS selector.',
			parameters: z.object({
				selector: z.string().describe('CSS selector of the input element'),
				text: z.string().describe('Text to type into the element'),
			}),
			async execute(params: unknown) {
				const { selector, text } = params as { selector: string; text: string }
				return getBrowser().type(selector, text)
			},
		},
		{
			name: 'browser_screenshot',
			description: 'Take a full-page screenshot of the current page. Returns a base64-encoded PNG (truncated to 100KB).',
			parameters: z.object({}),
			async execute() {
				const base64 = await getBrowser().screenshot()
				return { screenshot: base64 }
			},
		},
		{
			name: 'browser_content',
			description: 'Get the page text content (truncated to 20k chars) and a simplified accessibility tree of interactive elements.',
			parameters: z.object({}),
			async execute() {
				return getBrowser().getContent()
			},
		},
		{
			name: 'browser_evaluate',
			description: 'Run arbitrary JavaScript in the page context and return the result.',
			parameters: z.object({
				script: z.string().describe('JavaScript code to evaluate in the page'),
			}),
			async execute(params: unknown) {
				const { script } = params as { script: string }
				const result = await getBrowser().evaluate(script)
				return { result }
			},
		},
	],

	async onLoad() {
		browser = new BrowserManager()
		await browser.launch()
		console.log('[paw-browser] loaded — browser launched')
	},

	async onUnload() {
		if (browser) {
			await browser.close()
			browser = undefined
		}
		console.log('[paw-browser] unloaded — browser closed')
	},
}
