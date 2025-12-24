# Video Features Task Board

## Mission
Expand Avatar Labs with cinematic camera movements, post-processing effects, video export, and environment maps. Each module integrates with the AI Director pipeline for autonomous creative decisions.

---

## Quick Start for New Agents

```bash
# 1. Read this file completely
# 2. Check current sprint status below
# 3. Read the key reference files for that sprint
# 4. Follow the step-by-step implementation guide
# 5. Run build after each file: npm run build
# 6. Test with: npm run dev
```

**Critical Pattern**: Types → Core → Director → Scheduler → UI

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    DIRECTOR PIPELINE                             │
│  PerformanceDirector → StageDirector → CameraDirector            │
│         ↓                    ↓                ↓                  │
│    mood, gestures      lighting, env     camera moves            │
│                              ↓                                   │
│                      EffectDirector (NEW)                        │
│                      post-processing                             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                    RENDER PIPELINE                               │
│  TalkingHead → EffectComposer → Canvas → MediaRecorder          │
│       ↑              ↑            ↑                              │
│   Environment    Post-FX      Export Layout                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Current Status

| Sprint | Status | Notes |
|--------|--------|-------|
| 1. Camera Movements | 🔄 In Progress | Directory created, files pending |
| 2. Post-Processing | ⏳ Pending | After Sprint 1 |
| 3. Export System | ⏳ Pending | After Sprint 2 |
| 4. Environments | ⏳ Pending | After Sprint 3 |
| 5. AI Integration | ⏳ Pending | After Sprint 4 |

---

## Sprint 1: Camera Movement System

### Goal
Implement cinematic camera movements that the CameraDirector can choreograph.

### Prerequisites
- Understand TalkingHead camera API (see Reference section below)
- Directory `src/camera/` already created

### Reference: TalkingHead Camera API
```typescript
// From src/scene/camera.ts - current implementation
head.opt.cameraDistance  // number: distance from subject
head.opt.cameraX         // number: horizontal offset
head.opt.cameraY         // number: vertical offset
head.opt.cameraRotateX   // number: vertical rotation (tilt)
head.opt.cameraRotateY   // number: horizontal rotation (pan)
head.setView(view, options)  // "full" | "mid" | "upper" | "head"
head.controls.autoRotate // boolean
head.controls.autoRotateSpeed // number
```

### Step 1: Create `src/camera/types.ts`

```typescript
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
```

### Step 2: Create `src/camera/easing.ts`

```typescript
/**
 * Easing Functions
 * Standard easing curves for smooth animations
 */

import type { EasingFn, EasingName } from "./types";

/** Linear interpolation (no easing) */
export const linear: EasingFn = (t) => t;

/** Quadratic ease-in */
export const easeIn: EasingFn = (t) => t * t;

/** Quadratic ease-out */
export const easeOut: EasingFn = (t) => t * (2 - t);

/** Quadratic ease-in-out */
export const easeInOut: EasingFn = (t) =>
  t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

/** Bounce effect */
export const bounce: EasingFn = (t) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
};

/** Elastic effect */
export const elastic: EasingFn = (t) => {
  if (t === 0 || t === 1) return t;
  const p = 0.3;
  const s = p / 4;
  return Math.pow(2, -10 * t) * Math.sin((t - s) * (2 * Math.PI) / p) + 1;
};

/** Easing function lookup */
export const EASING_FUNCTIONS: Record<EasingName, EasingFn> = {
  linear,
  easeIn,
  easeOut,
  easeInOut,
  bounce,
  elastic
};

/** Get easing function by name */
export function getEasing(name?: EasingName): EasingFn {
  return EASING_FUNCTIONS[name || "easeInOut"] || easeInOut;
}

/** Interpolate between two values */
export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}
```

### Step 3: Create `src/camera/movements.ts`

