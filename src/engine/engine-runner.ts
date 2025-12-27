/**
 * Engine Runner
 *
 * Orchestrates the full performance flow:
 * Director Plan → Timeline → Engine State Machine → Executors → TalkingHead
 *
 * This is the main integration point that connects all engine components.
 */

import type { TalkingHead } from "@met4citizen/talkinghead";
import type { MergedPlan } from "../directors/types";
import type { Timeline, TimelineBlock, EngineState } from "./types";
import { EngineStateMachine, type EngineConfig } from "./engine-state-machine";
import { directorPlanToTimeline } from "./director-adapter";
import { createTimelineEditor, type TimelineEditor } from "./ui";
import {
  saveTimeline,
  loadTimeline,
  loadCurrentTimeline,
  exportTimelineAsFile,
  importTimelineFromFile,
  scheduleAutoSave,
} from "./timeline-persistence";

// ============================================
// Engine Runner
// ============================================

export interface EngineRunnerConfig {
  /** Container element for timeline editor */
  timelineContainer?: HTMLElement;
  /** Auto-save timeline changes */
  autoSave?: boolean;
  /** Auto-save delay in ms */
  autoSaveDelay?: number;
  /** Show timeline editor */
  showEditor?: boolean;
}

export interface EngineRunnerState {
  isPlaying: boolean;
  isPaused: boolean;
  currentTime_ms: number;
  duration_ms: number;
  timeline: Timeline | null;
  engineState: EngineState;
}

export type EngineRunnerEventType =
  | "stateChange"
  | "timeUpdate"
  | "timelineLoaded"
  | "timelineSaved"
  | "playbackStart"
  | "playbackPause"
  | "playbackStop"
  | "playbackEnd"
  | "error";

export interface EngineRunnerEvent {
  type: EngineRunnerEventType;
  state?: EngineRunnerState;
  error?: Error;
  timeline?: Timeline;
}

type EngineRunnerEventHandler = (event: EngineRunnerEvent) => void;

export class EngineRunner {
  private head: TalkingHead;
  private config: Required<EngineRunnerConfig>;

  private engine: EngineStateMachine | null = null;
  private editor: TimelineEditor | null = null;
  private timeline: Timeline | null = null;

  private eventHandlers: Map<EngineRunnerEventType, Set<EngineRunnerEventHandler>> = new Map();
  private playbackRAF: number | null = null;
  private lastFrameTime = 0;

  constructor(head: TalkingHead, config: EngineRunnerConfig = {}) {
    this.head = head;
    this.config = {
      timelineContainer: config.timelineContainer || null!,
      autoSave: config.autoSave ?? true,
      autoSaveDelay: config.autoSaveDelay ?? 2000,
      showEditor: config.showEditor ?? true,
    };

    this.init();
  }

  // ─────────────────────────────────────────────────────────────
  // Initialization
  // ─────────────────────────────────────────────────────────────

  private init(): void {
    // Create engine
    const engineConfig: EngineConfig = {
      head: this.head,
      effectsManager: undefined, // Will be set if available
    };

    this.engine = new EngineStateMachine(engineConfig);

    // Subscribe to engine events
    this.engine.on("stateChange", (event) => {
      this.emit({ type: "stateChange", state: this.getState() });
    });

    this.engine.on("timeUpdate", (event) => {
      if (this.editor && event.time_ms !== undefined) {
        this.editor.setPlayhead(event.time_ms);
      }
      this.emit({ type: "timeUpdate", state: this.getState() });
    });

    // Create timeline editor if container provided
    if (this.config.showEditor && this.config.timelineContainer) {
      this.initEditor();
    }

    // Try to load last timeline
    const lastTimeline = loadCurrentTimeline();
    if (lastTimeline) {
      this.loadTimeline(lastTimeline);
    }

    console.log("[EngineRunner] Initialized");
  }

  private initEditor(): void {
    if (!this.config.timelineContainer) return;

    this.editor = createTimelineEditor(this.config.timelineContainer, {
      trackHeight: 44,
      headerWidth: 100,
      showRuler: true,
      showMarkers: true,
      enableSelection: true,
      enableDragging: true,
    });

    // Wire up editor events
    this.editor.on("playhead:seek", (event) => {
      if (event.time_ms !== undefined) {
        this.seek(event.time_ms);
      }
    });

    this.editor.on("block:move", (event) => {
      this.onTimelineModified();
    });

    this.editor.on("block:resize", (event) => {
      this.onTimelineModified();
    });

    this.editor.on("block:delete", (event) => {
      this.onTimelineModified();
    });

    this.editor.on("block:paste", (event) => {
      this.onTimelineModified();
    });

    this.editor.on("block:duplicate", (event) => {
      this.onTimelineModified();
    });
  }

