# Avatar Labs Agent Notes

## Purpose
- `avatar-labs` is a Vite-based house that validates TalkingHead + HeadAudio with local MLX services (no OpenAI cloud).
- Primary UI is `engine-lab.html` (Performance Engine Lab) with logic in `src/stage.ts`.
- Legacy UI: `stage.html` (same logic, different layout)
- Secondary UIs: `dance-studio.html`, `gestures-lab.html`, `multi-modal.html`

## How to run
- From `houses/avatar-labs`:
  - `npm install`
  - `npm run dev` (runs `scripts/dev.zsh`, bootstraps local MLX LLM + Audio if needed)

## Entry Points

| Page | Purpose |
|------|---------|
| `engine-lab.html` | **Primary** - Performance Engine with timeline editor |
| `stage.html` | Legacy performance stage with directors |
| `dance-studio.html` | Animation/choreography authoring |
| `gestures-lab.html` | Gesture clip authoring, ARKit blendshapes |
| `multi-modal.html` | VLM + voice conversation |
| `mlx-conversation.html` | Text chat with MLX LLM |
| `info.html` | System info display |
| `settings.html` | Configuration panel |

## Module Architecture

```text
src/
├── avatar/          # TalkingHead management, Duo Mode
├── camera/          # Camera animation (dolly, pan, orbit)
├── composition/     # Canvas layer compositing (WIP)
├── dance/           # Animation library, Dance Director
├── directors/       # Performance/Stage/Camera directors
├── effects/         # Post-processing (bloom, vignette, glitch)
├── engine/          # Multi-Layer Performance Engine (NEW)
│   ├── executors/   # Layer executors (viseme, dance, blendshape, emoji, lighting, camera, fx)
│   ├── ui/          # Timeline editor component
│   ├── types.ts     # Timeline, Block, Layer interfaces
│   ├── engine-state-machine.ts
│   ├── engine-runner.ts
│   ├── director-adapter.ts  # Converts director plans to timeline blocks
│   └── timeline-persistence.ts
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
└── ui/              # Status, progress, HUD, subtitles
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

## Performance Engine (src/engine/)

The Multi-Layer Performance Engine coordinates 6 animation/control layers through a unified state machine with a block/row-based timeline UI.

### Layer Types

| Layer | Executor | Purpose |
|-------|----------|---------|
| `viseme` | VisemeExecutor | Lip sync from word timings |
| `dance` | DanceExecutor | Full-body animations from library |
| `blendshape` | BlendshapeExecutor | Facial expressions, morphs |
| `emoji` | EmojiExecutor | Face emoji expressions |
| `lighting` | LightingExecutor | Stage lighting presets |
| `camera` | CameraExecutor | Camera movements (dolly, pan, orbit) |
| `fx` | FXExecutor | Post-processing effects |

### Engine Flow

```text
Director Plans (Performance/Stage/Camera/PostFX)
    ↓
DirectorAdapter.directorPlanToTimeline()
    ↓
Timeline with typed blocks per layer
    ↓
EngineRunner executes blocks via layer executors
    ↓
TalkingHead / EffectsManager / Scene
```

### Timeline Editor

- Located in `src/engine/ui/timeline-editor.ts`
- Block-based editing with property panels per layer type
- Playhead sync with performance timing
- Save/load/export/import via `timeline-persistence.ts`

## Subtitle System (src/ui/subtitles.ts)

Word-level subtitle rendering with multiple style presets.

### Presets

- `default` - Clean white text
- `karaoke` - Word-by-word highlight with glow
- `cinema` - Yellow italic cinematic style
- `minimal` - Small, subtle text
- `neon` - Glowing cyan cyberpunk style
- `retro` - Green terminal/VHS aesthetic

### Integration

```typescript
const subtitleRenderer = createSubtitleRenderer(stage, options, getTime);
subtitleRenderer.start(wordTimings, duration);
subtitleRenderer.setPreset("karaoke");
```

## Environment Variable Flow

```text
.env.ecosystem (repo root, generated by scripts/infra/generate_env.py)
    ↓
scripts/dev.zsh sources it, detects running services
    ↓
packages/tests/write-env-local.mjs generates .env.local
    ↓
Vite reads .env.local at server start
    ↓
import.meta.env.VITE_* available in browser code
    ↓
