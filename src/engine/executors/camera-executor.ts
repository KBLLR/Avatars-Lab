/**
 * Multi-Layer Performance Engine - Camera Executor
 *
 * Handles camera movements and views.
 * Supports:
 * - Camera views (full, mid, upper, head)
 * - Movement types (dolly, pan, tilt, orbit, shake, punch, sweep)
 * - Smooth transitions with easing
 */

import type { TalkingHead } from "@met4citizen/talkinghead";
import type {
  Timeline,
  TimelineBlock,
  CameraBlockData,
  CameraView,
  CameraMovementType,
  LayerType,
} from "../types";
import { getBlockData } from "../types";
import { BaseExecutor } from "./base-executor";

// ============================================
// Camera View Presets
// ============================================

interface CameraViewConfig {
  distance: number;
  y: number;
  rotateX: number;
}

const CAMERA_VIEWS: Record<CameraView, CameraViewConfig> = {
  full: { distance: 1.2, y: 0, rotateX: 0 },
  mid: { distance: 0.8, y: 0.05, rotateX: 0 },
  upper: { distance: 0.5, y: 0.1, rotateX: 0 },
  head: { distance: 0.3, y: 0.15, rotateX: 0 },
};

// ============================================
// Camera Executor
// ============================================

export class CameraExecutor extends BaseExecutor {
  readonly layerType: LayerType = "camera";
  private readonly degToRad = (deg: number) => (deg * Math.PI) / 180;

  // Current camera state
  private currentView: CameraView = "upper";
  private currentDistance = 0.5;
  private currentX = 0;
  private currentY = 0.1;
  private currentRotateX = 0;
  private currentRotateY = 0;

  // Transition state
  private targetDistance = 0.5;
  private targetX = 0;
  private targetY = 0.1;
  private targetRotateX = 0;
  private targetRotateY = 0;
  private transitionProgress = 1;
  private transitionDuration_ms = 500;
  private transitionStartTime = 0;
  private transitionStart = {
    distance: 0.5,
    x: 0,
    y: 0.1,
    rotateX: 0,
    rotateY: 0,
  };

  // Shake state
  private shakeActive = false;
  private shakeIntensity = 0;
  private shakeFrequency = 15;
  private shakePhase = 0;

  // Track current block to detect changes
  private currentBlockId: string | null = null;

  constructor(head: TalkingHead) {
    super(head);

    try {
      const opt = (head as unknown as { opt?: { cameraDistance?: number; cameraX?: number; cameraY?: number; cameraRotateX?: number; cameraRotateY?: number } }).opt;
      if (opt) {
        this.currentDistance = opt.cameraDistance ?? this.currentDistance;
        this.currentX = opt.cameraX ?? this.currentX;
        this.currentY = opt.cameraY ?? this.currentY;
        this.currentRotateX = opt.cameraRotateX ?? this.currentRotateX;
        this.currentRotateY = opt.cameraRotateY ?? this.currentRotateY;
        this.transitionStart = {
          distance: this.currentDistance,
          x: this.currentX,
          y: this.currentY,
          rotateX: this.currentRotateX,
          rotateY: this.currentRotateY,
        };
      }
    } catch {
      // Ignore camera opt sync failures
    }
  }

  // ─────────────────────────────────────────────────────────
  // Main Update
  // ─────────────────────────────────────────────────────────

  update(
    time_ms: number,
    delta_ms: number,
    activeBlocks: TimelineBlock[]
  ): void {
    if (this.isPaused) return;

    // Get first active block
    const block = activeBlocks[0];

    if (block) {
      const data = getBlockData(block, "camera");
      if (data) {
        const progress = this.getBlockProgress(block, time_ms);

        // Check if this is a new block
        if (block.id !== this.currentBlockId) {
          this.startNewBlock(block, data);
          this.currentBlockId = block.id;
        }

        // Apply movement based on type
        this.applyMovement(data, progress, delta_ms);
      }
    }

    // Update transition
    this.updateTransition();

    // Apply shake if active
    if (this.shakeActive) {
      this.updateShake(delta_ms);
    }

    // Apply to TalkingHead
    this.applyToHead();

    this.currentBlocks = activeBlocks;
  }

  // ─────────────────────────────────────────────────────────
  // Block Processing
  // ─────────────────────────────────────────────────────────

  private startNewBlock(block: TimelineBlock, data: CameraBlockData): void {
    this.transitionStart = {
      distance: this.currentDistance,
      x: this.currentX,
      y: this.currentY,
      rotateX: this.currentRotateX,
      rotateY: this.currentRotateY,
    };

    // If view is specified, start transition to it
    if (data.view) {
      this.transitionToView(data.view, block.duration_ms, {
        distance:
          typeof data.distance === "number" ? data.distance : undefined,
        rotateX:
          typeof data.rotateX === "number" ? data.rotateX : undefined,
        rotateY:
          typeof data.rotateY === "number" ? data.rotateY : undefined,
      });
    } else {
      this.transitionProgress = 1;
    }

    // Handle shake
    if (data.shake) {
      this.shakeActive = true;
      this.shakeIntensity = data.shake.intensity;
      this.shakeFrequency = data.shake.frequency || 15;
    } else if (data.movement !== "shake") {
      this.shakeActive = false;
    }
  }

