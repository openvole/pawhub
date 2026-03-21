import { z, type PawDefinition } from '@openvole/paw-sdk'
import { Resend } from 'resend'

let client: Resend | undefined
let defaultFrom: string | undefined

export const paw: PawDefinition = {
	name: '@openvole/paw-resend',
	version: '0.1.0',
	description: 'Email sending powered by Resend',

	tools: [
		{
			name: 'resend_send',
			description: 'Send a plain text email via Resend',
			parameters: z.object({
				to: z.string().describe('Recipient email address (or comma-separated for multiple)'),
				subject: z.string().describe('Email subject line'),
				text: z.string().describe('Plain text email body'),
				from: z.string().optional().describe('Sender email (defaults to RESEND_FROM env var)'),
				cc: z.string().optional().describe('CC recipients (comma-separated)'),
				bcc: z.string().optional().describe('BCC recipients (comma-separated)'),
				replyTo: z.string().optional().describe('Reply-to email address'),
			}),
			async execute(params) {
				const p = params as {
					to: string; subject: string; text: string
					from?: string; cc?: string; bcc?: string; replyTo?: string
				}
				if (!client) throw new Error('Resend client not initialized')

				try {
					const result = await client.emails.send({
						from: p.from ?? defaultFrom ?? 'onboarding@resend.dev',
						to: p.to.split(',').map((s) => s.trim()),
						subject: p.subject,
						text: p.text,
						cc: p.cc ? p.cc.split(',').map((s) => s.trim()) : undefined,
						bcc: p.bcc ? p.bcc.split(',').map((s) => s.trim()) : undefined,
						replyTo: p.replyTo,
					})
					return { ok: true, id: result.data?.id }
				} catch (err) {
					return { ok: false, error: err instanceof Error ? err.message : String(err) }
				}
			},
		},
		{
			name: 'resend_send_html',
			description: 'Send an HTML email via Resend',
			parameters: z.object({
				to: z.string().describe('Recipient email address (or comma-separated)'),
				subject: z.string().describe('Email subject line'),
				html: z.string().describe('HTML email body'),
				text: z.string().optional().describe('Plain text fallback'),
				from: z.string().optional().describe('Sender email (defaults to RESEND_FROM)'),
				replyTo: z.string().optional().describe('Reply-to email address'),
			}),
			async execute(params) {
				const p = params as {
					to: string; subject: string; html: string
					text?: string; from?: string; replyTo?: string
				}
				if (!client) throw new Error('Resend client not initialized')

				try {
					const result = await client.emails.send({
						from: p.from ?? defaultFrom ?? 'onboarding@resend.dev',
						to: p.to.split(',').map((s) => s.trim()),
						subject: p.subject,
						html: p.html,
						text: p.text,
						replyTo: p.replyTo,
					})
					return { ok: true, id: result.data?.id }
				} catch (err) {
					return { ok: false, error: err instanceof Error ? err.message : String(err) }
				}
			},
		},
		{
			name: 'resend_batch',
			description: 'Send multiple emails in a single batch via Resend',
			parameters: z.object({
				emails: z.array(z.object({
					to: z.string().describe('Recipient'),
					subject: z.string().describe('Subject'),
					text: z.string().optional().describe('Plain text body'),
					html: z.string().optional().describe('HTML body'),
				})).describe('Array of emails to send'),
			}),
			async execute(params) {
				const { emails } = params as {
					emails: Array<{ to: string; subject: string; text?: string; html?: string }>
				}
				if (!client) throw new Error('Resend client not initialized')

				try {
					const result = await client.batch.send(
						emails.map((e) => ({
							from: defaultFrom ?? 'onboarding@resend.dev',
							to: e.to.split(',').map((s) => s.trim()),
							subject: e.subject,
							text: e.text,
							html: e.html,
						})),
					)
					return { ok: true, count: emails.length, ids: result.data?.data?.map((d) => d.id) }
				} catch (err) {
					return { ok: false, error: err instanceof Error ? err.message : String(err) }
				}
			},
		},
	],

	async onLoad() {
		const apiKey = process.env.RESEND_API_KEY
		if (!apiKey) {
			console.error('[paw-resend] RESEND_API_KEY not set — emails will not send')
			return
		}

		client = new Resend(apiKey)
		defaultFrom = process.env.RESEND_FROM
		console.log(`[paw-resend] loaded — from: ${defaultFrom ?? 'onboarding@resend.dev'}`)
	},

	async onUnload() {
		client = undefined
		console.log('[paw-resend] unloaded')
	},
}
