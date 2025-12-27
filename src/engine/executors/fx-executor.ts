/**
 * Multi-Layer Performance Engine - FX Executor
 *
 * Handles post-processing effects.
 * Supports:
 * - Bloom, vignette, chromatic aberration
 * - Glitch, pixelation
 * - Keyframe animations for effect parameters
 * - Smooth transitions between effects
 */

import type { EffectsManager } from "../../effects/manager";
import type {
  Timeline,
  TimelineBlock,
  FXBlockData,
  FXKeyframe,
  FXEffectType,
  LayerType,
} from "../types";
import { getBlockData } from "../types";

// ============================================
// FX Executor (doesn't extend BaseExecutor since it uses EffectsManager, not TalkingHead)
// ============================================

export class FXExecutor {
  readonly layerType: LayerType = "fx";

  private effectsManager: EffectsManager;
  private isPaused = false;
  private currentBlocks: TimelineBlock[] = [];

  // Track active effects to reset properly
  private activeEffects: Set<FXEffectType> = new Set();

  constructor(effectsManager: EffectsManager) {
    this.effectsManager = effectsManager;
  }

  // ─────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────

  async loadResources(_timeline: Timeline): Promise<void> {
    // FX executor doesn't need to pre-load resources
  }

  dispose(): void {
    this.resetAllEffects();
    this.currentBlocks = [];
    this.activeEffects.clear();
  }

  // ─────────────────────────────────────────────────────────
  // Main Update
  // ─────────────────────────────────────────────────────────

  update(
    time_ms: number,
    _delta_ms: number,
    activeBlocks: TimelineBlock[]
  ): void {
    if (this.isPaused) return;

    // Track which effects are active this frame
    const frameActiveEffects = new Set<FXEffectType>();

    // No active blocks - reset all effects
    if (activeBlocks.length === 0) {
      if (this.activeEffects.size > 0) {
        this.resetAllEffects();
      }
      return;
    }

    // Process all active FX blocks (they can stack)
    for (const block of activeBlocks) {
      const data = getBlockData(block, "fx");
      if (!data || data.effect === "none") continue;

      frameActiveEffects.add(data.effect);

      const progress = this.getBlockProgress(block, time_ms);
      const fadeFactor = this.getFadeFactor(block, time_ms);

      // Handle keyframed effects
      if (data.keyframes && data.keyframes.length > 0) {
        const interpolated = this.interpolateKeyframes(
          data.keyframes,
          progress,
          block.duration_ms
        );
        this.applyEffect(data.effect, interpolated, fadeFactor);
      } else {
        this.applyEffect(data.effect, data.params, fadeFactor);
      }
    }

    // Reset effects that are no longer active
    for (const effect of this.activeEffects) {
      if (!frameActiveEffects.has(effect)) {
        this.resetEffect(effect);
      }
    }

    this.activeEffects = frameActiveEffects;
    this.currentBlocks = activeBlocks;
  }

  // ─────────────────────────────────────────────────────────
  // Effect Application
  // ─────────────────────────────────────────────────────────

  private applyEffect(
    effect: FXEffectType,
    params: Record<string, number | boolean>,
    fadeFactor: number = 1
  ): void {
    try {
      switch (effect) {
        case "bloom":
          this.effectsManager.setBloom(
            ((params.strength as number) || 1.5) * fadeFactor,
            (params.radius as number) || 0.4,
            (params.threshold as number) || 0.85
          );
          break;

        case "vignette":
          this.effectsManager.setVignette(
            (params.offset as number) || 1.0,
            ((params.darkness as number) || 1.0) * fadeFactor
          );
          break;

        case "chromatic":
          this.effectsManager.setChromaticAberration({
            amount: ((params.amount as number) || 0.005) * fadeFactor,
          });
          break;

        case "glitch":
          this.effectsManager.setGlitch(
            (params.active as boolean) ?? true,
            (params.wild as boolean) ?? false
          );
          break;

        case "pixelation":
          this.effectsManager.setPixelation({
            pixelSize: ((params.size as number) || 8) * (2 - fadeFactor), // Inverse fade for pixelation
          });
          break;

        case "none":
          // No effect
          break;
      }
    } catch (err) {
      console.warn(`[FX Executor] Failed to apply ${effect}:`, err);
    }
  }

  private resetEffect(effect: FXEffectType): void {
    try {
      switch (effect) {
        case "bloom":
          this.effectsManager.setBloom(0, 0, 1);
          break;
        case "vignette":
          this.effectsManager.setVignette(1, 0);
          break;
        case "chromatic":
          this.effectsManager.setChromaticAberration({ amount: 0 });
          break;
        case "glitch":
          this.effectsManager.setGlitch(false, false);
          break;
        case "pixelation":
          this.effectsManager.setPixelation({ pixelSize: 1 });
          break;
      }
    } catch {
      // Ignore reset errors
    }
  }

  private resetAllEffects(): void {
    try {
      this.effectsManager.resetEffects();
    } catch {
      // Manual reset if resetEffects not available
      this.resetEffect("bloom");
      this.resetEffect("vignette");
      this.resetEffect("chromatic");
      this.resetEffect("glitch");
      this.resetEffect("pixelation");
    }
    this.activeEffects.clear();
  }

