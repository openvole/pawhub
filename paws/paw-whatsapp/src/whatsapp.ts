import * as path from 'node:path'
// Using whatsapp-web.js for WhatsApp Web protocol
// @ts-expect-error whatsapp-web.js has no type declarations
import pkg from 'whatsapp-web.js'
const { Client: WAClient, LocalAuth } = pkg

export interface IncomingMessage {
	chatId: string
	messageId: string
	text: string
	from: string
	isGroup: boolean
}

export interface ChatInfo {
	name: string
	isGroup: boolean
	participantCount: number | undefined
}

type MessageCallback = (message: IncomingMessage) => void

export class WhatsAppClient {
	private client: InstanceType<typeof WAClient>
	private running = false

	constructor(sessionData?: string) {
		const dataPath = path.resolve(process.cwd(), '.openvole', 'paws', 'paw-whatsapp')
		const clientOptions: Record<string, unknown> = {
			authStrategy: new LocalAuth({ dataPath }),
			puppeteer: {
				headless: true,
				args: ['--no-sandbox', '--disable-setuid-sandbox'],
			},
		}

		if (sessionData) {
			try {
				const parsed = JSON.parse(sessionData)
				clientOptions.session = parsed
			} catch {
				console.warn('[paw-whatsapp] Failed to parse WHATSAPP_SESSION_DATA, using LocalAuth')
			}
		}

		this.client = new WAClient(clientOptions)
	}

	/**
	 * Start the WhatsApp client and call the provided callback for each incoming message.
	 */
	async start(onMessage: MessageCallback): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.client.on('qr', (qr: string) => {
				console.log('[paw-whatsapp] QR code received. Scan with WhatsApp to authenticate:')
				console.log(qr)
			})

			this.client.on('authenticated', () => {
				console.log('[paw-whatsapp] Authenticated successfully')
			})

			this.client.on('auth_failure', (error: Error) => {
				console.error('[paw-whatsapp] Authentication failed:', error)
				reject(error)
			})

			this.client.on('ready', () => {
				this.running = true
				console.log('[paw-whatsapp] Client is ready')
				resolve()
			})

			this.client.on('message', async (msg: { body: string; from: string; id: { _serialized: string }; getContact: () => Promise<{ pushname?: string; number: string }>; getChat: () => Promise<{ isGroup: boolean }> }) => {
				if (!msg.body) return

				try {
					const contact = await msg.getContact()
					const chat = await msg.getChat()

					onMessage({
						chatId: msg.from,
						messageId: msg.id._serialized,
						text: msg.body,
						from: contact.pushname || contact.number,
						isGroup: chat.isGroup,
					})
				} catch (err) {
					console.error('[paw-whatsapp] Error processing message:', err)
				}
			})

			this.client.initialize().catch(reject)
		})
	}

	/** Send a message to a chat */
	async sendMessage(
		chatId: string,
		text: string,
		quotedMessageId?: string,
	): Promise<void> {
		const options: Record<string, unknown> = {}
		if (quotedMessageId) {
			options.quotedMessageId = quotedMessageId
		}
		await this.client.sendMessage(chatId, text, options)
	}

	/** Send a message and return its message ID (for later reference) */
	async sendMessageAndGetId(
		chatId: string,
		text: string,
		quotedMessageId?: string,
	): Promise<string> {
		const options: Record<string, unknown> = {}
		if (quotedMessageId) {
			options.quotedMessageId = quotedMessageId
		}
		const msg = await this.client.sendMessage(chatId, text, options)
		return msg.id._serialized
	}

	/** Get info about a chat */
	async getChatInfo(chatId: string): Promise<ChatInfo> {
		const chat = await this.client.getChatById(chatId)

		return {
			name: chat.name || chatId,
			isGroup: chat.isGroup,
			participantCount: chat.isGroup && chat.participants ? chat.participants.length : undefined,
		}
	}

	/** Stop the client gracefully */
	async stop(): Promise<void> {
		if (this.running) {
			this.running = false
			await this.client.destroy()
			console.log('[paw-whatsapp] Client stopped')
		}
	}
}
