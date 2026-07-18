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
- `/engine-lab.html`: existing multi-layer performance editor.
- `/dance-studio.html`: choreography authoring and Mixamo-compatible preview.
- `/gestures-lab.html`: pose, expression, and blendshape inspection.
- `/multi-modal.html`: combined avatar, voice, text, and vision harness.
- `/mlx-conversation.html`: local voice conversation and avatar actions.
- `/composition-layer.html`: WebGL material, typography, and environment composition.
- `/head-audio.html`: AudioWorklet and MFCC viseme diagnostics.

The eight legacy cases share one responsive workbench bar and route picker. The six
avatar-bearing cases load a real GLB; Composition Layer and HeadAudio intentionally use
their own specialized rendering/probe surfaces.

## Verification

```bash
npm run verify
npm run test:browser
```

Expected results:

- TypeScript: no errors.
- Modernization contract: 11 routes and one AVARA house agent.
- Vite 8 production build: success.
- Launcher tests: desktop and mobile layouts contained.
- Renderer tests: Gemma canvas ready; Core-X WebGL fallback has morph targets.
- OpenResponses test: legacy house messages and tools translate to `/v1/responses`.
- Case tests: all eight workbench routes are contained at desktop and mobile sizes, and
  all six avatar-bearing routes render a real full-body GLB without page errors.
- Asset contract: sixteen avatars load; the historical `diego.glb` entry is unavailable
  and therefore omitted from the runtime selector.

For latency evidence, run the benchmark documented in
`docs/reports/gemma-avatar-performance-review-2026-07-18.md`.
