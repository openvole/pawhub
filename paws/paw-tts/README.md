# @openvole/paw-tts

**Text-to-speech tool for OpenVole with multi-provider support (ElevenLabs and OpenAI).**

[![npm](https://img.shields.io/npm/v/@openvole/paw-tts)](https://www.npmjs.com/package/@openvole/paw-tts)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-tts
```

## Config

### ElevenLabs (default)

```json
{
  "name": "@openvole/paw-tts",
  "allow": {
    "network": ["api.elevenlabs.io"],
    "env": ["VOLE_TTS_PROVIDER", "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID"]
  }
}
```

### OpenAI

```json
{
  "name": "@openvole/paw-tts",
  "allow": {
    "network": ["api.openai.com"],
    "env": ["VOLE_TTS_PROVIDER", "OPENAI_API_KEY", "OPENAI_TTS_MODEL", "OPENAI_TTS_VOICE"]
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VOLE_TTS_PROVIDER` | No | TTS provider to use: `elevenlabs` (default) or `openai` |
| `ELEVENLABS_API_KEY` | Yes (ElevenLabs) | ElevenLabs API key |
| `ELEVENLABS_VOICE_ID` | No | Default ElevenLabs voice ID (default: `21m00Tcm4TlvDq8ikWAM`) |
| `OPENAI_API_KEY` | Yes (OpenAI) | OpenAI API key |
| `OPENAI_TTS_MODEL` | No | OpenAI TTS model: `tts-1` (default) or `tts-1-hd` |
| `OPENAI_TTS_VOICE` | No | Default OpenAI voice (default: `alloy`) |

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

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
