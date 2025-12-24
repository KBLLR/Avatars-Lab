# Avatar Labs Agent Notes

## Purpose
- `avatar-labs` is a Vite-based house that validates TalkingHead + HeadAudio with local MLX services (no OpenAI cloud).
- Primary UI is `stage.html` with logic in `src/stage.ts`.

## How to run
- From `houses/avatar-labs`:
  - `npm install`
  - `npm run dev` (runs `scripts/dev.zsh`, bootstraps local MLX LLM + Audio if needed)

## Environment and config
- Required (from `.env.local`):
  - `VITE_MLX_LLM_BASE_URL`
  - `VITE_MLX_AUDIO_BASE_URL`
  - `VITE_MLX_DEFAULT_LLM_MODEL`
  - `VITE_MLX_DEFAULT_TTS_MODEL`
  - `VITE_MLX_DEFAULT_STT_MODEL`
  - `VITE_MLX_DEFAULT_TTS_VOICE`
- Optional:
  - `VITE_AVATAR_MANIFEST_URL` (override avatar manifest location)
- Avoid external APIs:
  - `OPENAI_API_KEY` must be unset.

## Assets
- Avatars live in `public/avatars/` and are listed by `public/avatars/manifest.json`.
- Stage loads GLB URLs relative to the manifest location.

## MLX LLM runtime controls
- Stage UI includes an "LLM Runtime" panel (load/unload/status).
- Calls these internal endpoints on the LLM service:
  - `GET /internal/models/status`
  - `POST /internal/models/load`
  - `POST /internal/models/unload`
  - Fallback: `GET /internal/diagnostics`

## Tests
- `scripts/smoke.zsh`
- `scripts/e2e.zsh`
- `scripts/all.zsh`
- Logs: `anthology/logs/avatar-labs/`

## Implementation notes
- Keep initialization non-blocking; avoid awaiting long network calls before avatar load.
- Audio contexts require a user gesture before playback (Chrome autoplay policy).
