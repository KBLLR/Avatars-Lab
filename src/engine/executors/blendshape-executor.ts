/**
 * Multi-Layer Performance Engine - Blendshape Executor
 *
 * Handles facial expressions and morph targets.
 * Supports:
 * - Direct morph target values
 * - Keyframe animations
 * - Mood presets
 * - Emoji expressions
 */

import type { TalkingHead } from "@met4citizen/talkinghead";
import type { Mood } from "../../directors/types";
import type {
  Timeline,
  TimelineBlock,
  BlendshapeBlockData,
  BlendshapeKeyframe,
  MorphTarget,
  LayerType,
} from "../types";
import { getBlockData } from "../types";
import { BaseExecutor } from "./base-executor";

export class BlendshapeExecutor extends BaseExecutor {
  readonly layerType: LayerType = "blendshape";

  // Track active morphs to reset on stop
  private activeMorphs: Map<string, number> = new Map();

  // Track current mood to avoid redundant calls
  private currentMood: Mood | null = null;

  constructor(head: TalkingHead) {
    super(head);
  }

  // ─────────────────────────────────────────────────────────
  // Main Update
  // ─────────────────────────────────────────────────────────

  update(
    time_ms: number,
    _delta_ms: number,
    activeBlocks: TimelineBlock[]
  ): void {
    if (this.isPaused || activeBlocks.length === 0) {
      return;
    }

    // Collect all morph values from active blocks
    // Blocks are blended based on priority and intensity
    const morphValues: Map<string, { value: number; weight: number }[]> =
      new Map();

    for (const block of activeBlocks) {
      const data = getBlockData(block, "blendshape");
      if (!data) continue;

      const progress = this.getBlockProgress(block, time_ms);
      const fadeFactor = this.getFadeFactor(block, time_ms);
      const intensity = (data.intensity ?? 1) * fadeFactor;

      // Handle keyframes if present
      if (data.keyframes && data.keyframes.length > 0) {
        const interpolated = this.interpolateKeyframes(
          data.keyframes,
          progress,
          block.duration_ms,
          block.easeIn
        );
        for (const morph of interpolated) {
          this.addMorphValue(morphValues, morph.name, morph.value, intensity);
        }
      } else if (data.targetMorphs) {
        // Static morph targets
        for (const morph of data.targetMorphs) {
          this.addMorphValue(morphValues, morph.name, morph.value, intensity);
        }
      }

      // Handle mood (high-level preset)
      if (data.mood && data.mood !== this.currentMood) {
        this.head.setMood(data.mood as Mood);
        this.currentMood = data.mood as Mood;
      }

      // Handle emoji expression
      if (data.emoji) {
        // Emoji expressions are triggered once at block start
        // We use progress to detect if we're near the start
        if (progress < 0.05) {
          this.head.speakEmoji(data.emoji);
        }
      }
    }

    // Apply blended morph values
    for (const [morphName, values] of morphValues) {
      const blendedValue = this.blendMorphValues(values);
      this.head.setValue(morphName, blendedValue);
      this.activeMorphs.set(morphName, blendedValue);
    }

    this.currentBlocks = activeBlocks;
  }

  // ─────────────────────────────────────────────────────────
  // Morph Blending
  // ─────────────────────────────────────────────────────────

  private addMorphValue(
    map: Map<string, { value: number; weight: number }[]>,
    name: string,
    value: number,
    weight: number
  ): void {
    const existing = map.get(name) || [];
    existing.push({ value, weight });
    map.set(name, existing);
  }

  private blendMorphValues(
    values: { value: number; weight: number }[]
  ): number {
    // Weighted average blend
    let totalWeight = 0;
    let totalValue = 0;

    for (const v of values) {
      totalWeight += v.weight;
      totalValue += v.value * v.weight;
    }

    return totalWeight > 0 ? totalValue / totalWeight : 0;
  }

  // ─────────────────────────────────────────────────────────
  // Keyframe Interpolation
  // ─────────────────────────────────────────────────────────

  private interpolateKeyframes(
    keyframes: BlendshapeKeyframe[],
    progress: number,
    duration_ms: number,
    blockEasing?: string
  ): MorphTarget[] {
    if (keyframes.length === 0) return [];
    if (keyframes.length === 1) return keyframes[0].morphs;

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

    // If before first keyframe, return first
    if (currentTime < prevKf.time_ms) {
      return prevKf.morphs;
    }

    // If after last keyframe, return last
    if (currentTime >= nextKf.time_ms && prevKf === nextKf) {
      return nextKf.morphs;
    }

    // Interpolate between keyframes
    const segmentDuration = nextKf.time_ms - prevKf.time_ms;
    const segmentProgress =
      segmentDuration > 0
        ? (currentTime - prevKf.time_ms) / segmentDuration
        : 1;

    // Apply easing (prefer keyframe easing, fallback to block easing)
    const easing = nextKf.easing || (blockEasing as string) || "linear";
    const easedProgress = this.applyEasing(
      segmentProgress,
      easing as import("../types").EasingType
    );

    // Interpolate each morph
    const result: MorphTarget[] = [];
    const allMorphNames = new Set([
      ...prevKf.morphs.map((m) => m.name),
      ...nextKf.morphs.map((m) => m.name),
    ]);

    for (const name of allMorphNames) {
      const prevVal = prevKf.morphs.find((m) => m.name === name)?.value || 0;
      const nextVal = nextKf.morphs.find((m) => m.name === name)?.value || 0;
      result.push({
        name,
        value: this.lerp(prevVal, nextVal, easedProgress),
      });
    }

    return result;
  }

  // ─────────────────────────────────────────────────────────
  // Cross-Layer Actions
  // ─────────────────────────────────────────────────────────

  executeAction(action: string, args?: Record<string, unknown>): void {
    switch (action) {
      case "set_mood":
        if (args?.mood) {
          this.head.setMood(args.mood as Mood);
          this.currentMood = args.mood as Mood;
        }
        break;

      case "set_value":
        if (args?.mt && typeof args.value === "number") {
          this.head.setValue(args.mt as string, args.value);
          this.activeMorphs.set(args.mt as string, args.value);
        }
        break;

      case "speak_emoji":
        if (args?.emoji) {
          this.head.speakEmoji(args.emoji as string);
        }
        break;

      case "make_facial_expression":
        if (args?.emoji) {
          this.head.speakEmoji(args.emoji as string);
        }
        break;

      default:
        this.warn(`Unknown action: ${action}`);
    }
  }

  // ─────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────

  async loadResources(_timeline: Timeline): Promise<void> {
    // Blendshape executor doesn't need to pre-load resources
    // TalkingHead already has morph targets loaded
  }

  stop(): void {
    super.stop();

    // Reset all active morphs to 0
    for (const [name] of this.activeMorphs) {
      try {
        this.head.setValue(name, 0);
      } catch {
        // Ignore errors on cleanup
      }
    }
    this.activeMorphs.clear();

    // Reset mood to neutral
    if (this.currentMood !== "neutral") {
      this.head.setMood("neutral");
      this.currentMood = "neutral";
    }
  }

  dispose(): void {
    this.stop();
    super.dispose();
  }
}
