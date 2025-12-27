/**
 * Multi-Layer Performance Engine - State Machine
 *
 * Unified state machine that coordinates all layer executors.
 * Handles playback, seeking, and cross-layer event propagation.
 */

import type { TalkingHead } from "@met4citizen/talkinghead";
import type { EffectsManager } from "../effects/manager";
import type {
  Timeline,
  TimelineBlock,
  LayerType,
  EngineState,
  EngineStateEvent,
  BlockEvent,
} from "./types";
import type { LayerExecutor } from "./executors/base-executor";

// ============================================
// Configuration
// ============================================

export interface EngineConfig {
  timeline: Timeline;
  head: TalkingHead;
  effectsManager?: EffectsManager;

  // Playback settings
  loop?: boolean;
  playbackRate?: number;
  startTime_ms?: number;
}

// ============================================
// Engine State Machine
// ============================================

export class EngineStateMachine {
  private state: EngineState = "idle";
  private timeline: Timeline;
  private head: TalkingHead;
  private effectsManager: EffectsManager | null;

  // Playback state
  private currentTime_ms = 0;
  private playbackRate = 1.0;
  private loop = false;
  private rafId: number | null = null;
  private lastFrameTime = 0;

  // Layer executors
  private executors: Map<LayerType, LayerExecutor> = new Map();

  // Active blocks per layer
  private activeBlocks: Map<string, TimelineBlock[]> = new Map();

  // Previously active block IDs (for detecting transitions)
  private previouslyActiveIds: Set<string> = new Set();

  // Listeners
  private listeners: Set<(event: EngineStateEvent) => void> = new Set();

  constructor(config: EngineConfig) {
    this.timeline = config.timeline;
    this.head = config.head;
    this.effectsManager = config.effectsManager ?? null;
    this.loop = config.loop ?? false;
    this.playbackRate = config.playbackRate ?? 1.0;
    this.currentTime_ms = config.startTime_ms ?? 0;
  }

  // ─────────────────────────────────────────────────────────
  // Executor Management
  // ─────────────────────────────────────────────────────────

  /**
   * Register a layer executor
   */
  registerExecutor(executor: LayerExecutor): void {
    this.executors.set(executor.layerType, executor);
  }

  /**
   * Get executor for a layer type
   */
  getExecutor(type: LayerType): LayerExecutor | undefined {
    return this.executors.get(type);
  }

