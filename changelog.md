# Avatar Labs Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- **Dance Module** (`src/dance/`)
  - `types.ts` - AnimationClip, PoseClip, Choreography, DanceStyle, DanceMood schemas
  - `library.ts` - DanceLibraryManager with CRUD, search, localStorage persistence
  - `director.ts` - DanceDirector for style selection, choreography generation
  - `index.ts` - Module exports
- **Dance Studio** (`dance-studio.html`, `src/dance-studio.ts`)
  - Style/mood grid selectors (18 styles, 8 moods)
  - BPM slider with intensity control
  - Animation/pose library browser
  - Timeline with playhead visualization
  - Choreography editor with step management
  - Import/export JSON
- **Dance Actions** in action-scheduler
  - `play_animation` - Plays FBX animation via TalkingHead
  - `play_pose` - Plays pose via TalkingHead
  - `stop_animation` - Stops and restarts head
- **Starter Dance Library** (`public/dance/library.json`)
  - 8 sample animation clips
  - 3 sample poses
  - 1 demo choreography

### Fixed
- **Lipsync Infinite Loop**: Changed `lipsyncLang: "en"` to `""` in dance-studio and gestures-lab when lipsync not needed
- **Duo Mode Disposal Crash**: Wrapped `disposeHead()` and `DuoHeadManager.dispose()` in try-catch to handle incomplete avatar loads

### Changed
- `vite.config.mjs` - Added dance-studio entry point

---

## [2025-12-26] - Swiss Design & Scene State Machine

### Added
- **Spotlight Preset** in stage constants - Default idle/start/end lighting
- **Stage Hero Section** - Eyebrow, title, dynamic description
- **Floating Action Bar** - Glass effect buttons on canvas hover
- **Canvas Resize** - Drag bottom edge, double-click to reset
- **Random Avatar Selection** - Different avatar each page load
- **TTS Narration** - Director intro/fallback/completion voice

### Changed
- **Swiss Design System** applied to stage.html, index.html, info.html, settings.html
- **Collapsible Cards** - All control cards collapse/expand on header click
- **Scene State Machine** - Spotlight as default, transitions during performance
- **GPT-OSS Harmony Parser** - Enhanced for more model output formats

### Fixed
- Type errors for `postfx` in DirectorStage records
- Duplicate `SetHudFn` export in scene/index.ts

---

## [2025-12-25] - Duo Mode & Gestures Lab

### Added
- **Duo Mode** (`src/avatar/duo-head-manager.ts`)
  - Two TalkingHead instances in shared WebGL context
  - `speakTo` property for mutual gaze
  - State sync between avatars
- **Gestures Lab** (`gestures-lab.html`, `src/gestures-lab.ts`)
  - Gesture clip authoring UI
  - Built-in gesture selection
  - Emoji expression picker
  - Morph target sliders
  - Library save/load
- **Gesture Library** (`src/gestures/`, `public/gestures/library.json`)
  - GestureClip, MorphCurve types
  - GestureLibraryManager with CRUD
- **Duo Mode Actions** in action-scheduler
  - `speak_to` - Set speaker and target
  - `set_speaker_target` - Change gaze target

### Changed
- `src/stage.ts` - Added Duo Mode toggle, avatar A/B selection
- `src/stage/controls.ts` - Duo Mode callbacks
- `src/stage/elements.ts` - Duo Mode UI elements

---

## [2025-12-24] - Effects & Environments

### Added
- **Effects Manager** (`src/effects/manager.ts`)
  - Bloom, Vignette, Chromatic Aberration
  - Pixelation, Glitch effects
  - postprocessing library integration
- **Environment Presets** (`src/environments/`)
  - Solid, Gradient, Transparent backgrounds
  - Preset definitions (neon, noir, sunset, frost, crimson)
- **PostFX Actions** in action-scheduler
  - `post_bloom`, `post_vignette`, `post_chromatic_aberration`
  - `post_pixelation`, `post_glitch`, `post_reset_effects`
- **Environment Actions**
  - `set_environment`, `set_background`

---

## [2025-12-23] - Core Stage System

### Added
- **Stage Director System** (`src/directors/`)
  - Performance Director - LLM-driven performance planning
  - Stage Director - Scene/mood/lighting changes
  - Camera Director - View and angle changes
  - Base director with prompt templates
- **Performance Pipeline** (`src/performance/`)
  - Action scheduler with marker system
  - Performer with speakAudio integration
  - Fallback plan generation
- **Camera Animations** (`src/camera/`)
  - Dolly, Pan, Tilt, Orbit
  - Shake, Punch, Sweep effects
- **MLX Integration** (`src/llm/`, `src/runtime/`)
  - Streaming parser for LLM responses
  - Model status/load/unload controls
  - Audio service client (TTS/STT)

### Changed
- Migrated from OpenAI cloud to local MLX services
- TalkingHead configuration for local-only operation

---

## Architecture Notes

### Current Pain Points
1. **stage.ts Monolith** - 28KB+ file needs decomposition
2. **Director Prompts** - Embedded strings, no validation
3. **MLX Reliability** - No retry logic, health checks weak
4. **Composition Layer** - Exists but not integrated

### Planned Improvements
1. Extract stage.ts into focused modules
2. Move prompts to external files with schemas
3. Add MLX service health polling
4. Complete composition layer for multi-layer canvas

### Integration Roadmap
- [ ] Dance Director → Stage performer integration
- [ ] Composition layer → Multi-avatar PiP
- [ ] MFLUX → Generative backgrounds
- [ ] WebGPU → Enhanced post-processing
