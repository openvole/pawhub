import { z, type PawDefinition } from '@openvole/paw-sdk'
import { createIpcTransport } from '@openvole/paw-sdk'
import { TwilioClient } from './twilio.js'

let client: TwilioClient | undefined
let transport: ReturnType<typeof createIpcTransport> | undefined

/** Map from taskId to the originating call context */
const pendingTasks = new Map<string, { callSid: string; taskId: string }>()

export const paw: PawDefinition = {
	name: '@openvole/paw-voice-call',
	version: '0.1.0',
	description: 'Voice call channel for OpenVole via Twilio',

	tools: [
		{
			name: 'initiate_call',
			description: 'Initiate an outbound phone call',
			parameters: z.object({
				to: z.string().describe('Phone number in E.164 format (e.g. +14155551234)'),
				greeting: z.string().optional().describe('Optional greeting message to say when the call connects'),
			}),
			async execute(params) {
				const { to, greeting } = params as { to: string; greeting?: string }
				if (!client) throw new Error('Twilio client not initialized')
				const result = await client.initiateCall(to, greeting)
				return { ok: true, call_sid: result.callSid }
			},
		},
		{
			name: 'end_call',
			description: 'End an active phone call',
			parameters: z.object({
				call_sid: z.string().describe('The Twilio Call SID of the call to end'),
			}),
			async execute(params) {
				const { call_sid } = params as { call_sid: string }
				if (!client) throw new Error('Twilio client not initialized')
				await client.endCall(call_sid)
				return { ok: true }
			},
		},
		{
			name: 'list_calls',
			description: 'List active phone calls',
			parameters: z.object({}),
			async execute() {
				if (!client) throw new Error('Twilio client not initialized')
				const calls = Array.from(client.activeCalls.values())
				return { ok: true, calls }
			},
		},
	],

	async onLoad() {
		const accountSid = process.env.TWILIO_ACCOUNT_SID
		const authToken = process.env.TWILIO_AUTH_TOKEN
		const fromNumber = process.env.TWILIO_PHONE_NUMBER
		const webhookUrl = process.env.VOICE_CALL_WEBHOOK_URL
		const port = process.env.VOICE_CALL_PORT ? Number.parseInt(process.env.VOICE_CALL_PORT, 10) : 3979

		if (!accountSid || !authToken || !fromNumber || !webhookUrl) {
			console.error(
				'[paw-voice-call] Missing required env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, VOICE_CALL_WEBHOOK_URL',
			)
			return
		}

		transport = createIpcTransport()

		// Subscribe to task lifecycle events so we can send voice responses back
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
				client?.respondToCall(taskId, taskData.result)
			} else if (event === 'task:failed') {
				const errorMsg = taskData.error || 'Sorry, something went wrong processing your request.'
				client?.respondToCall(taskId, errorMsg)
			}
		})

		try {
			client = new TwilioClient(accountSid, authToken, fromNumber, webhookUrl, port)

			client.onSpeech(async (text, callSid, from) => {
				console.log(`[paw-voice-call] Speech from ${from} on call ${callSid}: ${text}`)

				try {
					const { taskId } = await transport!.createTask(text, {
						sessionId: `call:${callSid}`,
						source: 'voice-call',
						callSid,
						from,
					})

					pendingTasks.set(taskId, { callSid, taskId })
					client!.setLastTaskId(taskId)
				} catch (err) {
					console.error('[paw-voice-call] Failed to create task:', err)
				}
			})

			await client.start()
		} catch (err) {
			console.error('[paw-voice-call] Failed to start Twilio client:', err)
			client = undefined
		}
	},

	async onUnload() {
		if (client) {
			await client.stop()
			client = undefined
		}
		transport = undefined
		pendingTasks.clear()
	},
}
