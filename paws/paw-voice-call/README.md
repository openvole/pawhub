# @openvole/paw-voice-call

[![npm version](https://img.shields.io/npm/v/@openvole/paw-voice-call.svg)](https://www.npmjs.com/package/@openvole/paw-voice-call)

Voice call channel Paw for OpenVole. Enables voice conversations via Twilio — both inbound and outbound calls with real-time speech-to-text and text-to-speech.

## Install

```bash
npm install @openvole/paw-voice-call
```

## Twilio Account Setup

1. Create a [Twilio account](https://www.twilio.com/try-twilio)
2. Purchase a phone number with Voice capabilities
3. Note your Account SID and Auth Token from the Twilio Console
4. Configure your phone number's Voice webhook to point to your server (see Webhook Setup below)

## Configuration

Add the paw to your `vole.json`:

```json
{
  "paws": [
    {
      "name": "@openvole/paw-voice-call",
      "config": {}
    }
  ]
}
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | Yes | Your Twilio Account SID |
| `TWILIO_AUTH_TOKEN` | Yes | Your Twilio Auth Token |
| `TWILIO_PHONE_NUMBER` | Yes | Your Twilio phone number in E.164 format (e.g. `+14155551234`) |
| `VOICE_CALL_WEBHOOK_URL` | Yes | Public URL where Twilio can reach the webhook server |
| `VOICE_CALL_PORT` | No | Local port for the webhook server (default: `3979`) |

## Call Flow

1. **Inbound call** arrives at Twilio, which hits `POST /voice/inbound`
2. Server responds with TwiML greeting + `<Gather>` to collect speech
3. Caller speaks — Twilio's built-in STT transcribes and sends to `POST /voice/gather`
4. Paw creates a task with the transcription, responds with TwiML redirect to `/voice/respond/<taskId>`
5. The respond endpoint holds the connection (long-poll, max 25s) waiting for the brain's response
6. When the task completes, TwiML with `<Say>` delivers the response + `<Gather>` continues the conversation
7. Loop back to step 3

Outbound calls follow the same flow after initial connection via the `initiate_call` tool.

## Webhook Setup

### Development (ngrok)

```bash
ngrok http 3979
```

Set `VOICE_CALL_WEBHOOK_URL` to your ngrok URL (e.g. `https://abc123.ngrok-free.app`).

In your Twilio Console, configure your phone number's Voice webhook:
- **A call comes in**: Webhook, `https://abc123.ngrok-free.app/voice/inbound`, HTTP POST

### Production

Point `VOICE_CALL_WEBHOOK_URL` to your production server's public URL and configure the Twilio webhook accordingly.

## License

MIT
