/**
 * Multi-Layer Performance Engine
 *
 * Coordinates 7 animation/control layers through a unified state machine:
 * - viseme: Lip sync from audio
 * - dance: Full-body animations
 * - blendshape: Facial expressions
 * - emoji: Emoji expressions
 * - lighting: Stage lighting
 * - camera: Camera movements
 * - fx: Post-processing effects
 */

// Core types
export * from "./types";

// State machine
export { EngineStateMachine } from "./engine-state-machine";
export type { EngineConfig } from "./engine-state-machine";

// Executors
export * from "./executors";

// Director plan adapter
export * from "./director-adapter";

// UI Components
export * from "./ui";

// Timeline persistence
export * from "./timeline-persistence";

// Dance library integration
export * from "./dance-integration";

// Engine runner (main integration)
export { EngineRunner, createEngineRunner } from "./engine-runner";
export type {
  EngineRunnerConfig,
  EngineRunnerState,
  EngineRunnerEvent,
  EngineRunnerEventType,
} from "./engine-runner";
