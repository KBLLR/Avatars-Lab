# MLX Contract Notes

## Endpoints Used
- LLM: `GET /health`, `GET /v1/models`
- Audio: `GET /health`, `POST /v1/audio/speech`, `POST /v1/audio/transcriptions`

## Service Discovery
- Preferred: `services.manifest.json` in repo root
- Env fallbacks: `MLX_LLM_BASE_URL`, `MLX_AUDIO_BASE_URL`

## Model Discovery
- Preferred: `model-zoo/registry.json`
- Env overrides: `MLX_DEFAULT_LLM_MODEL`, `MLX_DEFAULT_TTS_MODEL`, `MLX_DEFAULT_STT_MODEL`

## Data-Pool Logs
- Audio events are expected in `data-pool/events/audio/*.jsonl`
- The contract tests assert `gen_ai.speech` (and `gen_ai.transcription` if STT runs)
