import http from 'node:http'
import {
	BotFrameworkAdapter,
	TurnContext,
	type ConversationReference,
	type Activity,
	ActivityTypes,
} from 'botbuilder'

type MessageCallback = (text: string, conversationId: string, userName: string) => void

export class MSTeamsClient {
	private adapter: BotFrameworkAdapter
	private server: http.Server | undefined
	private port: number
	private messageCallback: MessageCallback | undefined
	private conversationReferences = new Map<string, Partial<ConversationReference>>()

	constructor(
		appId: string,
		appPassword: string,
		private tenantId?: string,
	) {
		this.port = Number(process.env.MSTEAMS_PORT) || 3978

		this.adapter = new BotFrameworkAdapter({
			appId,
			appPassword,
		})

		// Error handler
		this.adapter.onTurnError = async (context, error) => {
			console.error('[paw-msteams] Turn error:', error)
			try {
				await context.sendActivity('Sorry, something went wrong processing your message.')
			} catch {
				// Ignore send failures during error handling
			}
		}
	}

	/** Register a callback for incoming messages */
	onMessage(callback: MessageCallback): void {
		this.messageCallback = callback
	}

	/** Send a message to a conversation and return the activity ID */
	async sendMessage(conversationId: string, text: string): Promise<string> {
		const reference = this.conversationReferences.get(conversationId)
		if (!reference) {
			throw new Error(`No conversation reference found for ${conversationId}`)
		}

		let activityId = ''
		await this.adapter.continueConversation(reference, async (context) => {
			const response = await context.sendActivity(text)
			activityId = response?.id ?? ''
		})

		return activityId
	}

	/** Edit (update) an existing message */
	async editMessage(conversationId: string, activityId: string, text: string): Promise<void> {
		const reference = this.conversationReferences.get(conversationId)
		if (!reference) {
			throw new Error(`No conversation reference found for ${conversationId}`)
		}

		await this.adapter.continueConversation(reference, async (context) => {
			await context.updateActivity({
				id: activityId,
				type: ActivityTypes.Message,
				text,
			} as Partial<Activity>)
		})
	}

	/** Get all active conversation IDs and their references */
	getConversations(): Array<{ conversationId: string; tenantId?: string }> {
		const result: Array<{ conversationId: string; tenantId?: string }> = []
		for (const [conversationId, ref] of this.conversationReferences) {
			result.push({
				conversationId,
				tenantId: (ref.conversation as { tenantId?: string })?.tenantId,
			})
		}
		return result
	}

	/** Start the HTTP server listening for Bot Framework messages */
	async start(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.server = http.createServer(async (req, res) => {
				if (req.method === 'POST' && req.url === '/api/messages') {
					await this.adapter.process(req, res, async (context: TurnContext) => {
						// Store conversation reference for proactive messaging
						const activity = context.activity
						if (activity.conversation) {
							const ref = TurnContext.getConversationReference(activity)
							this.conversationReferences.set(activity.conversation.id, ref)
						}

						// Only process message activities with text
						if (activity.type === ActivityTypes.Message && activity.text) {
							const conversationId = activity.conversation?.id ?? ''
							const userName =
								activity.from?.name ??
								activity.from?.id ??
								'unknown'

							if (this.messageCallback) {
								this.messageCallback(activity.text, conversationId, userName)
							}
						}
					})
				} else {
					res.writeHead(404)
					res.end()
				}
			})

			this.server.on('error', (err) => {
				console.error('[paw-msteams] Server error:', err)
				reject(err)
			})

			this.server.listen(this.port, () => {
				console.log(`[paw-msteams] Listening on port ${this.port} at /api/messages`)
				resolve()
			})
		})
	}

	/** Stop the HTTP server */
	async stop(): Promise<void> {
		return new Promise((resolve) => {
			if (this.server) {
				this.server.close(() => {
					console.log('[paw-msteams] Server stopped')
					resolve()
				})
			} else {
				resolve()
			}
		})
	}
}