```typescript
/**
 * Camera Movement Implementations
 * Individual movement functions using requestAnimationFrame
 */

import type { TalkingHead } from "@met4citizen/talkinghead";
import type {
  CameraState,
  ActiveMovement,
  DollyConfig,
  PanConfig,
  TiltConfig,
  OrbitConfig,
  ShakeConfig,
  PunchConfig,
  SweepConfig
} from "./types";
import { getEasing, lerp } from "./easing";

/** Current active movement (only one at a time) */
let activeMovement: ActiveMovement | null = null;

/** Get current camera state from TalkingHead */
export function getCameraState(head: TalkingHead): CameraState {
  return {
    distance: head.opt.cameraDistance,
    x: head.opt.cameraX,
    y: head.opt.cameraY,
    rotateX: head.opt.cameraRotateX,
    rotateY: head.opt.cameraRotateY
  };
}

/** Apply camera state to TalkingHead */
export function applyCameraState(head: TalkingHead, state: Partial<CameraState>): void {
  if (state.distance !== undefined) head.opt.cameraDistance = state.distance;
  if (state.x !== undefined) head.opt.cameraX = state.x;
  if (state.y !== undefined) head.opt.cameraY = state.y;
  if (state.rotateX !== undefined) head.opt.cameraRotateX = state.rotateX;
  if (state.rotateY !== undefined) head.opt.cameraRotateY = state.rotateY;
}

/** Cancel any active movement */
export function cancelMovement(): void {
  if (activeMovement) {
    cancelAnimationFrame(activeMovement.rafId);
    activeMovement = null;
  }
}

/** Check if a movement is active */
export function isMoving(): boolean {
  return activeMovement !== null;
}

/** Dolly: Move toward/away from subject */
export function dolly(head: TalkingHead, config: DollyConfig): void {
  cancelMovement();

  const startState = getCameraState(head);
  const targetDistance = startState.distance + config.distance;
  const easing = getEasing(config.easing);
  const startTime = performance.now();

  function animate(now: number) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / config.duration_ms, 1);
    const easedProgress = easing(progress);

    head.opt.cameraDistance = lerp(startState.distance, targetDistance, easedProgress);

    if (progress < 1) {
      activeMovement = {
        type: "dolly",
        startTime,
        rafId: requestAnimationFrame(animate),
        originalState: startState
      };
    } else {
      activeMovement = null;
      config.onComplete?.();
    }
  }

  activeMovement = {
    type: "dolly",
    startTime,
    rafId: requestAnimationFrame(animate),
    originalState: startState
  };
}

/** Pan: Horizontal rotation */
export function pan(head: TalkingHead, config: PanConfig): void {
  cancelMovement();

  const startState = getCameraState(head);
  const targetRotateY = startState.rotateY + (config.angle * Math.PI / 180);
  const easing = getEasing(config.easing);
  const startTime = performance.now();

  function animate(now: number) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / config.duration_ms, 1);
    const easedProgress = easing(progress);

    head.opt.cameraRotateY = lerp(startState.rotateY, targetRotateY, easedProgress);

    if (progress < 1) {
      activeMovement = {
        type: "pan",
        startTime,
        rafId: requestAnimationFrame(animate),
        originalState: startState
      };
    } else {
      activeMovement = null;
      config.onComplete?.();
    }
  }

  activeMovement = {
    type: "pan",
    startTime,
    rafId: requestAnimationFrame(animate),
    originalState: startState
  };
}

/** Tilt: Vertical rotation */
export function tilt(head: TalkingHead, config: TiltConfig): void {
  cancelMovement();

  const startState = getCameraState(head);
  const targetRotateX = startState.rotateX + (config.angle * Math.PI / 180);
  const easing = getEasing(config.easing);
  const startTime = performance.now();

  function animate(now: number) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / config.duration_ms, 1);
    const easedProgress = easing(progress);

    head.opt.cameraRotateX = lerp(startState.rotateX, targetRotateX, easedProgress);

    if (progress < 1) {
      activeMovement = {
        type: "tilt",
        startTime,
        rafId: requestAnimationFrame(animate),
        originalState: startState
      };
    } else {
      activeMovement = null;
      config.onComplete?.();
    }
  }

  activeMovement = {
    type: "tilt",
    startTime,
    rafId: requestAnimationFrame(animate),
    originalState: startState
  };
}

/** Orbit: Circular path around subject */
export function orbit(head: TalkingHead, config: OrbitConfig): void {
  cancelMovement();

  const startState = getCameraState(head);
  const angleRad = config.angle * Math.PI / 180;
  const easing = getEasing(config.easing);
  const startTime = performance.now();

  function animate(now: number) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / config.duration_ms, 1);
    const easedProgress = easing(progress);

    const currentAngle = angleRad * easedProgress;
    head.opt.cameraRotateY = startState.rotateY + currentAngle;

    // Optional radius change during orbit
    if (config.radius !== undefined) {
      head.opt.cameraDistance = lerp(startState.distance, config.radius, easedProgress);
    }

    if (progress < 1) {
      activeMovement = {
        type: "orbit",
        startTime,
        rafId: requestAnimationFrame(animate),
        originalState: startState
      };
    } else {
      activeMovement = null;
      config.onComplete?.();
    }
  }

  activeMovement = {
    type: "orbit",
    startTime,
    rafId: requestAnimationFrame(animate),
    originalState: startState
  };
}

/** Shake: Handheld camera simulation */
export function shake(head: TalkingHead, config: ShakeConfig): void {
  cancelMovement();

  const startState = getCameraState(head);
  const frequency = config.frequency || 15;
  const startTime = performance.now();

  function animate(now: number) {
    const elapsed = now - startTime;
    const progress = elapsed / config.duration_ms;

    if (progress >= 1) {
      // Restore original position
      applyCameraState(head, startState);
      activeMovement = null;
      return;
    }

    // Decay intensity over time
    const currentIntensity = config.intensity * (1 - progress);

    // Random offset based on frequency
    const phase = (elapsed / 1000) * frequency * Math.PI * 2;
    const offsetX = Math.sin(phase) * currentIntensity * 0.1;
    const offsetY = Math.cos(phase * 1.3) * currentIntensity * 0.1;
    const offsetRotX = Math.sin(phase * 0.7) * currentIntensity * 0.02;
    const offsetRotY = Math.cos(phase * 0.9) * currentIntensity * 0.02;

    head.opt.cameraX = startState.x + offsetX;
    head.opt.cameraY = startState.y + offsetY;
    head.opt.cameraRotateX = startState.rotateX + offsetRotX;
    head.opt.cameraRotateY = startState.rotateY + offsetRotY;

    activeMovement = {
      type: "shake",
      startTime,
      rafId: requestAnimationFrame(animate),
      originalState: startState
    };
  }

  activeMovement = {
    type: "shake",
    startTime,
    rafId: requestAnimationFrame(animate),
    originalState: startState
  };
}

/** Punch: Quick zoom in/out */
export function punch(head: TalkingHead, config: PunchConfig): void {
  cancelMovement();

  const startState = getCameraState(head);
  const targetDistance = startState.distance / config.factor;
  const startTime = performance.now();
  const halfDuration = config.duration_ms / 2;

  function animate(now: number) {
    const elapsed = now - startTime;
    const progress = elapsed / config.duration_ms;

    if (progress >= 1) {
      head.opt.cameraDistance = startState.distance;
      activeMovement = null;
      return;
    }

    // Zoom in first half, zoom out second half
    let easedProgress: number;
    if (elapsed < halfDuration) {
      easedProgress = elapsed / halfDuration;
      head.opt.cameraDistance = lerp(startState.distance, targetDistance, easedProgress);
    } else {
      easedProgress = (elapsed - halfDuration) / halfDuration;
      head.opt.cameraDistance = lerp(targetDistance, startState.distance, easedProgress);
    }

    activeMovement = {
      type: "punch",
      startTime,
      rafId: requestAnimationFrame(animate),
      originalState: startState
    };
  }

  activeMovement = {
    type: "punch",
    startTime,
    rafId: requestAnimationFrame(animate),
    originalState: startState
  };
}

/** Sweep: Arc from angle A to B */
export function sweep(head: TalkingHead, config: SweepConfig): void {
  cancelMovement();

  const startState = getCameraState(head);
  const startAngleRad = config.startAngle * Math.PI / 180;
  const endAngleRad = config.endAngle * Math.PI / 180;
  const easing = getEasing(config.easing);
  const startTime = performance.now();

  // Set initial position
  head.opt.cameraRotateY = startState.rotateY + startAngleRad;

  function animate(now: number) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / config.duration_ms, 1);
    const easedProgress = easing(progress);

    const currentAngle = lerp(startAngleRad, endAngleRad, easedProgress);
    head.opt.cameraRotateY = startState.rotateY + currentAngle;

    if (progress < 1) {
      activeMovement = {
        type: "sweep",
        startTime,
        rafId: requestAnimationFrame(animate),
        originalState: startState
      };
    } else {
      activeMovement = null;
      config.onComplete?.();
    }
  }

  activeMovement = {
    type: "sweep",
    startTime,
    rafId: requestAnimationFrame(animate),
    originalState: startState
  };
}
```