  private transitionToView(
    view: CameraView,
    duration_ms: number,
    overrides?: Partial<{ distance: number; x: number; y: number; rotateX: number; rotateY: number }>
  ): void {
    const config = CAMERA_VIEWS[view];
    if (!config) return;

    this.targetDistance = overrides?.distance ?? config.distance;
    this.targetX = overrides?.x ?? this.currentX;
    this.targetY = overrides?.y ?? config.y;
    this.targetRotateX = overrides?.rotateX ?? config.rotateX;
    this.targetRotateY = overrides?.rotateY ?? this.currentRotateY;

    this.transitionProgress = 0;
    this.transitionDuration_ms = Math.min(duration_ms, 1000);
    this.transitionStartTime = performance.now();
    this.currentView = view;
  }

  // ─────────────────────────────────────────────────────────
  // Movement Types
  // ─────────────────────────────────────────────────────────

  private applyMovement(
    data: CameraBlockData,
    progress: number,
    delta_ms: number
  ): void {
    const easedProgress = this.applyEasing(progress, data.easing);

    switch (data.movement) {
      case "dolly":
        this.applyDolly(data, easedProgress);
        break;
      case "pan":
        this.applyPan(data, easedProgress);
        break;
      case "tilt":
        this.applyTilt(data, easedProgress);
        break;
      case "orbit":
        this.applyOrbit(data, easedProgress);
        break;
      case "shake":
        this.applyShakeMovement(data, delta_ms);
        break;
      case "punch":
        this.applyPunch(data, easedProgress);
        break;
      case "sweep":
        this.applySweep(data, easedProgress);
        break;
      case "static":
      default:
        // No movement, just hold current position
        break;
    }
  }

  private applyDolly(data: CameraBlockData, progress: number): void {
    if (data.distance !== undefined) {
      // Dolly: delta distance over time
      const startDistance = this.transitionStart.distance;
      const targetDistance = startDistance + data.distance;
      this.currentDistance = this.lerp(startDistance, targetDistance, progress);
    }
  }

  private applyPan(data: CameraBlockData, progress: number): void {
    // Pan: horizontal rotation
    if (data.rotateY !== undefined) {
      const startRotateY = this.transitionStart.rotateY;
      const targetRotateY = startRotateY + this.degToRad(data.rotateY);
      this.currentRotateY = this.lerp(startRotateY, targetRotateY, progress);
    }
  }

  private applyTilt(data: CameraBlockData, progress: number): void {
    // Tilt: vertical rotation
    if (data.rotateX !== undefined) {
      const startRotateX = this.transitionStart.rotateX;
      const targetRotateX = startRotateX + this.degToRad(data.rotateX);
      this.currentRotateX = this.lerp(startRotateX, targetRotateX, progress);
    }
  }

  private applyOrbit(data: CameraBlockData, progress: number): void {
    // Orbit: rotate around subject
    if (data.orbit !== undefined) {
      const angle = this.degToRad(data.orbit) * progress;
      this.currentRotateY = this.transitionStart.rotateY + angle;
    }

    if (data.distance !== undefined) {
      const startDistance = this.transitionStart.distance;
      this.currentDistance = this.lerp(startDistance, data.distance, progress);
    }
  }

  private applyShakeMovement(data: CameraBlockData, delta_ms: number): void {
    if (data.shake) {
      this.shakeActive = true;
      this.shakeIntensity = data.shake.intensity;
      this.shakeFrequency = data.shake.frequency || 15;
    }
  }

  private applyPunch(data: CameraBlockData, progress: number): void {
    // Punch: quick zoom in then out
    const punchCurve = Math.sin(progress * Math.PI);
    const punchAmount = (data.punch ?? 0.1) * punchCurve;
    this.currentDistance = this.transitionStart.distance - punchAmount;
  }

  private applySweep(data: CameraBlockData, progress: number): void {
    if (data.startAngle === undefined || data.endAngle === undefined) return;

    const startAngle = this.degToRad(data.startAngle);
    const endAngle = this.degToRad(data.endAngle);
    const currentAngle = this.lerp(startAngle, endAngle, progress);
    this.currentRotateY = this.transitionStart.rotateY + currentAngle;
  }

  // ─────────────────────────────────────────────────────────
  // Shake Effect
  // ─────────────────────────────────────────────────────────

