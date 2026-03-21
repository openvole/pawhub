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

	// Resolve assets directory relative to the paw's own directory
	const assetsDir = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '..', 'assets')

	const MIME_TYPES: Record<string, string> = {
		'.png': 'image/png',
		'.jpg': 'image/jpeg',
		'.jpeg': 'image/jpeg',
		'.ico': 'image/x-icon',
		'.svg': 'image/svg+xml',
	}

	// HTTP server — serves the dashboard HTML and static assets
	const httpServer = http.createServer((req, res) => {
		// Serve favicon
		if (req.url === '/favicon.ico') {
			try {
				const icon = fs.readFileSync(path.join(assetsDir, 'vole.ico'))
				res.writeHead(200, {
					'Content-Type': 'image/x-icon',
					'Cache-Control': 'public, max-age=86400',
				})
				res.end(icon)
			} catch {
				res.writeHead(404)
				res.end()
			}
			return
		}

		// Serve static assets from /assets/*
		if (req.url?.startsWith('/assets/')) {
			const fileName = path.basename(req.url)
			const filePath = path.resolve(assetsDir, fileName)
			// Prevent path traversal
			if (!filePath.startsWith(assetsDir)) {
				res.writeHead(403)
				res.end()
				return
			}
			try {
				const file = fs.readFileSync(filePath)
				const ext = path.extname(fileName).toLowerCase()
				res.writeHead(200, {
					'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
					'Cache-Control': 'public, max-age=86400',
					'X-Content-Type-Options': 'nosniff',
				})
				res.end(file)
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