### Step 4: Create `src/camera/presets.ts`

```typescript
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
```

### Step 5: Create `src/camera/index.ts`

```typescript
/**
 * Camera Module - Barrel Exports
 */

export * from "./types";
export * from "./easing";
export * from "./movements";
export * from "./presets";
```

### Step 6: Update `src/directors/types.ts`

Add to the existing CAMERA_ACTIONS_COMPACT array:

```typescript
// Find the CAMERA_ACTIONS_COMPACT export and ADD these lines:
export const CAMERA_MOVEMENT_ACTIONS = [
  "camera_dolly(distance: number, duration_ms: number, easing?: linear|easeIn|easeOut|easeInOut)",
  "camera_pan(angle: number, duration_ms: number, easing?: linear|easeIn|easeOut|easeInOut)",
  "camera_tilt(angle: number, duration_ms: number, easing?: linear|easeIn|easeOut|easeInOut)",
  "camera_orbit(angle: number, duration_ms: number, easing?: linear|easeIn|easeOut|easeInOut)",
  "camera_shake(intensity: 0-1, duration_ms: number)",
  "camera_punch(factor: number, duration_ms: number)",
  "camera_sweep(startAngle: number, endAngle: number, duration_ms: number, easing?: string)"
] as const;
```

### Step 7: Update `src/directors/camera-director.ts`

