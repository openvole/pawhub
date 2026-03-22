import { z, type PawDefinition } from '@openvole/paw-sdk'
import { google, type calendar_v3 } from 'googleapis'

let calendar: calendar_v3.Calendar | undefined
let calendarId: string = 'primary'

function getCalendar(): calendar_v3.Calendar {
	if (!calendar) {
		throw new Error('GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN not set — paw-calendar is not configured')
	}
	return calendar
}

export const paw: PawDefinition = {
	name: '@openvole/paw-calendar',
	version: '0.1.0',
	description: 'Paw for managing Google Calendar events',

	tools: [
		{
			name: 'calendar_list_events',
			description: 'List upcoming events from Google Calendar',
			parameters: z.object({
				days: z
					.number()
					.optional()
					.describe('Number of days ahead to look (default: 7)'),
				maxResults: z
					.number()
					.optional()
					.describe('Maximum number of events to return (default: 25)'),
			}),
			async execute(params: unknown) {
				const { days, maxResults } = params as {
					days?: number
					maxResults?: number
				}
				try {
					const now = new Date()
					const until = new Date(now)
					until.setDate(until.getDate() + (days ?? 7))

					const { data } = await getCalendar().events.list({
						calendarId,
						timeMin: now.toISOString(),
						timeMax: until.toISOString(),
						maxResults: maxResults ?? 25,
						singleEvents: true,
						orderBy: 'startTime',
					})

					const events = (data.items ?? []).map((ev) => ({
						id: ev.id,
						summary: ev.summary,
						start: ev.start?.dateTime ?? ev.start?.date,
						end: ev.end?.dateTime ?? ev.end?.date,
						location: ev.location,
						description: ev.description,
						status: ev.status,
					}))

					return { ok: true, count: events.length, events }
				} catch (err: any) {
					return { ok: false, error: err.message }
				}
			},
		},
		{
			name: 'calendar_create_event',
			description: 'Create a new event on Google Calendar',
			parameters: z.object({
				summary: z.string().describe('Event title'),
				start: z
					.string()
					.describe('Start time in ISO 8601 format (e.g. 2025-01-15T09:00:00-05:00)'),
				end: z
					.string()
					.describe('End time in ISO 8601 format (e.g. 2025-01-15T10:00:00-05:00)'),
				description: z.string().optional().describe('Event description'),
				location: z.string().optional().describe('Event location'),
			}),
			async execute(params: unknown) {
				const { summary, start, end, description, location } = params as {
					summary: string
					start: string
					end: string
					description?: string
					location?: string
				}
				try {
					const { data } = await getCalendar().events.insert({
						calendarId,
						requestBody: {
							summary,
							description,
							location,
							start: { dateTime: start },
							end: { dateTime: end },
						},
					})
					return {
						ok: true,
						id: data.id,
						summary: data.summary,
						start: data.start?.dateTime,
						end: data.end?.dateTime,
						url: data.htmlLink,
					}
				} catch (err: any) {
					return { ok: false, error: err.message }
				}
			},
		},
		{
			name: 'calendar_update_event',
			description: 'Update an existing event on Google Calendar',
			parameters: z.object({
				eventId: z.string().describe('The event ID to update'),
				summary: z.string().optional().describe('New event title'),
				start: z.string().optional().describe('New start time in ISO 8601 format'),
				end: z.string().optional().describe('New end time in ISO 8601 format'),
			}),
			async execute(params: unknown) {
				const { eventId, summary, start, end } = params as {
					eventId: string
					summary?: string
					start?: string
					end?: string
				}
				try {
					const requestBody: calendar_v3.Schema$Event = {}
					if (summary !== undefined) requestBody.summary = summary
					if (start !== undefined) requestBody.start = { dateTime: start }
					if (end !== undefined) requestBody.end = { dateTime: end }

					const { data } = await getCalendar().events.patch({
						calendarId,
						eventId,
						requestBody,
					})
					return {
						ok: true,
						id: data.id,
						summary: data.summary,
						start: data.start?.dateTime,
						end: data.end?.dateTime,
					}
				} catch (err: any) {
					return { ok: false, error: err.message }
				}
			},
		},
		{
			name: 'calendar_delete_event',
			description: 'Delete an event from Google Calendar',
			parameters: z.object({
				eventId: z.string().describe('The event ID to delete'),
			}),
			async execute(params: unknown) {
				const { eventId } = params as { eventId: string }
				try {
					await getCalendar().events.delete({
						calendarId,
						eventId,
					})
					return { ok: true, deleted: eventId }
				} catch (err: any) {
					return { ok: false, error: err.message }
				}
			},
		},
	],

	async onLoad() {
		const clientId = process.env.GOOGLE_CLIENT_ID
		const clientSecret = process.env.GOOGLE_CLIENT_SECRET
		const refreshToken = process.env.GOOGLE_REFRESH_TOKEN

		if (!clientId || !clientSecret || !refreshToken) {
			const missing: string[] = []
			if (!clientId) missing.push('GOOGLE_CLIENT_ID')
			if (!clientSecret) missing.push('GOOGLE_CLIENT_SECRET')
			if (!refreshToken) missing.push('GOOGLE_REFRESH_TOKEN')
			console.log(`[paw-calendar] ${missing.join(', ')} not set — paw will not function`)
			return
		}

		calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary'

		const oauth2Client = new google.auth.OAuth2(clientId, clientSecret)
		oauth2Client.setCredentials({ refresh_token: refreshToken })

		calendar = google.calendar({ version: 'v3', auth: oauth2Client })
		console.log(`[paw-calendar] loaded — calendar: ${calendarId}`)
	},

	async onUnload() {
		calendar = undefined
		console.log('[paw-calendar] unloaded')
	},
}
