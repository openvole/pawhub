import { z, type PawDefinition } from '@openvole/paw-sdk'
import nodemailer, { type Transporter } from 'nodemailer'
import { ImapFlow } from 'imapflow'

let transporter: Transporter | undefined
let imapConfig: { host: string; port: number; auth: { user: string; pass: string } } | undefined

function getTransporter(): Transporter {
	if (!transporter) {
		throw new Error('SMTP transporter not initialized — paw not loaded')
	}
	return transporter
}

function getImapConfig() {
	if (!imapConfig) {
		throw new Error('IMAP config not initialized — paw not loaded')
	}
	return imapConfig
}

async function withImap<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
	const cfg = getImapConfig()
	const client = new ImapFlow({
		host: cfg.host,
		port: cfg.port,
		secure: cfg.port === 993,
		auth: cfg.auth,
		logger: false,
	})
	await client.connect()
	try {
		return await fn(client)
	} finally {
		await client.logout()
	}
}

export const paw: PawDefinition = {
	name: '@openvole/paw-email',
	version: '0.1.0',
	description: 'Paw for sending and reading emails via SMTP and IMAP',

	tools: [
		{
			name: 'email_send',
			description: 'Send an email via SMTP',
			parameters: z.object({
				to: z.string().describe('Recipient email address(es), comma-separated'),
				subject: z.string().describe('Email subject line'),
				body: z.string().describe('Email body (plain text)'),
				cc: z.string().optional().describe('CC recipients, comma-separated'),
				bcc: z.string().optional().describe('BCC recipients, comma-separated'),
			}),
			async execute(params: unknown) {
				const { to, subject, body, cc, bcc } = params as {
					to: string
					subject: string
					body: string
					cc?: string
					bcc?: string
				}
				try {
					const info = await getTransporter().sendMail({
						from: process.env.EMAIL_USER,
						to,
						subject,
						text: body,
						cc,
						bcc,
					})
					return { ok: true, messageId: info.messageId }
				} catch (err: any) {
					return { ok: false, error: err.message }
				}
			},
		},
		{
			name: 'email_search',
			description: 'Search emails in a mailbox folder',
			parameters: z.object({
				query: z.string().describe('Search query (applied to subject and from fields)'),
				folder: z.string().optional().describe('Mailbox folder to search (default: INBOX)'),
				limit: z.number().optional().describe('Maximum number of results (default: 20)'),
			}),
			async execute(params: unknown) {
				const { query, folder, limit } = params as {
					query: string
					folder?: string
					limit?: number
				}
				try {
					return await withImap(async (client) => {
						const mailbox = folder ?? 'INBOX'
						const lock = await client.getMailboxLock(mailbox)
						try {
							const maxResults = limit ?? 20
							const messages: any[] = []
							for await (const msg of client.fetch(
								{ or: [{ subject: query }, { from: query }] },
								{ envelope: true, uid: true },
							)) {
								messages.push({
									uid: msg.uid,
									subject: msg.envelope.subject,
									from: msg.envelope.from,
									date: msg.envelope.date,
								})
								if (messages.length >= maxResults) break
							}
							return { ok: true, folder: mailbox, count: messages.length, messages }
						} finally {
							lock.release()
						}
					})
				} catch (err: any) {
					return { ok: false, error: err.message }
				}
			},
		},
		{
			name: 'email_read',
			description: 'Read a specific email by its UID',
			parameters: z.object({
				uid: z.number().describe('The UID of the email message'),
				folder: z.string().optional().describe('Mailbox folder (default: INBOX)'),
			}),
			async execute(params: unknown) {
				const { uid, folder } = params as { uid: number; folder?: string }
				try {
					return await withImap(async (client) => {
						const mailbox = folder ?? 'INBOX'
						const lock = await client.getMailboxLock(mailbox)
						try {
							const msg = await client.fetchOne(
								String(uid),
								{ source: true, envelope: true, uid: true },
								{ uid: true },
							)
							const source = msg.source?.toString('utf-8') ?? ''
							return {
								ok: true,
								uid: msg.uid,
								subject: msg.envelope.subject,
								from: msg.envelope.from,
								to: msg.envelope.to,
								date: msg.envelope.date,
								body: source,
							}
						} finally {
							lock.release()
						}
					})
				} catch (err: any) {
					return { ok: false, error: err.message }
				}
			},
		},
		{
			name: 'email_list_folders',
			description: 'List available mailbox folders',
			parameters: z.object({}),
			async execute() {
				try {
					return await withImap(async (client) => {
						const folders: { name: string; path: string }[] = []
						for await (const folder of client.listTree()) {
							collectFolders(folder, folders)
						}
						return { ok: true, folders }
					})
				} catch (err: any) {
					return { ok: false, error: err.message }
				}
			},
		},
	],

	async onLoad() {
		const host = process.env.EMAIL_HOST
		const port = Number(process.env.EMAIL_PORT) || 587
		const user = process.env.EMAIL_USER
		const pass = process.env.EMAIL_PASS
		const imapHost = process.env.EMAIL_IMAP_HOST
		const imapPort = Number(process.env.EMAIL_IMAP_PORT) || 993

		if (!host || !user || !pass) {
			throw new Error(
				'[paw-email] Missing required env vars: EMAIL_HOST, EMAIL_USER, EMAIL_PASS',
			)
		}

		transporter = nodemailer.createTransport({
			host,
			port,
			secure: port === 465,
			auth: { user, pass },
		})

		imapConfig = {
			host: imapHost || host,
			port: imapPort,
			auth: { user, pass },
		}

		console.log(`[paw-email] loaded — SMTP: ${host}:${port}, IMAP: ${imapConfig.host}:${imapPort}`)
	},

	async onUnload() {
		if (transporter) {
			transporter.close()
			transporter = undefined
		}
		imapConfig = undefined
		console.log('[paw-email] unloaded')
	},
}

function collectFolders(
	node: any,
	result: { name: string; path: string }[],
) {
	result.push({ name: node.name, path: node.path })
	if (node.folders) {
		for (const child of node.folders) {
			collectFolders(child, result)
		}
	}
}