  // ─────────────────────────────────────────────────────────
  // Keyframe Interpolation
  // ─────────────────────────────────────────────────────────

  private interpolateKeyframes(
    keyframes: FXKeyframe[],
    progress: number,
    duration_ms: number
  ): Record<string, number | boolean> {
    if (keyframes.length === 0) return {};
    if (keyframes.length === 1) return keyframes[0].params;

    const currentTime = progress * duration_ms;

    // Find surrounding keyframes
    let prevKf = keyframes[0];
    let nextKf = keyframes[keyframes.length - 1];

    for (let i = 0; i < keyframes.length - 1; i++) {
      if (
        currentTime >= keyframes[i].time_ms &&
        currentTime < keyframes[i + 1].time_ms
      ) {
        prevKf = keyframes[i];
        nextKf = keyframes[i + 1];
        break;
      }
    }

    // If before first keyframe or after last
    if (currentTime < prevKf.time_ms) return prevKf.params;
    if (currentTime >= nextKf.time_ms && prevKf === nextKf) return nextKf.params;

    // Interpolate
    const segmentDuration = nextKf.time_ms - prevKf.time_ms;
    const segmentProgress =
      segmentDuration > 0
        ? (currentTime - prevKf.time_ms) / segmentDuration
        : 1;

    // Apply easing
    const easedProgress = this.applyEasing(segmentProgress, nextKf.easing);

    // Interpolate numeric params, use next value for booleans
    const result: Record<string, number | boolean> = {};
    const allKeys = new Set([
      ...Object.keys(prevKf.params),
      ...Object.keys(nextKf.params),
    ]);

    for (const key of allKeys) {
      const prevVal = prevKf.params[key];
      const nextVal = nextKf.params[key];

      if (typeof prevVal === "number" && typeof nextVal === "number") {
        result[key] = prevVal + (nextVal - prevVal) * easedProgress;
      } else {
        result[key] = nextVal ?? prevVal;
      }
    }

    return result;
  }

  // ─────────────────────────────────────────────────────────
  // Utility Methods
  // ─────────────────────────────────────────────────────────

  private getBlockProgress(block: TimelineBlock, time_ms: number): number {
    const elapsed = time_ms - block.start_ms;
    return Math.max(0, Math.min(1, elapsed / block.duration_ms));
  }

  private getFadeFactor(block: TimelineBlock, time_ms: number): number {
    let factor = 1;

    // Fade in
    if (block.fadeIn_ms && block.fadeIn_ms > 0) {
      const elapsed = time_ms - block.start_ms;
      factor *= Math.min(1, elapsed / block.fadeIn_ms);
    }

    // Fade out
    if (block.fadeOut_ms && block.fadeOut_ms > 0) {
      const blockEnd = block.start_ms + block.duration_ms;
      const remaining = blockEnd - time_ms;
      factor *= Math.min(1, remaining / block.fadeOut_ms);
    }

    return factor;
  }

  private applyEasing(
    progress: number,
    easing?: string
  ): number {
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
      default:
        return progress;
    }
  }

  // ─────────────────────────────────────────────────────────
  // Playback Control
  // ─────────────────────────────────────────────────────────

  pause(): void {
    this.isPaused = true;
  }

  stop(): void {
    this.isPaused = false;
    this.resetAllEffects();
    this.currentBlocks = [];
  }

  seek(_time_ms: number): void {
    // Effects are stateless, nothing to do on seek
  }

  onEngineStateChange(): void {
    // Nothing to do
  }

  // ─────────────────────────────────────────────────────────
  // Cross-Layer Actions
  // ─────────────────────────────────────────────────────────

  executeAction(action: string, args?: Record<string, unknown>): void {
    switch (action) {
      case "post_bloom":
        this.effectsManager.setBloom(
          (args?.strength as number) || 1.5,
          (args?.radius as number) || 0.4,
          (args?.threshold as number) || 0.85
        );
        this.activeEffects.add("bloom");
        break;

      case "post_vignette":
        this.effectsManager.setVignette(
          (args?.offset as number) || 1.0,
          (args?.darkness as number) || 1.0
        );
        this.activeEffects.add("vignette");
        break;

      case "post_chromatic":
        this.effectsManager.setChromaticAberration({
          amount: (args?.amount as number) || 0.005,
        });
        this.activeEffects.add("chromatic");
        break;

      case "post_glitch":
        this.effectsManager.setGlitch(
          (args?.active as boolean) ?? true,
          (args?.wild as boolean) ?? false
        );
        this.activeEffects.add("glitch");
        break;

      case "post_pixelation":
        this.effectsManager.setPixelation({
          pixelSize: (args?.size as number) || 8,
        });
        this.activeEffects.add("pixelation");
        break;

      case "post_reset":
      case "post_reset_effects":
        this.resetAllEffects();
        break;

      default:
        console.warn(`[FX Executor] Unknown action: ${action}`);
    }
  }
}
