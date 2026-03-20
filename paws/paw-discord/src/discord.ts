import { Client, GatewayIntentBits, type Message, type TextChannel } from 'discord.js'

const DISCORD_MAX_LENGTH = 2000

export interface IncomingMessage {
	channelId: string
	messageId: string
	text: string
	from: string
	userId: string
	isGuild: boolean
}

export interface ChannelInfo {
	name: string | undefined
	topic: string | undefined
	type: string
	memberCount: number | undefined
}

type MessageCallback = (message: IncomingMessage) => void

/**
 * Split a long message into chunks that fit within Discord's 2000-char limit.
 * Prefers splitting at newline boundaries when possible.
 */
function chunkMessage(text: string): string[] {
	if (text.length <= DISCORD_MAX_LENGTH) return [text]

	const chunks: string[] = []
	let remaining = text

	while (remaining.length > 0) {
		if (remaining.length <= DISCORD_MAX_LENGTH) {
			chunks.push(remaining)
			break
		}

		const slice = remaining.substring(0, DISCORD_MAX_LENGTH)
		const lastNewline = slice.lastIndexOf('\n')

		let splitAt: number
		if (lastNewline > DISCORD_MAX_LENGTH * 0.3) {
			splitAt = lastNewline + 1
		} else {
			splitAt = DISCORD_MAX_LENGTH
		}

		chunks.push(remaining.substring(0, splitAt))
		remaining = remaining.substring(splitAt)
	}

	return chunks
}

export class DiscordClient {
	private client: Client
	private running = false

	constructor(token: string) {
		this.client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.MessageContent,
				GatewayIntentBits.DirectMessages,
			],
		})
		this.client.token = token
	}

	/**
	 * Start the Discord client and call the provided callback for each incoming message.
	 * In guild channels, only processes messages that mention the bot.
	 * In DMs, processes all messages.
	 */
	async start(onMessage: MessageCallback): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			this.client.once('ready', () => {
				this.running = true
				console.log(`[paw-discord] Bot connected as ${this.client.user?.tag}`)
				resolve()
			})

			this.client.on('messageCreate', (msg: Message) => {
				// Ignore bot messages
				if (msg.author.bot) return

				const isGuild = !!msg.guild

				// In guilds, only respond to messages that mention the bot
				if (isGuild) {
					const mentionsBot = this.client.user && msg.mentions.has(this.client.user)
					if (!mentionsBot) return
				}

				if (!msg.content) return

				onMessage({
					channelId: msg.channelId,
					messageId: msg.id,
					text: msg.content,
					from: msg.author.tag,
					userId: msg.author.id,
					isGuild,
				})
			})

			this.client.login().catch(reject)
		})
	}

	/** Send a message to a channel, splitting into chunks if needed */
	async sendMessage(
		channelId: string,
		text: string,
		replyToMessageId?: string,
	): Promise<void> {
		const channel = await this.client.channels.fetch(channelId)
		if (!channel || !('send' in channel)) {
			throw new Error(`Channel ${channelId} not found or not a text channel`)
		}

		const textChannel = channel as TextChannel
		const chunks = chunkMessage(text)

		for (let i = 0; i < chunks.length; i++) {
			if (i === 0 && replyToMessageId) {
				try {
					const replyMsg = await textChannel.messages.fetch(replyToMessageId)
					await replyMsg.reply(chunks[i])
				} catch {
					await textChannel.send(chunks[i])
				}
			} else {
				await textChannel.send(chunks[i])
			}
		}
	}

	/** Send a message and return its message ID (for later editing) */
	async sendMessageAndGetId(
		channelId: string,
		text: string,
		replyToMessageId?: string,
	): Promise<string> {
		const channel = await this.client.channels.fetch(channelId)
		if (!channel || !('send' in channel)) {
			throw new Error(`Channel ${channelId} not found or not a text channel`)
		}

		const textChannel = channel as TextChannel
		let sent: Message

		if (replyToMessageId) {
			try {
				const replyMsg = await textChannel.messages.fetch(replyToMessageId)
				sent = await replyMsg.reply(text)
			} catch {
				sent = await textChannel.send(text)
			}
		} else {
			sent = await textChannel.send(text)
		}

		return sent.id
	}

	/** Edit an existing message's text, splitting into chunks if needed */
	async editMessage(
		channelId: string,
		messageId: string,
		text: string,
	): Promise<void> {
		const channel = await this.client.channels.fetch(channelId)
		if (!channel || !('messages' in channel)) {
			throw new Error(`Channel ${channelId} not found or not a text channel`)
		}

		const textChannel = channel as TextChannel
		const chunks = chunkMessage(text)

		// Edit the original message with the first chunk
		const msg = await textChannel.messages.fetch(messageId)
		await msg.edit(chunks[0])

		// Send remaining chunks as new messages
		for (let i = 1; i < chunks.length; i++) {
			await textChannel.send(chunks[i])
		}
	}

	/** Get info about a channel */
	async getChannelInfo(channelId: string): Promise<ChannelInfo> {
		const channel = await this.client.channels.fetch(channelId)
		if (!channel) {
			throw new Error(`Channel ${channelId} not found`)
		}

		const textChannel = channel as TextChannel

		return {
			name: textChannel.name,
			topic: 'topic' in textChannel ? textChannel.topic ?? undefined : undefined,
			type: channel.type.toString(),
			memberCount: textChannel.guild?.memberCount,
		}
	}

	/** Stop the client gracefully */
	async stop(): Promise<void> {
		if (this.running) {
			this.running = false
			await this.client.destroy()
			console.log('[paw-discord] Bot stopped')
		}
	}
}
