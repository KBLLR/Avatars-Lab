# Drift Report

## Timing Approximations
- The HeadTTS bridge returns word timing arrays by evenly distributing the audio duration across words.
- Viseme arrays in the bridge are returned empty; TalkingHead tests rely on word timings instead.

## Audio Fixtures
- The HeadAudio harness uses a pre-generated WAV fixture to keep the viseme test deterministic.

## E2E Pipeline
- TalkingHead E2E uses MLX TTS output, converts to PCM16LE, and feeds words + timings into `streamAudio()`.
