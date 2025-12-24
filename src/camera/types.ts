/**
 * Camera Movement Types
 * Defines all camera movement configurations
 */

import type { TalkingHead } from "@met4citizen/talkinghead";

/** Easing function signature */
export type EasingFn = (t: number) => number;

/** Named easing functions */
export type EasingName =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "bounce"
  | "elastic";

/** Camera state snapshot */
export interface CameraState {
  distance: number;
  x: number;
  y: number;
  rotateX: number;
  rotateY: number;
}

/** Base movement configuration */
export interface MovementConfig {
  duration_ms: number;
  easing?: EasingName;
  onComplete?: () => void;
}

/** Dolly movement (toward/away from subject) */
export interface DollyConfig extends MovementConfig {
  distance: number;  // positive = away, negative = toward
}

/** Pan movement (horizontal rotation) */
export interface PanConfig extends MovementConfig {
  angle: number;  // degrees, positive = right
}

/** Tilt movement (vertical rotation) */
export interface TiltConfig extends MovementConfig {
  angle: number;  // degrees, positive = up
}

/** Orbit movement (circular path around subject) */
export interface OrbitConfig extends MovementConfig {
  angle: number;      // degrees to orbit
  radius?: number;    // optional radius change
}

/** Shake effect (handheld camera simulation) */
export interface ShakeConfig {
  intensity: number;  // 0-1
  duration_ms: number;
  frequency?: number; // shakes per second, default 15
}

/** Punch zoom effect (quick zoom in/out) */
export interface PunchConfig {
  factor: number;     // 1.2 = 20% zoom in
  duration_ms: number;
}

/** Sweep movement (arc from angle A to B) */
export interface SweepConfig extends MovementConfig {
  startAngle: number;
  endAngle: number;
}

/** Active movement state for cancellation */
export interface ActiveMovement {
  type: string;
  startTime: number;
  rafId: number;
  originalState: CameraState;
}

/** Movement controller interface */
export interface CameraMovementController {
  dolly(head: TalkingHead, config: DollyConfig): void;
  pan(head: TalkingHead, config: PanConfig): void;
  tilt(head: TalkingHead, config: TiltConfig): void;
  orbit(head: TalkingHead, config: OrbitConfig): void;
  shake(head: TalkingHead, config: ShakeConfig): void;
  punch(head: TalkingHead, config: PunchConfig): void;
  sweep(head: TalkingHead, config: SweepConfig): void;
  cancel(): void;
  isMoving(): boolean;
}

/** Camera movement action names */
export type CameraMovementAction =
  | "camera_dolly"
  | "camera_pan"
  | "camera_tilt"
  | "camera_orbit"
  | "camera_shake"
  | "camera_punch"
  | "camera_sweep";

/** Preset movement combination */
export interface CameraPreset {
  name: string;
  description: string;
  movements: Array<{
    delay_ms: number;
    action: CameraMovementAction;
    config: DollyConfig | PanConfig | TiltConfig | OrbitConfig | ShakeConfig | PunchConfig | SweepConfig;
  }>;
}
