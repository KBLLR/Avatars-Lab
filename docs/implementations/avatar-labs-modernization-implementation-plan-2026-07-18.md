# Avatar Labs Modernization Implementation Plan - 2026-07-18

## Objective

Bring Avatar Labs onto the current Core-X local-first runtime contract while preserving
its existing authoring cases and validating Fable's Gemma Avatar work against the
hosted reference.

## Scope

1. Preserve and review commits `596cf5b`, `d5c4d35`, and `63629db`.
2. Upgrade the toolchain to Vite 8, current React/Three, and current Playwright.
3. Route MLX traffic through Gateway `127.0.0.1:8090` and remove direct service startup.
   Migrate all LLM callers to canonical `POST /v1/responses`.
4. Add a WebGPU-first Core-X head with a tested WebGL2 fallback.
5. Replace the broken link launcher with a typed registry of real case entrypoints.
6. Apply the Core-X design source from `core-x/docs/design/AvatarsLab`.
7. Add house, agent, browser, performance, and schema verification.
8. Restore a reproducible full-body avatar asset contract and unify the eight legacy
   cases under a responsive workbench shell.
9. Rebuild Stage Director as a bounded Audio -> Transcript -> Plan -> Perform workflow,
   with Gateway model discovery, Warehouse-backed performance records, and a viewport-safe
   stage/inspector layout.
10. Replace Engine Lab's Stage Director-derived shell with a production Performance Engine:
    versioned projects, multi-actor Three.js rooms, editable timeline, selectable Core-X
    heads and rigged bodies, TSL looks, real FBX motion, WebGPU/WebGL2 rendering, a schedule
    worker, local import/export, and Warehouse persistence.
11. Restore the reachable RPM/Mixamo motion library and make the existing director pipeline
    the Performance Engine's show-authoring path: Performance Director is showrunner; Stage,
    Camera, and PostFX directors contribute specialist plans; generated tracks remain editable.
12. Make planning visible and audible: each director publishes a bounded briefing summary,
    Gateway TTS speaks it, and the room previews slow-motion blocking from changing angles.
13. Analyze attached scores with Web Audio plus Audio Lab transcription/diarisation, preserve
    semantic/emotional evidence, and map each detected singer to an editable actor lipsync track.
14. Promote the stage to a timeline-controlled system with cinematic camera grammar, motivated
    three-point lighting, TSL procedural backgrounds, particles, and optional Rapier physics.

## Architecture

- `src/runtime/corex-client.ts`: canonical Gateway client.
- `src/runtime/audio-stream.ts`: shared PCM16 stream decoder and resampler.
- `src/runtime/openresponses-client.ts`: conversation/tool-call compatibility adapter.
- `src/cases/registry.ts`: visible harness roster.
- `house.manifest.json`: house identity, dependencies, agent, and surface contract.
- `functions.manifest.json`: AVARA house-agent binding.
- `vite.config.mjs`: fixed 5185 surface plus safe Core-X asset bridge in dev/preview.
- `scripts/hydrate-avatar-assets.mjs`: ignored runtime GLB cache sourced from an explicit
  asset root or the preserved repository snapshot.
- `src/cases/workbench-shell.ts`: shared case navigation and renderer provenance.
- `src/stage/inspector.ts`: accessible workflow state, inspector order, and truthful
  control gating for Stage Director.
- `src/data-pool/store.ts`: Warehouse query, publish, item, and stream contracts for
  performance plans and optional source audio.
- `src/performance-engine/types.ts`: canonical `avatar-labs.performance-project.v1`
  project, cast, track, clip, environment, and compiled-event types.
- `src/performance-engine/project.ts`: bounded project creation, local persistence,
  JSON export, and strict import validation for 1-4 actors, supported assets, tracks,
  clips, duration, and frame rate.
- `src/performance-engine/schedule.worker.ts`: module worker for deterministic timeline
  validation, sorting, overlap detection, and event compilation.
- `src/performance-engine/controller.ts`: play, pause, stop, seek, audio synchronization,
  stale-compile rejection, and room state reconstruction at arbitrary timeline positions.
- `src/performance-engine/room.ts`: WebGPU-first Three.js room with WebGL2 fallback,
  HDR environments, multi-actor loading, camera/lighting presets, morph expressions,
  TSL node materials, renderer diagnostics, in-place FBX animation normalization, and
  Mixamo/RPM bone-name retargeting onto matching avatar rigs.
