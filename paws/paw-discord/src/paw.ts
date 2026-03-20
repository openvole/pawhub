import { z, type PawDefinition } from '@openvole/paw-sdk'
import { createIpcTransport } from '@openvole/paw-sdk'
import { DiscordClient } from './discord.js'

let client: DiscordClient | undefined
let transport: ReturnType<typeof createIpcTransport> | undefined

/** Map from taskId to the originating Discord channel/message + placeholder for reply routing */
const pendingTasks = new Map<string, { channelId: string; messageId: string; placeholderMessageId?: string }>()

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
	name: '@openvole/paw-discord',
	version: '0.1.0',
	description: 'Discord messaging channel for OpenVole',

	tools: [
		{
			name: 'discord_send',
			description: 'Send a message to a Discord channel',
			parameters: z.object({
				channel_id: z.string().describe('The Discord channel ID'),
				text: z.string().describe('The message text to send'),
			}),
			async execute(params) {
				const { channel_id, text } = params as { channel_id: string; text: string }
				if (!client) throw new Error('Discord client not initialized')
				await client.sendMessage(channel_id, text)
				return { ok: true }
			},
		},
		{
			name: 'discord_reply',
			description: 'Reply to a message in Discord',
			parameters: z.object({
				channel_id: z.string().describe('The Discord channel ID'),
				text: z.string().describe('The reply text'),
				message_id: z.string().describe('The message ID to reply to'),
			}),
			async execute(params) {
				const { channel_id, text, message_id } = params as {
					channel_id: string
					text: string
					message_id: string
				}
				if (!client) throw new Error('Discord client not initialized')
				await client.sendMessage(channel_id, text, message_id)
				return { ok: true }
			},
		},
		{
			name: 'discord_get_channel',
			description: 'Get information about a Discord channel',
			parameters: z.object({
				channel_id: z.string().describe('The Discord channel ID'),
			}),
			async execute(params) {
				const { channel_id } = params as { channel_id: string }
				if (!client) throw new Error('Discord client not initialized')
				return client.getChannelInfo(channel_id)
			},
		},
	],

	async onLoad() {
		const token = process.env.DISCORD_BOT_TOKEN
		if (!token) {
			console.error(
				'[paw-discord] DISCORD_BOT_TOKEN not set — bot will not start',
			)
			return
		}

		const allowFrom = parseAllowList(process.env.DISCORD_ALLOW_FROM)
		if (allowFrom) {
			console.log(`[paw-discord] Restricted to ${allowFrom.size} allowed channel(s)/user(s)`)
		} else {
			console.warn('[paw-discord] DISCORD_ALLOW_FROM not set — bot accepts messages from anyone')
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
				if (origin.placeholderMessageId) {
					// Edit the "Thinking..." message with the actual response
					client?.editMessage(origin.channelId, origin.placeholderMessageId, text)
						.catch((err) => {
							console.error('[paw-discord] Failed to edit placeholder, sending new message:', err)
							client?.sendMessage(origin.channelId, text, origin.messageId)
						})
				} else {
					client?.sendMessage(origin.channelId, text, origin.messageId)
						.catch((err) => {
							console.error('[paw-discord] Failed to send reply:', err)
						})
				}
			} else if (event === 'task:failed') {
				const errorMsg =
					taskData.error || 'Something went wrong processing your request.'
				if (origin.placeholderMessageId) {
					client?.editMessage(origin.channelId, origin.placeholderMessageId, errorMsg)
						.catch(() => {
							client?.sendMessage(origin.channelId, errorMsg, origin.messageId)
						})
				} else {
					client?.sendMessage(origin.channelId, errorMsg, origin.messageId)
						.catch((err) => {
							console.error('[paw-discord] Failed to send error reply:', err)
						})
				}
			}
		})

		try {
			client = new DiscordClient(token)
			await client.start(async (message) => {
				// Check allow list (check both channel and user)
				if (allowFrom && !allowFrom.has(message.channelId) && !allowFrom.has(message.userId)) {
					console.log(`[paw-discord] Ignored message from unauthorized source ${message.channelId} (${message.from})`)
					return
				}

				console.log(
					`[paw-discord] Message from ${message.from}: ${message.text}`,
				)

				try {
					// Send "Thinking..." placeholder immediately
					const placeholderMessageId = await client!.sendMessageAndGetId(
						message.channelId,
						'Thinking...',
						message.messageId,
					)

					const { taskId } = await transport!.createTask(message.text, {
						sessionId: `discord:${message.channelId}`,
						source: 'discord',
						channelId: message.channelId,
						from: message.from,
						isGuild: message.isGuild,
					})

					pendingTasks.set(taskId, {
						channelId: message.channelId,
						messageId: message.messageId,
						placeholderMessageId,
					})
				} catch (err) {
					console.error('[paw-discord] Failed to create task:', err)
				}
			})
		} catch (err) {
			console.error('[paw-discord] Failed to start bot:', err)
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
