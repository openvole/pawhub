import { z, type PawDefinition } from '@openvole/paw-sdk'
import { createIpcTransport } from '@openvole/paw-sdk'
import { WhatsAppClient } from './whatsapp.js'

let client: WhatsAppClient | undefined
let transport: ReturnType<typeof createIpcTransport> | undefined

/** Map from taskId to the originating WhatsApp chat/message for reply routing */
const pendingTasks = new Map<string, { chatId: string; messageId: string; placeholderMessageId?: string }>()

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
	name: '@openvole/paw-whatsapp',
	version: '0.1.0',
	description: 'WhatsApp messaging channel for OpenVole',

	tools: [
		{
			name: 'whatsapp_send',
			description: 'Send a message via WhatsApp',
			parameters: z.object({
				chat_id: z.string().describe('The WhatsApp chat ID'),
				text: z.string().describe('The message text to send'),
				quote_message_id: z.string().optional().describe('Message ID to quote/reply to'),
			}),
			async execute(params) {
				const { chat_id, text, quote_message_id } = params as { chat_id: string; text: string; quote_message_id?: string }
				if (!client) throw new Error('WhatsApp client not initialized')
				await client.sendMessage(chat_id, text, quote_message_id)
				return { ok: true }
			},
		},
		{
			name: 'whatsapp_get_chat',
			description: 'Get information about a WhatsApp chat',
			parameters: z.object({
				chat_id: z.string().describe('The WhatsApp chat ID'),
			}),
			async execute(params) {
				const { chat_id } = params as { chat_id: string }
				if (!client) throw new Error('WhatsApp client not initialized')
				return client.getChatInfo(chat_id)
			},
		},
	],

	async onLoad() {
		const sessionData = process.env.WHATSAPP_SESSION_DATA

		const allowFrom = parseAllowList(process.env.WHATSAPP_ALLOW_FROM)
		if (allowFrom) {
			console.log(`[paw-whatsapp] Restricted to ${allowFrom.size} allowed chat(s)`)
		} else {
			console.warn('[paw-whatsapp] WHATSAPP_ALLOW_FROM not set — bot accepts messages from anyone')
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
				// WhatsApp doesn't support editing messages, so send a new reply
				client?.sendMessage(origin.chatId, text, origin.messageId)
					.catch((err) => {
						console.error('[paw-whatsapp] Failed to send reply:', err)
					})
			} else if (event === 'task:failed') {
				const errorMsg =
					taskData.error || 'Something went wrong processing your request.'
				client?.sendMessage(origin.chatId, errorMsg, origin.messageId)
					.catch((err) => {
						console.error('[paw-whatsapp] Failed to send error reply:', err)
					})
			}
		})

		try {
			client = new WhatsAppClient(sessionData)
			await client.start(async (message) => {
				// Check allow list
				if (allowFrom && !allowFrom.has(message.chatId)) {
					console.log(`[paw-whatsapp] Ignored message from unauthorized chat ${message.chatId} (${message.from})`)
					return
				}

				console.log(
					`[paw-whatsapp] Message from ${message.from}: ${message.text}`,
				)

				try {
					// Send "Thinking..." placeholder immediately
					// Note: WhatsApp doesn't support message editing, so the placeholder
					// will remain and the response will be sent as a separate reply
					const placeholderMessageId = await client!.sendMessageAndGetId(
						message.chatId,
						'Thinking...',
						message.messageId,
					)

					const { taskId } = await transport!.createTask(message.text, {
						sessionId: `whatsapp:${message.chatId}`,
						source: 'whatsapp',
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
					console.error('[paw-whatsapp] Failed to create task:', err)
				}
			})
		} catch (err) {
			console.error('[paw-whatsapp] Failed to start client:', err)
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
