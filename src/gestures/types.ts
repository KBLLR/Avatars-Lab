/**
 * Gesture Library Types
 *
 * High-level TalkingHead actions preferred over skeletal clips.
 * GLB animations only when absolutely needed (no FBX runtime retargeting).
 */

import type { Mood } from "../directors/types";

export interface MorphKeyframe {
  time_ms: number;
  value: number;
}

export interface MorphCurve {
  morph_target: string;
  keyframes: MorphKeyframe[];
}

export interface GestureDefinition {
  name: string;                  // TalkingHead built-in: handup, index, ok, thumbup, etc.
  duration?: number;             // seconds
  mirror?: boolean;
}

export interface LookAtDefinition {
  x: number;                     // 0-1
  y: number;                     // 0-1
  t: number;                     // duration in ms
}

export interface GlbAnimation {
  url: string;                   // path to GLB with animation
  animation_name: string;        // name inside the GLB
  scale?: number;                // scale factor (default 1)
}

export interface GestureClip {
  id: string;                    // UUID or slug
  name: string;
  description?: string;
  tags: string[];                // e.g. ["happy", "hand", "subtle"]
  duration_ms: number;
  created_at: string;            // ISO timestamp
  updated_at?: string;

  // High-level TalkingHead actions (preferred)
  gesture?: GestureDefinition;
  emoji?: string;                // e.g. "😊"
  mood?: Mood;
  look_at?: LookAtDefinition;

  // Custom morph curves (when built-ins don't suffice)
  morph_curves?: MorphCurve[];

  // Pre-baked GLB animation (only if absolutely needed)
  glb_animation?: GlbAnimation;
}

export interface GestureLibrary {
  version: "1.0";
  updated_at: string;
  clips: GestureClip[];
}

// Built-in TalkingHead gestures
export const BUILTIN_GESTURES = [
  "handup",
  "index",
  "ok",
  "thumbup",
  "thumbdown",
  "side",
  "shrug",
  "namaste"
] as const;

export type BuiltinGesture = typeof BUILTIN_GESTURES[number];

// Common tags for filtering
export const GESTURE_TAGS = [
  "happy",
  "sad",
  "angry",
  "neutral",
  "excited",
  "subtle",
  "dramatic",
  "hand",
  "face",
  "head",
  "body",
  "greeting",
  "farewell",
  "listening",
  "speaking",
  "thinking"
] as const;

export type GestureTag = typeof GESTURE_TAGS[number];
