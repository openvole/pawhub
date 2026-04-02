import { z, type PawDefinition } from '@openvole/paw-sdk'
import { createIpcTransport } from '@openvole/paw-sdk'
import { TelegramClient } from './telegram.js'

let client: TelegramClient | undefined
let transport: ReturnType<typeof createIpcTransport> | undefined
let defaultChatId: string | undefined

/** Map from taskId to the originating Telegram chat/message + placeholder for reply routing */
const pendingTasks = new Map<string, { chatId: number; messageId: number; placeholderMessageId?: number }>()

/** Parse comma-separated IDs from env var */
function parseAllowList(envVar: string | undefined): Set<number> | null {
	if (!envVar) return null
	const ids = envVar
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
		.map(Number)
		.filter((n) => !Number.isNaN(n))
	return ids.length > 0 ? new Set(ids) : null
}

export const paw: PawDefinition = {
	name: '@openvole/paw-telegram',
	version: '0.1.0',
	description: 'Telegram messaging channel for OpenVole',

	tools: [
		{
			name: 'telegram_send',
			description: 'Send a message to a Telegram chat. If chat_id is omitted, sends to the default user.',
			parameters: z.object({
				chat_id: z.string().optional().describe('The Telegram chat ID (optional — defaults to TELEGRAM_ALLOW_FROM)'),
				text: z.string().describe('The message text to send'),
			}),
			async execute(params) {
				const { chat_id, text } = params as { chat_id?: string; text: string }
				if (!client) throw new Error('Telegram client not initialized')
				const target = chat_id || defaultChatId
				if (!target) throw new Error('No chat_id provided and TELEGRAM_ALLOW_FROM not set')
				await client.sendMessage(target, text)
				return { ok: true }
			},
		},
		{
			name: 'telegram_reply',
			description: 'Reply to a specific message in a Telegram chat. If chat_id is omitted, sends to the default user.',
			parameters: z.object({
				chat_id: z.string().optional().describe('The Telegram chat ID (optional — defaults to TELEGRAM_ALLOW_FROM)'),
				text: z.string().describe('The reply text'),
				reply_to: z.number().describe('The message ID to reply to'),
			}),
			async execute(params) {
				const { chat_id, text, reply_to } = params as {
					chat_id?: string
					text: string
					reply_to: number
				}
				if (!client) throw new Error('Telegram client not initialized')
				const target = chat_id || defaultChatId
				if (!target) throw new Error('No chat_id provided and TELEGRAM_ALLOW_FROM not set')
				await client.sendMessage(target, text, reply_to)
				return { ok: true }
			},
		},
		{
			name: 'telegram_get_chat',
			description: 'Get information about a Telegram chat. If chat_id is omitted, uses the default user.',
			parameters: z.object({
				chat_id: z.string().optional().describe('The Telegram chat ID (optional — defaults to TELEGRAM_ALLOW_FROM)'),
			}),
			async execute(params) {
				const { chat_id } = params as { chat_id?: string }
				if (!client) throw new Error('Telegram client not initialized')
				const target = chat_id || defaultChatId
				if (!target) throw new Error('No chat_id provided and TELEGRAM_ALLOW_FROM not set')
				return client.getChatInfo(target)
			},
		},
	],

	async onLoad() {
		const token = process.env.TELEGRAM_BOT_TOKEN
		if (!token) {
			console.error(
				'[paw-telegram] TELEGRAM_BOT_TOKEN not set — bot will not start',
			)
			return
		}

		const allowFrom = parseAllowList(process.env.TELEGRAM_ALLOW_FROM)
		if (allowFrom) {
			console.log(`[paw-telegram] Restricted to ${allowFrom.size} allowed user(s)`)
			// Use the first allowed ID as default chat target for outbound messages
			defaultChatId = String([...allowFrom][0])
		} else {
			console.warn('[paw-telegram] TELEGRAM_ALLOW_FROM not set — bot accepts messages from anyone')
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
					client?.editMessage(origin.chatId, origin.placeholderMessageId, text)
						.catch((err) => {
							// If edit fails (e.g. message too old), send a new one
							console.error('[paw-telegram] Failed to edit placeholder, sending new message:', err)
							client?.sendMessage(origin.chatId, text, origin.messageId)
						})
				} else {
					client?.sendMessage(origin.chatId, text, origin.messageId)
						.catch((err) => {
							console.error('[paw-telegram] Failed to send reply:', err)
						})
				}
			} else if (event === 'task:failed') {
				const errorMsg =
					taskData.error || 'Something went wrong processing your request.'
				if (origin.placeholderMessageId) {
					client?.editMessage(origin.chatId, origin.placeholderMessageId, errorMsg)
						.catch(() => {
							client?.sendMessage(origin.chatId, errorMsg, origin.messageId)
						})
				} else {
					client?.sendMessage(origin.chatId, errorMsg, origin.messageId)
						.catch((err) => {
							console.error('[paw-telegram] Failed to send error reply:', err)
						})
				}
			}
		})

		try {
			client = new TelegramClient(token)
			await client.start(async (message) => {
				// Check allow list
				if (allowFrom && !allowFrom.has(message.chatId)) {
					console.log(`[paw-telegram] Ignored message from unauthorized chat ${message.chatId} (${message.from})`)
					return
				}

				console.log(
					`[paw-telegram] Message from ${message.from}: ${message.text}`,
				)

				try {
					// Send "Thinking..." placeholder immediately
					const placeholderMessageId = await client!.sendMessageAndGetId(
						message.chatId,
						'Thinking...',
						message.messageId,
					)

					const { taskId } = await transport!.createTask(message.text, {
						sessionId: `telegram:${message.chatId}`,
						source: 'telegram',
						chatId: message.chatId,
						from: message.from,
						isGroup: message.isGroup,
					})

					pendingTasks.set(taskId, {
						chatId: message.chatId,
						messageId: message.messageId,
						placeholderMessageId,
					})
				} catch (err) {
					console.error('[paw-telegram] Failed to create task:', err)
				}
			})
		} catch (err) {
			console.error('[paw-telegram] Failed to start bot:', err)
			client = undefined
		}
	},

	async onUnload() {
		client?.stop()
		client = undefined
		transport = undefined
		pendingTasks.clear()
	},
}
