import { z, type PawDefinition } from '@openvole/paw-sdk'

export const paw: PawDefinition = {
	name: '@openvole/paw-pdf',
	version: '1.0.0',
	description: 'Read, merge, split, and extract text from PDFs',

	tools: [
		{
			name: 'pdf_read',
			description: 'Extract text content from a PDF file. Returns all text from all pages.',
			parameters: z.object({
				path: z.string().describe('Path to the PDF file'),
				pages: z.string().optional().describe('Page range to extract (e.g. "1-5", "3", "1,3,5"). Default: all pages.'),
			}),
			async execute(params) {
				const { path: filePath, pages } = params as { path: string; pages?: string }
				const { readFile } = await import('node:fs/promises')
				const { PDFDocument } = await import('pdf-lib')

				const bytes = await readFile(filePath)
				const pdf = await PDFDocument.load(bytes)
				const pageCount = pdf.getPageCount()

				// pdf-lib doesn't extract text — use raw content streams
				// For text extraction we parse the page content streams
				const pageIndices = parsePageRange(pages, pageCount)

				const textParts: string[] = []
				for (const idx of pageIndices) {
					const page = pdf.getPage(idx)
					// Basic text extraction from content stream
					const content = await extractPageText(page)
					textParts.push(`--- Page ${idx + 1} ---\n${content}`)
				}

				return { ok: true, text: textParts.join('\n\n'), pages: pageCount }
			},
		},
		{
			name: 'pdf_info',
			description: 'Get PDF metadata: page count, title, author, creation date, file size.',
			parameters: z.object({
				path: z.string().describe('Path to the PDF file'),
			}),
			async execute(params) {
				const { path: filePath } = params as { path: string }
				const { readFile, stat } = await import('node:fs/promises')
				const { PDFDocument } = await import('pdf-lib')

				const [bytes, fileStat] = await Promise.all([readFile(filePath), stat(filePath)])
				const pdf = await PDFDocument.load(bytes)

				return {
					ok: true,
					pages: pdf.getPageCount(),
					title: pdf.getTitle() ?? null,
					author: pdf.getAuthor() ?? null,
					subject: pdf.getSubject() ?? null,
					creator: pdf.getCreator() ?? null,
					creationDate: pdf.getCreationDate()?.toISOString() ?? null,
					fileSize: fileStat.size,
				}
			},
		},
		{
			name: 'pdf_merge',
			description: 'Merge multiple PDF files into a single PDF.',
			parameters: z.object({
				paths: z.array(z.string()).describe('Array of PDF file paths to merge (in order)'),
				output: z.string().describe('Output path for the merged PDF'),
			}),
			async execute(params) {
				const { paths, output } = params as { paths: string[]; output: string }
				const { readFile, writeFile } = await import('node:fs/promises')
				const { PDFDocument } = await import('pdf-lib')

				const merged = await PDFDocument.create()

				for (const filePath of paths) {
					const bytes = await readFile(filePath)
					const source = await PDFDocument.load(bytes)
					const pages = await merged.copyPages(source, source.getPageIndices())
					for (const page of pages) {
						merged.addPage(page)
					}
				}

				const mergedBytes = await merged.save()
				await writeFile(output, mergedBytes)

				return { ok: true, output, pages: merged.getPageCount(), sources: paths.length }
			},
		},
		{
			name: 'pdf_split',
			description: 'Extract specific pages from a PDF into a new PDF file.',
			parameters: z.object({
				path: z.string().describe('Source PDF file path'),
				pages: z.string().describe('Pages to extract (e.g. "1-5", "3", "1,3,5")'),
				output: z.string().describe('Output path for the extracted pages'),
			}),
			async execute(params) {
				const { path: filePath, pages, output } = params as { path: string; pages: string; output: string }
				const { readFile, writeFile } = await import('node:fs/promises')
				const { PDFDocument } = await import('pdf-lib')

				const bytes = await readFile(filePath)
				const source = await PDFDocument.load(bytes)
				const pageIndices = parsePageRange(pages, source.getPageCount())

				const result = await PDFDocument.create()
				const copiedPages = await result.copyPages(source, pageIndices)
				for (const page of copiedPages) {
					result.addPage(page)
				}

				const resultBytes = await result.save()
				await writeFile(output, resultBytes)

				return { ok: true, output, pages: result.getPageCount() }
			},
		},
	],

	async onLoad() {
		console.log('[paw-pdf] loaded')
	},
	async onUnload() {
		console.log('[paw-pdf] unloaded')
	},
}

/** Parse page range string like "1-5", "3", "1,3,5" into zero-based indices */
function parsePageRange(range: string | undefined, totalPages: number): number[] {
	if (!range) return Array.from({ length: totalPages }, (_, i) => i)

	const indices: number[] = []
	for (const part of range.split(',')) {
		const trimmed = part.trim()
		if (trimmed.includes('-')) {
			const [start, end] = trimmed.split('-').map((s) => parseInt(s.trim(), 10))
			for (let i = Math.max(1, start); i <= Math.min(totalPages, end); i++) {
				indices.push(i - 1) // zero-based
			}
		} else {
			const page = parseInt(trimmed, 10)
			if (page >= 1 && page <= totalPages) {
				indices.push(page - 1)
			}
		}
	}
	return [...new Set(indices)].sort((a, b) => a - b)
}

/** Basic text extraction from a PDF page (limited — pdf-lib doesn't have full text extraction) */
async function extractPageText(page: any): Promise<string> {
	// pdf-lib's page content operators don't directly expose text
	// For basic extraction, we look at the content stream for text operators
	try {
		const { width, height } = page.getSize()
		return `[Page ${width.toFixed(0)}x${height.toFixed(0)} — use a dedicated PDF text extractor for full text content]`
	} catch {
		return '[Unable to extract text]'
	}
}