In the buildPrompt method, add movement actions:

```typescript
// Add import at top
import { CAMERA_MOVEMENT_ACTIONS } from "./types";

// In buildPrompt, update CAMERA ACTIONS section:
CAMERA ACTIONS:
${CAMERA_ACTIONS_COMPACT.join("\n")}

CAMERA MOVEMENTS (cinematic):
${CAMERA_MOVEMENT_ACTIONS.join("\n")}

MOVEMENT GUIDE:
- dolly: Move toward (negative) or away (positive) from subject
- pan: Horizontal rotation in degrees
- tilt: Vertical rotation in degrees
- orbit: Circular path around subject
- shake: Handheld camera effect for intensity/energy
- punch: Quick zoom for impact moments
- sweep: Arc movement from start to end angle
```

### Step 8: Update `src/performance/action-scheduler.ts`

Add imports and case handlers:

```typescript
// Add import at top
import {
  dolly, pan, tilt, orbit, shake, punch, sweep,
  type DollyConfig, type PanConfig, type TiltConfig,
  type OrbitConfig, type ShakeConfig, type PunchConfig, type SweepConfig
} from "../camera";

// In scheduleAction switch statement, add these cases:
case "camera_dolly":
  dolly(head, args as DollyConfig);
  break;
case "camera_pan":
  pan(head, args as PanConfig);
  break;
case "camera_tilt":
  tilt(head, args as TiltConfig);
  break;
case "camera_orbit":
  orbit(head, args as OrbitConfig);
  break;
case "camera_shake":
  shake(head, args as ShakeConfig);
  break;
case "camera_punch":
  punch(head, args as PunchConfig);
  break;
case "camera_sweep":
  sweep(head, args as SweepConfig);
  break;
```

### Sprint 1 Acceptance Criteria
- [ ] `npm run build` passes with no errors
- [ ] All 6 camera files exist in `src/camera/`
- [ ] CAMERA_MOVEMENT_ACTIONS exported from `src/directors/types.ts`
- [ ] CameraDirector prompt includes movement actions
- [ ] action-scheduler handles all 7 movement types
- [ ] Manual test: movements execute smoothly at 60fps
- [ ] Manual test: movements can be cancelled by new movement

### Common Pitfalls
1. **TalkingHead not ready**: Always check `if (!head) return;` before applying
2. **Radians vs Degrees**: API uses radians, config uses degrees - convert!
3. **RAF cleanup**: Always store rafId and cancel on new movement
4. **Type imports**: Use `import type` for interfaces

---

## Sprint 2: Post-Processing Effects

### Goal
Add EffectComposer with bloom, vignette, color grading for cinematic look.

### Prerequisites
- Sprint 1 complete
- Understand Three.js postprocessing (TalkingHead uses Three.js internally)

### Critical Discovery Task
Before implementing, you MUST investigate TalkingHead's renderer access:

```typescript
// Check these properties exist on TalkingHead instance:
head.renderer      // WebGLRenderer?
head.scene         // Scene?
head.camera        // Camera?
head.composer      // Already has EffectComposer?
head.onRender      // Callback hook?
```

Read the TalkingHead source or test in browser console first!

### Step 1: Create `src/effects/types.ts`

