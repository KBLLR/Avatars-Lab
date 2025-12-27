/**
 * Dance State Machine
 *
 * Manages avatar animation states with proper lifecycle handling.
 * Ensures smooth transitions between animations and return to idle.
 * Designed for use in both Dance Studio and Stage performances.
 */

import type { TalkingHead } from "@met4citizen/talkinghead";
import type { AnimationClip, Choreography, ChoreographyStep } from "./types";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export type DanceState = "idle" | "playing" | "choreography" | "transitioning" | "paused";

export interface DanceStateEvent {
  type: "stateChange" | "animationStart" | "animationEnd" | "choreographyEnd" | "error";
  state: DanceState;
  previousState?: DanceState;
  animation?: AnimationClip;
  step?: number;
  error?: Error;
}

export type DanceStateListener = (event: DanceStateEvent) => void;

export interface DanceStateMachineConfig {
  /** Idle animation to play when not dancing (optional) */
  idleAnimation?: AnimationClip;
  /** Default transition duration in ms */
  transitionDuration?: number;
  /** Whether to auto-return to idle after animations */
  autoReturnToIdle?: boolean;
  /** Delay before returning to idle (ms) */
  idleReturnDelay?: number;
}

// ─────────────────────────────────────────────────────────────
// State Machine
// ─────────────────────────────────────────────────────────────

export class DanceStateMachine {
  private head: TalkingHead | null = null;
  private state: DanceState = "idle";
  private config: DanceStateMachineConfig;
  private listeners: Set<DanceStateListener> = new Set();

  // Choreography state
  private currentChoreography: Choreography | null = null;
  private choreographySteps: ChoreographyStep[] = [];
  private currentStepIndex = 0;
  private choreographyTimeouts: number[] = [];

  // Idle return
  private idleTimeout: number | null = null;

  // Animation tracking
  private currentAnimation: AnimationClip | null = null;
  private animationStartTime = 0;

