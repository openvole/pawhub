import http from 'node:http'
import { URL } from 'node:url'
import Twilio from 'twilio'

type SpeechCallback = (text: string, callSid: string, from: string) => void

interface ActiveCall {
	callSid: string
	from: string
	to: string
	status: string
}

interface PendingResponse {
	resolve: (twiml: string) => void
	timer: ReturnType<typeof setTimeout>
}

export class TwilioClient {
	private readonly twilioClient: ReturnType<typeof Twilio>
	private readonly fromNumber: string
	private readonly webhookUrl: string
	private readonly port: number
	private server: http.Server | undefined
	private speechCallback: SpeechCallback | undefined

	readonly activeCalls = new Map<string, ActiveCall>()
	private readonly pendingResponses = new Map<string, PendingResponse>()

	constructor(
		accountSid: string,
		authToken: string,
		fromNumber: string,
		webhookUrl: string,
		port = 3979,
	) {
		this.twilioClient = Twilio(accountSid, authToken)
		this.fromNumber = fromNumber
		this.webhookUrl = webhookUrl.replace(/\/$/, '')
		this.port = port
	}

	onSpeech(callback: SpeechCallback): void {
		this.speechCallback = callback
	}

	async initiateCall(to: string, greeting?: string): Promise<{ callSid: string }> {
		const greetingText = greeting || 'Hello, this is OpenVole. How can I help you?'
		const twiml = [
			'<?xml version="1.0" encoding="UTF-8"?>',
			'<Response>',
			`  <Say>${escapeXml(greetingText)}</Say>`,
			`  <Gather input="speech" speechTimeout="auto" action="${this.webhookUrl}/voice/gather">`,
			'    <Say>I\'m listening.</Say>',
			'  </Gather>',
			'</Response>',
		].join('\n')

		const call = await this.twilioClient.calls.create({
			to,
			from: this.fromNumber,
			twiml,
			statusCallback: `${this.webhookUrl}/voice/status`,
			statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
		})

		this.activeCalls.set(call.sid, {
			callSid: call.sid,
			from: this.fromNumber,
			to,
			status: 'initiated',
		})

		console.log(`[paw-voice-call] Initiated call ${call.sid} to ${to}`)
		return { callSid: call.sid }
	}

	async endCall(callSid: string): Promise<void> {
		await this.twilioClient.calls(callSid).update({ status: 'completed' })
		this.activeCalls.delete(callSid)
		console.log(`[paw-voice-call] Ended call ${callSid}`)
	}

	respondToCall(taskId: string, responseText: string): void {
		const pending = this.pendingResponses.get(taskId)
		if (!pending) {
			console.warn(`[paw-voice-call] No pending response for taskId ${taskId}`)
			return
		}

		clearTimeout(pending.timer)
		this.pendingResponses.delete(taskId)

		const twiml = [
			'<?xml version="1.0" encoding="UTF-8"?>',
			'<Response>',
			`  <Say>${escapeXml(responseText)}</Say>`,
			`  <Gather input="speech" speechTimeout="auto" action="${this.webhookUrl}/voice/gather">`,
			'    <Say>Is there anything else?</Say>',
			'  </Gather>',
			'</Response>',
		].join('\n')

		pending.resolve(twiml)
	}

	async start(): Promise<void> {
		return new Promise((resolve) => {
			this.server = http.createServer((req, res) => {
				this.handleRequest(req, res)
			})

			this.server.listen(this.port, () => {
				console.log(`[paw-voice-call] Webhook server listening on port ${this.port}`)
				resolve()
			})
		})
	}

	async stop(): Promise<void> {
		// Clear any pending responses
		for (const [taskId, pending] of this.pendingResponses) {
			clearTimeout(pending.timer)
			pending.resolve(
				'<?xml version="1.0" encoding="UTF-8"?><Response><Say>Goodbye.</Say><Hangup/></Response>',
			)
		}
		this.pendingResponses.clear()

		return new Promise((resolve) => {
			if (this.server) {
				this.server.close(() => {
					console.log('[paw-voice-call] Webhook server stopped')
					resolve()
				})
			} else {
				resolve()
			}
		})
	}

	private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
		const url = new URL(req.url || '/', `http://localhost:${this.port}`)
		const path = url.pathname

		if (req.method !== 'POST') {
			res.writeHead(405, { 'Content-Type': 'text/plain' })
			res.end('Method Not Allowed')
			return
		}

		let body = ''
		req.on('data', (chunk: Buffer) => {
			body += chunk.toString()
		})

