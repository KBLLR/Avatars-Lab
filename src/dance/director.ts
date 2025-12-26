/**
 * Dance Director - Selects dance styles and generates choreographies
 *
 * Uses the Dance Library to find appropriate animations based on style,
 * mood, and BPM, then sequences them into choreographies for TalkingHead.
 */

import type {
  AnimationClip,
  PoseClip,
  Choreography,
  ChoreographyStep,
  DanceStyle,
  DanceMood,
  DanceDirectorConfig,
  DanceDirectorOutput,
  AnimQueueItem
} from "./types";
import type { PlanAction } from "../directors/types";
import { getDanceLibrary, type DanceLibraryManager } from "./library";

const DEFAULT_CONFIG: DanceDirectorConfig = {
  style: "freestyle",
  mood: "energetic",
  intensity: "medium",
  allowTransitions: true,
  minClipDuration: 2000,
  maxClipDuration: 10000
};

export class DanceDirector {
  private library: DanceLibraryManager;
  private config: DanceDirectorConfig;

  constructor(config: Partial<DanceDirectorConfig> = {}) {
    this.library = getDanceLibrary();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setConfig(config: Partial<DanceDirectorConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): DanceDirectorConfig {
    return { ...this.config };
  }

  /**
   * Find animations matching current style/mood configuration
   */
  findMatchingAnimations(): AnimationClip[] {
    const { style, mood, intensity } = this.config;
    let clips = this.library.getAllAnimations();

    // Filter by style if specified
    if (style) {
      const styleMatches = clips.filter(c =>
        c.tags.includes(style) || c.type === "dance"
      );
      if (styleMatches.length > 0) clips = styleMatches;
    }

    // Filter by dance mood if specified (look in tags, not avatar mood field)
    if (mood) {
      const moodMatches = clips.filter(c => c.tags.includes(mood));
      if (moodMatches.length > 0) clips = moodMatches;
    }

    // Filter by intensity if specified
    if (intensity) {
      const intensityMatches = clips.filter(c => c.intensity === intensity);
      if (intensityMatches.length > 0) clips = intensityMatches;
    }

    return clips;
  }

  /**
   * Generate a choreography for a given duration
   */
  generateChoreography(
    durationMs: number,
    name?: string
  ): DanceDirectorOutput {
    const { style, mood, bpm, allowTransitions, minClipDuration, maxClipDuration } = this.config;
    const clips = this.findMatchingAnimations();

    if (clips.length === 0) {
      // Return empty choreography if no clips available
      const emptyChoreography: Choreography = {
        id: `choreo_${Date.now()}`,
        name: name || "Empty Choreography",
        style: style || "freestyle",
        mood: mood || "energetic",
        duration_ms: durationMs,
        steps: [],
        created_at: new Date().toISOString()
      };
      return { choreography: emptyChoreography, clips: [], totalDuration: 0 };
    }

    const steps: ChoreographyStep[] = [];
    const usedClips: AnimationClip[] = [];
    let currentTime = 0;

    // Build choreography by selecting clips
    while (currentTime < durationMs) {
      const remainingTime = durationMs - currentTime;
      if (remainingTime < (minClipDuration || 2000)) break;

      // Select a random clip from available animations
      const clip = this.selectClip(clips, usedClips);
      if (!clip) break;

      // Determine step duration
      let stepDuration = clip.duration_ms;
      if (maxClipDuration && stepDuration > maxClipDuration) {
        stepDuration = maxClipDuration;
      }
      if (stepDuration > remainingTime) {
        stepDuration = remainingTime;
      }

      // Determine speed multiplier for BPM sync
      let speed = 1.0;
      if (bpm && clip.bpm && clip.bpm > 0) {
        speed = bpm / clip.bpm;
        // Clamp speed to reasonable range
        speed = Math.max(0.5, Math.min(2.0, speed));
      }

      // Create step
      const step: ChoreographyStep = {
        clip_id: clip.id,
        start_ms: currentTime,
        duration_ms: stepDuration,
        loop: clip.loopable && stepDuration > clip.duration_ms,
        transition: allowTransitions ? "crossfade" : "cut",
        transition_ms: allowTransitions ? 500 : 0,
        speed
      };

      steps.push(step);
      usedClips.push(clip);
      currentTime += stepDuration;
    }

    const choreography: Choreography = {
      id: `choreo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: name || `${style || "Freestyle"} ${mood || ""} Dance`.trim(),
      style: style || "freestyle",
      mood: mood || "energetic",
      bpm,
      duration_ms: currentTime,
      steps,
      created_at: new Date().toISOString()
    };

    return {
      choreography,
      clips: usedClips,
      totalDuration: currentTime
    };
  }

  /**
   * Select a clip, preferring variety
   */
  private selectClip(
    available: AnimationClip[],
    used: AnimationClip[]
  ): AnimationClip | null {
    if (available.length === 0) return null;

    // Prefer clips not recently used
    const recentIds = new Set(used.slice(-3).map(c => c.id));
    const fresh = available.filter(c => !recentIds.has(c.id));

    const pool = fresh.length > 0 ? fresh : available;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * Convert choreography to TalkingHead animQueue items
   */
  choreographyToAnimQueue(choreography: Choreography): AnimQueueItem[] {
    const items: AnimQueueItem[] = [];

    for (const step of choreography.steps) {
      const clip = this.library.getAnimation(step.clip_id);
      if (!clip) continue;

      items.push({
        name: clip.name,
        type: clip.type === "pose" ? "pose" : "animation",
        url: clip.url,
        duration: step.duration_ms,
        loop: step.loop,
        speed: step.speed
      });
    }

    return items;
  }

  /**
   * Generate markers from choreography for TalkingHead speakAudio
   */
  choreographyToMarkers(choreography: Choreography): {
    markers: string[];
    mtimes: number[];
  } {
    const markers: string[] = [];
    const mtimes: number[] = [];

    for (const step of choreography.steps) {
      const clip = this.library.getAnimation(step.clip_id);
      if (!clip) continue;

      // Create marker for each step
      markers.push(`dance:${clip.name}`);
      mtimes.push(step.start_ms);
    }

    return { markers, mtimes };
  }

  /**
   * Get a single random animation for quick playback
   */
  getRandomAnimation(): AnimationClip | null {
    const clips = this.findMatchingAnimations();
    if (clips.length === 0) return null;
    return clips[Math.floor(Math.random() * clips.length)];
  }

  /**
   * Get a pose by dance mood (searches tags)
   */
  getPoseForMood(mood: DanceMood): PoseClip | null {
    const poses = this.library.getAllPoses();
    const matching = poses.filter(p => p.tags.includes(mood));
    if (matching.length === 0) return null;
    return matching[Math.floor(Math.random() * matching.length)];
  }

  /**
   * Convert choreography to PlanActions for action-scheduler integration
   */
  choreographyToPlanActions(choreography: Choreography): PlanAction[] {
    const actions: PlanAction[] = [];

    for (const step of choreography.steps) {
      const clip = this.library.getAnimation(step.clip_id);
      if (!clip) continue;

      actions.push({
        time_ms: step.start_ms,
        action: "play_animation",
        args: {
          url: clip.url,
          name: clip.name,
          duration: (step.duration_ms || clip.duration_ms) / 1000,
          loop: step.loop,
          speed: step.speed,
          mirror: step.mirror
        }
      });
    }

    return actions;
  }

  /**
   * Generate dance actions for a performance section
   * Can be called by the Performance Director to add dance moves
   */
  generateDanceActions(
    startMs: number,
    endMs: number,
    density: "sparse" | "normal" | "dense" = "normal"
  ): PlanAction[] {
    const durationMs = endMs - startMs;
    const clips = this.findMatchingAnimations();

    if (clips.length === 0) return [];

    // Determine how many dance moves based on density
    const intervals = {
      sparse: 15000,  // One move every 15s
      normal: 8000,   // One move every 8s
      dense: 4000     // One move every 4s
    };
    const interval = intervals[density];
    const count = Math.floor(durationMs / interval);

    const actions: PlanAction[] = [];
    for (let i = 0; i < count; i++) {
      const clip = clips[Math.floor(Math.random() * clips.length)];
      const timeMs = startMs + (i * interval) + Math.random() * (interval / 2);

      actions.push({
        time_ms: timeMs,
        action: "play_animation",
        args: {
          url: clip.url,
          name: clip.name,
          duration: Math.min(clip.duration_ms, interval * 0.8) / 1000
        }
      });
    }

    return actions;
  }
}

// Singleton
let instance: DanceDirector | null = null;

export const getDanceDirector = (config?: Partial<DanceDirectorConfig>): DanceDirector => {
  if (!instance) {
    instance = new DanceDirector(config);
  } else if (config) {
    instance.setConfig(config);
  }
  return instance;
};
