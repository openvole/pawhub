import { z, type PawDefinition } from '@openvole/paw-sdk'
import { createIpcTransport } from '@openvole/paw-sdk'
import { SlackClient } from './slack.js'

let client: SlackClient | undefined
let transport: ReturnType<typeof createIpcTransport> | undefined

/** Map from taskId to the originating Slack channel/message + placeholder for reply routing */
const pendingTasks = new Map<string, { channelId: string; messageTs: string; threadTs?: string; placeholderTs?: string }>()

/** Parse comma-separated IDs from env var */
function parseAllowList(envVar: string | undefined): Set<string> | null {
	if (!envVar) return null
	const ids = envVar
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
	return ids.length > 0 ? new Set(ids) : null
}

export const paw: PawDefinition = {
	name: '@openvole/paw-slack',
	version: '0.1.0',
	description: 'Slack messaging channel for OpenVole',

	tools: [
		{
			name: 'slack_send',
			description: 'Send a message to a Slack channel',
			parameters: z.object({
				channel_id: z.string().describe('The Slack channel ID'),
				text: z.string().describe('The message text to send'),
				thread_ts: z.string().optional().describe('Thread timestamp to send in a thread'),
			}),
			async execute(params) {
				const { channel_id, text, thread_ts } = params as { channel_id: string; text: string; thread_ts?: string }
				if (!client) throw new Error('Slack client not initialized')
				await client.sendMessage(channel_id, text, thread_ts)
				return { ok: true }
			},
		},
		{
			name: 'slack_reply',
			description: 'Reply in a Slack thread',
			parameters: z.object({
				channel_id: z.string().describe('The Slack channel ID'),
				text: z.string().describe('The reply text'),
				thread_ts: z.string().describe('The thread timestamp to reply in'),
			}),
			async execute(params) {
				const { channel_id, text, thread_ts } = params as {
					channel_id: string
					text: string
					thread_ts: string
				}
				if (!client) throw new Error('Slack client not initialized')
				await client.sendMessage(channel_id, text, thread_ts)
				return { ok: true }
			},
		},
		{
			name: 'slack_get_channel',
			description: 'Get information about a Slack channel',
			parameters: z.object({
				channel_id: z.string().describe('The Slack channel ID'),
			}),
			async execute(params) {
				const { channel_id } = params as { channel_id: string }
				if (!client) throw new Error('Slack client not initialized')
				return client.getChannelInfo(channel_id)
			},
		},
	],

	async onLoad() {
		const botToken = process.env.SLACK_BOT_TOKEN
		const signingSecret = process.env.SLACK_SIGNING_SECRET
		const appToken = process.env.SLACK_APP_TOKEN

		if (!botToken || !signingSecret || !appToken) {
			console.error(
				'[paw-slack] SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, and SLACK_APP_TOKEN must all be set — bot will not start',
			)
			return
		}

		const allowFrom = parseAllowList(process.env.SLACK_ALLOW_FROM)
		if (allowFrom) {
			console.log(`[paw-slack] Restricted to ${allowFrom.size} allowed channel(s)/user(s)`)
		} else {
			console.warn('[paw-slack] SLACK_ALLOW_FROM not set — bot accepts messages from anyone')
		}

		transport = createIpcTransport()

		// Subscribe to task lifecycle events so we can send replies back
		transport.subscribe(['task:completed', 'task:failed'])

		transport.onBusEvent((event, data) => {
			const taskData = data as {
				taskId?: string
				result?: string
				error?: string
			}
			const taskId = taskData?.taskId
			if (!taskId) return

			const origin = pendingTasks.get(taskId)
			if (!origin) return

			pendingTasks.delete(taskId)

			if (event === 'task:completed' && taskData.result) {
				const text = taskData.result
				if (origin.placeholderTs) {
					// Edit the "Thinking..." message with the actual response
					client?.editMessage(origin.channelId, origin.placeholderTs, text)
						.catch((err) => {
							console.error('[paw-slack] Failed to edit placeholder, sending new message:', err)
							client?.sendMessage(origin.channelId, text, origin.threadTs || origin.messageTs)
						})
				} else {
					client?.sendMessage(origin.channelId, text, origin.threadTs || origin.messageTs)
						.catch((err) => {
							console.error('[paw-slack] Failed to send reply:', err)
						})
				}
			} else if (event === 'task:failed') {
				const errorMsg =
					taskData.error || 'Something went wrong processing your request.'
				if (origin.placeholderTs) {
					client?.editMessage(origin.channelId, origin.placeholderTs, errorMsg)
						.catch(() => {
							client?.sendMessage(origin.channelId, errorMsg, origin.threadTs || origin.messageTs)
						})
				} else {
					client?.sendMessage(origin.channelId, errorMsg, origin.threadTs || origin.messageTs)
						.catch((err) => {
							console.error('[paw-slack] Failed to send error reply:', err)
						})
				}
			}
		})

		try {
			client = new SlackClient(botToken, signingSecret, appToken)
			await client.start(async (message) => {
				// Check allow list
				if (allowFrom && !allowFrom.has(message.channelId) && !allowFrom.has(message.userId)) {
					console.log(`[paw-slack] Ignored message from unauthorized source ${message.channelId} (${message.from})`)
					return
				}

				console.log(
					`[paw-slack] Message from ${message.from}: ${message.text}`,
				)

				try {
					// Send "Thinking..." placeholder immediately
					const placeholderTs = await client!.sendMessageAndGetTs(
						message.channelId,
						'Thinking...',
						message.threadTs || message.messageTs,
					)

					const { taskId } = await transport!.createTask(message.text, {
						sessionId: `slack:${message.channelId}`,
						source: 'slack',
						channelId: message.channelId,
						from: message.from,
					})

					pendingTasks.set(taskId, {
						channelId: message.channelId,
						messageTs: message.messageTs,
						threadTs: message.threadTs,
						placeholderTs,
					})
				} catch (err) {
					console.error('[paw-slack] Failed to create task:', err)
				}
			})
		} catch (err) {
			console.error('[paw-slack] Failed to start bot:', err)
			client = undefined
		}
	},

	async onUnload() {
		await client?.stop()
		client = undefined
		transport = undefined
		pendingTasks.clear()
	},
}