		req.on('end', () => {
			const params = parseFormData(body)

			if (path === '/voice/inbound') {
				this.handleInbound(params, res)
			} else if (path === '/voice/gather') {
				this.handleGather(params, res)
			} else if (path.startsWith('/voice/respond/')) {
				const taskId = path.replace('/voice/respond/', '')
				this.handleRespond(taskId, res)
			} else if (path === '/voice/status') {
				this.handleStatus(params, res)
			} else {
				res.writeHead(404, { 'Content-Type': 'text/plain' })
				res.end('Not Found')
			}
		})
	}

	private handleInbound(params: Record<string, string>, res: http.ServerResponse): void {
		const callSid = params.CallSid || ''
		const from = params.From || ''
		const to = params.To || ''

		console.log(`[paw-voice-call] Inbound call ${callSid} from ${from}`)

		this.activeCalls.set(callSid, {
			callSid,
			from,
			to,
			status: 'in-progress',
		})

		const twiml = [
			'<?xml version="1.0" encoding="UTF-8"?>',
			'<Response>',
			'  <Say>Hello, welcome to OpenVole.</Say>',
			`  <Gather input="speech" speechTimeout="auto" action="${this.webhookUrl}/voice/gather">`,
			'    <Say>How can I help you?</Say>',
			'  </Gather>',
			'</Response>',
		].join('\n')

		res.writeHead(200, { 'Content-Type': 'application/xml' })
		res.end(twiml)
	}

	private handleGather(params: Record<string, string>, res: http.ServerResponse): void {
		const speechResult = params.SpeechResult || ''
		const callSid = params.CallSid || ''
		const from = params.From || ''

		if (!speechResult) {
			// No speech detected, prompt again
			const twiml = [
				'<?xml version="1.0" encoding="UTF-8"?>',
				'<Response>',
				`  <Gather input="speech" speechTimeout="auto" action="${this.webhookUrl}/voice/gather">`,
				'    <Say>I didn\'t catch that. Could you please repeat?</Say>',
				'  </Gather>',
				'</Response>',
			].join('\n')
			res.writeHead(200, { 'Content-Type': 'application/xml' })
			res.end(twiml)
			return
		}

		console.log(`[paw-voice-call] Speech from ${from} on call ${callSid}: ${speechResult}`)

		// Fire the speech callback — it will create a task and give us a taskId
		if (this.speechCallback) {
			this.speechCallback(speechResult, callSid, from)
		}

		// Get the taskId that was just created (stored by the callback via setLastTaskId)
		const taskId = this.lastTaskId
		this.lastTaskId = undefined

		if (!taskId) {
			// Fallback if task creation failed
			const twiml = [
				'<?xml version="1.0" encoding="UTF-8"?>',
				'<Response>',
				'  <Say>Sorry, I could not process your request. Please try again.</Say>',
				`  <Gather input="speech" speechTimeout="auto" action="${this.webhookUrl}/voice/gather">`,
				'    <Say>How can I help you?</Say>',
				'  </Gather>',
				'</Response>',
			].join('\n')
			res.writeHead(200, { 'Content-Type': 'application/xml' })
			res.end(twiml)
			return
		}

		// Respond with redirect to the long-poll endpoint
		const twiml = [
			'<?xml version="1.0" encoding="UTF-8"?>',
			'<Response>',
			'  <Say>One moment please.</Say>',
			`  <Redirect method="POST">${this.webhookUrl}/voice/respond/${taskId}</Redirect>`,
			'</Response>',
		].join('\n')

		res.writeHead(200, { 'Content-Type': 'application/xml' })
		res.end(twiml)
	}

	private handleRespond(taskId: string, res: http.ServerResponse): void {
		console.log(`[paw-voice-call] Long-poll waiting for task ${taskId}`)

		const timer = setTimeout(() => {
			// Timeout — ask user to wait or retry
			this.pendingResponses.delete(taskId)
			const twiml = [
				'<?xml version="1.0" encoding="UTF-8"?>',
				'<Response>',
				'  <Say>I\'m still working on that. Please hold on.</Say>',
				`  <Redirect method="POST">${this.webhookUrl}/voice/respond/${taskId}</Redirect>`,
				'</Response>',
			].join('\n')
			res.writeHead(200, { 'Content-Type': 'application/xml' })
			res.end(twiml)
		}, 25_000) // 25s to stay under Twilio's 30s limit

		this.pendingResponses.set(taskId, {
			resolve: (twiml: string) => {
				res.writeHead(200, { 'Content-Type': 'application/xml' })
				res.end(twiml)
			},
			timer,
		})
	}

	private handleStatus(params: Record<string, string>, res: http.ServerResponse): void {
		const callSid = params.CallSid || ''
		const callStatus = params.CallStatus || ''

		console.log(`[paw-voice-call] Call ${callSid} status: ${callStatus}`)

		const call = this.activeCalls.get(callSid)
		if (call) {
			call.status = callStatus
			if (callStatus === 'completed' || callStatus === 'failed' || callStatus === 'canceled' || callStatus === 'busy' || callStatus === 'no-answer') {
				this.activeCalls.delete(callSid)
			}
		}

		res.writeHead(200, { 'Content-Type': 'text/plain' })
		res.end('OK')
	}

	/** Used by the paw to pass the taskId back synchronously after creating a task */
	private lastTaskId: string | undefined

	setLastTaskId(taskId: string): void {
		this.lastTaskId = taskId
	}
}

/** Parse URL-encoded form data */
function parseFormData(body: string): Record<string, string> {
	const params: Record<string, string> = {}
	for (const pair of body.split('&')) {
		const [key, ...rest] = pair.split('=')
		if (key) {
			params[decodeURIComponent(key)] = decodeURIComponent(rest.join('=').replace(/\+/g, ' '))
		}
	}
	return params
}

/** Escape special XML characters */
function escapeXml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
}