  constructor(config: DanceStateMachineConfig = {}) {
    this.config = {
      transitionDuration: 300,
      autoReturnToIdle: true,
      idleReturnDelay: 500,
      ...config
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────

  /**
   * Attach to a TalkingHead instance
   */
  attach(head: TalkingHead): void {
    this.head = head;
    this.setState("idle");
  }

  /**
   * Detach from TalkingHead instance
   */
  detach(): void {
    this.stop();
    this.head = null;
    this.setState("idle");
  }

  /**
   * Update config
   */
  configure(config: Partial<DanceStateMachineConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Set the idle animation
   */
  setIdleAnimation(animation: AnimationClip | undefined): void {
    this.config.idleAnimation = animation;
  }

  // ─────────────────────────────────────────────────────────────
  // State Management
  // ─────────────────────────────────────────────────────────────

  /**
   * Get current state
   */
  getState(): DanceState {
    return this.state;
  }

  /**
   * Check if currently animating
   */
  isAnimating(): boolean {
    return this.state === "playing" || this.state === "choreography";
  }

  /**
   * Check if idle
   */
  isIdle(): boolean {
    return this.state === "idle";
  }

  private setState(newState: DanceState): void {
    const previousState = this.state;
    this.state = newState;
    this.emit({
      type: "stateChange",
      state: newState,
      previousState
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Single Animation Playback
  // ─────────────────────────────────────────────────────────────

  /**
   * Play a single animation
   */
  play(animation: AnimationClip, options?: { loop?: boolean; speed?: number }): void {
    if (!this.head) {
      console.warn("DanceStateMachine: No head attached");
      return;
    }

    // Clear any pending operations
    this.clearTimeouts();

    this.currentAnimation = animation;
    this.animationStartTime = performance.now();
    this.setState("playing");

    this.emit({
      type: "animationStart",
      state: "playing",
      animation
    });

    const durationSec = (animation.duration_ms / 1000) * (1 / (options?.speed || 1));

    // Play the animation
    this.head.playAnimation(
      animation.url,
      null,  // onprogress
      durationSec,
      0,     // ndx - animation index
      0.01   // scale
    );

    // Schedule completion handler
    const completionMs = animation.duration_ms * (1 / (options?.speed || 1));
    setTimeout(() => this.onAnimationComplete(animation, options?.loop), completionMs);
  }

  /**
   * Called when animation completes
   */
  private onAnimationComplete(animation: AnimationClip, loop?: boolean): void {
    if (this.state !== "playing") return;

    this.emit({
      type: "animationEnd",
      state: this.state,
      animation
    });

    if (loop && animation.loopable) {
      // Restart the animation
      this.play(animation, { loop: true });
    } else if (this.config.autoReturnToIdle) {
      // Schedule return to idle
      this.scheduleIdleReturn();
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Choreography Playback
  // ─────────────────────────────────────────────────────────────

  /**
   * Play a choreography sequence
   */
  playChoreography(
    choreography: Choreography,
    animations: Map<string, AnimationClip>,
    options?: { loop?: boolean; onStepChange?: (step: number) => void }
  ): void {
    if (!this.head) {
      console.warn("DanceStateMachine: No head attached");
      return;
    }

    // Clear any pending operations
    this.clearTimeouts();

    this.currentChoreography = choreography;
    this.choreographySteps = choreography.steps;
    this.currentStepIndex = 0;
    this.setState("choreography");

    // Schedule all steps
    let cumulativeTime = 0;

    choreography.steps.forEach((step, index) => {
      const animation = animations.get(step.clip_id);
      if (!animation) {
        console.warn(`Animation not found: ${step.clip_id}`);
        return;
      }

      const timeoutId = window.setTimeout(() => {
        if (this.state !== "choreography") return;

        this.currentStepIndex = index;
        this.currentAnimation = animation;

        this.emit({
          type: "animationStart",
          state: "choreography",
          animation,
          step: index
        });

        options?.onStepChange?.(index);

        const durationSec = ((step.duration_ms || animation.duration_ms) / 1000) * (step.speed || 1);

        this.head?.playAnimation(
          animation.url,
          null,  // onprogress
          durationSec,
          0,     // ndx - animation index within FBX
          0.01   // scale - RPM uses 1, Mixamo uses 100
        );
      }, cumulativeTime);

      this.choreographyTimeouts.push(timeoutId);
      cumulativeTime += step.duration_ms || animation.duration_ms;
    });

    // Schedule choreography completion
    const completionId = window.setTimeout(() => {
      if (this.state !== "choreography") return;

      this.emit({
        type: "choreographyEnd",
        state: this.state
      });

      if (options?.loop) {
        // Restart choreography
        this.playChoreography(choreography, animations, options);
      } else if (this.config.autoReturnToIdle) {
        this.scheduleIdleReturn();
      }
    }, choreography.duration_ms);

    this.choreographyTimeouts.push(completionId);
  }

  // ─────────────────────────────────────────────────────────────
  // Idle Management
  // ─────────────────────────────────────────────────────────────

  /**
   * Return to idle state
   */
  returnToIdle(): void {
    this.clearTimeouts();
    this.currentAnimation = null;
    this.currentChoreography = null;

    if (this.config.idleAnimation && this.head) {
      this.setState("transitioning");

      // Play idle animation
      this.head.playAnimation(
        this.config.idleAnimation.url,
        null,  // onprogress
        this.config.idleAnimation.duration_ms / 1000,
        0,     // ndx
        0.01   // scale
      );

      // Schedule loop after animation completes
      setTimeout(() => {
        if (this.state === "transitioning" || this.state === "idle") {
          this.setState("idle");
          if (this.config.idleAnimation) {
            this.playIdleLoop();
          }
        }
      }, this.config.idleAnimation.duration_ms);
    } else {
      // No idle animation, just stop
      this.head?.stop();
      this.setState("idle");
    }
  }

  private playIdleLoop(): void {
    if (!this.head || !this.config.idleAnimation) return;
    if (this.state !== "idle") return;

    this.head.playAnimation(
      this.config.idleAnimation.url,
      null,  // onprogress
      this.config.idleAnimation.duration_ms / 1000,
      0,     // ndx
      0.01   // scale
    );

    // Schedule next loop iteration
    setTimeout(() => this.playIdleLoop(), this.config.idleAnimation.duration_ms);
  }

  private scheduleIdleReturn(): void {
    this.clearIdleTimeout();

    this.idleTimeout = window.setTimeout(() => {
      this.returnToIdle();
    }, this.config.idleReturnDelay);
  }

  private clearIdleTimeout(): void {
    if (this.idleTimeout !== null) {
      clearTimeout(this.idleTimeout);
      this.idleTimeout = null;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Control
  // ─────────────────────────────────────────────────────────────

  /**
   * Stop all playback and return to idle
   */
  stop(): void {
    this.clearTimeouts();
    this.currentAnimation = null;
    this.currentChoreography = null;
    this.head?.stop();
    this.setState("idle");
  }

  /**
   * Pause playback (if supported)
   */
  pause(): void {
    if (this.state === "playing" || this.state === "choreography") {
      // Note: TalkingHead may not support true pause
      this.setState("paused");
    }
  }

  /**
   * Resume playback (if paused)
   */
  resume(): void {
    if (this.state === "paused") {
      // Would need to track where we were and resume
      // For now, just return to idle
      this.returnToIdle();
    }
  }

  private clearTimeouts(): void {
    this.clearIdleTimeout();
    this.choreographyTimeouts.forEach((id) => clearTimeout(id));
    this.choreographyTimeouts = [];
  }

  // ─────────────────────────────────────────────────────────────
  // Events
  // ─────────────────────────────────────────────────────────────

  /**
   * Subscribe to state events
   */
  on(listener: DanceStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Unsubscribe from state events
   */
  off(listener: DanceStateListener): void {
    this.listeners.delete(listener);
  }

  private emit(event: DanceStateEvent): void {
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (err) {
        console.error("DanceStateMachine listener error:", err);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Getters
  // ─────────────────────────────────────────────────────────────

  getCurrentAnimation(): AnimationClip | null {
    return this.currentAnimation;
  }

  getCurrentChoreography(): Choreography | null {
    return this.currentChoreography;
  }

  getCurrentStepIndex(): number {
    return this.currentStepIndex;
  }

  getElapsedTime(): number {
    if (!this.animationStartTime) return 0;
    return performance.now() - this.animationStartTime;
  }
}

// ─────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────

let defaultStateMachine: DanceStateMachine | null = null;

/**
 * Get the singleton state machine instance
 */
export function getDanceStateMachine(config?: DanceStateMachineConfig): DanceStateMachine {
  if (!defaultStateMachine) {
    defaultStateMachine = new DanceStateMachine(config);
  } else if (config) {
    defaultStateMachine.configure(config);
  }
  return defaultStateMachine;
}

/**
 * Create a new state machine instance (for multi-avatar scenarios)
 */
export function createDanceStateMachine(config?: DanceStateMachineConfig): DanceStateMachine {
  return new DanceStateMachine(config);
}
