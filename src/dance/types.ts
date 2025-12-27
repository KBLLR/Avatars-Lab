/**
 * Dance Module Types
 *
 * Schemas for dance animations, poses, and performance choreography.
 * Compatible with Mixamo FBX animations via TalkingHead's playAnimation/playPose.
 */

import type { Mood } from "../directors/types";

// ─────────────────────────────────────────────────────────────
// Animation & Pose Types
// ─────────────────────────────────────────────────────────────

export type AnimationSource = "mixamo" | "custom" | "builtin";
export type AnimationType = "dance" | "idle" | "gesture" | "transition" | "pose";

export interface AnimationClip {
  id: string;
  name: string;
  description?: string;
  url: string;                    // Path to FBX file
  source: AnimationSource;
  type?: AnimationType;           // Optional for idle/expression animations
  duration_ms: number;
  bpm?: number;                   // Beats per minute (for music sync)
  loopable: boolean;
  tags: string[];
  mood?: Mood | string;           // Can be Mood enum or string from JSON
  intensity?: "low" | "medium" | "high";
  created_at: string;
}

export interface PoseClip {
  id: string;
  name: string;
  description?: string;
  url: string;                    // Path to FBX pose file
  source: AnimationSource;
  duration_ms: number;            // How long to hold the pose
  tags: string[];
  mood?: Mood;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────
// Dance Styles & Genres
// ─────────────────────────────────────────────────────────────

export const DANCE_STYLES = [
  "hip-hop",
  "house",
  "breaking",
  "popping",
  "locking",
  "krump",
  "contemporary",
  "jazz",
  "ballet",
  "salsa",
  "swing",
  "twerk",
  "voguing",
  "freestyle",
  "robot",
  "wave",
  "tutting",
  "shuffling"
] as const;

export type DanceStyle = typeof DANCE_STYLES[number];

export const DANCE_MOODS = [
  "energetic",
  "chill",
  "dramatic",
  "playful",
  "sensual",
  "aggressive",
  "smooth",
  "quirky"
] as const;

export type DanceMood = typeof DANCE_MOODS[number];

// ─────────────────────────────────────────────────────────────
// Choreography & Sequencing
// ─────────────────────────────────────────────────────────────

export interface ChoreographyStep {
  clip_id: string;
  start_ms: number;
  duration_ms?: number;           // Override clip duration
  loop?: boolean;
  transition?: "cut" | "crossfade" | "blend";
  transition_ms?: number;
  mirror?: boolean;
  speed?: number;                 // Playback speed multiplier
}

export interface Choreography {
  id: string;
  name: string;
  description?: string;
  style: DanceStyle;
  mood: DanceMood;
  bpm?: number;
  duration_ms: number;
  steps: ChoreographyStep[];
  created_at: string;
}

// ─────────────────────────────────────────────────────────────
// Dance Director Types
// ─────────────────────────────────────────────────────────────

export interface DanceDirectorConfig {
  style?: DanceStyle;
  mood?: DanceMood;
  intensity?: "low" | "medium" | "high";
  bpm?: number;
  syncToMusic?: boolean;
  allowTransitions?: boolean;
  minClipDuration?: number;
  maxClipDuration?: number;
}

export interface DanceDirectorOutput {
  choreography: Choreography;
  clips: AnimationClip[];
  totalDuration: number;
}

// ─────────────────────────────────────────────────────────────
// Library Types
// ─────────────────────────────────────────────────────────────

export interface DanceLibrary {
  version: "1.0";
  updated_at: string;
  animations: AnimationClip[];
  expressions?: AnimationClip[];
  idle?: AnimationClip[];
  locomotion?: AnimationClip[];
  poses: PoseClip[];
  choreographies: Choreography[];
}

// ─────────────────────────────────────────────────────────────
// Animation Queue Integration
// ─────────────────────────────────────────────────────────────

/**
 * Represents an item to be pushed to TalkingHead's animQueue
 * via animFactory or direct manipulation
 */
export interface AnimQueueItem {
  name: string;
  type: "animation" | "pose" | "gesture" | "lookat" | "moveto";
  url?: string;
  duration?: number;
  loop?: boolean;
  mirror?: boolean;
  speed?: number;
  props?: Record<string, unknown>;
}

/**
 * Task item for TalkingHead's internal task processing
 */
export interface AnimTask {
  mt: string;                     // Task type: 'pose', 'gesture', 'moveto', etc.
  url?: string;
  template?: unknown;
  duration?: number;
  [key: string]: unknown;
}