  private onTimelineModified(): void {
    if (this.timeline && this.config.autoSave) {
      scheduleAutoSave(this.timeline, this.config.autoSaveDelay);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Timeline Management
  // ─────────────────────────────────────────────────────────────

  /**
   * Load a timeline from a MergedPlan (director output)
   */
  loadFromPlan(plan: MergedPlan, audioDuration_ms?: number): void {
    const { timeline } = directorPlanToTimeline(plan, {
      durationMs: audioDuration_ms || 30000,
      defaultCameraView: "upper",
      defaultLightPreset: "neon",
      defaultMood: "neutral",
    });

    this.loadTimeline(timeline);
  }

  /**
   * Load a timeline object
   */
  loadTimeline(timeline: Timeline): void {
    this.timeline = timeline;

    // Load into engine
    if (this.engine) {
      this.engine.loadTimeline(timeline);
    }

    // Load into editor
    if (this.editor) {
      this.editor.setTimeline(timeline);
    }

    this.emit({ type: "timelineLoaded", timeline });
    console.log(`[EngineRunner] Loaded timeline: ${timeline.name}`);
  }

  /**
   * Get current timeline
   */
  getTimeline(): Timeline | null {
    return this.timeline;
  }

  /**
   * Save current timeline
   */
  save(): void {
    if (this.timeline) {
      saveTimeline(this.timeline);
      this.emit({ type: "timelineSaved", timeline: this.timeline });
    }
  }

  /**
   * Export timeline to file
   */
  export(): void {
    if (this.timeline) {
      exportTimelineAsFile(this.timeline);
    }
  }

  /**
   * Import timeline from file
   */
  async import(file: File): Promise<boolean> {
    const timeline = await importTimelineFromFile(file);
    if (timeline) {
      this.loadTimeline(timeline);
      return true;
    }
    return false;
  }

  // ─────────────────────────────────────────────────────────────
  // Playback Control
  // ─────────────────────────────────────────────────────────────

  /**
   * Start playback
   */
  play(): void {
    if (!this.engine || !this.timeline) return;

    this.engine.play();

    if (this.editor) {
      this.editor.play();
    }

    // Start playback loop
    this.startPlaybackLoop();

    this.emit({ type: "playbackStart", state: this.getState() });
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (!this.engine) return;

    this.engine.pause();

    if (this.editor) {
      this.editor.pause();
    }

    this.stopPlaybackLoop();

    this.emit({ type: "playbackPause", state: this.getState() });
  }

  /**
   * Stop playback and reset to beginning
   */
  stop(): void {
    if (!this.engine) return;

    this.engine.stop();

    if (this.editor) {
      this.editor.stop();
    }

    this.stopPlaybackLoop();

    this.emit({ type: "playbackStop", state: this.getState() });
  }

  /**
   * Toggle play/pause
   */
  togglePlay(): void {
    if (this.engine?.getState().state === "playing") {
      this.pause();
    } else {
      this.play();
    }
  }

  /**
   * Seek to time
   */
  seek(time_ms: number): void {
    if (!this.engine) return;

    this.engine.seek(time_ms);

    if (this.editor) {
      this.editor.setPlayhead(time_ms);
    }
  }

  /**
   * Get current playback time
   */
  getCurrentTime(): number {
    return this.engine?.getState().time_ms || 0;
  }

  // ─────────────────────────────────────────────────────────────
  // Playback Loop
  // ─────────────────────────────────────────────────────────────

  private startPlaybackLoop(): void {
    this.lastFrameTime = performance.now();
    this.playbackRAF = requestAnimationFrame(this.playbackTick.bind(this));
  }

  private stopPlaybackLoop(): void {
    if (this.playbackRAF) {
      cancelAnimationFrame(this.playbackRAF);
      this.playbackRAF = null;
    }
  }

  private playbackTick(timestamp: number): void {
    if (!this.engine || !this.timeline) {
      this.stopPlaybackLoop();
      return;
    }

    const state = this.engine.getState();

    if (state.state !== "playing") {
      this.stopPlaybackLoop();
      return;
    }

    // Check if playback ended
    if (state.time_ms >= this.timeline.duration_ms) {
      this.stop();
      this.emit({ type: "playbackEnd", state: this.getState() });
      return;
    }

    // Update editor playhead
    if (this.editor) {
      this.editor.setPlayhead(state.time_ms);
    }

    this.lastFrameTime = timestamp;
    this.playbackRAF = requestAnimationFrame(this.playbackTick.bind(this));
  }

  // ─────────────────────────────────────────────────────────────
  // State
  // ─────────────────────────────────────────────────────────────

  /**
   * Get current runner state
   */
  getState(): EngineRunnerState {
    const engineState = this.engine?.getState();

    return {
      isPlaying: engineState?.state === "playing",
      isPaused: engineState?.state === "paused",
      currentTime_ms: engineState?.time_ms || 0,
      duration_ms: this.timeline?.duration_ms || 0,
      timeline: this.timeline,
      engineState: engineState?.state || "idle",
    };
  }

  /**
   * Get timeline editor instance
   */
  getEditor(): TimelineEditor | null {
    return this.editor;
  }

  /**
   * Get engine instance
   */
  getEngine(): EngineStateMachine | null {
    return this.engine;
  }

  // ─────────────────────────────────────────────────────────────
  // Event System
  // ─────────────────────────────────────────────────────────────

  on(type: EngineRunnerEventType, handler: EngineRunnerEventHandler): void {
    if (!this.eventHandlers.has(type)) {
      this.eventHandlers.set(type, new Set());
    }
    this.eventHandlers.get(type)!.add(handler);
  }

  off(type: EngineRunnerEventType, handler: EngineRunnerEventHandler): void {
    this.eventHandlers.get(type)?.delete(handler);
  }

  private emit(event: EngineRunnerEvent): void {
    this.eventHandlers.get(event.type)?.forEach((handler) => handler(event));
  }

  // ─────────────────────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────────────────────

  dispose(): void {
    this.stopPlaybackLoop();

    if (this.engine) {
      this.engine.dispose();
      this.engine = null;
    }

    if (this.editor) {
      this.editor.dispose();
      this.editor = null;
    }

    this.eventHandlers.clear();
    this.timeline = null;

    console.log("[EngineRunner] Disposed");
  }
}

// ============================================
// Factory Function
// ============================================

/**
 * Create an engine runner instance
 */
export function createEngineRunner(
  head: TalkingHead,
  config?: EngineRunnerConfig
): EngineRunner {
  return new EngineRunner(head, config);
}
