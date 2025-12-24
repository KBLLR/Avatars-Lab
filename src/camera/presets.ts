/**
 * Camera Movement Presets
 * Named combinations of movements for common scenarios
 */

import type { CameraPreset } from "./types";

export const CAMERA_PRESETS: CameraPreset[] = [
  {
    name: "dramatic-intro",
    description: "Slow dolly in with slight orbit for dramatic entrances",
    movements: [
      { delay_ms: 0, action: "camera_dolly", config: { distance: -0.5, duration_ms: 3000, easing: "easeInOut" } },
      { delay_ms: 500, action: "camera_orbit", config: { angle: 15, duration_ms: 2500, easing: "easeOut" } }
    ]
  },
  {
    name: "hype-drop",
    description: "Quick punch zoom with shake for high-energy moments",
    movements: [
      { delay_ms: 0, action: "camera_punch", config: { factor: 1.3, duration_ms: 300 } },
      { delay_ms: 300, action: "camera_shake", config: { intensity: 0.5, duration_ms: 500 } }
    ]
  },
  {
    name: "intimate-closeup",
    description: "Gentle push-in to head shot",
    movements: [
      { delay_ms: 0, action: "camera_dolly", config: { distance: -0.8, duration_ms: 2000, easing: "easeOut" } },
      { delay_ms: 0, action: "camera_tilt", config: { angle: -5, duration_ms: 2000, easing: "easeOut" } }
    ]
  },
  {
    name: "reveal-sweep",
    description: "Wide arc reveal from side to front",
    movements: [
      { delay_ms: 0, action: "camera_sweep", config: { startAngle: -45, endAngle: 0, duration_ms: 3000, easing: "easeInOut" } }
    ]
  },
  {
    name: "tension-build",
    description: "Slow creeping dolly with subtle shake",
    movements: [
      { delay_ms: 0, action: "camera_dolly", config: { distance: -0.3, duration_ms: 4000, easing: "easeIn" } },
      { delay_ms: 2000, action: "camera_shake", config: { intensity: 0.15, duration_ms: 2000 } }
    ]
  },
  {
    name: "pullback-resolve",
    description: "Pull back to wide shot for resolution",
    movements: [
      { delay_ms: 0, action: "camera_dolly", config: { distance: 0.6, duration_ms: 2500, easing: "easeInOut" } }
    ]
  }
];

/** Get preset by name */
export function getCameraPreset(name: string): CameraPreset | undefined {
  return CAMERA_PRESETS.find(p => p.name === name);
}

/** List all preset names */
export function getCameraPresetNames(): string[] {
  return CAMERA_PRESETS.map(p => p.name);
}
