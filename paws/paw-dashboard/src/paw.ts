import { createIpcTransport, type PawDefinition } from '@openvole/paw-sdk'
import { createDashboardServer, type DashboardServer } from './server.js'

const DEFAULT_PORT = 3000

let server: DashboardServer | undefined
let transport: ReturnType<typeof createIpcTransport> | undefined

/** Fetch full state from the core via IPC queries */
async function fetchFullState(): Promise<unknown> {
	if (!transport) return {}

	const [tools, paws, skills, tasks, schedules, volenet] = await Promise.all([
		transport.query('tools').catch(() => []),
		transport.query('paws').catch(() => []),
		transport.query('skills').catch(() => []),
		transport.query('tasks').catch(() => []),
		transport.query('schedules').catch(() => []),
		transport.query('volenet').catch(() => ({ enabled: false })),
	])

	return { tools, paws, skills, tasks, schedules, volenet }
}

/** Refresh state and broadcast to all clients (coalesced — at most one in-flight) */
let refreshInFlight = false
let refreshPending = false
async function refreshAndBroadcastState(): Promise<void> {
	if (refreshInFlight) {
		refreshPending = true
		return
	}
	refreshInFlight = true
	try {
		const state = await fetchFullState()
		server?.broadcast('state', state)
	} finally {
		refreshInFlight = false
		if (refreshPending) {
			refreshPending = false
			refreshAndBroadcastState()
		}
	}
}

export const paw: PawDefinition = {
	name: '@openvole/paw-dashboard',
	version: '0.1.0',
	description: 'Web dashboard for real-time agent monitoring',

	async onLoad() {
		const port = Number(process.env.VOLE_DASHBOARD_PORT) || DEFAULT_PORT
		transport = createIpcTransport()

		// Subscribe to all bus events for live streaming
		transport.subscribe([
			'tool:registered',
			'tool:unregistered',
			'paw:registered',
			'paw:unregistered',
			'paw:crashed',
			'task:queued',
			'task:started',
			'task:completed',
			'task:failed',
			'task:cancelled',
			'rate:limited',
		])

		// Forward bus events to WebSocket clients
		transport.onBusEvent((event, data) => {
			server?.broadcast('event', data, event)

			if (
				event.startsWith('tool:') ||
				event.startsWith('paw:') ||
				event.startsWith('task:')
			) {
				refreshAndBroadcastState()
			}
		})

		// Create the dashboard HTTP + WebSocket server
		server = createDashboardServer(port, async () => {
			return fetchFullState()
		})
	},

	async onUnload() {
		await server?.close()
		server = undefined
	},
}