  /**
   * Initialize all registered executors
   */
  async initialize(): Promise<void> {
    this.setState("loading");

    try {
      const promises = Array.from(this.executors.values()).map((executor) =>
        executor.loadResources(this.timeline)
      );
      await Promise.all(promises);
      this.setState("ready");
    } catch (error) {
      this.setState("error");
      this.emit({
        type: "error",
        state: this.state,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  // ─────────────────────────────────────────────────────────
  // State Management
  // ─────────────────────────────────────────────────────────

  getState(): EngineState {
    return this.state;
  }

  getCurrentTime(): number {
    return this.currentTime_ms;
  }

  getDuration(): number {
    return this.timeline.duration_ms;
  }

  getTimeline(): Timeline {
    return this.timeline;
  }

  setTimeline(timeline: Timeline): void {
    const wasPlaying = this.state === "playing";
    if (wasPlaying) {
      this.pause();
    }

    this.timeline = timeline;
    this.currentTime_ms = 0;
    this.activeBlocks.clear();
    this.previouslyActiveIds.clear();

    // Re-initialize executors with new timeline
    this.initialize().then(() => {
      if (wasPlaying) {
        this.play();
      }
    });
  }

  private setState(newState: EngineState): void {
    const previousState = this.state;
    if (previousState === newState) return;

    this.state = newState;
    this.emit({ type: "stateChange", state: newState, previousState });

    // Notify all executors of state change
    this.executors.forEach((executor) => {
      executor.onEngineStateChange(newState, previousState);
    });
  }

  // ─────────────────────────────────────────────────────────
  // Playback Controls
  // ─────────────────────────────────────────────────────────

  play(): void {
    if (this.state !== "ready" && this.state !== "paused") {
      console.warn(`[Engine] Cannot play from state: ${this.state}`);
      return;
    }

    this.setState("playing");
    this.lastFrameTime = performance.now();
    this.tick();
  }

  pause(): void {
    if (this.state !== "playing") return;

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Pause all executors
    this.executors.forEach((executor) => executor.pause());

    this.setState("paused");
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Stop all executors
    this.executors.forEach((executor) => executor.stop());

    this.currentTime_ms = 0;
    this.activeBlocks.clear();
    this.previouslyActiveIds.clear();
    this.setState("ready");
  }

  seek(time_ms: number): void {
    const prevState = this.state;
    if (
      prevState !== "playing" &&
      prevState !== "paused" &&
      prevState !== "ready"
    ) {
      return;
    }

    this.setState("seeking");

    const clampedTime = Math.max(0, Math.min(time_ms, this.getDuration()));
    this.currentTime_ms = clampedTime;

    // Update all executors to new time
    this.executors.forEach((executor) => {
      executor.seek(clampedTime);
    });

    // Recalculate active blocks
    this.updateActiveBlocks();

    this.emit({
      type: "seekComplete",
      state: this.state,
      time_ms: clampedTime,
    });

    this.setState(prevState === "playing" ? "playing" : "ready");

    // Resume playback if was playing
    if (prevState === "playing") {
      this.lastFrameTime = performance.now();
      this.tick();
    }
  }

  setPlaybackRate(rate: number): void {
    this.playbackRate = Math.max(0.1, Math.min(4.0, rate));
  }

  getPlaybackRate(): number {
    return this.playbackRate;
  }

  setLoop(loop: boolean): void {
    this.loop = loop;
  }

  isLooping(): boolean {
    return this.loop;
  }

  // ─────────────────────────────────────────────────────────
  // Main Update Loop
  // ─────────────────────────────────────────────────────────

  private tick(): void {
    if (this.state !== "playing") return;

    const now = performance.now();
    const delta_ms = (now - this.lastFrameTime) * this.playbackRate;
    this.lastFrameTime = now;

    this.currentTime_ms += delta_ms;

    // Check for end of timeline
    if (this.currentTime_ms >= this.getDuration()) {
      if (this.loop) {
        this.currentTime_ms = 0;
        this.activeBlocks.clear();
        this.previouslyActiveIds.clear();
      } else {
        this.stop();
        return;
      }
    }

    // Update active blocks
    this.updateActiveBlocks();

    // Update all executors
    this.executors.forEach((executor, layerType) => {
      const layer = this.timeline.layers.find((l) => l.type === layerType);
      if (!layer || !layer.enabled || layer.muted) return;

      const layerBlocks = this.activeBlocks.get(layer.id) || [];
      executor.update(this.currentTime_ms, delta_ms, layerBlocks);
    });

    // Emit time update (throttled to avoid spam)
    this.emit({
      type: "timeUpdate",
      state: this.state,
      time_ms: this.currentTime_ms,
    });

    // Schedule next frame
    this.rafId = requestAnimationFrame(() => this.tick());
  }

  private updateActiveBlocks(): void {
    const time = this.currentTime_ms;
    const currentlyActiveIds = new Set<string>();

    // Find all blocks that overlap current time
    for (const block of this.timeline.blocks) {
      const layer = this.timeline.layers.find((l) => l.id === block.layerId);
      if (!layer || !layer.enabled || layer.muted) continue;

      const blockEnd = block.start_ms + block.duration_ms;
      const isActive = time >= block.start_ms && time < blockEnd;

      if (isActive) {
        currentlyActiveIds.add(block.id);

        // Check if this block just became active
        if (!this.previouslyActiveIds.has(block.id)) {
          this.activateBlock(block);
        }
      }
    }

    // Check for blocks that just became inactive
    for (const blockId of this.previouslyActiveIds) {
      if (!currentlyActiveIds.has(blockId)) {
        const block = this.timeline.blocks.find((b) => b.id === blockId);
        if (block) {
          this.deactivateBlock(block);
        }
      }
    }

    // Update tracking
    this.previouslyActiveIds = currentlyActiveIds;
  }

  private activateBlock(block: TimelineBlock): void {
    const layerBlocks = this.activeBlocks.get(block.layerId) || [];
    layerBlocks.push(block);
    this.activeBlocks.set(block.layerId, layerBlocks);

    this.emit({
      type: "blockStart",
      state: this.state,
      blockId: block.id,
      layerId: block.layerId,
      time_ms: this.currentTime_ms,
    });

    // Process trigger events
    this.processBlockEvents(block, "start");
  }

  private deactivateBlock(block: TimelineBlock): void {
    const layerBlocks = this.activeBlocks.get(block.layerId) || [];
    const filtered = layerBlocks.filter((b) => b.id !== block.id);
    this.activeBlocks.set(block.layerId, filtered);

    this.emit({
      type: "blockEnd",
      state: this.state,
      blockId: block.id,
      layerId: block.layerId,
      time_ms: this.currentTime_ms,
    });

    // Process trigger events
    this.processBlockEvents(block, "end");
  }

  private processBlockEvents(
    block: TimelineBlock,
    eventType: "start" | "end"
  ): void {
    if (!block.triggerEvents) return;

    for (const event of block.triggerEvents) {
      if (event.type !== eventType) continue;

      this.executeBlockEvent(event);
    }
  }

  private executeBlockEvent(event: BlockEvent): void {
    const targetLayer = this.timeline.layers.find(
      (l) => l.id === event.targetLayerId
    );
    if (!targetLayer) return;

    const executor = this.executors.get(targetLayer.type);
    if (!executor) return;

    const execute = () => {
      executor.executeAction(event.action, event.args);
    };

    if (event.delay_ms && event.delay_ms > 0) {
      setTimeout(execute, event.delay_ms);
    } else {
      execute();
    }
  }

  // ─────────────────────────────────────────────────────────
  // Events
  // ─────────────────────────────────────────────────────────

  on(listener: (event: EngineStateEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: EngineStateEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (err) {
        console.error("[Engine] Listener error:", err);
      }
    });
  }

  // ─────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────

  /**
   * Get all active blocks at the current time
   */
  getActiveBlocks(): TimelineBlock[] {
    const result: TimelineBlock[] = [];
    for (const blocks of this.activeBlocks.values()) {
      result.push(...blocks);
    }
    return result;
  }

  /**
   * Get active blocks for a specific layer
   */
  getActiveBlocksForLayer(layerId: string): TimelineBlock[] {
    return this.activeBlocks.get(layerId) || [];
  }

  // ─────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────

  dispose(): void {
    this.stop();
    this.executors.forEach((executor) => executor.dispose());
    this.executors.clear();
    this.listeners.clear();
    this.activeBlocks.clear();
    this.previouslyActiveIds.clear();
  }
}
