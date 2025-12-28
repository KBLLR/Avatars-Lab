/**
 * Multi-Layer Performance Engine - Core Types
 *
 * Defines data structures for coordinating 7 animation/control layers:
 * - viseme: Lip sync from audio
 * - dance: Full-body animations (Mixamo FBX)
 * - blendshape: Facial expressions / morph targets
 * - emoji: Emoji expression triggers
 * - lighting: Stage lighting presets & transitions
 * - camera: Camera movements & views
 * - fx: Post-processing effects
 */

import type { Mood } from "../directors/types";

// ============================================
// Layer Types & Identifiers
// ============================================

export const LAYER_TYPES = [
  "viseme",
  "dance",
  "blendshape",
  "emoji",
  "lighting",
  "camera",
  "fx",
] as const;

export type LayerType = (typeof LAYER_TYPES)[number];

export type BlendMode =
  | "override" // Layer completely replaces lower priority
  | "additive" // Values added to lower priority
  | "multiply" // Values multiplied with lower priority
  | "max" // Take maximum value
  | "min"; // Take minimum value

export interface LayerConfig {
  type: LayerType;
  id: string;
  name: string;
  enabled: boolean;
  locked: boolean;
  muted: boolean;
  priority: number; // Higher = wins in conflicts
  blendMode: BlendMode;
  color: string; // UI track color
}

// ============================================
// Easing Types
// ============================================

export type EasingType =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "bounce"
  | "elastic"
  | "step";

// ============================================
// Block Events (Cross-Layer Triggers)
// ============================================

export interface BlockEvent {
  type: "start" | "end" | "progress";
  progressThreshold?: number; // For "progress" type, 0-1
  targetLayerId: string;
  action: string;
  args?: Record<string, unknown>;
  delay_ms?: number;
}

// ============================================
// Timeline Block (Generic)
// ============================================

export interface TimelineBlock<T = unknown> {
  id: string;
  layerId: string;
  layerType: LayerType;
  start_ms: number;
  duration_ms: number;
  data: T;

  // Transition settings
  easeIn?: EasingType;
  easeOut?: EasingType;
  fadeIn_ms?: number;
  fadeOut_ms?: number;

  // Visual properties
  color?: string;
  label?: string;

  // Relationships
  linkedBlocks?: string[]; // IDs of blocks that should move together
  triggerEvents?: BlockEvent[];
}

// ============================================
// Layer-Specific Block Data Types
// ============================================

// Word timing from transcription
export interface WordTiming {
  words: string[];
  wtimes: number[];
  wdurations: number[];
}

// Viseme mapping for lip sync
export interface VisemeMapping {
  visemes: string[];
  vtimes: number[];
  vdurations: number[];
}

export interface VisemeBlockData {
  source: "audio" | "tts" | "manual";
  audioUrl?: string;
  text?: string;
  wordTimings?: WordTiming;
  visemeMapping?: VisemeMapping;
}

export interface DanceBlockData {
  clipId: string;
  clipUrl: string;
  loop?: boolean;
  mirror?: boolean;
  speed?: number;
  blendWeight?: number;
}

export interface MorphTarget {
  name: string;
  value: number;
}

export interface BlendshapeKeyframe {
  time_ms: number; // Relative to block start
  morphs: MorphTarget[];
  easing?: EasingType;
}

export interface BlendshapeBlockData {
  targetMorphs?: MorphTarget[];
  keyframes?: BlendshapeKeyframe[];
  mood?: Mood | string;
  emoji?: string;
  intensity?: number;
}

export interface EmojiBlockData {
  emoji: string;
}

export type LightTransition = "cut" | "fade" | "pulse";

export interface LightingBlockData {
  preset?: string;
  transition?: LightTransition;
  colors?: {
    ambient?: string;
    direct?: string;
    spot?: string;
  };
  intensities?: {
    ambient?: number;
    direct?: number;
    spot?: number;
  };
  audioPulse?: boolean;
}

export type CameraView = "full" | "mid" | "upper" | "head";

export type CameraMovementType =
  | "dolly"
  | "pan"
  | "tilt"
  | "orbit"
  | "shake"
  | "punch"
  | "sweep"
  | "static";