  private updateShake(delta_ms: number): void {
    this.shakePhase += delta_ms * 0.001 * this.shakeFrequency * Math.PI * 2;

    if (this.shakePhase > Math.PI * 2) {
      this.shakePhase -= Math.PI * 2;
    }
  }

  private getShakeOffset(): { x: number; y: number } {
    if (!this.shakeActive || this.shakeIntensity === 0) {
      return { x: 0, y: 0 };
    }

    const scale = this.shakeIntensity * 0.02;
    return {
      x: Math.sin(this.shakePhase) * scale,
      y: Math.cos(this.shakePhase * 1.3) * scale * 0.7,
    };
  }

  // ─────────────────────────────────────────────────────────
  // Transition
  // ─────────────────────────────────────────────────────────

  private updateTransition(): void {
    if (this.transitionProgress >= 1) return;

    const elapsed = performance.now() - this.transitionStartTime;
    this.transitionProgress = Math.min(1, elapsed / this.transitionDuration_ms);

    const t = this.applyEasing(this.transitionProgress, "easeInOut");

    this.currentDistance = this.lerp(
      this.transitionStart.distance,
      this.targetDistance,
      t
    );
    this.currentX = this.lerp(this.transitionStart.x, this.targetX, t);
    this.currentY = this.lerp(this.transitionStart.y, this.targetY, t);
    this.currentRotateX = this.lerp(
      this.transitionStart.rotateX,
      this.targetRotateX,
      t
    );
    this.currentRotateY = this.lerp(
      this.transitionStart.rotateY,
      this.targetRotateY,
      t
    );
  }

  // ─────────────────────────────────────────────────────────
  // Apply to TalkingHead
  // ─────────────────────────────────────────────────────────

  private applyToHead(): void {
    try {
      const shake = this.getShakeOffset();
      const head = this.head as unknown as {
        opt?: {
          cameraDistance?: number;
          cameraX?: number;
          cameraY?: number;
          cameraRotateX?: number;
          cameraRotateY?: number;
        };
      };

      if (head.opt) {
        head.opt.cameraDistance = this.currentDistance;
        head.opt.cameraX = this.currentX + shake.x;
        head.opt.cameraY = this.currentY + shake.y;
        head.opt.cameraRotateX = this.currentRotateX;
        head.opt.cameraRotateY = this.currentRotateY;
      }
    } catch (err) {
      // Camera control may not be available
    }
  }

  // ─────────────────────────────────────────────────────────
  // Cross-Layer Actions
  // ─────────────────────────────────────────────────────────

  executeAction(action: string, args?: Record<string, unknown>): void {
    switch (action) {
      case "set_view":
        if (args?.view) {
          const view = args.view as CameraView;
          const duration = (args.t as number) || 1000;
          this.transitionToView(view, duration, {
            distance:
              typeof args.cameraDistance === "number"
                ? (args.cameraDistance as number)
                : undefined,
            x:
              typeof args.cameraX === "number"
                ? (args.cameraX as number)
                : undefined,
            y:
              typeof args.cameraY === "number"
                ? (args.cameraY as number)
                : undefined,
            rotateX:
              typeof args.cameraRotateX === "number"
                ? (args.cameraRotateX as number)
                : undefined,
            rotateY:
              typeof args.cameraRotateY === "number"
                ? (args.cameraRotateY as number)
                : undefined,
          });

          // Also call TalkingHead's setView if available
          try {
            this.head.setView(view, duration);
          } catch {
            // Not all versions support setView
          }
        }
        break;

      case "camera_shake":
        this.shakeActive = true;
        this.shakeIntensity = (args?.intensity as number) || 1;
        this.shakeFrequency = (args?.frequency as number) || 15;

        // Auto-stop after duration
        if (args?.duration_ms) {
          setTimeout(() => {
            this.shakeActive = false;
          }, args.duration_ms as number);
        }
        break;

      case "camera_stop_shake":
        this.shakeActive = false;
        break;

      case "look_at":
        if (args?.x !== undefined && args?.y !== undefined) {
          try {
            this.head.lookAt(
              args.x as number,
              args.y as number,
              (args.t as number) || 600
            );
          } catch {
            // lookAt may not be available
          }
        }
        break;

      case "look_at_camera":
        try {
          this.head.lookAtCamera((args?.t as number) || 600);
        } catch {
          // lookAtCamera may not be available
        }
        break;

      default:
        this.warn(`Unknown action: ${action}`);
    }
  }

  // ─────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────

  stop(): void {
    super.stop();
    this.shakeActive = false;
    this.currentBlockId = null;

    // Reset to default view
    this.transitionToView("upper", 500);
  }

  seek(_time_ms: number): void {
    this.currentBlockId = null;
    this.transitionProgress = 1;
  }

  dispose(): void {
    this.stop();
    super.dispose();
  }
}
