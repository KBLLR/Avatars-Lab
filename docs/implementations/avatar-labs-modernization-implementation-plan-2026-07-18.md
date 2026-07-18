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

Core-X topology remains the process owner. Avatar Labs starts only its own Vite surface.

## Verification Gates

- strict TypeScript typecheck
- modernization contract test
- Vite production build
- launcher desktop/mobile Playwright test
- Gemma Avatar and Core-X head renderer Playwright test
- all-case desktop/mobile containment and six-case real-GLB rendering test
- house manifest schema validation
- three-run local/reference latency sample with the comparison scope recorded

## Explicit Non-Goals

- Recreating the hosted Space's VAD, STT, Gemma/Cerebras, tools, and barge-in stack.
- Introducing cloud inference or a second service registry.
- Duplicating Core-X head binaries in the house repo.