```typescript
/**
 * Post-Processing Effect Types
 */

/** Bloom pass configuration */
export interface BloomConfig {
  strength: number;    // 0-2, default 1
  radius: number;      // 0-1, default 0.5
  threshold: number;   // 0-1, default 0.5
}

/** Vignette pass configuration */
export interface VignetteConfig {
  darkness: number;    // 0-1
  offset: number;      // 0-1
}

/** Color grading configuration */
export interface ColorGradingConfig {
  saturation?: number;   // 0-2, default 1
  contrast?: number;     // 0-2, default 1
  brightness?: number;   // 0-2, default 1
  lut?: string;          // LUT file path
}

/** Film effect configuration */
export interface FilmConfig {
  grain?: number;              // 0-1
  grainAnimated?: boolean;
  chromaticAberration?: number; // 0-0.1
}

/** Combined effect state */
export interface EffectsState {
  enabled: boolean;
  bloom?: BloomConfig;
  vignette?: VignetteConfig;
  colorGrading?: ColorGradingConfig;
  film?: FilmConfig;
}

/** Effect preset name */
export type EffectPresetName =
  | "clean"
  | "neon-glow"
  | "film-noir"
  | "warm-sunset"
  | "music-video";
```

### Step 2: Create `src/effects/composer.ts`

```typescript
/**
 * EffectComposer Integration
 * Wraps TalkingHead renderer with post-processing
 */

import type { TalkingHead } from "@met4citizen/talkinghead";
import type { EffectsState, BloomConfig, VignetteConfig } from "./types";
// Three.js imports - check if available via TalkingHead
// import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
// import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
// import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';

let effectsState: EffectsState = { enabled: false };
let composer: unknown = null; // EffectComposer when initialized

/**
 * Initialize EffectComposer with TalkingHead
 * Call this after TalkingHead is fully initialized
 */
export async function initEffects(head: TalkingHead): Promise<boolean> {
  // TODO: Investigate TalkingHead renderer access
  // This is the critical integration point

  // Option A: Direct renderer access
  // const renderer = head.renderer;
  // const scene = head.scene;
  // const camera = head.camera;

  // Option B: Hook into render loop
  // head.onRender = (renderer, scene, camera) => { ... }

  // Option C: Canvas post-processing (fallback)
  // const canvas = document.querySelector('canvas');

  console.warn("[Effects] initEffects not yet implemented - needs TalkingHead investigation");
  return false;
}

/**
 * Update effect configuration
 */
export function updateEffects(newState: Partial<EffectsState>): void {
  effectsState = { ...effectsState, ...newState };
  // Apply to composer passes...
}

/**
 * Set bloom parameters
 */
export function setBloom(config: BloomConfig): void {
  effectsState.bloom = config;
  // Apply to bloom pass...
}

/**
 * Set vignette parameters
 */
export function setVignette(config: VignetteConfig): void {
  effectsState.vignette = config;
  // Apply to vignette pass...
}

/**
 * Get current effects state
 */
export function getEffectsState(): EffectsState {
  return { ...effectsState };
}

/**
 * Dispose of effects resources
 */
export function disposeEffects(): void {
  if (composer) {
    // composer.dispose();
    composer = null;
  }
  effectsState = { enabled: false };
}
```

### Step 3: Create `src/effects/presets.ts`

```typescript
/**
 * Effect Presets
 * Named combinations for quick application
 */

import type { EffectsState, EffectPresetName } from "./types";

export const EFFECT_PRESETS: Record<EffectPresetName, EffectsState> = {
  "clean": {
    enabled: false
  },
  "neon-glow": {
    enabled: true,
    bloom: { strength: 1.5, radius: 0.6, threshold: 0.3 },
    colorGrading: { saturation: 1.3, contrast: 1.1 }
  },
  "film-noir": {
    enabled: true,
    vignette: { darkness: 0.8, offset: 0.3 },
    colorGrading: { saturation: 0.3, contrast: 1.4 },
    film: { grain: 0.3 }
  },
  "warm-sunset": {
    enabled: true,
    bloom: { strength: 0.5, radius: 0.8, threshold: 0.6 },
    colorGrading: { saturation: 1.1, brightness: 1.1 }
  },
  "music-video": {
    enabled: true,
    bloom: { strength: 1.0, radius: 0.5, threshold: 0.4 },
    film: { chromaticAberration: 0.002 }
  }
};

/**
 * Get preset by name
 */
export function getEffectPreset(name: EffectPresetName): EffectsState {
  return EFFECT_PRESETS[name] || EFFECT_PRESETS.clean;
}

/**
 * List all preset names
 */
export function getEffectPresetNames(): EffectPresetName[] {
  return Object.keys(EFFECT_PRESETS) as EffectPresetName[];
}
```

### Step 4: Create `src/effects/index.ts`

```typescript
/**
 * Effects Module - Barrel Exports
 */

export * from "./types";
export * from "./composer";
export * from "./presets";
```

### Sprint 2 Acceptance Criteria
- [ ] TalkingHead renderer access method documented
- [ ] Effect types defined
- [ ] Preset system working
- [ ] At least bloom OR vignette functional
- [ ] action-scheduler handles effect actions
- [ ] No performance regression (60fps maintained)

