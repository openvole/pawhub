# @openvole/paw-tts

[![npm version](https://img.shields.io/npm/v/@openvole/paw-tts.svg)](https://www.npmjs.com/package/@openvole/paw-tts)

Text-to-speech tool Paw for OpenVole with multi-provider support (ElevenLabs and OpenAI TTS).

## Install

```bash
npm install @openvole/paw-tts
```

## Configuration

### ElevenLabs (default)

```bash
export VOLE_TTS_PROVIDER=elevenlabs
export ELEVENLABS_API_KEY=your-api-key
export ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM  # optional, defaults to Rachel
```

### OpenAI

```bash
export VOLE_TTS_PROVIDER=openai
export OPENAI_API_KEY=your-api-key
export OPENAI_TTS_MODEL=tts-1        # optional, defaults to tts-1
export OPENAI_TTS_VOICE=alloy        # optional, defaults to alloy
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `VOLE_TTS_PROVIDER` | No | `elevenlabs` | TTS provider to use (`elevenlabs` or `openai`) |
| `ELEVENLABS_API_KEY` | Yes (ElevenLabs) | — | ElevenLabs API key |
| `ELEVENLABS_VOICE_ID` | No | `21m00Tcm4TlvDq8ikWAM` | Default ElevenLabs voice ID |
| `OPENAI_API_KEY` | Yes (OpenAI) | — | OpenAI API key |
| `OPENAI_TTS_MODEL` | No | `tts-1` | OpenAI TTS model (`tts-1` or `tts-1-hd`) |
| `OPENAI_TTS_VOICE` | No | `alloy` | Default OpenAI voice |

## Tools

### `tts_speak`

Convert text to speech and save as an audio file.

- **text** (string, required) — The text to convert to speech
- **voice** (string, optional) — Voice ID (provider-specific)
- **output_format** (enum: `mp3` | `wav` | `pcm`, default: `mp3`) — Audio format

Audio files are saved to `.openvole/workspace/audio/`.

### `tts_list_voices`

List available voices for the active TTS provider.

## License

MIT
