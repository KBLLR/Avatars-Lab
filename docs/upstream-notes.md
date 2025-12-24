# Upstream Notes

## TalkingHead
- Streaming API accepts PCM16LE audio via `streamAudio()` and optional `visemes/vtimes/vdurations` or `words/wtimes/wdurations`.
- External TTS services can provide word-level timestamps or visemes directly.
- Ready Player Me services are winding down in 2026; tests must use local GLB assets.

## HeadAudio
- AudioWorklet node/processor emitting Oculus viseme blend-shape values in real time.
- Requires loading `headworklet` and a pre-trained viseme model, then wiring `(key, value)` callbacks in [0,1].

## HeadTTS
- REST endpoint `POST /v1/synthesize` returning base64 audio plus word/viseme timing arrays.
- Supports `audioEncoding` of `wav` or `pcm` (16-bit LE samples).
