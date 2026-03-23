# @openvole/paw-stt

**Speech-to-text tool for OpenVole using the OpenAI Whisper API.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-stt)](https://www.npmjs.com/package/@openvole/paw-stt)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-stt
```

## Config

```json
{
  "name": "@openvole/paw-stt",
  "allow": {
    "network": ["api.openai.com"],
    "env": ["OPENAI_API_KEY", "OPENAI_STT_MODEL"]
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key for Whisper access |
| `OPENAI_STT_MODEL` | No | Whisper model to use (default: `whisper-1`) |

## Tool

### `stt_transcribe`

Transcribe an audio file to text using OpenAI Whisper.

**Parameters:**

- `file_path` (string, required) — Absolute path to the audio file.
- `language` (string, optional) — ISO-639-1 language code (e.g. `"en"`, `"fr"`). Whisper auto-detects if omitted.

**Supported formats:** mp3, wav, m4a, webm, mp4, mpeg, mpga, oga, ogg, flac.

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
