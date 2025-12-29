# Chatterbox Voice References

Place reference audio files (5-10 seconds) here for avatar-specific voice cloning.

## File naming convention

Use the avatar ID as the filename:
- `adam.wav` - Voice reference for Adam
- `anja.wav` - Voice reference for Anja
- etc.

## Requirements

- Duration: 5-10 seconds minimum
- Format: WAV, MP3, or FLAC
- Quality: Clean speech, minimal background noise
- Content: Clear spoken sentences (not singing)

## Usage

Update `manifest.json` to use the avatar ID as `chatterbox_voice`:

```json
{
  "id": "adam",
  "chatterbox_voice": "adam"  // Will use adam.wav
}
```

When `chatterbox_voice` is set to an avatar ID, the system looks for:
`/voices/chatterbox/{id}.wav`
