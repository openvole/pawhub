import { type PawDefinition, z } from '@openvole/paw-sdk'
import { lookupCompany } from './extract.js'
import { clearHistory, readHistory, recordLookup } from './store.js'

export const paw: PawDefinition = {
	name: '@openvole/paw-prospect',
	version: '0.1.0',
	description:
		'Prospect & lead enrichment from a company website URL — fetches a public site and returns a structured company profile (name, description, logo, socials, tech, key pages). Deterministic; the Brain can call it to research a prospect. Ships an embedded dashboard panel.',
	category: 'tool',

	tools: [
		{
			name: 'prospect_lookup',
			description:
				'Look up a company / sales prospect from its website URL or bare domain (e.g. "stripe.com"). Fetches the public site and returns a structured profile: name, tagline, description, logo, social links, detected tech, location, and key pages. Call this, then summarize or assess the prospect.',
			parameters: z.object({
				url: z
					.string()
					.describe('Company website URL or bare domain, e.g. "stripe.com" or "https://stripe.com"'),
			}),
			async execute(params) {
				const { url } = params as { url: string }
				const profile = await lookupCompany(url)
				await recordLookup(profile)
				return profile
			},
		},
		{
			name: 'prospect_history',
			description:
				"Recent prospect lookups (powers the panel's recent list). action: 'list' (default) | 'clear'.",
			parameters: z.object({
				action: z.enum(['list', 'clear']).optional().describe("'list' (default) or 'clear'"),
			}),
			async execute(params) {
				const { action } = params as { action?: 'list' | 'clear' }
				if (action === 'clear') {
					await clearHistory()
					return { ok: true, history: [] }
				}
				return { ok: true, history: await readHistory(50) }
			},
		},
	],

	async onLoad() {
		console.log('[paw-prospect] ready — prospect lookup tools + embedded panel')
	},
}
