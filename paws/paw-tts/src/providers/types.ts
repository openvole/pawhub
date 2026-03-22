export interface TTSProvider {
	synthesize(
		text: string,
		voice: string | undefined,
		format: 'mp3' | 'wav' | 'pcm',
	): Promise<Buffer>
}
