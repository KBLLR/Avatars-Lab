# Avatar Labs Implementation Plan

## Goal
Bootstrap the avatar-labs house as a Vite project with deterministic MLX-backed tests for TalkingHead, HeadAudio, and a HeadTTS-compatible bridge.

## Steps
1. Audit upstream TalkingHead/HeadAudio/HeadTTS APIs and local MLX contracts/manifests to lock required endpoints and assets.
2. Scaffold Vite project structure with scripts, docs, fixtures, and test harnesses.
3. Implement contract/connectivity tests for MLX LLM/Audio/STT and data-pool event logging.
4. Implement browser harness for HeadAudio and Playwright E2E tests for TalkingHead streaming with local GLB fixtures.
5. Add optional HeadTTS-compatible bridge and response-shape tests.
6. Finalize documentation, runner scripts, and verification guidance.

## Verification
- `zsh houses/avatar-labs/scripts/smoke.zsh`
- `zsh houses/avatar-labs/scripts/e2e.zsh`
- `zsh houses/avatar-labs/scripts/all.zsh`
