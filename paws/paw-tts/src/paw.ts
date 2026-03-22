import { z, type PawDefinition } from '@openvole/paw-sdk'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { TTSProvider } from './providers/types.js'
import { ElevenLabsProvider } from './providers/elevenlabs.js'
import { OpenAIProvider } from './providers/openai.js'

let provider: (TTSProvider & { listVoices: () => Promise<{ id: string; name: string }[]> | { id: string; name: string }[] }) | undefined
let providerName: string = 'elevenlabs'

function getProvider() {
	if (!provider) {
		throw new Error('TTS provider not initialized — onLoad has not been called')
	}
	return provider
}

export const paw: PawDefinition = {
	name: '@openvole/paw-tts',
	version: '0.1.0',
	description: 'Text-to-speech tool supporting ElevenLabs and OpenAI TTS',
	brain: false,

	tools: [
		{
			name: 'tts_speak',
			description: 'Convert text to speech and save as audio file',
			parameters: z.object({
				text: z.string().describe('The text to convert to speech'),
				voice: z
					.string()
					.optional()
					.describe('Voice ID to use (provider-specific). Uses default if omitted.'),
				output_format: z
					.enum(['mp3', 'wav', 'pcm'])
					.default('mp3')
					.describe('Audio output format'),
			}),
			async execute(params: unknown) {
				const { text, voice, output_format } = params as {
					text: string
					voice?: string
					output_format: 'mp3' | 'wav' | 'pcm'
				}

				const p = getProvider()
				const audio = await p.synthesize(text, voice, output_format)

				const ext = output_format === 'pcm' ? 'pcm' : output_format
				const filename = `tts_${Date.now()}.${ext}`
				const audioDir = path.join(process.cwd(), '.openvole', 'workspace', 'audio')
				await fs.mkdir(audioDir, { recursive: true })

				const filePath = path.join(audioDir, filename)
				await fs.writeFile(filePath, audio)

				return {
					ok: true,
					file_path: filePath,
					format: output_format,
					size_bytes: audio.length,
				}
			},
		},
		{
			name: 'tts_list_voices',
			description: 'List available voices for the active TTS provider',
			parameters: z.object({}),
			async execute() {
				const p = getProvider()
				const voices = await p.listVoices()
				return {
					provider: providerName,
					voices,
				}
			},
		},
	],

	async onLoad() {
		providerName = (process.env.VOLE_TTS_PROVIDER ?? 'elevenlabs').toLowerCase()

		if (providerName === 'elevenlabs') {
			const apiKey = process.env.ELEVENLABS_API_KEY
			if (!apiKey) {
				throw new Error(
					'[paw-tts] ELEVENLABS_API_KEY is required when using the ElevenLabs provider',
				)
			}
			const voiceId = process.env.ELEVENLABS_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM'
			provider = new ElevenLabsProvider(apiKey, voiceId)
		} else if (providerName === 'openai') {
			const apiKey = process.env.OPENAI_API_KEY
			if (!apiKey) {
				throw new Error(
					'[paw-tts] OPENAI_API_KEY is required when using the OpenAI provider',
				)
			}
			const model = process.env.OPENAI_TTS_MODEL ?? 'tts-1'
			const voice = process.env.OPENAI_TTS_VOICE ?? 'alloy'
			provider = new OpenAIProvider(apiKey, model, voice)
		} else {
			throw new Error(
				`[paw-tts] Unknown TTS provider: ${providerName}. Supported: elevenlabs, openai`,
			)
		}

		console.log(`[paw-tts] loaded — provider: ${providerName}`)
	},

	async onUnload() {
		provider = undefined
		console.log('[paw-tts] unloaded')
	},
}
