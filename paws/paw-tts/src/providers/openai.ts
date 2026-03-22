import type { TTSProvider } from './types.js'

export class OpenAIProvider implements TTSProvider {
	private apiKey: string
	private model: string
	private defaultVoice: string

	constructor(
		apiKey: string,
		model: string = 'tts-1',
		defaultVoice: string = 'alloy',
	) {
		this.apiKey = apiKey
		this.model = model
		this.defaultVoice = defaultVoice
	}

	async synthesize(
		text: string,
		voice: string | undefined,
		format: 'mp3' | 'wav' | 'pcm',
	): Promise<Buffer> {
		const response = await fetch(
			'https://api.openai.com/v1/audio/speech',
			{
				method: 'POST',
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					model: this.model,
					voice: voice ?? this.defaultVoice,
					input: text,
					response_format: format,
				}),
			},
		)

		if (!response.ok) {
			const body = await response.text()
			throw new Error(`OpenAI TTS API error (${response.status}): ${body}`)
		}

		return Buffer.from(await response.arrayBuffer())
	}

	listVoices(): { id: string; name: string }[] {
		return [
			{ id: 'alloy', name: 'Alloy' },
			{ id: 'echo', name: 'Echo' },
			{ id: 'fable', name: 'Fable' },
			{ id: 'onyx', name: 'Onyx' },
			{ id: 'nova', name: 'Nova' },
			{ id: 'shimmer', name: 'Shimmer' },
		]
	}
}
