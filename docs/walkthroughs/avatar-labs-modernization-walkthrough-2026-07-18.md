# Avatar Labs Modernization Walkthrough - 2026-07-18

## Start

From the Avatar Labs house worktree:

```bash
npm install
npm run assets:hydrate
npm run dev
```

Open `http://127.0.0.1:5185`.

The launcher shows eleven real harnesses and live renderer/Gateway state. Core-X topology
owns Gateway and MLX services; the house launcher no longer starts or kills them.
Stage Director discovers current LLM, STT, and TTS defaults from Gateway `/v1/models`.
`VITE_MLX_DEFAULT_*` values are optional operator overrides, not startup requirements.

Asset hydration restores the sixteen preserved full-body GLBs into the ignored
`public/avatars/` runtime cache and writes `runtime-manifest.json`. Set
`AVATAR_LABS_ASSET_ROOT` to use an external canonical asset directory instead. Missing
or invalid GLBs are excluded from selectors instead of being served as HTML fallbacks.

## Primary Cases

- `/gemma-avatar.html`: TalkingHead WebGL compatibility case using Gateway streaming TTS.
- `/corex-head.html`: Core-X head with WebGPU primary and WebGL2 fallback.
- `/corex-head.html?renderer=webgl`: deterministic compatibility path.
- `/stage.html`: existing performance stage.
- `/engine-lab.html`: production multi-actor Performance Engine with WebGPU/TSL room,
  editable timeline, worker scheduling, real motion, and Warehouse projects.
- `/dance-studio.html`: choreography authoring and Mixamo-compatible preview.
- `/gestures-lab.html`: pose, expression, and blendshape inspection.
- `/multi-modal.html`: combined avatar, voice, text, and vision harness.
- `/mlx-conversation.html`: local voice conversation and avatar actions.
- `/composition-layer.html`: WebGL material, typography, and environment composition.
- `/head-audio.html`: AudioWorklet and MFCC viseme diagnostics.

The eight workbench cases share one responsive workbench bar and route picker. Five legacy
avatar-bearing cases and the dedicated Performance Engine load real GLBs; Composition Layer
and HeadAudio intentionally use their own specialized rendering/probe surfaces.

## Stage Director

Stage Director presents one direct four-step flow: upload audio, transcribe, generate and
approve a director plan, then perform. Actions remain disabled until their prerequisite is
complete, and the stage action bar remains visible while the inspector scrolls internally.

Model selectors discover canonical `text/`, `vision/`, `stt/`, `tts/`, and `embeddings/`
routes from Gateway. Runtime diagnostics use the public Gateway model catalog when private
model-management endpoints are unavailable. Saved performances use Warehouse on port 5202;
metadata is published as a Stage Director record and source audio is an optional linked
Warehouse item. Existing records with embedded base64 audio remain readable.

## Performance Engine

Open `http://127.0.0.1:5185/engine-lab.html`. The page is a fixed-viewport production
cockpit: the Three.js room and transport stay visible, the timeline scrolls internally,
and the inspector becomes a contained drawer on narrow screens.

The default project loads a rigged Sandri body and the KBLLR Core-X head. Cast supports up
to four actors. Core-X heads expose their morph targets and TSL looks but truthfully disable
FBX clips because they have no skeleton. Motion search exposes 39 locally verified FBX
clips: 17 curated/normalized clips from Rigging Portal and 22 RPM-retargeted performance
clips from Project Anja. Search, category, rig, and selected-body compatibility filters use
the generated local catalog rather than the stale historical `public/dance/library.json`
URLs. Imported FBX clips are converted to in-place motion by removing source translation
and scale tracks. Mixamo/RPM prefixes are normalized onto matching avatar bone names; clips
with fewer than eight matching targets fail instead of moving or deforming an actor.

Performance Director creates the show. Enter a brief, select a current Gateway text model
and style, then choose the Stage, Camera, and PostFX specialists. The existing director
orchestrator runs through canonical `POST /v1/responses`: Performance sets the arc and
blocking, Stage supplies motivated lighting and atmosphere, Camera supplies lens-aware coverage,
and PostFX supplies restrained finishing. While the directors run, the room enters a planning
rehearsal: actor animation slows to 0.28x, the camera cycles through director-specific coverage,
and local Gateway TTS can speak each short briefing. These are bounded director summaries, not
hidden chain-of-thought. Only verified animation and cast IDs become clips. The generated project is ordinary
timeline data, so every clip can still be selected, moved, resized, removed, or replaced.
Project provenance records the showrunner, model, brief, enabled council, specialist notes,
briefing summaries, and generation time. Invalid output or an unavailable Gateway leaves the
current edit intact.

