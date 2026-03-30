import { z, type PawDefinition } from '@openvole/paw-sdk'

async function getSharp() {
	const sharp = await import('sharp')
	return sharp.default
}

export const paw: PawDefinition = {
	name: '@openvole/paw-image',
	version: '1.0.0',
	description: 'Resize, crop, watermark, compress, and convert images',

	tools: [
		{
			name: 'image_info',
			description: 'Get image metadata: dimensions, format, file size, color space.',
			parameters: z.object({
				path: z.string().describe('Path to the image file'),
			}),
			async execute(params) {
				const { path } = params as { path: string }
				const sharp = await getSharp()
				const { stat } = await import('node:fs/promises')
				const meta = await sharp(path).metadata()
				const fileStat = await stat(path)
				return {
					ok: true,
					width: meta.width,
					height: meta.height,
					format: meta.format,
					channels: meta.channels,
					space: meta.space,
					hasAlpha: meta.hasAlpha,
					fileSize: fileStat.size,
				}
			},
		},
		{
			name: 'image_resize',
			description: 'Resize an image to specified dimensions. Maintains aspect ratio by default.',
			parameters: z.object({
				path: z.string().describe('Path to the input image'),
				output: z.string().describe('Path for the output image'),
				width: z.number().optional().describe('Target width in pixels'),
				height: z.number().optional().describe('Target height in pixels'),
				fit: z.enum(['cover', 'contain', 'fill', 'inside', 'outside']).optional().describe('Resize fit mode (default: inside)'),
			}),
			async execute(params) {
				const { path, output, width, height, fit } = params as {
					path: string; output: string; width?: number; height?: number; fit?: string
				}
				if (!width && !height) return { ok: false, error: 'At least one of width or height is required' }
				const sharp = await getSharp()
				await sharp(path)
					.resize(width, height, { fit: (fit ?? 'inside') as any })
					.toFile(output)
				const meta = await sharp(output).metadata()
				return { ok: true, output, width: meta.width, height: meta.height }
			},
		},
		{
			name: 'image_crop',
			description: 'Crop a region from an image.',
			parameters: z.object({
				path: z.string().describe('Path to the input image'),
				output: z.string().describe('Path for the output image'),
				left: z.number().describe('Left offset in pixels'),
				top: z.number().describe('Top offset in pixels'),
				width: z.number().describe('Crop width in pixels'),
				height: z.number().describe('Crop height in pixels'),
			}),
			async execute(params) {
				const { path, output, left, top, width, height } = params as {
					path: string; output: string; left: number; top: number; width: number; height: number
				}
				const sharp = await getSharp()
				await sharp(path).extract({ left, top, width, height }).toFile(output)
				return { ok: true, output, width, height }
			},
		},
		{
			name: 'image_compress',
			description: 'Compress an image to reduce file size. Supports JPEG quality and PNG compression.',
			parameters: z.object({
				path: z.string().describe('Path to the input image'),
				output: z.string().describe('Path for the output image'),
				quality: z.number().optional().describe('Quality (1-100, default: 80). Lower = smaller file.'),
			}),
			async execute(params) {
				const { path, output, quality } = params as { path: string; output: string; quality?: number }
				const sharp = await getSharp()
				const q = quality ?? 80
				const meta = await sharp(path).metadata()

				let pipeline = sharp(path)
				if (meta.format === 'jpeg' || meta.format === 'jpg') {
					pipeline = pipeline.jpeg({ quality: q })
				} else if (meta.format === 'png') {
					pipeline = pipeline.png({ quality: q })
				} else if (meta.format === 'webp') {
					pipeline = pipeline.webp({ quality: q })
				} else {
					pipeline = pipeline.jpeg({ quality: q })
				}

				await pipeline.toFile(output)
				const { stat } = await import('node:fs/promises')
				const [originalSize, compressedSize] = await Promise.all([stat(path), stat(output)])
				const savings = Math.round((1 - compressedSize.size / originalSize.size) * 100)

				return { ok: true, output, originalSize: originalSize.size, compressedSize: compressedSize.size, savings: `${savings}%` }
			},
		},
		{
			name: 'image_convert',
			description: 'Convert an image to a different format (png, jpeg, webp, avif, tiff).',
			parameters: z.object({
				path: z.string().describe('Path to the input image'),
				output: z.string().describe('Path for the output image (extension determines format)'),
				format: z.enum(['png', 'jpeg', 'webp', 'avif', 'tiff']).optional().describe('Target format. If omitted, inferred from output extension.'),
			}),
			async execute(params) {
				const { path, output, format } = params as { path: string; output: string; format?: string }
				const sharp = await getSharp()
				const ext = format ?? output.split('.').pop()?.toLowerCase()

				let pipeline = sharp(path)
				switch (ext) {
					case 'png': pipeline = pipeline.png(); break
					case 'jpeg': case 'jpg': pipeline = pipeline.jpeg(); break
					case 'webp': pipeline = pipeline.webp(); break
					case 'avif': pipeline = pipeline.avif(); break
					case 'tiff': case 'tif': pipeline = pipeline.tiff(); break
					default: return { ok: false, error: `Unsupported format: ${ext}` }
				}

				await pipeline.toFile(output)
				return { ok: true, output, format: ext }
			},
		},
		{
			name: 'image_watermark',
			description: 'Add a text watermark to an image.',
			parameters: z.object({
				path: z.string().describe('Path to the input image'),
				output: z.string().describe('Path for the output image'),
				text: z.string().describe('Watermark text'),
				position: z.enum(['center', 'bottom-right', 'bottom-left', 'top-right', 'top-left']).optional().describe('Watermark position (default: bottom-right)'),
				opacity: z.number().optional().describe('Watermark opacity (0-1, default: 0.5)'),
			}),
			async execute(params) {
				const { path, output, text, position, opacity } = params as {
					path: string; output: string; text: string; position?: string; opacity?: number
				}
				const sharp = await getSharp()
				const meta = await sharp(path).metadata()
				const w = meta.width ?? 800
				const h = meta.height ?? 600
				const op = Math.round((opacity ?? 0.5) * 255)

				const fontSize = Math.max(16, Math.round(w / 30))
				const svg = `<svg width="${w}" height="${h}">
					<text x="${getX(position ?? 'bottom-right', w, fontSize)}" y="${getY(position ?? 'bottom-right', h, fontSize)}"
						font-size="${fontSize}" fill="rgba(255,255,255,${op / 255})"
						font-family="Arial, sans-serif" text-anchor="${getAnchor(position ?? 'bottom-right')}">
						${escapeXml(text)}
					</text>
				</svg>`

				await sharp(path)
					.composite([{ input: Buffer.from(svg), gravity: 'southeast' }])
					.toFile(output)

				return { ok: true, output }
			},
		},
	],

	async onLoad() {
		try {
			await getSharp()
			console.log('[paw-image] loaded — sharp available')
		} catch (err) {
			console.error(`[paw-image] sharp not available: ${err instanceof Error ? err.message : String(err)}`)
		}
	},
	async onUnload() {
		console.log('[paw-image] unloaded')
	},
}

function getX(pos: string, w: number, fontSize: number): number {
	if (pos.includes('left')) return fontSize
	if (pos.includes('right')) return w - fontSize
	return w / 2
}
function getY(pos: string, h: number, fontSize: number): number {
	if (pos.includes('top')) return fontSize * 2
	if (pos.includes('bottom')) return h - fontSize
	return h / 2
}
function getAnchor(pos: string): string {
	if (pos.includes('left')) return 'start'
	if (pos.includes('right')) return 'end'
	return 'middle'
}
function escapeXml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
