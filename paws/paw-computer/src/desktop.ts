import { mouse, keyboard, screen, Button, Key, Point, Region } from '@nut-tree-fork/nut-js'
import { execSync } from 'node:child_process'
import { crc32 } from 'node:buffer'

const KEY_MAP: Record<string, Key> = {
	ctrl: Key.LeftControl,
	control: Key.LeftControl,
	alt: Key.LeftAlt,
	option: Key.LeftAlt,
	shift: Key.LeftShift,
	cmd: Key.LeftSuper,
	meta: Key.LeftSuper,
	super: Key.LeftSuper,
	command: Key.LeftSuper,
	tab: Key.Tab,
	enter: Key.Enter,
	return: Key.Enter,
	escape: Key.Escape,
	esc: Key.Escape,
	backspace: Key.Backspace,
	delete: Key.Delete,
	up: Key.Up,
	down: Key.Down,
	left: Key.Left,
	right: Key.Right,
	space: Key.Space,
	home: Key.Home,
	end: Key.End,
	pageup: Key.PageUp,
	pagedown: Key.PageDown,
	f1: Key.F1,
	f2: Key.F2,
	f3: Key.F3,
	f4: Key.F4,
	f5: Key.F5,
	f6: Key.F6,
	f7: Key.F7,
	f8: Key.F8,
	f9: Key.F9,
	f10: Key.F10,
	f11: Key.F11,
	f12: Key.F12,
	a: Key.A,
	b: Key.B,
	c: Key.C,
	d: Key.D,
	e: Key.E,
	f: Key.F,
	g: Key.G,
	h: Key.H,
	i: Key.I,
	j: Key.J,
	k: Key.K,
	l: Key.L,
	m: Key.M,
	n: Key.N,
	o: Key.O,
	p: Key.P,
	q: Key.Q,
	r: Key.R,
	s: Key.S,
	t: Key.T,
	u: Key.U,
	v: Key.V,
	w: Key.W,
	x: Key.X,
	y: Key.Y,
	z: Key.Z,
	'0': Key.Num0,
	'1': Key.Num1,
	'2': Key.Num2,
	'3': Key.Num3,
	'4': Key.Num4,
	'5': Key.Num5,
	'6': Key.Num6,
	'7': Key.Num7,
	'8': Key.Num8,
	'9': Key.Num9,
}

export class DesktopController {
	constructor() {
		const delayMs = parseInt(process.env.VOLE_COMPUTER_DELAY_MS || '100', 10)
		mouse.config.autoDelayMs = delayMs
		screen.config.confidence = 0.9
	}

	async screenshot(): Promise<{ width: number; height: number; base64: string }> {
		const image = await screen.grab()
		const width = await image.width
		const height = await image.height
		const raw = await image.toRGB()
		const png = await this.rgbToPngBase64(raw.data, width, height)
		return { width, height, base64: png }
	}

	async click(x: number, y: number): Promise<void> {
		await mouse.setPosition(new Point(x, y))
		await mouse.click(Button.LEFT)
	}

	async doubleClick(x: number, y: number): Promise<void> {
		await mouse.setPosition(new Point(x, y))
		await mouse.doubleClick(Button.LEFT)
	}

	async rightClick(x: number, y: number): Promise<void> {
		await mouse.setPosition(new Point(x, y))
		await mouse.click(Button.RIGHT)
	}

	async moveMouse(x: number, y: number): Promise<void> {
		await mouse.setPosition(new Point(x, y))
	}

	async type(text: string): Promise<void> {
		await keyboard.type(text)
	}

	async pressKey(keys: string): Promise<void> {
		const parts = keys.toLowerCase().split('+').map((k) => k.trim())
		const mapped: Key[] = []

		for (const part of parts) {
			const key = KEY_MAP[part]
			if (key === undefined) {
				throw new Error(`Unknown key: "${part}". Supported keys: ${Object.keys(KEY_MAP).join(', ')}`)
			}
			mapped.push(key)
		}

		if (mapped.length === 1) {
			await keyboard.pressKey(mapped[0])
			await keyboard.releaseKey(mapped[0])
		} else {
			// Press all modifier keys, then the last key, then release in reverse
			for (const key of mapped) {
				await keyboard.pressKey(key)
			}
			for (const key of mapped.reverse()) {
				await keyboard.releaseKey(key)
			}
		}
	}

	async scroll(x: number, y: number, direction: 'up' | 'down', amount: number): Promise<void> {
		await mouse.setPosition(new Point(x, y))
		const lines = amount || 3
		if (direction === 'up') {
			await mouse.scrollUp(lines)
		} else {
			await mouse.scrollDown(lines)
		}
	}

	async drag(fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
		await mouse.setPosition(new Point(fromX, fromY))
		await mouse.pressButton(Button.LEFT)
		await mouse.setPosition(new Point(toX, toY))
		await mouse.releaseButton(Button.LEFT)
	}

