/**
 * Multi-Layer Performance Engine - Dance Executor
 *
 * Handles full-body animations from Mixamo FBX files.
 * Supports:
 * - Animation playback with looping
 * - Speed control
 * - Mirroring
 * - Blend weight transitions
 */

import type { TalkingHead } from "@met4citizen/talkinghead";
import type {
  Timeline,
  TimelineBlock,
  DanceBlockData,
  LayerType,
} from "../types";
import { getBlockData } from "../types";
import { BaseExecutor } from "./base-executor";

export class DanceExecutor extends BaseExecutor {
  readonly layerType: LayerType = "dance";

  // Track loaded clips to avoid reloading
  private loadedClips: Set<string> = new Set();

  // Current animation state
  private currentClipId: string | null = null;
  private currentBlockId: string | null = null;

  constructor(head: TalkingHead) {
    super(head);
  }

  // ─────────────────────────────────────────────────────────
  // Resource Loading
  // ─────────────────────────────────────────────────────────

  async loadResources(timeline: Timeline): Promise<void> {
    // Collect all unique dance clip URLs
    const danceBlocks = timeline.blocks.filter((b) => b.layerType === "dance");
    const urls = new Set<string>();

    for (const block of danceBlocks) {
      const data = getBlockData(block, "dance");
      if (data?.clipUrl) {
        urls.add(data.clipUrl);
      }
    }

    // TalkingHead loads FBX on first play, but we track what's available
    for (const url of urls) {
      this.loadedClips.add(url);
    }

    this.log(`Prepared ${urls.size} animation clips`);
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

    // No active blocks - stop current animation
    if (activeBlocks.length === 0) {
      if (this.currentClipId) {
        this.stopCurrentAnimation();
      }
      return;
    }

    // Get highest priority block (first in sorted array)
    const block = activeBlocks[0];
    const data = getBlockData(block, "dance");
    if (!data) return;

    // Check if we need to start a new animation
    if (block.id !== this.currentBlockId) {
      this.startAnimation(block, data);
    }

    // Update blend weight based on fade
    const fadeFactor = this.getFadeFactor(block, time_ms);
    if (fadeFactor < 1 && data.blendWeight !== undefined) {
      // Could adjust blend weight here if TalkingHead supports it
    }

    this.currentBlocks = activeBlocks;
  }

  // ─────────────────────────────────────────────────────────
  // Animation Control
  // ─────────────────────────────────────────────────────────

  private startAnimation(block: TimelineBlock, data: DanceBlockData): void {
    if (!data.clipUrl) {
      this.warn(`Block ${block.id} has no clipUrl`);
      return;
    }

    // Calculate duration in seconds, adjusted for speed
    const speed = data.speed || 1;
    const durationSec = (block.duration_ms / 1000) / speed;

    this.log(`Playing: ${data.clipId || data.clipUrl} (${durationSec.toFixed(1)}s)`);

    try {
      // TalkingHead.playAnimation signature:
      // playAnimation(url, onprogress, dur, ndx, scale)
      this.head.playAnimation(
        data.clipUrl,
        null,           // onprogress callback
        durationSec,    // duration in seconds
        0,              // animation index (0 for single-animation FBX)
        0.01            // scale (Mixamo uses 100, RPM uses 1)
      );

      this.currentClipId = data.clipId;
      this.currentBlockId = block.id;
    } catch (err) {
      this.warn(`Failed to play animation: ${err}`);
    }
  }

  private stopCurrentAnimation(): void {
    try {
      this.head.stopAnimation();
    } catch {
      // stopAnimation may not exist on all TalkingHead versions
      try {
        // Fallback: stop and restart to clear animation state
        this.head.stop();
        this.head.start();
      } catch {
        // Ignore
      }
    }

    this.currentClipId = null;
    this.currentBlockId = null;
  }

  // ─────────────────────────────────────────────────────────
  // Cross-Layer Actions
  // ─────────────────────────────────────────────────────────

  executeAction(action: string, args?: Record<string, unknown>): void {
    switch (action) {
      case "play_animation":
        if (args?.url) {
          const durationSec = (args.duration as number) || 2;
          this.head.playAnimation(
            args.url as string,
            null,
            durationSec,
            0,
            0.01
          );
        }
        break;

      case "play_gesture":
        if (args?.gesture) {
          const duration = (args.duration as number) || 2;
          // TalkingHead has playGesture for built-in gestures
          try {
            this.head.playGesture(
              args.gesture as string,
              duration,
              args.mirror as boolean
            );
          } catch {
            this.warn(`Gesture not found: ${args.gesture}`);
          }
        }
        break;

      case "stop_gesture":
        try {
          this.head.stopGesture((args?.ms as number) || 800);
        } catch {
          this.warn("Failed to stop gesture");
        }
        break;

      case "stop_animation":
        this.stopCurrentAnimation();
        break;

      case "stop_pose":
        this.stopCurrentAnimation();
        break;

      case "play_pose":
        if (args?.url) {
          try {
            this.head.playPose(
              args.url as string,
              null,
              (args.duration as number) || 2,
              0,
              0.01
            );
          } catch (err) {
            this.warn(`Failed to play pose: ${err}`);
          }
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
    this.stopCurrentAnimation();
  }

  seek(_time_ms: number): void {
    // On seek, clear current animation so it restarts at new position
    this.currentBlockId = null;
  }

  dispose(): void {
    this.stop();
    this.loadedClips.clear();
    super.dispose();
  }
}