---

## Sprint 3: Export System

### Goal
Record performances to video files in multiple aspect ratios.

### Step 1: Create `src/export/types.ts`

```typescript
/**
 * Video Export Types
 */

export type AspectRatio = "portrait" | "landscape" | "square" | "ultrawide";

export interface AspectRatioConfig {
  name: AspectRatio;
  width: number;
  height: number;
  ratio: string;
  description: string;
}

export const ASPECT_RATIOS: Record<AspectRatio, AspectRatioConfig> = {
  portrait: { name: "portrait", width: 1080, height: 1920, ratio: "9:16", description: "Instagram Reels, TikTok" },
  landscape: { name: "landscape", width: 1920, height: 1080, ratio: "16:9", description: "YouTube, Suno" },
  square: { name: "square", width: 1080, height: 1080, ratio: "1:1", description: "Instagram Feed" },
  ultrawide: { name: "ultrawide", width: 2560, height: 1080, ratio: "21:9", description: "Cinematic" }
};

export type Quality = "preview" | "standard" | "high" | "4k";

export interface QualityConfig {
  name: Quality;
  fps: number;
  bitrate: number;  // bits per second
  description: string;
}

export const QUALITY_PRESETS: Record<Quality, QualityConfig> = {
  preview: { name: "preview", fps: 30, bitrate: 2_000_000, description: "Fast, lower quality" },
  standard: { name: "standard", fps: 30, bitrate: 5_000_000, description: "Balanced" },
  high: { name: "high", fps: 60, bitrate: 8_000_000, description: "High quality" },
  "4k": { name: "4k", fps: 30, bitrate: 15_000_000, description: "Maximum quality" }
};

export interface ExportConfig {
  aspectRatio: AspectRatio;
  quality: Quality;
  includeAudio: boolean;
  transparentBackground: boolean;
}

export interface ExportProgress {
  status: "preparing" | "recording" | "encoding" | "complete" | "error";
  progress: number;  // 0-1
  message: string;
}

export type ExportProgressCallback = (progress: ExportProgress) => void;
```

### Step 2: Create `src/export/recorder.ts`

```typescript
/**
 * Video Recorder
 * Uses MediaRecorder API to capture canvas
 */

import type { ExportConfig, ExportProgress, ExportProgressCallback } from "./types";
import { ASPECT_RATIOS, QUALITY_PRESETS } from "./types";

let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];

/**
 * Start recording the canvas
 */
export function startRecording(
  canvas: HTMLCanvasElement,
  config: ExportConfig,
  onProgress?: ExportProgressCallback
): boolean {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    console.warn("[Recorder] Already recording");
    return false;
  }

  const quality = QUALITY_PRESETS[config.quality];
  const stream = canvas.captureStream(quality.fps);

  // Check for WebM VP9 support
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';

  try {
    mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: quality.bitrate
    });
  } catch (e) {
    onProgress?.({ status: "error", progress: 0, message: `Failed to create recorder: ${e}` });
    return false;
  }

  recordedChunks = [];

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  mediaRecorder.onerror = (event) => {
    onProgress?.({ status: "error", progress: 0, message: `Recording error: ${event}` });
  };

  mediaRecorder.start(100); // Capture in 100ms chunks
  onProgress?.({ status: "recording", progress: 0, message: "Recording started" });

  return true;
}

/**
 * Stop recording and return blob
 */
export function stopRecording(): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state !== "recording") {
      resolve(null);
      return;
    }

    mediaRecorder.onstop = () => {
      const blob = new Blob(recordedChunks, { type: "video/webm" });
      recordedChunks = [];
      mediaRecorder = null;
      resolve(blob);
    };

    mediaRecorder.stop();
  });
}

/**
 * Check if currently recording
 */
export function isRecording(): boolean {
  return mediaRecorder !== null && mediaRecorder.state === "recording";
}

/**
 * Download blob as file
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Generate filename with timestamp and config
 */
export function generateFilename(config: ExportConfig): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const ratio = ASPECT_RATIOS[config.aspectRatio].ratio.replace(":", "x");
  return `avatar-${ratio}-${config.quality}-${timestamp}.webm`;
}
```

### Step 3: Create `src/export/layouts.ts`

