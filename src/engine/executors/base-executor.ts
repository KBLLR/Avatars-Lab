/**
 * Multi-Layer Performance Engine - Base Executor
 *
 * Abstract base class for layer executors.
 * Each layer type implements its own executor.
 */

import type { TalkingHead } from "@met4citizen/talkinghead";
import type {
  Timeline,
  TimelineBlock,
  LayerType,
  EngineState,
  EasingType,
} from "../types";

// ============================================
// Layer Executor Interface
// ============================================

export interface LayerExecutor {
  readonly layerType: LayerType;

  // Lifecycle
  loadResources(timeline: Timeline): Promise<void>;
  dispose(): void;

  // Playback
  update(
    time_ms: number,
    delta_ms: number,
    activeBlocks: TimelineBlock[]
  ): void;
  pause(): void;
  stop(): void;
  seek(time_ms: number): void;

  // State
  onEngineStateChange(newState: EngineState, prevState: EngineState): void;

  // Actions (for cross-layer triggers)
  executeAction(action: string, args?: Record<string, unknown>): void;
}

// ============================================
// Base Executor Abstract Class
// ============================================

export abstract class BaseExecutor implements LayerExecutor {
  abstract readonly layerType: LayerType;

  protected head: TalkingHead;
  protected currentBlocks: TimelineBlock[] = [];
  protected isPaused = false;

  constructor(head: TalkingHead) {
    this.head = head;
  }

  // ─────────────────────────────────────────────────────────
  // Lifecycle (override in subclasses as needed)
  // ─────────────────────────────────────────────────────────

  async loadResources(_timeline: Timeline): Promise<void> {
    // Override in subclasses to pre-load resources
  }

  dispose(): void {
    this.currentBlocks = [];
    this.isPaused = false;
  }

  // ─────────────────────────────────────────────────────────
  // Playback (must override update in subclasses)
  // ─────────────────────────────────────────────────────────

  abstract update(
    time_ms: number,
    delta_ms: number,
    activeBlocks: TimelineBlock[]
  ): void;

  pause(): void {
    this.isPaused = true;
  }

  stop(): void {
    this.isPaused = false;
    this.currentBlocks = [];
  }

  seek(_time_ms: number): void {
    // Override in subclasses for seek behavior
  }

  onEngineStateChange(_newState: EngineState, _prevState: EngineState): void {
    // Override in subclasses to respond to engine state changes
  }

  executeAction(_action: string, _args?: Record<string, unknown>): void {
    // Override in subclasses to handle cross-layer triggers
  }

  // ─────────────────────────────────────────────────────────
  // Utility: Block Progress Calculation
  // ─────────────────────────────────────────────────────────

  /**
   * Calculate block progress (0-1) based on current time
   */
  protected getBlockProgress(block: TimelineBlock, time_ms: number): number {
    const elapsed = time_ms - block.start_ms;
    return Math.max(0, Math.min(1, elapsed / block.duration_ms));
  }

  /**
   * Calculate fade-in factor (0-1) based on block's fadeIn_ms setting
   */
  protected getFadeInFactor(block: TimelineBlock, time_ms: number): number {
    if (!block.fadeIn_ms || block.fadeIn_ms <= 0) return 1;

    const elapsed = time_ms - block.start_ms;
    return Math.min(1, elapsed / block.fadeIn_ms);
  }

  /**
   * Calculate fade-out factor (0-1) based on block's fadeOut_ms setting
   */
  protected getFadeOutFactor(block: TimelineBlock, time_ms: number): number {
    if (!block.fadeOut_ms || block.fadeOut_ms <= 0) return 1;

    const blockEnd = block.start_ms + block.duration_ms;
    const remaining = blockEnd - time_ms;
    return Math.min(1, remaining / block.fadeOut_ms);
  }

  /**
   * Combined fade factor (fade-in * fade-out)
   */
  protected getFadeFactor(block: TimelineBlock, time_ms: number): number {
    return (
      this.getFadeInFactor(block, time_ms) *
      this.getFadeOutFactor(block, time_ms)
    );
  }

  // ─────────────────────────────────────────────────────────
  // Utility: Easing Functions
  // ─────────────────────────────────────────────────────────

  /**
   * Apply easing to a 0-1 progress value
   */
  protected applyEasing(progress: number, easing?: EasingType): number {
    if (!easing || easing === "linear") return progress;

    switch (easing) {
      case "easeIn":
        return progress * progress;

      case "easeOut":
        return 1 - (1 - progress) * (1 - progress);

      case "easeInOut":
        return progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      case "bounce":
        return this.bounceEasing(progress);

      case "elastic":
        return this.elasticEasing(progress);

      case "step":
        return progress < 1 ? 0 : 1;

      default:
        return progress;
    }
  }

  private bounceEasing(t: number): number {
    const n1 = 7.5625;
    const d1 = 2.75;

    if (t < 1 / d1) {
      return n1 * t * t;
    } else if (t < 2 / d1) {
      return n1 * (t -= 1.5 / d1) * t + 0.75;
    } else if (t < 2.5 / d1) {
      return n1 * (t -= 2.25 / d1) * t + 0.9375;
    } else {
      return n1 * (t -= 2.625 / d1) * t + 0.984375;
    }
  }

  private elasticEasing(t: number): number {
    const c4 = (2 * Math.PI) / 3;

    return t === 0
      ? 0
      : t === 1
        ? 1
        : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  }

  // ─────────────────────────────────────────────────────────
  // Utility: Interpolation
  // ─────────────────────────────────────────────────────────

  /**
   * Linear interpolation between two values
   */
  protected lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  /**
   * Linear interpolation for colors (hex strings)
   */
  protected lerpColor(colorA: string, colorB: string, t: number): string {
    const parseHex = (hex: string) => {
      const clean = hex.replace("#", "");
      return {
        r: parseInt(clean.slice(0, 2), 16),
        g: parseInt(clean.slice(2, 4), 16),
        b: parseInt(clean.slice(4, 6), 16),
      };
    };

    const a = parseHex(colorA);
    const b = parseHex(colorB);

    const r = Math.round(this.lerp(a.r, b.r, t));
    const g = Math.round(this.lerp(a.g, b.g, t));
    const bl = Math.round(this.lerp(a.b, b.b, t));

    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
  }

  // ─────────────────────────────────────────────────────────
  // Utility: Logging
  // ─────────────────────────────────────────────────────────

  protected log(message: string, ...args: unknown[]): void {
    console.log(`[${this.layerType.toUpperCase()} Executor]`, message, ...args);
  }

  protected warn(message: string, ...args: unknown[]): void {
    console.warn(
      `[${this.layerType.toUpperCase()} Executor]`,
      message,
      ...args
    );
  }
}
