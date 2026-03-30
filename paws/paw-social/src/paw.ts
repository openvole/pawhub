import { z, type PawDefinition } from '@openvole/paw-sdk'

function getTwitterHeaders(): Record<string, string> {
	const bearer = process.env.TWITTER_BEARER_TOKEN
	if (bearer) {
		return { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }
	}
	throw new Error('TWITTER_BEARER_TOKEN not set')
}

function getTwitterOAuth(): {
	apiKey: string; apiSecret: string; accessToken: string; accessSecret: string
} {
	const apiKey = process.env.TWITTER_API_KEY
	const apiSecret = process.env.TWITTER_API_SECRET
	const accessToken = process.env.TWITTER_ACCESS_TOKEN
	const accessSecret = process.env.TWITTER_ACCESS_SECRET
	if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
		throw new Error('Twitter OAuth credentials not set (TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET)')
	}
	return { apiKey, apiSecret, accessToken, accessSecret }
}

export const paw: PawDefinition = {
	name: '@openvole/paw-social',
	version: '1.0.0',
	description: 'Post to Twitter/X and LinkedIn',

	tools: [
		{
			name: 'twitter_post',
			description: 'Post a tweet to Twitter/X. Requires OAuth credentials (TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET).',
			parameters: z.object({
				text: z.string().max(280).describe('Tweet text (max 280 characters)'),
				reply_to: z.string().optional().describe('Tweet ID to reply to'),
			}),
			async execute(params) {
				const { text, reply_to } = params as { text: string; reply_to?: string }

				// Twitter v2 API requires OAuth 1.0a for posting
				// Use simple HMAC-SHA1 signing
				const oauth = getTwitterOAuth()
				const url = 'https://api.twitter.com/2/tweets'
				const body: Record<string, unknown> = { text }
				if (reply_to) body.reply = { in_reply_to_tweet_id: reply_to }

				const authHeader = await buildOAuth1Header(
					'POST', url, oauth.apiKey, oauth.apiSecret,
					oauth.accessToken, oauth.accessSecret,
				)

				const response = await fetch(url, {
					method: 'POST',
					headers: { ...authHeader, 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				})

				if (!response.ok) {
					const error = await response.text()
					return { ok: false, error: `Twitter API error ${response.status}: ${error}` }
				}

				const data = await response.json() as { data: { id: string; text: string } }
				return { ok: true, tweet_id: data.data.id, text: data.data.text }
			},
		},
		{
			name: 'twitter_search',
			description: 'Search recent tweets on Twitter/X. Requires TWITTER_BEARER_TOKEN.',
			parameters: z.object({
				query: z.string().describe('Search query'),
				max_results: z.number().optional().describe('Max results (10-100, default: 10)'),
			}),
			async execute(params) {
				const { query, max_results } = params as { query: string; max_results?: number }
				const headers = getTwitterHeaders()
				const limit = Math.min(100, Math.max(10, max_results ?? 10))

				const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=${limit}&tweet.fields=created_at,author_id,public_metrics`

				const response = await fetch(url, { headers })
				if (!response.ok) {
					const error = await response.text()
					return { ok: false, error: `Twitter API error ${response.status}: ${error}` }
				}

				const data = await response.json() as {
					data?: Array<{
						id: string; text: string; created_at: string
						public_metrics?: { like_count: number; retweet_count: number; reply_count: number }
					}>
					meta?: { result_count: number }
				}

				return {
					ok: true,
					count: data.meta?.result_count ?? 0,
					tweets: (data.data ?? []).map((t) => ({
						id: t.id,
						text: t.text,
						created_at: t.created_at,
						likes: t.public_metrics?.like_count,
						retweets: t.public_metrics?.retweet_count,
					})),
				}
			},
		},
		{
			name: 'linkedin_post',
			description: 'Post to LinkedIn. Requires LINKEDIN_ACCESS_TOKEN with w_member_social scope.',
			parameters: z.object({
				text: z.string().describe('Post text'),
			}),
			async execute(params) {
				const { text } = params as { text: string }
				const token = process.env.LINKEDIN_ACCESS_TOKEN
				if (!token) {
					return { ok: false, error: 'LINKEDIN_ACCESS_TOKEN not set' }
				}

				// Get user profile ID
				const meResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
					headers: { Authorization: `Bearer ${token}` },
				})
				if (!meResponse.ok) {
					return { ok: false, error: `LinkedIn profile fetch failed: ${meResponse.status}` }
				}
				const me = await meResponse.json() as { sub: string }

				// Create post
				const postBody = {
					author: `urn:li:person:${me.sub}`,
					lifecycleState: 'PUBLISHED',
					specificContent: {
						'com.linkedin.ugc.ShareContent': {
							shareCommentary: { text },
							shareMediaCategory: 'NONE',
						},
					},
					visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
				}

				const postResponse = await fetch('https://api.linkedin.com/v2/ugcPosts', {
					method: 'POST',
					headers: {
						Authorization: `Bearer ${token}`,
						'Content-Type': 'application/json',
						'X-Restli-Protocol-Version': '2.0.0',
					},
					body: JSON.stringify(postBody),
				})

				if (!postResponse.ok) {
					const error = await postResponse.text()
					return { ok: false, error: `LinkedIn post failed: ${postResponse.status}: ${error}` }
				}

				const postId = postResponse.headers.get('x-restli-id') ?? 'unknown'
				return { ok: true, post_id: postId }
			},
		},
	],

	async onLoad() {
		const hasTwitter = !!(process.env.TWITTER_BEARER_TOKEN || process.env.TWITTER_API_KEY)
		const hasLinkedIn = !!process.env.LINKEDIN_ACCESS_TOKEN
		console.log(`[paw-social] loaded — Twitter: ${hasTwitter ? 'configured' : 'not configured'}, LinkedIn: ${hasLinkedIn ? 'configured' : 'not configured'}`)
	},
	async onUnload() {
		console.log('[paw-social] unloaded')
	},
}

/** Build OAuth 1.0a Authorization header for Twitter API */
async function buildOAuth1Header(
	method: string,
	url: string,
	consumerKey: string,
	consumerSecret: string,
	accessToken: string,
	accessSecret: string,
): Promise<Record<string, string>> {
	const { createHmac, randomBytes } = await import('node:crypto')
	const timestamp = Math.floor(Date.now() / 1000).toString()
	const nonce = randomBytes(16).toString('hex')

	const params: Record<string, string> = {
		oauth_consumer_key: consumerKey,
		oauth_nonce: nonce,
		oauth_signature_method: 'HMAC-SHA1',
		oauth_timestamp: timestamp,
		oauth_token: accessToken,
		oauth_version: '1.0',
	}

	const paramString = Object.keys(params)
		.sort()
		.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
		.join('&')

	const baseString = `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(paramString)}`
	const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(accessSecret)}`
	const signature = createHmac('sha1', signingKey).update(baseString).digest('base64')

	params.oauth_signature = signature

	const header = Object.keys(params)
		.sort()
		.map((k) => `${encodeURIComponent(k)}="${encodeURIComponent(params[k])}"`)
		.join(', ')

	return { Authorization: `OAuth ${header}` }
}
