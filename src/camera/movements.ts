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