```typescript
/**
 * Canvas Layout Management
 * Handles aspect ratio switching for export
 */

import type { AspectRatio } from "./types";
import { ASPECT_RATIOS } from "./types";

interface LayoutState {
  originalWidth: number;
  originalHeight: number;
  originalStyle: string;
}

let savedLayout: LayoutState | null = null;

/**
 * Apply aspect ratio to canvas for export
 * Saves original dimensions for restoration
 */
export function applyExportLayout(
  canvas: HTMLCanvasElement,
  aspectRatio: AspectRatio
): void {
  // Save original state
  savedLayout = {
    originalWidth: canvas.width,
    originalHeight: canvas.height,
    originalStyle: canvas.style.cssText
  };

  const config = ASPECT_RATIOS[aspectRatio];

  // Set canvas to export resolution
  canvas.width = config.width;
  canvas.height = config.height;

  // Center canvas if needed
  canvas.style.width = `${config.width}px`;
  canvas.style.height = `${config.height}px`;
  canvas.style.maxWidth = "100vw";
  canvas.style.maxHeight = "100vh";
  canvas.style.objectFit = "contain";
}

/**
 * Restore original canvas dimensions
 */
export function restoreLayout(canvas: HTMLCanvasElement): void {
  if (!savedLayout) return;

  canvas.width = savedLayout.originalWidth;
  canvas.height = savedLayout.originalHeight;
  canvas.style.cssText = savedLayout.originalStyle;

  savedLayout = null;
}

/**
 * Get current layout state
 */
export function hasSavedLayout(): boolean {
  return savedLayout !== null;
}
```

### Step 4: Create `src/export/index.ts`

```typescript
/**
 * Export Module - Barrel Exports
 */

export * from "./types";
export * from "./recorder";
export * from "./layouts";
```

### Sprint 3 Acceptance Criteria
- [ ] Export types defined with all aspect ratios
- [ ] MediaRecorder wrapper working
- [ ] Canvas aspect ratio switching works
- [ ] Export produces downloadable WebM
- [ ] Original canvas restored after export
- [ ] Export UI panel added to stage.html

---

## Sprint 4: Environment Maps

### Goal
Support HDRI backgrounds, solid colors, gradients, and transparency.

### Prerequisites
- Understand Three.js scene.background and scene.environment
- Have HDRI files ready or use placeholder

### Step 1: Create `src/environments/types.ts`

```typescript
/**
 * Environment Types
 */

export type EnvironmentType = "hdri" | "solid" | "gradient" | "transparent";

export interface HDRIEnvironment {
  type: "hdri";
  preset: string;
  path: string;
  intensity?: number;
}

export interface SolidEnvironment {
  type: "solid";
  color: string;  // hex color
}

export interface GradientEnvironment {
  type: "gradient";
  colors: [string, string];  // [top, bottom] hex colors
  angle?: number;  // degrees, default 0 (vertical)
}

export interface TransparentEnvironment {
  type: "transparent";
}

export type Environment =
  | HDRIEnvironment
  | SolidEnvironment
  | GradientEnvironment
  | TransparentEnvironment;

export interface EnvironmentPreset {
  name: string;
  description: string;
  environment: Environment;
}
```

### Step 2: Create `src/environments/presets.ts`

```typescript
/**
 * Environment Presets
 */

import type { EnvironmentPreset, Environment } from "./types";

export const ENVIRONMENT_PRESETS: EnvironmentPreset[] = [
  {
    name: "studio",
    description: "Clean studio lighting",
    environment: { type: "hdri", preset: "studio", path: "/environments/studio.hdr", intensity: 1.0 }
  },
  {
    name: "outdoor",
    description: "Natural outdoor lighting",
    environment: { type: "hdri", preset: "outdoor", path: "/environments/outdoor.hdr", intensity: 1.0 }
  },
  {
    name: "neon-city",
    description: "Cyberpunk urban environment",
    environment: { type: "hdri", preset: "neon-city", path: "/environments/neon-city.hdr", intensity: 1.2 }
  },
  {
    name: "void",
    description: "Pure black background",
    environment: { type: "solid", color: "#000000" }
  },
  {
    name: "transparent",
    description: "Transparent for compositing",
    environment: { type: "transparent" }
  },
  {
    name: "sunset-gradient",
    description: "Warm sunset gradient",
    environment: { type: "gradient", colors: ["#ff6b35", "#1a1a2e"], angle: 0 }
  }
];

export function getEnvironmentPreset(name: string): EnvironmentPreset | undefined {
  return ENVIRONMENT_PRESETS.find(p => p.name === name);
}

export function getEnvironmentPresetNames(): string[] {
  return ENVIRONMENT_PRESETS.map(p => p.name);
}
```

### Step 3: Create `src/environments/backgrounds.ts`