getMlxConfig() in src/mlx-config.ts returns config object
```

**Important**: Vite does NOT hot-reload environment variables. After `.env.local` changes, restart the dev server.

## Avatar Metadata

Avatars in `public/avatars/manifest.json` now include rich metadata:
- `display_name` - Human-readable name
- `body` - Body type (fullbody, halfbody)
- `voice_id` - Default TTS voice
- `intro` - Avatar description
- `background` - Suggested background
- `project` - Source project
- `tags` - Categorization tags
- `default_mood` - Starting emotional state

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
- Vite caches deps in `node_modules/.vite/deps` - clear if env vars seem stale.

## Debugging: Common Issues

### CORS errors on MLX runtime panel
- **Symptom**: Network requests to `/internal/models/status` fail with CORS
- **Cause**: `.env.local` not loaded or port missing from URL
- **Fix**:
  1. Verify `.env.local` has `VITE_MLX_LLM_BASE_URL=http://127.0.0.1:8080`
  2. Clear Vite cache: `rm -rf node_modules/.vite/deps`
  3. Restart dev server: `npm run dev`

### Conflicting event handlers
- **Symptom**: Button clicks don't work or work inconsistently
- **Cause**: Inline `<script>` handlers conflict with module handlers
- **Fix**: Use consistent approach - prefer CSS classes over inline styles

### Timeline not syncing with playback
- **Symptom**: Playhead doesn't move with performance
- **Fix**: Ensure `timelineEditor.setPlayhead(ms)` called in timing loop

## TTS Backend Configuration

The system supports two TTS backends, selectable via `mlx-config.ts`:

| Backend | Model ID | Sample Rate | Voice Cloning |
|---------|----------|-------------|---------------|
| Kokoro | `kokoro` (default) | 24kHz | No |
| Chatterbox | `chatterbox` | 24kHz | Yes (5+ sec reference) |

### TTS Routing

```text
Frontend (mlx-config.ttsBackend)
    ↓
ConversationManager.speakResponse()
    ↓
/v1/audio/speech with model="kokoro" or "chatterbox"
    ↓
main.py routes to TTSService or ChatterboxTTSService
    ↓
Audio response (WAV, 24kHz)
```

### Voice Cloning Endpoint

```text
POST /v1/audio/clone-voice
- reference_audio: WAV/MP3 file (5+ seconds)
- text: Text to synthesize
- temperature, top_k, top_p, repetition_penalty: Generation params
→ Returns: WAV audio with cloned voice
```

### Voice Registry

Located at `public/voices/registry.json`, defines available voices for each TTS backend:

```json
{
  "backends": {
    "kokoro": {
      "voices": [
        { "id": "af_heart", "name": "Heart (American Female)", ... },
        { "id": "am_adam", "name": "Adam (American Male)", ... }
      ]
    },
    "chatterbox": {
      "supports_voice_cloning": true,
      "clone_requirements": { "min_audio_seconds": 5, ... }
    }
  }
}
```

### Frontend TTS Selection

In `multi-modal.html`, the Voice card includes:
- TTS Backend toggle (Kokoro/Chatterbox)
- Voice dropdown (populated from registry)
- Voice Cloning section (Chatterbox only)
  - Reference audio file upload
  - Status indicator

## Multi-Modal Conversation System

Located in `multi-modal.html` with logic in `src/multi-modal.ts` and `src/chat/conversation-manager.ts`.

### Features
- Text input (Enter to send, Shift+Enter for newline)
- Voice input (Push-to-talk or VAD mode)
- Service health checks on page load
- Typing indicator during LLM processing
- Function calling for avatar control (gestures, mood, expressions)

### Conversation Flow

```text
User Input (text or voice)
    ↓
ConversationManager.handleUserText()
    ↓
LLM with function calling (tools: set_mood, play_gesture, etc.)
    ↓
Apply function calls to TalkingHead
    ↓
TTS via selected backend
    ↓
HeadAudio lipsync playback
```

## Known Issues
- `talkinghead-e2e.ts` has type error for `window.__talkingHeadResult` (pre-existing)
- `lab/event-bus.ts` has generic type mismatch (pre-existing)
- `engine-runner.ts` has type mismatches with EngineStateMachine (pre-existing)
- Stage.ts is 28KB+ monolith - decomposition needed
- Director prompts need schema validation

## Technical Debt
- Stage state management is fragmented
- No retry logic for MLX service calls
- Choreography timeline missing step reorder/delete
- Composition layer integration incomplete
- Timeline scrubbing (click to seek) not implemented
- Voice cloning needs actual file upload to backend (currently frontend-only)
