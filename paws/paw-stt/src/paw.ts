import { z, type PawDefinition } from '@openvole/paw-sdk'
import { WhisperClient } from './whisper.js'

let whisper: WhisperClient | undefined

function getWhisper(): WhisperClient {
	if (!whisper) {
		throw new Error('WhisperClient not initialized — onLoad has not been called')
	}
	return whisper
}

export const paw: PawDefinition = {
	name: '@openvole/paw-stt',
	version: '0.1.0',
	description: 'Speech-to-text tool using OpenAI Whisper',
	brain: false,

	tools: [
		{
			name: 'stt_transcribe',
			description: 'Transcribe an audio file to text using OpenAI Whisper',
			parameters: z.object({
				file_path: z.string().describe('Absolute path to the audio file to transcribe'),
				language: z
					.string()
					.optional()
					.describe('ISO-639-1 language code (e.g. "en", "fr", "de"). Optional — Whisper auto-detects if omitted'),
			}),
			async execute(params: unknown) {
				const { file_path, language } = params as {
					file_path: string
					language?: string
				}

				try {
					const text = await getWhisper().transcribe(file_path, language)
					return { text, file_path, language: language ?? null }
				} catch (err) {
					const message =
						err instanceof Error ? err.message : String(err)

					if (message.startsWith('File not found')) {
						throw new Error(`File not found: ${file_path}`)
					}
					if (message.startsWith('Unsupported audio format')) {
						throw new Error(message)
					}
					throw new Error(`Whisper transcription failed: ${message}`)
				}
			},
		},
	],

	async onLoad() {
		const apiKey = process.env.OPENAI_API_KEY
		if (!apiKey) {
			throw new Error(
				'[paw-stt] OPENAI_API_KEY environment variable is required',
			)
		}

		const model = process.env.OPENAI_STT_MODEL ?? 'whisper-1'
		whisper = new WhisperClient(apiKey, model)
		console.log(`[paw-stt] loaded — model: ${model}`)
	},

	async onUnload() {
		whisper = undefined
		console.log('[paw-stt] unloaded')
	},
}
