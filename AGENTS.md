# Avatar Labs Agent Notes

## Purpose
- `avatar-labs` is a Vite-based house that validates TalkingHead + HeadAudio with local MLX services (no OpenAI cloud).
- Primary UI is `stage.html` with logic in `src/stage.ts`.
- Secondary UIs: `dance-studio.html`, `gestures-lab.html`, `multi-modal.html`

## How to run
- From `houses/avatar-labs`:
  - `npm install`
  - `npm run dev` (runs `scripts/dev.zsh`, bootstraps local MLX LLM + Audio if needed)

## Entry Points

| Page | Purpose |
|------|---------|
| `stage.html` | Main performance stage with directors |
| `dance-studio.html` | Animation/choreography authoring |
| `gestures-lab.html` | Gesture clip authoring |
| `multi-modal.html` | VLM + voice conversation |
| `mlx-conversation.html` | Text chat with MLX LLM |
| `info.html` | System info display |
| `settings.html` | Configuration panel |

## Module Architecture

```
src/
├── avatar/          # TalkingHead management, Duo Mode
├── camera/          # Camera animation (dolly, pan, orbit)
├── composition/     # Canvas layer compositing (WIP)
├── dance/           # Animation library, Dance Director
├── directors/       # Performance/Stage/Camera directors
├── effects/         # Post-processing (bloom, vignette, glitch)
├── environments/    # Background presets
├── generative/      # Procedural visuals (planned)
├── gestures/        # Gesture library
├── lab/             # Event bus, experimental
├── llm/             # MLX LLM client, parsers
├── performance/     # Action scheduler, performer
├── pipeline/        # Processing pipeline
├── runtime/         # MLX service health checks
├── scene/           # Lighting, camera setup
├── stage/           # Stage state, controls, elements
└── ui/              # Status, progress, HUD
```

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
- Gestures library in `public/gestures/library.json`.
- Dance library in `public/dance/library.json`.
- Stage loads GLB URLs relative to the manifest location.

## MLX LLM runtime controls
- Stage UI includes an "LLM Runtime" panel (load/unload/status).
- Calls these internal endpoints on the LLM service:
  - `GET /internal/models/status`
  - `POST /internal/models/load`
  - `POST /internal/models/unload`
  - Fallback: `GET /internal/diagnostics`

## Key Pipelines

### Performance Pipeline
1. Load audio + transcript
2. Run Performance Director (LLM generates plan)
3. Approve plan
4. Execute via action-scheduler with markers
5. Avatar speaks with synchronized gestures/lighting

### Duo Mode
- Two TalkingHead instances in shared WebGL context
- `DuoHeadManager` handles lifecycle
- `speakTo` property enables mutual gaze
- Action scheduler supports `speak_to` actions

### Dance Pipeline
- DanceDirector selects clips by style/mood/BPM
- Generates choreographies as step sequences
- Converts to PlanActions for integration
- TalkingHead's `playAnimation()` handles FBX playback

## Tests
- `scripts/smoke.zsh`
- `scripts/e2e.zsh`
- `scripts/all.zsh`
- Logs: `anthology/logs/avatar-labs/`

## Implementation notes
- Keep initialization non-blocking; avoid awaiting long network calls before avatar load.
- Audio contexts require a user gesture before playback (Chrome autoplay policy).
- TalkingHead disposal can fail if avatar not fully loaded - always wrap in try-catch.
- Lipsync modules: Set `lipsyncLang: ""` if speech not needed to avoid init loop.

## Known Issues
- `talkinghead-e2e.ts` has type error for `window.__talkingHeadResult` (pre-existing)
- `lab/event-bus.ts` has generic type mismatch (pre-existing)
- Stage.ts is 28KB+ monolith - decomposition needed
- Director prompts need schema validation

## Technical Debt
- Stage state management is fragmented
- No retry logic for MLX service calls
- Choreography timeline missing step reorder/delete
- Composition layer integration incomplete
