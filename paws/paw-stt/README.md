# @openvole/paw-stt

[![npm version](https://img.shields.io/npm/v/@openvole/paw-stt.svg)](https://www.npmjs.com/package/@openvole/paw-stt)

Speech-to-text tool Paw for OpenVole. Transcribe audio files using the OpenAI Whisper API.

## Install

```bash
npm install @openvole/paw-stt
```

## Configuration

Add to your Vole config:

```json
{
  "paws": ["@openvole/paw-stt"]
}
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | Yes | — | OpenAI API key for Whisper access |
| `OPENAI_STT_MODEL` | No | `whisper-1` | Whisper model to use |

## Tool

### `stt_transcribe`

Transcribe an audio file to text using OpenAI Whisper.

**Parameters:**

- `file_path` (string, required) — Absolute path to the audio file.
- `language` (string, optional) — ISO-639-1 language code (e.g. `"en"`, `"fr"`). Whisper auto-detects if omitted.

**Supported formats:** mp3, wav, m4a, webm, mp4, mpeg, mpga, oga, ogg, flac.

## License

MIT
