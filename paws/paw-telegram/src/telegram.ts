import { Bot } from 'grammy'

const TELEGRAM_MAX_LENGTH = 4096

export interface IncomingMessage {
	chatId: number
	messageId: number
	text: string
	from: string
	isGroup: boolean
	threadId?: number
}

export interface ChatInfo {
	title: string | undefined
	type: string
	memberCount: number | undefined
}

type MessageCallback = (message: IncomingMessage) => void

/**
 * Split a long message into chunks that fit within Telegram's 4096-char limit.
 * Prefers splitting at newline boundaries when possible.
 */
function chunkMessage(text: string): string[] {
	if (text.length <= TELEGRAM_MAX_LENGTH) return [text]

	const chunks: string[] = []
	let remaining = text

	while (remaining.length > 0) {
		if (remaining.length <= TELEGRAM_MAX_LENGTH) {
			chunks.push(remaining)
			break
		}

		// Try to find a newline to split at within the limit
		const slice = remaining.substring(0, TELEGRAM_MAX_LENGTH)
		const lastNewline = slice.lastIndexOf('\n')

		let splitAt: number
		if (lastNewline > TELEGRAM_MAX_LENGTH * 0.3) {
			// Split at newline if it's not too early in the chunk
			splitAt = lastNewline + 1
		} else {
			// Fall back to hard split at the limit
			splitAt = TELEGRAM_MAX_LENGTH
		}

		chunks.push(remaining.substring(0, splitAt))
		remaining = remaining.substring(splitAt)
	}

	return chunks
}

export class TelegramClient {
	private bot: Bot
	private running = false

	constructor(token: string) {
		this.bot = new Bot(token)
	}

	/**
	 * Start long-polling and call the provided callback for each incoming text message.
	 * For group chats, only processes messages that mention the bot or reply to the bot.
	 */
	async start(onMessage: MessageCallback): Promise<void> {
		const botInfo = await this.bot.api.getMe()
		const botUsername = botInfo.username

		this.bot.on('message:text', (ctx) => {
			const msg = ctx.message
			const chat = ctx.chat
			const isGroup = chat.type === 'group' || chat.type === 'supergroup'

			// In group chats, only respond to messages that mention the bot or reply to the bot
			if (isGroup) {
				const mentionsBot =
					botUsername && msg.text.includes(`@${botUsername}`)
				const repliesToBot =
					msg.reply_to_message?.from?.id === botInfo.id

				if (!mentionsBot && !repliesToBot) return
			}

			const from =
				msg.from?.username ||
				[msg.from?.first_name, msg.from?.last_name]
					.filter(Boolean)
					.join(' ') ||
				'unknown'

			onMessage({
				chatId: chat.id,
				messageId: msg.message_id,
				text: msg.text,
				from,
				isGroup,
				threadId: msg.message_thread_id,
			})
		})

		this.running = true
		console.log('[paw-telegram] Bot connected, starting long-polling')

		// bot.start() blocks, so we don't await it — it runs until stop() is called
		this.bot.start({
			onStart: () => {
				console.log(`[paw-telegram] Polling started as @${botUsername}`)
			},
		})
	}

	/** Send a message to a chat, splitting into chunks if needed */
	async sendMessage(
		chatId: number | string,
		text: string,
		replyToMessageId?: number,
	): Promise<void> {
		const chunks = chunkMessage(text)

		for (let i = 0; i < chunks.length; i++) {
			await this.bot.api.sendMessage(Number(chatId), chunks[i], {
				// Only set reply_to on the first chunk
				...(i === 0 && replyToMessageId
					? { reply_parameters: { message_id: replyToMessageId } }
					: {}),
			})
		}
	}

	/** Send a message and return its message ID (for later editing) */
	async sendMessageAndGetId(
		chatId: number | string,
		text: string,
		replyToMessageId?: number,
	): Promise<number> {
		const msg = await this.bot.api.sendMessage(Number(chatId), text, {
			...(replyToMessageId
				? { reply_parameters: { message_id: replyToMessageId } }
				: {}),
		})
		return msg.message_id
	}

	/** Edit an existing message's text, splitting into chunks if needed */
	async editMessage(
		chatId: number | string,
		messageId: number,
		text: string,
	): Promise<void> {
		const chunks = chunkMessage(text)

		// Edit the original message with the first chunk
		await this.bot.api.editMessageText(Number(chatId), messageId, chunks[0])

		// Send remaining chunks as new messages
		for (let i = 1; i < chunks.length; i++) {
			await this.bot.api.sendMessage(Number(chatId), chunks[i])
		}
	}

	/** Get info about a chat */
	async getChatInfo(chatId: number | string): Promise<ChatInfo> {
		const chat = await this.bot.api.getChat(Number(chatId))

		let memberCount: number | undefined
		try {
			memberCount = await this.bot.api.getChatMemberCount(Number(chatId))
		} catch {
			// May fail for some chat types
		}

		return {
			title:
				'title' in chat
					? (chat.title as string)
					: 'first_name' in chat
						? (chat.first_name as string)
						: undefined,
			type: chat.type,
			memberCount,
		}
	}

	/** Stop the bot gracefully */
	stop(): void {
		if (this.running) {
			this.running = false
			this.bot.stop()
			console.log('[paw-telegram] Bot stopped')
		}
	}
}
