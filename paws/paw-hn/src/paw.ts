import { type PawDefinition, z } from '@openvole/paw-sdk'
import { type Feed, getStories, getStory } from './hn.js'

export const paw: PawDefinition = {
	name: '@openvole/paw-hn',
	version: '0.1.0',
	description:
		'Hacker News reader — live front page, stories, and threads via the public HN API, with an embedded dashboard panel. Deterministic; the Brain can read and summarize HN too.',
	category: 'tool',

	tools: [
		{
			name: 'hn_top',
			description:
				"Hacker News stories for a feed. feed: 'top' (default) | 'new' | 'best' | 'ask' | 'show' | 'job'. Returns title, points, comment count, url, domain, author, and age.",
			parameters: z.object({
				feed: z
					.enum(['top', 'new', 'best', 'ask', 'show', 'job'])
					.optional()
					.describe("Which feed (default 'top')"),
				limit: z.number().optional().describe('How many stories (default 30, max 50)'),
			}),
			async execute(params) {
				const { feed, limit } = params as { feed?: Feed; limit?: number }
				const stories = await getStories(feed ?? 'top', limit ?? 30)
				return { ok: true, feed: feed ?? 'top', count: stories.length, stories }
			},
		},
		{
			name: 'hn_story',
			description:
				'A single Hacker News item with its top-level comments — for reading or summarizing a discussion. Pass the numeric story id.',
			parameters: z.object({
				id: z.number().describe('HN item id, e.g. 38901234'),
			}),
			async execute(params) {
				const { id } = params as { id: number }
				const story = await getStory(id)
				if (!story) return { ok: false, error: 'story not found' }
				return { ok: true, story }
			},
		},
	],

	async onLoad() {
		console.log('[paw-hn] ready — Hacker News reader tools + embedded panel')
	},
}