Attach a score and choose **Analyze score + singers** to run the local production-analysis path.
Web Audio decodes the file and measures its energy envelope, onset/beat candidates, and tempo.
Audio Lab then transcribes lyrics and diarises speaker turns through Gateway routes
`/voice-snip/transcribe-file` and `/voice-snip/diarise`. The result is aligned into semantic
sections with bounded arousal/valence evidence. Each detected singer has an editable actor
selector; changing it regenerates only the actor-scoped lipsync tracks. The current diarisation
model is speech-trained, so overlapping singing remains a review step rather than an automatic
identity claim.

The room supports Cyclorama, Black Box, Broadcast, and Neon Grid geometry with canonical
Core-X HDR environments. Camera language includes wide, two-shot, portrait, profile, orbit,
low-angle, overhead, and Dutch frames, with target actor, lens, transition, handheld, dolly,
pan, tilt, sweep, and orbit metadata. Lighting uses key/fill/rim presets for studio, concert,
noir, sunset, chiaroscuro, and silhouette, with beat/energy response.

Hologram, Toon, Chrome, and X-ray are real Three.js TSL `MeshStandardNodeMaterial` presets.
Stage tracks also control clean/aurora/pulse/monochrome procedural backdrops and dust/sparks/
rain/embers particles. Confetti uses dynamically imported Rapier rigid bodies and floor
collisions. The renderer selects WebGPU when available and otherwise uses the WebGL2 backend;
the chosen backend is visible in the stage and diagnostics.

Timeline projects use schema `avatar-labs.performance-project.v1`. Tracks cover audio,
animation, expression, shader, camera, lighting, environment, lipsync, and stage-effect events. Clips select,
drag, resize with 100ms snapping, and seek. Schedule sorting and validation execute in a
module Web Worker; playback, audio synchronization, state reconstruction after seek, and
Three.js rendering remain deterministic in the page runtime.

Project actions support local browser save, strict JSON import/export, optional score audio,
and explicit Warehouse publish/load. Warehouse records use kind `performance-project`,
source `performance-engine`, and `capabilities.performance_engine_project`; score audio is
a linked item rather than embedded binary data.

Canonical binaries are not copied into Avatar Labs. Development and preview stream Core-X
heads/HDRIs, Rigging Portal animations, and the RPM subset through read-only byte-range
routes. In unusual worktree layouts, set:

```bash
export AVATAR_LABS_COREX_PUBLIC_ROOT=/absolute/path/to/core-x/ui/public
export AVATAR_LABS_ANIMATION_ROOT=/absolute/path/to/rigging-portal/public/animation-library/fbx
export AVATAR_LABS_RPM_ANIMATION_ROOT=/absolute/path/to/project-anja/public/assets/animations/mixamo
```

## Verification

```bash
npm run verify
npm run test:browser
npm run test:performance
```

Expected results:

- TypeScript: no errors.
- Modernization contract: 11 routes and one AVARA house agent.
- Vite 8 production build: success.
- Launcher tests: desktop and mobile layouts contained.
- Renderer tests: Gemma canvas ready; Core-X WebGL fallback has morph targets.
- OpenResponses test: legacy house messages and tools translate to `/v1/responses`.
- Case tests: all eight workbench routes are contained at desktop and mobile sizes, and
  all five legacy avatar-bearing routes render a real full-body GLB without page errors.
- Stage Director tests: one control surface, prerequisite gating, Harmony JSON parsing,
  Warehouse query/publish contracts, and full-canvas framing at laptop, desktop, wide,
  and mobile viewports.
- Asset contract: sixteen avatars load; the historical `diego.glb` entry is unavailable
  and therefore omitted from the runtime selector.
- Performance Engine tests: WebGPU or explicit WebGL2 fallback, worker scheduler, two
  actors, six default clips, selectable timeline, rig-less head gating, TSL/environment
  switching, advancing transport, Warehouse project payload, foreign-schema rejection,
  exact desktop/mobile viewport containment, 39 reachable motion files, RPM retargeted
  playback, four-director generation, strict provenance, hallucinated-ID rejection,
  unchanged current project on Gateway failure, audible planning requests, two-singer
  diarisation/mapping, actor-scoped lipsync, cinematic camera cues, stage shaders/particles,
  and Rapier physics playback.

On 2026-07-18 the live local smoke path returned healthy service responses from Gateway `8090`,
MLX Audio `8093`, and Audio Lab `8098`. Gateway produced a 169,004-byte WAV from `tts/qwen`;
Audio Lab transcribed it as "Camera director ready. Slow profile coverage begins now." and
returned a `SPEAKER_02` diarisation segment through the same Gateway routes used by the UI.

The build currently reports the existing large shared Three.js/TalkingHead loader chunks.
Engine Lab's own entry is about 154 kB minified and its worker is emitted separately. Rapier is
a 2.24 MB dynamically loaded chunk and is fetched only for Confetti physics; shared 3D loader
code splitting should be measured before changing the bundle graph.

For latency evidence, run the benchmark documented in
`docs/reports/gemma-avatar-performance-review-2026-07-18.md`.