export interface CameraBlockData {
  movement?: CameraMovementType;
  view?: CameraView;
  target?: { x: number; y: number; z: number };
  distance?: number;
  orbit?: number;
  rotateX?: number;
  rotateY?: number;
  startAngle?: number;
  endAngle?: number;
  punch?: number;
  shake?: { intensity: number; frequency?: number };
  easing?: EasingType;
}

export type FXEffectType =
  | "bloom"
  | "vignette"
  | "chromatic"
  | "glitch"
  | "pixelation"
  | "none";

export interface FXKeyframe {
  time_ms: number;
  params: Record<string, number | boolean>;
  easing?: EasingType;
}

export interface FXBlockData {
  effect: FXEffectType;
  params: Record<string, number | boolean>;
  keyframes?: FXKeyframe[];
}

// ============================================
// Block Data Type Map
// ============================================

export type BlockDataMap = {
  viseme: VisemeBlockData;
  dance: DanceBlockData;
  blendshape: BlendshapeBlockData;
  emoji: EmojiBlockData;
  lighting: LightingBlockData;
  camera: CameraBlockData;
  fx: FXBlockData;
};

// Type guard for block data
export function getBlockData<T extends LayerType>(
  block: TimelineBlock,
  type: T
): BlockDataMap[T] | null {
  if (block.layerType !== type) return null;
  return block.data as BlockDataMap[T];
}

// ============================================
// Timeline Markers
// ============================================

export interface TimelineMarker {
  id: string;
  time_ms: number;
  label: string;
  color?: string;
  snapPoint?: boolean; // Timeline UI can snap to this
}

// ============================================
// Timeline Container
// ============================================

export interface Timeline {
  id: string;
  name: string;
  duration_ms: number;
  layers: LayerConfig[];
  blocks: TimelineBlock[];
  markers: TimelineMarker[];

  // Audio reference
  audioUrl?: string;
  audioBuffer?: AudioBuffer;

  // Metadata
  bpm?: number;
  created_at: string;
  updated_at: string;
}

// ============================================
// Engine State
// ============================================

export const ENGINE_STATES = [
  "idle",
  "loading",
  "ready",
  "playing",
  "paused",
  "seeking",
  "error",
] as const;

export type EngineState = (typeof ENGINE_STATES)[number];

export interface EngineStateEvent {
  type:
    | "stateChange"
    | "timeUpdate"
    | "layerUpdate"
    | "blockStart"
    | "blockEnd"
    | "seekComplete"
    | "error";
  state: EngineState;
  previousState?: EngineState;
  time_ms?: number;
  layerId?: string;
  blockId?: string;
  error?: Error;
}

// ============================================
// Factory Functions
// ============================================

export function createDefaultLayers(): LayerConfig[] {
  const colors: Record<LayerType, string> = {
    viseme: "#4CAF50",
    dance: "#2196F3",
    blendshape: "#FF9800",
    emoji: "#009688",
    lighting: "#FFEB3B",
    camera: "#9C27B0",
    fx: "#E91E63",
  };

  const names: Record<LayerType, string> = {
    viseme: "Lip Sync",
    dance: "Dance/Animation",
    blendshape: "Expressions",
    emoji: "Emoji",
    lighting: "Lighting",
    camera: "Camera",
    fx: "Effects",
  };

  return LAYER_TYPES.map((type, index) => ({
    type,
    id: type,
    name: names[type],
    enabled: true,
    locked: false,
    muted: false,
    priority: LAYER_TYPES.length - index,
    blendMode: "override" as BlendMode,
    color: colors[type],
  }));
}

export function createTimeline(
  name: string,
  duration_ms: number
): Timeline {
  return {
    id: `timeline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    duration_ms,
    layers: createDefaultLayers(),
    blocks: [],
    markers: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function createBlock<T extends LayerType>(
  layerType: T,
  layerId: string,
  start_ms: number,
  duration_ms: number,
  data: BlockDataMap[T],
  label?: string
): TimelineBlock<BlockDataMap[T]> {
  return {
    id: `block_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    layerId,
    layerType,
    start_ms,
    duration_ms,
    data,
    label,
  };
}
