import { z, type PawDefinition } from '@openvole/paw-sdk'
import { createIpcTransport } from '@openvole/paw-sdk'
import { MSTeamsClient } from './msteams.js'

let client: MSTeamsClient | undefined
let transport: ReturnType<typeof createIpcTransport> | undefined

/** Map from taskId to the originating conversation + placeholder for reply routing */
const pendingTasks = new Map<string, { conversationId: string; placeholderActivityId: string }>()

/** Parse comma-separated names/IDs from env var */
function parseAllowList(envVar: string | undefined): Set<string> | null {
	if (!envVar) return null
	const entries = envVar
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
	return entries.length > 0 ? new Set(entries) : null
}

export const paw: PawDefinition = {
	name: '@openvole/paw-msteams',
	version: '0.1.0',
	description: 'Microsoft Teams channel for OpenVole',

	tools: [
		{
			name: 'msteams_send',
			description: 'Send a message to a Microsoft Teams conversation',
			parameters: z.object({
				conversation_id: z.string().describe('The Teams conversation ID'),
				text: z.string().describe('The message text to send'),
			}),
			async execute(params) {
				const { conversation_id, text } = params as { conversation_id: string; text: string }
				if (!client) throw new Error('Teams client not initialized')
				const activityId = await client.sendMessage(conversation_id, text)
				return { ok: true, activityId }
			},
		},
		{
			name: 'msteams_reply',
			description: 'Reply to the current Teams conversation',
			parameters: z.object({
				text: z.string().describe('The reply text'),
			}),
			async execute(params) {
				const { text } = params as { text: string }
				if (!client) throw new Error('Teams client not initialized')
				// Reply to the most recent conversation from pendingTasks
				const conversations = client.getConversations()
				if (conversations.length === 0) throw new Error('No active conversations')
				const lastConversation = conversations[conversations.length - 1]
				const activityId = await client.sendMessage(lastConversation.conversationId, text)
				return { ok: true, activityId }
			},
		},
		{
			name: 'msteams_get_conversations',
			description: 'List active Teams conversations',
			parameters: z.object({}),
			async execute() {
				if (!client) throw new Error('Teams client not initialized')
				return client.getConversations()
			},
		},
	],

	async onLoad() {
		const appId = process.env.MSTEAMS_APP_ID
		const appPassword = process.env.MSTEAMS_APP_PASSWORD

		if (!appId || !appPassword) {
			console.error(
				'[paw-msteams] MSTEAMS_APP_ID and MSTEAMS_APP_PASSWORD must be set — bot will not start',
			)
			return
		}

		const tenantId = process.env.MSTEAMS_TENANT_ID
		const allowFrom = parseAllowList(process.env.MSTEAMS_ALLOW_FROM)

		if (allowFrom) {
			console.log(`[paw-msteams] Restricted to ${allowFrom.size} allowed user(s)`)
		} else {
			console.warn('[paw-msteams] MSTEAMS_ALLOW_FROM not set — bot accepts messages from anyone')
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
				if (origin.placeholderActivityId) {
					client?.editMessage(origin.conversationId, origin.placeholderActivityId, text)
						.catch((err) => {
							console.error('[paw-msteams] Failed to edit placeholder, sending new message:', err)
							client?.sendMessage(origin.conversationId, text)
						})
				} else {
					client?.sendMessage(origin.conversationId, text)
						.catch((err) => {
							console.error('[paw-msteams] Failed to send reply:', err)
						})
				}
			} else if (event === 'task:failed') {
				const errorMsg =
					taskData.error || 'Something went wrong processing your request.'
				if (origin.placeholderActivityId) {
					client?.editMessage(origin.conversationId, origin.placeholderActivityId, errorMsg)
						.catch(() => {
							client?.sendMessage(origin.conversationId, errorMsg)
						})
				} else {
					client?.sendMessage(origin.conversationId, errorMsg)
						.catch((err) => {
							console.error('[paw-msteams] Failed to send error reply:', err)
						})
				}
			}
		})

		try {
			client = new MSTeamsClient(appId, appPassword, tenantId)

			client.onMessage(async (text, conversationId, userName) => {
				// Check allow list
				if (allowFrom && !allowFrom.has(userName)) {
					console.log(`[paw-msteams] Ignored message from unauthorized user ${userName}`)
					return
				}

				console.log(`[paw-msteams] Message from ${userName}: ${text}`)

				try {
					// Send "Thinking..." placeholder immediately
					const placeholderActivityId = await client!.sendMessage(
						conversationId,
						'Thinking...',
					)

					const { taskId } = await transport!.createTask(text, {
						sessionId: `msteams:${conversationId}`,
						source: 'msteams',
						conversationId,
						from: userName,
					})

					pendingTasks.set(taskId, {
						conversationId,
						placeholderActivityId,
					})
				} catch (err) {
					console.error('[paw-msteams] Failed to create task:', err)
				}
			})

			await client.start()
		} catch (err) {
			console.error('[paw-msteams] Failed to start bot:', err)
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
