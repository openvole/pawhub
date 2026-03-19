import * as http from 'node:http'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import { getDashboardHtml } from './ui.js'

const logger = {
	info: (msg: string) => console.info(`[paw-dashboard] ${msg}`),
	error: (msg: string) => console.error(`[paw-dashboard] ${msg}`),
}

export interface DashboardServer {
	/** Broadcast a message to all connected WebSocket clients */
	broadcast(type: string, data: unknown, event?: string): void
	/** Shut down the server */
	close(): Promise<void>
}

export function createDashboardServer(
	port: number,
	onClientConnected: () => Promise<unknown>,
): DashboardServer {
	const clients = new Set<WebSocket>()

	// Resolve logo path relative to project root
	const logoPath = path.resolve(process.cwd(), 'assets', 'logo.jpg')

	// HTTP server — serves the dashboard HTML and static assets
	const httpServer = http.createServer((req, res) => {
		if (req.url === '/logo.jpg') {
			try {
				const logo = fs.readFileSync(logoPath)
				res.writeHead(200, {
					'Content-Type': 'image/jpeg',
					'Cache-Control': 'public, max-age=86400',
					'X-Content-Type-Options': 'nosniff',
				})
				res.end(logo)
			} catch {
				res.writeHead(404)
				res.end()
			}
			return
		}

		res.writeHead(200, {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-cache',
			'X-Content-Type-Options': 'nosniff',
			'X-Frame-Options': 'DENY',
		})
		res.end(getDashboardHtml(port))
	})

	// WebSocket server — real-time events
	const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

	wss.on('connection', async (ws) => {
		clients.add(ws)
		logger.info(`Client connected (${clients.size} total)`)

		ws.on('close', () => {
			clients.delete(ws)
			logger.info(`Client disconnected (${clients.size} total)`)
		})

		ws.on('error', (err) => {
			logger.error(`WebSocket error: ${err.message}`)
			clients.delete(ws)
		})

		// Send initial state snapshot on connect
		try {
			const state = await onClientConnected()
			ws.send(JSON.stringify({ type: 'state', data: state }))
		} catch (err) {
			logger.error(`Failed to send initial state: ${err}`)
		}
	})

	httpServer.listen(port, () => {
		logger.info(`Dashboard running at http://localhost:${port}`)
	})

	return {
		broadcast(type: string, data: unknown, event?: string) {
			const message = JSON.stringify(
				event ? { type, event, data } : { type, data },
			)
			for (const client of clients) {
				if (client.readyState === client.OPEN) {
					client.send(message)
				}
			}
		},

		async close() {
			for (const client of clients) {
				client.close()
			}
			clients.clear()
			wss.close()
			return new Promise<void>((resolve) => {
				httpServer.close(() => resolve())
			})
		},
	}
}
