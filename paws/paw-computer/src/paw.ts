import { z, type PawDefinition } from '@openvole/paw-sdk'
import { DesktopController } from './desktop.js'

let desktop: DesktopController | undefined

function getDesktop(): DesktopController {
	if (!desktop) {
		throw new Error('Desktop controller not initialized. The paw has not been loaded yet.')
	}
	return desktop
}

export const paw: PawDefinition = {
	name: '@openvole/paw-computer',
	version: '1.0.0',
	description: 'Desktop automation — control mouse, keyboard, and screen capture',

	tools: [
		{
			name: 'computer_screenshot',
			description:
				'Capture the screen and return as base64 PNG with screen dimensions and active window info. Use a vision-capable Brain model to analyze the screenshot, or use computer_click at known coordinates.',
			parameters: z.object({
				region: z
					.object({
						x: z.number().describe('Left coordinate of the capture region'),
						y: z.number().describe('Top coordinate of the capture region'),
						width: z.number().describe('Width of the capture region'),
						height: z.number().describe('Height of the capture region'),
					})
					.optional()
					.describe('Optional region to capture. If omitted, captures the full screen.'),
			}),
			async execute(params: unknown) {
				const { region } = params as {
					region?: { x: number; y: number; width: number; height: number }
				}
				const d = getDesktop()
				const shot = await d.screenshot()
				let activeWindow: { title: string; x: number; y: number; width: number; height: number } | null = null
				try {
					activeWindow = await d.getActiveWindow()
				} catch {
					// Active window info may not be available on all platforms
				}
				return {
					width: shot.width,
					height: shot.height,
					image_base64: shot.base64,
					active_window: activeWindow,
				}
			},
		},
		{
			name: 'computer_click',
			description: 'Click at screen coordinates (x, y). Defaults to left click.',
			parameters: z.object({
				x: z.number().describe('X coordinate to click'),
				y: z.number().describe('Y coordinate to click'),
				button: z
					.enum(['left', 'right'])
					.default('left')
					.describe('Mouse button to click (default: left)'),
			}),
			async execute(params: unknown) {
				const { x, y, button } = params as { x: number; y: number; button: 'left' | 'right' }
				const d = getDesktop()
				if (button === 'right') {
					await d.rightClick(x, y)
				} else {
					await d.click(x, y)
				}
				return { ok: true, clicked: { x, y } }
			},
		},
		{
			name: 'computer_double_click',
			description: 'Double click at screen coordinates (x, y).',
			parameters: z.object({
				x: z.number().describe('X coordinate to double click'),
				y: z.number().describe('Y coordinate to double click'),
			}),
			async execute(params: unknown) {
				const { x, y } = params as { x: number; y: number }
				await getDesktop().doubleClick(x, y)
				return { ok: true }
			},
		},
		{
			name: 'computer_type',
			description: 'Type text at the current cursor position.',
			parameters: z.object({
				text: z.string().describe('Text to type'),
			}),
			async execute(params: unknown) {
				const { text } = params as { text: string }
				await getDesktop().type(text)
				return { ok: true, typed: text }
			},
		},
		{
			name: 'computer_key',
			description:
				'Press a key combination. Examples: "ctrl+c", "cmd+tab", "enter", "alt+f4", "shift+ctrl+s".',
			parameters: z.object({
				keys: z.string().describe('Key combination to press (e.g. "ctrl+c", "cmd+tab", "enter")'),
			}),
			async execute(params: unknown) {
				const { keys } = params as { keys: string }
				await getDesktop().pressKey(keys)
				return { ok: true, pressed: keys }
			},
		},
		{
			name: 'computer_mouse_move',
			description: 'Move the mouse cursor to coordinates without clicking.',
			parameters: z.object({
				x: z.number().describe('X coordinate to move to'),
				y: z.number().describe('Y coordinate to move to'),
			}),
			async execute(params: unknown) {
				const { x, y } = params as { x: number; y: number }
				await getDesktop().moveMouse(x, y)
				return { ok: true, position: { x, y } }
			},
		},
		{
			name: 'computer_scroll',
			description: 'Scroll up or down at a screen position.',
			parameters: z.object({
				x: z.number().describe('X coordinate to scroll at'),
				y: z.number().describe('Y coordinate to scroll at'),
				direction: z.enum(['up', 'down']).describe('Scroll direction'),
				amount: z.number().default(3).describe('Number of scroll lines (default: 3)'),
			}),
			async execute(params: unknown) {
				const { x, y, direction, amount } = params as {
					x: number
					y: number
					direction: 'up' | 'down'
					amount: number
				}
				await getDesktop().scroll(x, y, direction, amount)
				return { ok: true }
			},
		},
		{
			name: 'computer_drag',
			description: 'Drag from one screen position to another.',
			parameters: z.object({
				from_x: z.number().describe('Starting X coordinate'),
				from_y: z.number().describe('Starting Y coordinate'),
				to_x: z.number().describe('Ending X coordinate'),
				to_y: z.number().describe('Ending Y coordinate'),
			}),
			async execute(params: unknown) {
				const { from_x, from_y, to_x, to_y } = params as {
					from_x: number
					from_y: number
					to_x: number
					to_y: number
				}
				await getDesktop().drag(from_x, from_y, to_x, to_y)
				return { ok: true }
			},
		},
		{
			name: 'computer_active_window',
			description: 'Get the title and bounds of the currently active window.',
			parameters: z.object({}),
			async execute() {
				const win = await getDesktop().getActiveWindow()
				return win
			},
		},
		{
			name: 'computer_clipboard_read',
			description: 'Read the current clipboard content as text. To read content from any app on screen: first use computer_key with cmd+a to select all, then cmd+c to copy, then call this tool to get the text.',
			parameters: z.object({}),
			async execute() {
				try {
					const text = await getDesktop().clipboardRead()
					return { ok: true, text }
				} catch (err) {
					return { ok: false, error: err instanceof Error ? err.message : String(err) }
				}
			},
		},
		{
			name: 'computer_clipboard_write',
			description: 'Write text to the clipboard. Use computer_key with cmd+v/ctrl+v afterwards to paste into the active application.',
			parameters: z.object({
				text: z.string().describe('Text to write to the clipboard'),
			}),
			async execute(params) {
				const { text } = params as { text: string }
				try {
					await getDesktop().clipboardWrite(text)
					return { ok: true }
				} catch (err) {
					return { ok: false, error: err instanceof Error ? err.message : String(err) }
				}
			},
		},
	],

	async onLoad() {
		const platform = process.platform

		if (platform === 'darwin') {
			console.log(
				'[paw-computer] macOS detected — grant Accessibility and Screen Recording permissions to the terminal app in System Settings > Privacy & Security'
			)
		} else if (platform === 'linux') {
			console.log(
				'[paw-computer] Linux detected — X11 is required. Wayland has limited support for screen capture and input simulation.'
			)
		} else if (platform === 'win32') {
			console.log('[paw-computer] Windows detected — desktop automation should work out of the box.')
		}

		try {
			desktop = new DesktopController()
			console.log('[paw-computer] loaded — desktop controller initialized')
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			console.error(`[paw-computer] failed to initialize desktop controller: ${message}`)
			if (platform === 'darwin' && message.includes('permission')) {
				console.error(
					'[paw-computer] Tip: Open System Settings > Privacy & Security > Accessibility and add your terminal app.'
				)
			}
			throw err
		}
	},

	async onUnload() {
		desktop = undefined
		console.log('[paw-computer] unloaded — desktop controller released')
	},
}
