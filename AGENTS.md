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