- `src/performance-engine/director.ts`: strict adapter from the existing four-director
  `/v1/responses` pipeline into validated Performance Engine tracks. It preserves the
  current edit on failure, rejects invented actor/animation IDs, and stores creator,
  model, brief, council, notes, and timestamp provenance in the project.
- `src/performance-engine/music-analysis.ts`: browser signal analysis plus Gateway-routed
  Audio Lab transcription and diarisation. It aligns lyrics, energy, arousal/valence evidence,
  and speaker turns without persisting temporary Audio Lab paths.
- `src/performance-engine/planning-rehearsal.ts`: sequential local-TTS director briefings,
  slow-motion actor rehearsal, and rotating director-specific camera coverage. Briefings are
  concise summaries, not private chain-of-thought.
- `src/performance-engine/stage-effects.ts`: TSL procedural backdrops, beat-reactive particles,
  and dynamically imported Rapier confetti rigid bodies under timeline control.
- `src/performance-engine/timeline-view.ts`: scrollable ruler, tracks, selectable clips,
  100ms-snap drag/resize, playhead, and clip inspection.
- `src/performance-engine/persistence.ts`: Warehouse
  `capabilities.performance_engine_project` query/publish/load contract and linked score audio.
- `vite.config.mjs`: read-only, range-capable bridges for Core-X heads/HDRIs, 17 curated
  Rigging Portal FBX assets, and 22 RPM-retargeted Project Anja FBX assets. The generated
  `avatar-labs.animation-catalog.v1` endpoint enumerates only files that exist. Operators
  can override roots with `AVATAR_LABS_COREX_PUBLIC_ROOT`, `AVATAR_LABS_ANIMATION_ROOT`,
  and `AVATAR_LABS_RPM_ANIMATION_ROOT`.

Core-X topology remains the process owner. Avatar Labs starts only its own Vite surface.

## Verification Gates

- strict TypeScript typecheck
- modernization contract test
- Vite production build
- launcher desktop/mobile Playwright test
- Gemma Avatar and Core-X head renderer Playwright test
- all-case desktop/mobile containment and six-case real-GLB rendering test
- Stage Director control-state, Gateway routing, Warehouse contract, Harmony response,
  and desktop/mobile framing tests
- Performance Engine WebGPU/WebGL2 readiness, worker scheduling, two-class cast, timeline
  editing, rig gating, TSL/environment switching, transport, Warehouse payload, schema
  rejection, and desktop/mobile containment tests
- all 39 catalog URLs returning binary range responses; search/category/rig/body filtering;
  four Gateway director requests; generated-show playback; rejected hallucinated assets;
  persisted provenance; and unchanged project state when the Gateway is unavailable
- score transcription/diarisation contracts, two-singer actor assignment, actor-scoped lipsync,
  local TTS briefing requests, cinematic lens/movement cues, stage effects, and physics playback
- house manifest schema validation
- three-run local/reference latency sample with the comparison scope recorded

The planning model is evidence-based but intentionally bounded. Web Audio energy/onset evidence
and lyric text inform section-level arousal and valence; they do not claim musicological ground
truth. Affective media research supports combining auditory and visual evidence, while mixed
singing/speech research shows that overlapping vocals remain difficult without source separation.
The current speech-trained diarisation output therefore always remains operator-editable.

Research basis:

- W3C Web Audio API: https://www.w3.org/TR/webaudio-1.0/
- Three.js WebGPU renderer and TSL: https://threejs.org/manual/en/webgpurenderer and
  https://threejs.org/docs/TSL.html
- Rapier JavaScript/WASM physics: https://rapier.rs/docs/user_guides/templates/getting_started_js/
- MuVi affective audiovisual dataset: https://arxiv.org/abs/2202.10453
- Mixed singing/speech separation and diarisation challenge: https://arxiv.org/abs/2404.11275

## Explicit Non-Goals

- Recreating the hosted Space's VAD, STT, Gemma/Cerebras, tools, and barge-in stack.
- Introducing cloud inference or a second service registry.
- Duplicating Core-X head binaries in the house repo.
- Claiming off-main-thread rendering: this slice moves schedule compilation to a real
  Web Worker while Three.js rendering remains on the renderer's supported browser thread.
  OffscreenCanvas rendering is a future measured optimization, not a current capability.
- Universal retargeting between arbitrary incompatible skeleton families. Supported
  RPM/Mixamo prefixes are normalized onto matching target bone names; clips still require
  at least eight matched rig tracks and remove source translation/scale tracks to keep
  actors in stage coordinates.
- Claiming reliable identity for overlapping singers. The current Audio Lab diarisation model
  is speech-trained and produces reviewable speaker turns, not definitive singer recognition.
