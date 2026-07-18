# Gemma Avatar Performance Review - 2026-07-18

## Verdict

Fable's `d5c4d35` commit is a valid local streaming TTS and audio-viseme proof. It is
not a full port of the hosted Gemma Avatar Space.

The local path is:

`text -> Core-X Gateway -> Qwen TTS -> PCM stream -> AudioWorklet -> HeadAudio visemes`

The hosted reference path is:

`microphone -> VAD -> Parakeet STT -> Gemma -> Qwen TTS -> avatar`

The hosted implementation also supports tools, camera input, barge-in, queueing, and
an OpenAI Realtime-compatible WebSocket session. Direct feature parity is therefore
not established.

## Source Pin

- Hosted source: `victor/gemma-avatar`
- Reviewed revision: `92bd3bba9042ad037b9d16e592c8d7af93b9c066`
- Local source: Avatar Labs commit stack ending at `63629db`, then this modernization

## Measurements

Environment: installed Chrome, local Gateway and MLX Audio online, short local text
`Hello operator.`, hosted `?fakemic=1` plus `getClient().requestResponse()`.

Three short-utterance runs:

| Metric | Local samples | Hosted samples | Median |
|---|---:|---:|---:|
| Visual readiness | 385, 407, 396 ms | 2,195, 2,225, 2,262 ms | local 396 ms; hosted 2,225 ms |
| First response audio | 553, 1,432, 476 ms | 1,719, 942, 970 ms | local 553 ms; hosted 970 ms |

An earlier long local sentence produced 3.1-4.3 second first-audio times. Prompt length,
model state, and lane contention materially affect Qwen streaming latency.

## Conclusion

The local case is faster at visual readiness and competitive on the narrower short-text
TTS edge. It is not correct to claim that the local case is globally "as fast" as the
hosted application because the measured pipelines and workloads differ. End-to-end
parity requires a local microphone/STT/LLM/TTS benchmark with identical prompts and
turn semantics.

Reproduce with:

```bash
npm run benchmark:gemma -- \
  --local-url http://127.0.0.1:5185/gemma-avatar.html \
  --reference-turn \
  --output /tmp/avatar-labs-gemma-benchmark.json
```
