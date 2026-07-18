# Avatar Labs Agent Contract

## Purpose

Avatar Labs is the Core-X house for local-first avatar rendering, speech animation,
performance authoring, and validation. Its named house orchestrator is AVARA
(`orchestrator:avatar-labs:avara`) and its default house agent is
`avatar-labs:avatar-director`.

Read the root `PROJECT_GUIDE.md`, `RULES.md`, and `AGENTS.md`, then read:

1. `house.manifest.json`
2. `functions.manifest.json`
3. `src/cases/registry.ts`
4. This file

## Runtime Contract

- Canonical surface: `http://127.0.0.1:5185`
- Canonical service edge: Core-X Gateway at `http://127.0.0.1:8090`
- Normal inference clients use Gateway routes. Do not add direct lane ports to UI code.
- Core-X topology owns MLX process lifecycle. `npm run dev` starts only the house UI.
- If Gateway or a required MLX lane is offline, report it; do not silently use cloud inference.
- Shared Core-X head assets are streamed through `/corex-assets` in dev and preview.
  Do not duplicate the binary head library in this repo.

## Rendering Contract

- `corex-head.html` is WebGPU-first with an explicit WebGL2 fallback.
- `gemma-avatar.html` uses TalkingHead's WebGL renderer for reference compatibility.
- Keep the main 3D stage full-bleed and unframed.
- Verify canvas dimensions and pixels in a real browser after renderer changes.
- Preserve `?renderer=webgl` as the deterministic compatibility-test path.

## Case Architecture

The launcher roster in `src/cases/registry.ts` is the source of truth for visible cases.
Every listed case must resolve to a real HTML entrypoint and be declared in
`house.manifest.json`.

The Gemma Avatar case is a bounded latency reference:

`text -> Gateway -> local Qwen TTS stream -> AudioWorklet -> HeadAudio visemes`

It does not implement the reference Space's microphone, VAD, STT, LLM, tool-call,
or barge-in loop. Do not describe it as end-to-end parity until those capabilities
exist and are tested.

Performance Engine uses the generated `/performance-assets/catalog.json` view of
reachable Rigging Portal and RPM/Project Anja FBX files. Do not reintroduce the stale
`public/dance/library.json` URLs as runtime truth or copy the owning binaries here.

Performance Director is the Performance Engine showrunner. It delegates specialist plans
to the existing Stage, Camera, and PostFX directors through Gateway `/v1/responses`, then
materializes validated, editable tracks. Generated projects must record director/model/
brief/council provenance, reject unknown cast or animation IDs, and remain unchanged when
the director pipeline fails instead of silently accepting a heuristic show.

Director planning is an observable rehearsal, not hidden model reasoning. Surface only each
director's short, speakable briefing summary; never request or display private chain-of-thought.
Briefings may use local Gateway TTS while the room previews slow actor motion and changing
camera coverage. Planning remains sequential so Stage, Camera, and PostFX can build on the
showrunner's bounded plan.

Attached scores are analyzed locally. Browser Web Audio supplies signal energy and beat/onset
evidence; Audio Lab `/voice-snip/transcribe-file` and `/voice-snip/diarise` supply transcript
and speaker turns through Gateway. Singer-to-actor assignments remain editable and compile to
actor-scoped lipsync tracks. Treat singing diarisation as best-effort: the current model is
speech-trained and overlapping singers require operator review. Do not claim source separation
or production-grade singer identity until those stages exist and are verified.

Stage atmosphere is project data, not decorative page state. Camera, motivated three-point
lighting, procedural TSL backdrop, particles, and optional Rapier rigid-body effects compile
through the same timeline/schedule/controller path as actor motion. Keep physics dynamically
loaded and preserve WebGPU-to-WebGL2 compatibility.

## Development

```bash
npm install
npm run dev
npm run verify
npm run test:browser
```

Useful focused commands:

```bash
npm run typecheck
npm run test:modernization
npm run test:launcher
npm run test:gemma
npm run test:performance
npm run build
```

The browser suite uses the installed Chrome by default. Override with
`PLAYWRIGHT_CHANNEL` only when a mission requires another browser.

## Source Control

- Work from an isolated house worktree based on `origin/main`.
- Keep one task per branch and stage exact paths only.
- Commit and push the house branch before a root gitlink update.
- A root gitlink may point only to a nested commit reachable from the house remote.
- Never include generated model snapshots, caches, media, or model weights in a source commit.

## Quality Boundaries

- Keep UI geometry stable at desktop and mobile viewports.
- Use the local design source under `core-x/docs/design/AvatarsLab` when available.
- Treat performance claims as measured evidence, including cold/warm state and scope.
- Avoid new registries, port maps, service launchers, memory stores, or cloud fallbacks.