	async clipboardRead(): Promise<string> {
		const platform = process.platform
		if (platform === 'darwin') {
			return execSync('pbpaste', { encoding: 'utf-8' })
		} else if (platform === 'linux') {
			return execSync('xclip -selection clipboard -o', { encoding: 'utf-8' })
		} else if (platform === 'win32') {
			return execSync('powershell -command "Get-Clipboard"', { encoding: 'utf-8' })
		}
		throw new Error(`Clipboard read not supported on ${platform}`)
	}

	async clipboardWrite(text: string): Promise<void> {
		const platform = process.platform
		if (platform === 'darwin') {
			execSync('pbcopy', { input: text, encoding: 'utf-8' })
		} else if (platform === 'linux') {
			execSync('xclip -selection clipboard', { input: text, encoding: 'utf-8' })
		} else if (platform === 'win32') {
			execSync('powershell -command "Set-Clipboard"', { input: text, encoding: 'utf-8' })
		} else {
			throw new Error(`Clipboard write not supported on ${platform}`)
		}
	}

	/**
	 * Get the accessibility UI tree of the frontmost application.
	 * Returns structured text describing all interactive elements (buttons, fields, labels, menus)
	 * with their roles, titles, and positions — enabling the Brain to interact without screenshots.
	 */
	async getUITree(maxDepth = 5): Promise<string> {
		const platform = process.platform
		const { writeFileSync, unlinkSync } = await import('node:fs')
		const { tmpdir } = await import('node:os')
		const { join } = await import('node:path')

		if (platform === 'darwin') {
			const scriptPath = join(tmpdir(), `vole-uitree-${Date.now()}.scpt`)
			// Recursive traversal that preserves parent-child hierarchy via indentation
			const script = `
property elemCount : 0

tell application "System Events"
  set frontApp to first application process whose frontmost is true
  set appName to name of frontApp
  set output to "App: " & appName & linefeed
  try
    set frontWindow to first window of frontApp
    set winTitle to name of frontWindow
    set winPos to position of frontWindow
    set winSize to size of frontWindow
    set output to output & "Window: " & winTitle & " at (" & item 1 of winPos & "," & item 2 of winPos & " " & item 1 of winSize & "x" & item 2 of winSize & ")" & linefeed & linefeed
    set my elemCount to 0
    set output to output & my walkElement(frontWindow, 0, ${maxDepth})
  end try
  return output
end tell

on walkElement(el, depth, maxD)
  if depth > maxD then return ""
  if my elemCount > 200 then return ""
  set indent to ""
  repeat depth times
    set indent to indent & "  "
  end repeat
  set result to ""
  try
    set uiElems to UI elements of el
  on error
    return ""
  end try
  repeat with elem in uiElems
    if my elemCount > 200 then exit repeat
    try
      set r to role of elem
      set t to ""
      try
        set t to name of elem
      end try
      set d to ""
      try
        set d to description of elem
      end try
      set v to ""
      try
        set v to value of elem
      end try
      set pos to ""
      try
        set p to position of elem
        set s to size of elem
        set pos to " at (" & item 1 of p & "," & item 2 of p & " " & item 1 of s & "x" & item 2 of s & ")"
      end try
      set ln to indent & r
      if t is not "" then set ln to ln & " " & quote & t & quote
      if d is not "" and d is not t then set ln to ln & " (" & d & ")"
      if v is not "" then
        try
          if (length of (v as text)) < 100 then set ln to ln & " [" & v & "]"
        end try
      end if
      set ln to ln & pos
      set result to result & ln & linefeed
      set my elemCount to (my elemCount) + 1
      -- Recurse into children
      set result to result & my walkElement(elem, depth + 1, maxD)
    end try
  end repeat
  return result
end walkElement
`
			try {
				writeFileSync(scriptPath, script, 'utf-8')
				const result = execSync(`osascript ${scriptPath}`, {
					encoding: 'utf-8',
					timeout: 15000,
				}).trim()
				try { unlinkSync(scriptPath) } catch {}
				return result
			} catch (err) {
				try { unlinkSync(scriptPath) } catch {}
				throw new Error(`Failed to read UI tree: ${err instanceof Error ? err.message : String(err)}`)
			}
		} else if (platform === 'win32') {
			const psPath = join(tmpdir(), `vole-uitree-${Date.now()}.ps1`)
			// Recursive traversal with indented tree output
			const psScript = `
Add-Type -AssemblyName UIAutomationClient
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$script:count = 0

function Get-UITree($el, $depth, $maxDepth) {
  if ($depth -ge $maxDepth) { return }
  if ($script:count -ge 200) { return }
  $c = $walker.GetFirstChild($el)
  while ($c -ne $null) {
    if ($script:count -ge 200) { return }
    $n = $c.Current.Name
    $t = $c.Current.ControlType.ProgrammaticName -replace '^ControlType\\.', ''
    $r = $c.Current.BoundingRectangle
    $indent = "  " * $depth
    $line = "$indent$t"
    if ($n -ne "") { $line += " \`"$n\`"" }
    if (-not [System.Double]::IsInfinity($r.X)) {
      $line += " at ($([int]$r.X),$([int]$r.Y) $([int]$r.Width)x$([int]$r.Height))"
    }
    Write-Output $line
    $script:count++
    Get-UITree $c ($depth + 1) $maxDepth
    $c = $walker.GetNextSibling($c)
  }
}

$focused = [System.Windows.Automation.AutomationElement]::FocusedElement
$win = $focused
while ($win -ne $null -and $win.Current.ControlType -ne [System.Windows.Automation.ControlType]::Window) {
  $win = $walker.GetParent($win)
}
if ($win -ne $null) {
  $wr = $win.Current.BoundingRectangle
  Write-Output "Window: $($win.Current.Name) at ($([int]$wr.X),$([int]$wr.Y) $([int]$wr.Width)x$([int]$wr.Height))"
  Write-Output ""
  Get-UITree $win 0 ${maxDepth}
}
`
			try {
				writeFileSync(psPath, psScript, 'utf-8')
				const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}"`, {
					encoding: 'utf-8',
					timeout: 15000,
				}).trim()
				try { unlinkSync(psPath) } catch {}
				return result
			} catch (err) {
				try { unlinkSync(psPath) } catch {}
				throw new Error(`Failed to read UI tree: ${err instanceof Error ? err.message : String(err)}`)
			}
		} else if (platform === 'linux') {
			return 'Linux accessibility tree (AT-SPI) not implemented yet. Use computer_screenshot instead.'
		}

		throw new Error(`UI tree not supported on ${platform}`)
	}

	async getActiveWindow(): Promise<{ title: string; x: number; y: number; width: number; height: number }> {
		// nut-js v4 provides getActiveWindow via the @nut-tree-fork/nut-js package
		const { getActiveWindow } = await import('@nut-tree-fork/nut-js')
		const win = await getActiveWindow()
		const region = await win.region
		const title = await win.title
		return {
			title,
			x: region.left,
			y: region.top,
			width: region.width,
			height: region.height,
		}
	}

	private async rgbToPngBase64(rgbData: Buffer | Uint8Array, width: number, height: number): Promise<string> {
		// Minimal PNG encoder — write uncompressed PNG from RGB data
		// We use Node's zlib to deflate the raw RGBA scanlines
		const { deflateSync } = await import('node:zlib')

		// Build RGBA scanlines with filter byte (0 = None) prepended
		const rowBytes = width * 4 + 1
		const rawData = Buffer.alloc(height * rowBytes)
		for (let y = 0; y < height; y++) {
			rawData[y * rowBytes] = 0 // filter: None
			for (let x = 0; x < width; x++) {
				const srcIdx = (y * width + x) * 3
				const dstIdx = y * rowBytes + 1 + x * 4
				rawData[dstIdx] = rgbData[srcIdx] // R
				rawData[dstIdx + 1] = rgbData[srcIdx + 1] // G
				rawData[dstIdx + 2] = rgbData[srcIdx + 2] // B
				rawData[dstIdx + 3] = 255 // A
			}
		}

		const compressed = deflateSync(rawData)

		// Build PNG file
		const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

		const ihdr = Buffer.alloc(13)
		ihdr.writeUInt32BE(width, 0)
		ihdr.writeUInt32BE(height, 4)
		ihdr[8] = 8 // bit depth
		ihdr[9] = 6 // color type: RGBA
		ihdr[10] = 0 // compression
		ihdr[11] = 0 // filter
		ihdr[12] = 0 // interlace

		const ihdrChunk = this.pngChunk('IHDR', ihdr)
		const idatChunk = this.pngChunk('IDAT', compressed)
		const iendChunk = this.pngChunk('IEND', Buffer.alloc(0))

		const png = Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk])
		return png.toString('base64')
	}

	private pngChunk(type: string, data: Buffer): Buffer {
		// crc32 imported at top level from node:buffer
		const length = Buffer.alloc(4)
		length.writeUInt32BE(data.length, 0)
		const typeBuffer = Buffer.from(type, 'ascii')
		const typeAndData = Buffer.concat([typeBuffer, data])

		// CRC32 over type + data
		const crcVal = this.crc32(typeAndData)
		const crcBuf = Buffer.alloc(4)
		crcBuf.writeUInt32BE(crcVal >>> 0, 0)

		return Buffer.concat([length, typeAndData, crcBuf])
	}

	private crc32(buf: Buffer): number {
		// Standard CRC32 implementation
		let crc = 0xffffffff
		for (let i = 0; i < buf.length; i++) {
			crc ^= buf[i]
			for (let j = 0; j < 8; j++) {
				if (crc & 1) {
					crc = (crc >>> 1) ^ 0xedb88320
				} else {
					crc = crc >>> 1
				}
			}
		}
		return (crc ^ 0xffffffff) >>> 0
	}
}
