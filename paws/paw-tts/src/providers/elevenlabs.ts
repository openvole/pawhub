import type { TTSProvider } from './types.js'

const FORMAT_MAP: Record<string, string> = {
	mp3: 'mp3_44100_128',
	wav: 'pcm_44100',
	pcm: 'pcm_44100',
}

export class ElevenLabsProvider implements TTSProvider {
	private apiKey: string
	private defaultVoiceId: string

	constructor(apiKey: string, defaultVoiceId: string) {
		this.apiKey = apiKey
		this.defaultVoiceId = defaultVoiceId
	}

	async synthesize(
		text: string,
		voice: string | undefined,
		format: 'mp3' | 'wav' | 'pcm',
	): Promise<Buffer> {
		const voiceId = voice ?? this.defaultVoiceId
		const outputFormat = FORMAT_MAP[format] ?? 'mp3_44100_128'

		const response = await fetch(
			`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
			{
				method: 'POST',
				headers: {
					'xi-api-key': this.apiKey,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					text,
					model_id: 'eleven_multilingual_v2',
					output_format: outputFormat,
				}),
			},
		)

		if (!response.ok) {
			const body = await response.text()
			throw new Error(
				`ElevenLabs API error (${response.status}): ${body}`,
			)
		}

		return Buffer.from(await response.arrayBuffer())
	}

	async listVoices(): Promise<{ id: string; name: string }[]> {
		const response = await fetch('https://api.elevenlabs.io/v1/voices', {
			headers: { 'xi-api-key': this.apiKey },
		})

		if (!response.ok) {
			const body = await response.text()
			throw new Error(
				`ElevenLabs API error (${response.status}): ${body}`,
			)
		}

		const data = (await response.json()) as {
			voices: { voice_id: string; name: string }[]
		}
		return data.voices.map((v) => ({ id: v.voice_id, name: v.name }))
	}
}
