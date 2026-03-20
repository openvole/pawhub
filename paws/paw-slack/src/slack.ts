import { App } from '@slack/bolt'

const SLACK_MAX_LENGTH = 4000

export interface IncomingMessage {
	channelId: string
	messageTs: string
	threadTs?: string
	text: string
	from: string
	userId: string
}

export interface ChannelInfo {
	name: string | undefined
	topic: string | undefined
	purpose: string | undefined
	memberCount: number | undefined
}

type MessageCallback = (message: IncomingMessage) => void

/**
 * Split a long message into chunks that fit within Slack's message limit.
 * Prefers splitting at newline boundaries when possible.
 */
function chunkMessage(text: string): string[] {
	if (text.length <= SLACK_MAX_LENGTH) return [text]

	const chunks: string[] = []
	let remaining = text

	while (remaining.length > 0) {
		if (remaining.length <= SLACK_MAX_LENGTH) {
			chunks.push(remaining)
			break
		}

		const slice = remaining.substring(0, SLACK_MAX_LENGTH)
		const lastNewline = slice.lastIndexOf('\n')

		let splitAt: number
		if (lastNewline > SLACK_MAX_LENGTH * 0.3) {
			splitAt = lastNewline + 1
		} else {
			splitAt = SLACK_MAX_LENGTH
		}

		chunks.push(remaining.substring(0, splitAt))
		remaining = remaining.substring(splitAt)
	}

	return chunks
}

export class SlackClient {
	private app: App
	private running = false

	constructor(
		botToken: string,
		signingSecret: string,
		appToken: string,
	) {
		this.app = new App({
			token: botToken,
			signingSecret,
			appToken,
			socketMode: true,
			port: 3002,
		})
	}

	/**
	 * Start the Slack app in socket mode and call the provided callback for each incoming message.
	 * Only processes messages that mention the bot.
	 */
	async start(onMessage: MessageCallback): Promise<void> {
		// Listen for messages that mention the bot
		this.app.event('app_mention', async ({ event }) => {
			onMessage({
				channelId: event.channel,
				messageTs: event.ts,
				threadTs: event.thread_ts,
				text: event.text,
				from: event.user,
				userId: event.user,
			})
		})

		// Listen for direct messages
		this.app.event('message', async ({ event }) => {
			// Only handle direct messages (im channel type)
			const msgEvent = event as {
				channel_type?: string
				text?: string
				user?: string
				ts: string
				thread_ts?: string
				channel: string
				subtype?: string
			}

			if (msgEvent.channel_type !== 'im') return
			if (msgEvent.subtype) return // ignore bot messages, edits, etc.
			if (!msgEvent.text || !msgEvent.user) return

			onMessage({
				channelId: msgEvent.channel,
				messageTs: msgEvent.ts,
				threadTs: msgEvent.thread_ts,
				text: msgEvent.text,
				from: msgEvent.user,
				userId: msgEvent.user,
			})
		})

		await this.app.start()
		this.running = true
		console.log('[paw-slack] Bot connected via Socket Mode')
	}

	/** Send a message to a channel, splitting into chunks if needed */
	async sendMessage(
		channelId: string,
		text: string,
		threadTs?: string,
	): Promise<void> {
		const chunks = chunkMessage(text)

		for (const chunk of chunks) {
			await this.app.client.chat.postMessage({
				channel: channelId,
				text: chunk,
				...(threadTs ? { thread_ts: threadTs } : {}),
			})
		}
	}

	/** Send a message and return its timestamp (for later editing) */
	async sendMessageAndGetTs(
		channelId: string,
		text: string,
		threadTs?: string,
	): Promise<string> {
		const result = await this.app.client.chat.postMessage({
			channel: channelId,
			text,
			...(threadTs ? { thread_ts: threadTs } : {}),
		})
		return result.ts as string
	}

	/** Edit an existing message's text, splitting into chunks if needed */
	async editMessage(
		channelId: string,
		messageTs: string,
		text: string,
	): Promise<void> {
		const chunks = chunkMessage(text)

		// Edit the original message with the first chunk
		await this.app.client.chat.update({
			channel: channelId,
			ts: messageTs,
			text: chunks[0],
		})

		// Send remaining chunks as new messages
		for (let i = 1; i < chunks.length; i++) {
			await this.app.client.chat.postMessage({
				channel: channelId,
				text: chunks[i],
			})
		}
	}

	/** Get info about a channel */
	async getChannelInfo(channelId: string): Promise<ChannelInfo> {
		const result = await this.app.client.conversations.info({
			channel: channelId,
		})

		const channel = result.channel as {
			name?: string
			topic?: { value?: string }
			purpose?: { value?: string }
			num_members?: number
		}

		return {
			name: channel?.name,
			topic: channel?.topic?.value,
			purpose: channel?.purpose?.value,
			memberCount: channel?.num_members,
		}
	}

	/** Stop the app gracefully */
	async stop(): Promise<void> {
		if (this.running) {
			this.running = false
			await this.app.stop()
			console.log('[paw-slack] Bot stopped')
		}
	}
}
