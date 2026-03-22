import { readFile, access } from 'node:fs/promises'
import { basename, extname } from 'node:path'

const SUPPORTED_EXTENSIONS = new Set([
	'.mp3',
	'.wav',
	'.m4a',
	'.webm',
	'.mp4',
	'.mpeg',
	'.mpga',
	'.oga',
	'.ogg',
	'.flac',
])

const MIME_TYPES: Record<string, string> = {
	'.mp3': 'audio/mpeg',
	'.wav': 'audio/wav',
	'.m4a': 'audio/mp4',
	'.webm': 'audio/webm',
	'.mp4': 'audio/mp4',
	'.mpeg': 'audio/mpeg',
	'.mpga': 'audio/mpeg',
	'.oga': 'audio/ogg',
	'.ogg': 'audio/ogg',
	'.flac': 'audio/flac',
}

export class WhisperClient {
	private apiKey: string
	private model: string

	constructor(apiKey: string, model = 'whisper-1') {
		this.apiKey = apiKey
		this.model = model
	}

	async transcribe(filePath: string, language?: string): Promise<string> {
		// Validate file exists
		try {
			await access(filePath)
		} catch {
			throw new Error(`File not found: ${filePath}`)
		}

		// Validate file extension
		const ext = extname(filePath).toLowerCase()
		if (!SUPPORTED_EXTENSIONS.has(ext)) {
			throw new Error(
				`Unsupported audio format "${ext}". Supported formats: ${[...SUPPORTED_EXTENSIONS].map((e) => e.slice(1)).join(', ')}`,
			)
		}

		const fileBuffer = await readFile(filePath)
		const mimeType = MIME_TYPES[ext] ?? 'application/octet-stream'
		const fileName = basename(filePath)

		const formData = new FormData()
		formData.append('file', new Blob([fileBuffer], { type: mimeType }), fileName)
		formData.append('model', this.model)
		if (language) {
			formData.append('language', language)
		}

		const response = await fetch(
			'https://api.openai.com/v1/audio/transcriptions',
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: formData,
			},
		)

		if (!response.ok) {
			const body = await response.text()
			throw new Error(
				`Whisper API error (${response.status}): ${body}`,
			)
		}

		const json = (await response.json()) as { text: string }
		return json.text
	}
}
