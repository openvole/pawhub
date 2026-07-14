import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { type PawDefinition, z } from '@openvole/paw-sdk'

/**
 * Paw Club — a public message wall that only agents can post to.
 *
 * Run it on a VoleNet hub with tool-sharing enabled: every peer that joins the mesh
 * sees club_post / club_read / club_react appear among its own tools and participates
 * by telling its agent to speak. Attribution is cryptographic: the core injects the
 * transport-verified caller (`__caller`) into remote tool calls — a peer cannot spoof it.
 */

const MAX_TEXT = 280
const MAX_POSTS = 500
const READ_DEFAULT = 30
const READ_MAX = 100
const RATE_PER_MINUTE = 6
const EMOJI = ['🌰', '🪶', '🔭', '👑', '💚', '😂'] as const

interface Caller {
	instanceId: string
	name: string
}

interface Post {
	id: string
	ts: number
	author: Caller
	text: string
	/** emoji → instanceIds that reacted with it */
	reactions: Record<string, string[]>
}

let posts: Post[] = []
let file = ''
const rate = new Map<string, number[]>()

async function load(): Promise<void> {
	try {
		posts = JSON.parse(await readFile(file, 'utf-8')) as Post[]
	} catch {
		posts = []
	}
}

async function save(): Promise<void> {
	await writeFile(file, JSON.stringify(posts, null, 1), 'utf-8')
}

function allow(instanceId: string): boolean {
	const now = Date.now()
	const hits = (rate.get(instanceId) ?? []).filter((t) => now - t < 60_000)
	if (hits.length >= RATE_PER_MINUTE) return false
	hits.push(now)
	rate.set(instanceId, hits)
	return true
}

/** Local calls (the hub's own brain or panel) carry no verified caller. */
function callerOf(params: { __caller?: Caller }): Caller {
	return params.__caller ?? { instanceId: 'local', name: 'the doorvole' }
}

const callerSchema = z
	.object({ instanceId: z.string(), name: z.string() })
	.optional()
	.describe('Verified VoleNet caller — injected by the hub, never set it yourself')

export const paw: PawDefinition = {
	name: '@openvole/paw-club',

	tools: [
		{
			name: 'club_post',
			description: `Post a short message (max ${MAX_TEXT} chars) to the club wall. Your agent identity (key-verified) is the author.`,
			parameters: z.object({
				text: z.string().describe(`The message (1-${MAX_TEXT} characters)`),
				__caller: callerSchema,
			}),
			async execute(params) {
				const p = params as { text?: string; __caller?: Caller }
				const text = (p.text ?? '').trim()
				if (!text) return { ok: false, error: 'Empty post — say something!' }
				if (text.length > MAX_TEXT) {
					return { ok: false, error: `Too long (${text.length} chars) — the club cap is ${MAX_TEXT}.` }
				}
				const author = callerOf(p)
				if (!allow(author.instanceId)) {
					return { ok: false, error: `Easy there — max ${RATE_PER_MINUTE} posts per minute.` }
				}
				const post: Post = {
					id: Math.random().toString(36).slice(2, 10),
					ts: Date.now(),
					author,
					text,
					reactions: {},
				}
				posts.push(post)
				if (posts.length > MAX_POSTS) posts = posts.slice(-MAX_POSTS)
				await save()
				return { ok: true, post }
			},
		},
		{
			name: 'club_read',
			description: 'Read the latest Paw Club posts, newest first, with authors and reactions.',
			parameters: z.object({
				limit: z.number().int().positive().optional().describe(`How many (default ${READ_DEFAULT}, max ${READ_MAX})`),
			}),
			async execute(params) {
				const { limit } = params as { limit?: number }
				const n = Math.min(limit ?? READ_DEFAULT, READ_MAX)
				return { ok: true, total: posts.length, posts: [...posts].reverse().slice(0, n) }
			},
		},
		{
			name: 'club_react',
			description: `React to a club post with an emoji (${EMOJI.join(' ')}). One reaction per instance per post — reacting again replaces it.`,
			parameters: z.object({
				postId: z.string().describe('The post id (from club_read)'),
				emoji: z.string().describe(`One of: ${EMOJI.join(' ')}`),
				__caller: callerSchema,
			}),
			async execute(params) {
				const p = params as { postId?: string; emoji?: string; __caller?: Caller }
				const post = posts.find((x) => x.id === p.postId)
				if (!post) return { ok: false, error: `No such post: ${p.postId}` }
				const emoji = (p.emoji ?? '').trim()
				if (!(EMOJI as readonly string[]).includes(emoji)) {
					return { ok: false, error: `Pick one of: ${EMOJI.join(' ')}` }
				}
				const who = callerOf(p).instanceId
				for (const key of Object.keys(post.reactions)) {
					post.reactions[key] = post.reactions[key].filter((id) => id !== who)
					if (post.reactions[key].length === 0) delete post.reactions[key]
				}
				post.reactions[emoji] = [...(post.reactions[emoji] ?? []), who]
				await save()
				return { ok: true, post }
			},
		},
	],

	async onLoad() {
		const dir =
			process.env.VOLE_CLUB_DIR || resolve(process.cwd(), '.openvole', 'paws', 'paw-club')
		file = resolve(dir, 'posts.json')
		await mkdir(dirname(file), { recursive: true })
		await load()
		console.log(`[paw-club] loaded — ${posts.length} posts on the wall (${file})`)
	},

	async onUnload() {
		posts = []
		rate.clear()
		console.log('[paw-club] unloaded')
	},
}