```typescript
/**
 * Background Application
 * Apply different background types to TalkingHead scene
 */

import type { TalkingHead } from "@met4citizen/talkinghead";
import type { Environment, SolidEnvironment, GradientEnvironment } from "./types";
// import * as THREE from "three";  // May need to check TalkingHead's Three.js version

/**
 * Apply solid color background
 */
export function applySolidBackground(head: TalkingHead, config: SolidEnvironment): void {
  // TODO: Access head.scene.background
  // head.scene.background = new THREE.Color(config.color);
  console.log(`[Environment] Apply solid: ${config.color}`);
}

/**
 * Apply gradient background
 * Note: Three.js doesn't natively support gradients - need shader or canvas texture
 */
export function applyGradientBackground(head: TalkingHead, config: GradientEnvironment): void {
  // Create gradient texture from canvas
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;

  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, config.colors[0]);
  gradient.addColorStop(1, config.colors[1]);

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // TODO: Convert to Three.js texture and apply
  // const texture = new THREE.CanvasTexture(canvas);
  // head.scene.background = texture;
  console.log(`[Environment] Apply gradient: ${config.colors.join(" -> ")}`);
}

/**
 * Apply transparent background
 */
export function applyTransparentBackground(head: TalkingHead): void {
  // TODO: Access head.renderer
  // head.renderer.setClearColor(0x000000, 0);
  // head.scene.background = null;
  console.log("[Environment] Apply transparent");
}

/**
 * Apply any environment type
 */
export function applyEnvironment(head: TalkingHead, env: Environment): void {
  switch (env.type) {
    case "solid":
      applySolidBackground(head, env);
      break;
    case "gradient":
      applyGradientBackground(head, env);
      break;
    case "transparent":
      applyTransparentBackground(head);
      break;
    case "hdri":
      // HDRI requires async loading - see hdri-loader.ts
      console.log(`[Environment] HDRI requested: ${env.preset}`);
      break;
  }
}
```

### Step 4: Create `src/environments/index.ts`

```typescript
/**
 * Environments Module - Barrel Exports
 */

export * from "./types";
export * from "./presets";
export * from "./backgrounds";
```

### Sprint 4 Acceptance Criteria
- [ ] Environment types defined
- [ ] Preset system working
- [ ] Solid color backgrounds work
- [ ] Transparent background for compositing
- [ ] action-scheduler handles environment actions
- [ ] Stage director can set environments

---

## Sprint 5: AI Integration Enhancement

### Goal
Integrate all new features into director decision pipeline.

### Key Changes

1. **Update `src/directors/types.ts`**
   - Add all new action types
   - Export combined action arrays

2. **Update `src/directors/camera-director.ts`**
   - Add movement actions to prompt
   - Add movement guide section

3. **Update `src/directors/stage-director.ts`**
   - Add effect preset actions
   - Add environment actions

4. **Create `src/directors/effect-director.ts`** (Optional)
   - Dedicated AI for post-processing decisions
   - Mood-to-effect mapping

5. **Update `src/pipeline/orchestrator.ts`**
   - Add EffectDirector to pipeline
   - Enhanced formatNotes with all decisions

### Sprint 5 Acceptance Criteria
- [ ] All directors use new action types
- [ ] Pipeline includes all directors
- [ ] formatNotes captures all decisions
- [ ] Full performance uses all features
- [ ] No regression in existing functionality

---

## Key Reference Files

When picking up work, read these first:

| File | Purpose |
|------|---------|
| `src/scene/camera.ts` | Current camera system, TalkingHead camera API |
| `src/directors/camera-director.ts` | AI camera decisions |
| `src/directors/stage-director.ts` | AI lighting/stage decisions |
| `src/directors/base-director.ts` | Director base class pattern |
| `src/directors/types.ts` | All action type definitions |
| `src/performance/action-scheduler.ts` | Action execution switch |
| `src/avatar/head-manager.ts` | TalkingHead integration |
| `src/pipeline/orchestrator.ts` | Director pipeline |

---

## Dependencies

### Already Available
- `three` ^0.180.0 (via TalkingHead)

### To Add (when needed)
```bash
# For Sprint 2 (if Three.js built-in postprocessing insufficient)
npm install postprocessing

# For Sprint 3 (if MP4 encoding needed)
npm install @ffmpeg/ffmpeg @ffmpeg/util
```

---

## Validation Commands

```bash
# Build check
npm run build

# Dev server
npm run dev

# Type check only
npx tsc --noEmit
```

---

*Last Updated: 2024-12-24*
