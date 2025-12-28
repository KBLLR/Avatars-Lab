/**
 * Director Plan -> Timeline adapter
 *
 * Converts a MergedPlan (director output) into a multi-layer timeline
 * that can be executed by the EngineStateMachine.
 */

import type {
  MergedPlan,
  PlanAction,
  PlanSection,
  Mood,
} from "../directors/types";
import {
  createTimeline,
  createBlock,
  type Timeline,
  type TimelineBlock,
  type CameraBlockData,
  type LightingBlockData,
  type BlendshapeBlockData,
  type EmojiBlockData,
  type DanceBlockData,
  type FXBlockData,
  type VisemeBlockData,
  type BlockEvent,
} from "./types";

export interface DirectorToTimelineOptions {
  durationMs: number;
  defaultCameraView?: string;
  defaultLightPreset?: string;
  defaultMood?: Mood | string;
  eventBlockMs?: number;
  cameraTransitionMs?: number;
  lightingTransitionMs?: number;
  // Viseme/lipsync data
  audioUrl?: string;
  wordTimings?: {
    words: string[];
    wtimes: number[];
    wdurations: number[];
  };
  visemeMapping?: {
    visemes: string[];
    vtimes: number[];
    vdurations: number[];
  };
}

export interface DirectorToTimelineResult {
  timeline: Timeline;
  externalActions: PlanAction[];
}

const DEFAULT_EVENT_BLOCK_MS = 160;
const DEFAULT_CAMERA_TRANSITION_MS = 900;
const DEFAULT_LIGHT_TRANSITION_MS = 900;
const DEFAULT_MOOD_DURATION_MS = 2000;
const DEFAULT_EXPRESSION_DURATION_MS = 1200;
const DEFAULT_FX_DURATION_MS = 2000;
const DEFAULT_CAMERA_MOVE_MS = 1200;
const DEFAULT_DANCE_DURATION_MS = 2500;

const toMs = (seconds?: number): number | null =>
  typeof seconds === "number" ? Math.max(0, Math.round(seconds * 1000)) : null;

const clampTime = (time: number, durationMs: number): number =>
  Math.max(0, Math.min(durationMs, Math.round(time)));

const ensureDuration = (durationMs: number | null, fallbackMs: number): number =>
  Math.max(60, Math.round(durationMs ?? fallbackMs));

const makeEventBlock = (
  start_ms: number,
  duration_ms: number,
  event: BlockEvent
): TimelineBlock<BlendshapeBlockData> => {
  const block = createBlock(
    "blendshape",
    "blendshape",
    start_ms,
    duration_ms,
    {},
    `event:${event.action}`
  );
  block.triggerEvents = [event];
  return block;
};

const addParam = (
  params: Record<string, number | boolean>,
  key: string,
  value: unknown
): void => {
  if (typeof value === "number" || typeof value === "boolean") {
    params[key] = value;
  }
};

const normalizeFxEffect = (value?: string): FXBlockData["effect"] | null => {
  if (!value) return null;
  const cleaned = value.trim().toLowerCase();
  if (!cleaned) return null;

  switch (cleaned) {
    case "bloom":
      return "bloom";
    case "vignette":
      return "vignette";
    case "chromatic":
    case "chromatic_aberration":
    case "chromatic-aberration":
      return "chromatic";
    case "glitch":
      return "glitch";
    case "pixel":
    case "pixelation":
    case "pixelate":
      return "pixelation";
    case "clean":
    case "none":
      return "none";
    default:
      return null;
  }
};

const addSectionDefaults = (
  blocks: TimelineBlock[],
  section: PlanSection,
  options: DirectorToTimelineOptions
): void => {
  const durationMs = Math.max(1, section.end_ms - section.start_ms);

  const mood = section.mood ?? options.defaultMood;
  if (mood) {
    const data: BlendshapeBlockData = { mood };
    blocks.push(
      createBlock(
        "blendshape",
        "blendshape",
        section.start_ms,
        durationMs,
        data,
        `${section.label}:mood`
      )
    );
  }

  const cameraView = section.camera || options.defaultCameraView;
  if (cameraView) {
    const data: CameraBlockData = { view: cameraView as CameraBlockData["view"], movement: "static" };
    const block = createBlock(
      "camera",
      "camera",
      section.start_ms,
      durationMs,
      data,
      `${section.label}:camera`
    );
    blocks.push(block);
  }

  const lightPreset = section.light || options.defaultLightPreset;
  if (lightPreset) {
    const data: LightingBlockData = {
      preset: lightPreset,
      transition: "fade",
    };
    const block = createBlock(
      "lighting",
      "lighting",
      section.start_ms,
      durationMs,
      data,
      `${section.label}:lights`
    );
    blocks.push(block);
  }

  const fxEffect = normalizeFxEffect(section.effects);
  if (fxEffect) {
    const data: FXBlockData = {
      effect: fxEffect,
      params: {},
    };
    blocks.push(
      createBlock(
        "fx",
        "fx",
        section.start_ms,
        durationMs,
        data,
        `fx:${section.effects || fxEffect}`
      )
    );
  }
};

const mapActionToBlocks = (
  action: PlanAction,
  options: DirectorToTimelineOptions,
  durationMs: number,
  blocks: TimelineBlock[],
  externalActions: PlanAction[]
): void => {
  const args = action.args || {};
  const start_ms = clampTime(action.time_ms, durationMs);

  switch (action.action) {
    case "set_mood": {
      if (!args.mood) {
        externalActions.push(action);
        return;
      }
      const data: BlendshapeBlockData = { mood: args.mood as Mood };
      const block = createBlock(
        "blendshape",
        "blendshape",
        start_ms,
        ensureDuration(null, DEFAULT_MOOD_DURATION_MS),
        data,
        `mood:${args.mood}`
      );
      blocks.push(block);
      return;
    }

    case "make_facial_expression":
    case "speak_emoji": {
      if (!args.emoji) {
        externalActions.push(action);
        return;
      }
      const durationMsLocal = ensureDuration(
        toMs(args.duration as number),
        DEFAULT_EXPRESSION_DURATION_MS
      );
      const data: EmojiBlockData = { emoji: args.emoji as string };
      const block = createBlock(
        "emoji",
        "emoji",
        start_ms,
        durationMsLocal,
        data,
        `emoji:${args.emoji}`
      );
      blocks.push(block);
      return;
    }

    case "set_value": {
      if (!args.mt || typeof args.value !== "number") {
        externalActions.push(action);
        return;
      }
      const durationMsLocal = ensureDuration(
        typeof args.ms === "number" ? args.ms : null,
        DEFAULT_EXPRESSION_DURATION_MS
      );
      const data: BlendshapeBlockData = {
        targetMorphs: [{ name: args.mt as string, value: args.value as number }],
      };
      const block = createBlock(
        "blendshape",
        "blendshape",
        start_ms,
        durationMsLocal,
        data,
        `morph:${args.mt}`
      );
      blocks.push(block);
      return;
    }

    case "play_animation": {
      if (!args.url) {
        externalActions.push(action);
        return;
      }
      const durationMsLocal = ensureDuration(
        toMs(args.duration as number) ||
          (typeof args.duration_ms === "number" ? args.duration_ms : null),
        DEFAULT_DANCE_DURATION_MS
      );
      const data: DanceBlockData = {
        clipId: (args.name as string) || (args.url as string),
        clipUrl: args.url as string,
        speed: typeof args.speed === "number" ? args.speed : undefined,
        mirror: typeof args.mirror === "boolean" ? args.mirror : undefined,
        loop: typeof args.loop === "boolean" ? args.loop : undefined,
      };
      const block = createBlock(
        "dance",
        "dance",
        start_ms,
        durationMsLocal,
        data,
        `anim:${data.clipId}`
      );
      blocks.push(block);
      return;
    }

    case "play_gesture":
    case "play_pose":
    case "stop_pose":
    case "stop_gesture":
    case "stop_animation": {
      const durationMsLocal = ensureDuration(
        typeof args.ms === "number" ? args.ms : null,
        options.eventBlockMs ?? DEFAULT_EVENT_BLOCK_MS
      );
      blocks.push(
        makeEventBlock(start_ms, durationMsLocal, {
          type: "start",
          targetLayerId: "dance",
          action: action.action,
          args,
        })
      );
      return;
    }

    case "set_view": {
      if (!args.view) {
        externalActions.push(action);
        return;
      }
      const durationMsLocal = ensureDuration(
        typeof args.t === "number" ? args.t : null,
        options.cameraTransitionMs ?? DEFAULT_CAMERA_TRANSITION_MS
      );
      const data: CameraBlockData = {
        view: args.view as CameraBlockData["view"],
        movement: "static",
        distance:
          typeof args.cameraDistance === "number"
            ? args.cameraDistance
            : undefined,
        rotateX:
          typeof args.cameraRotateX === "number"
            ? args.cameraRotateX
            : undefined,
        rotateY:
          typeof args.cameraRotateY === "number"
            ? args.cameraRotateY
            : undefined,
      };
      const block = createBlock(
        "camera",
        "camera",
        start_ms,
        durationMsLocal,
        data,
        `view:${args.view}`
      );
      blocks.push(block);
      return;
    }

    case "camera_dolly":
    case "camera_pan":
    case "camera_tilt":
    case "camera_orbit":
    case "camera_shake":
    case "camera_punch":
    case "camera_sweep": {
      const durationMsLocal = ensureDuration(
        typeof args.duration_ms === "number" ? args.duration_ms : null,
        DEFAULT_CAMERA_MOVE_MS
      );
      const movement = action.action.replace("camera_", "");
      const data: CameraBlockData = {
        movement: movement as CameraBlockData["movement"],
        distance:
          movement === "dolly" && typeof args.distance === "number"
            ? args.distance
            : undefined,
        rotateY:
          movement === "pan" && typeof args.angle === "number"
            ? args.angle
            : undefined,
        rotateX:
          movement === "tilt" && typeof args.angle === "number"
            ? args.angle
            : undefined,
        orbit:
          movement === "orbit" && typeof args.angle === "number"
            ? args.angle
            : undefined,
        startAngle:
          movement === "sweep" && typeof args.startAngle === "number"
            ? args.startAngle
            : undefined,
        endAngle:
          movement === "sweep" && typeof args.endAngle === "number"
            ? args.endAngle
            : undefined,
        punch:
          movement === "punch" && typeof args.factor === "number"
            ? args.factor
            : undefined,
        shake:
          movement === "shake" && typeof args.intensity === "number"
            ? {
                intensity: args.intensity as number,
                frequency:
                  typeof args.frequency === "number"
                    ? (args.frequency as number)
                    : undefined,
              }
            : undefined,
        easing:
          typeof args.easing === "string"
            ? (args.easing as CameraBlockData["easing"])
            : undefined,
      };
      const block = createBlock(
        "camera",
        "camera",
        start_ms,
        durationMsLocal,
        data,
        `camera:${movement}`
      );
      blocks.push(block);
      return;
    }

    case "look_at":
    case "look_at_camera":
    case "make_eye_contact": {
      const durationMsLocal = ensureDuration(
        typeof args.t === "number" ? args.t : null,
        options.eventBlockMs ?? DEFAULT_EVENT_BLOCK_MS
      );
      blocks.push(
        makeEventBlock(start_ms, durationMsLocal, {
          type: "start",
          targetLayerId: "camera",
          action: action.action === "make_eye_contact" ? "look_at_camera" : action.action,
          args,
        })
      );
      return;
    }

    case "set_light_preset": {
      if (!args.preset) {
        externalActions.push(action);
        return;
      }
      const durationMsLocal = ensureDuration(
        typeof args.duration_ms === "number" ? args.duration_ms : null,
        options.lightingTransitionMs ?? DEFAULT_LIGHT_TRANSITION_MS
      );
      const data: LightingBlockData = {
        preset: args.preset as string,
        transition: "fade",
      };
      const block = createBlock(
        "lighting",
        "lighting",
        start_ms,
        durationMsLocal,
        data,
        `light:${args.preset}`
      );
      blocks.push(block);
      return;
    }

    case "post_bloom":
    case "post_vignette":
    case "post_chromatic":
    case "post_chromatic_aberration":
    case "post_glitch":
    case "post_pixelation": {
      const durationMsLocal = ensureDuration(
        typeof args.duration_ms === "number" ? args.duration_ms : null,
        DEFAULT_FX_DURATION_MS
      );
      const effect =
        action.action === "post_chromatic_aberration"
          ? "chromatic"
          : action.action.replace("post_", "");
      const params: Record<string, number | boolean> = {};
      const strength =
        typeof args.intensity === "number"
          ? (args.intensity as number)
          : args.strength;
      addParam(params, "strength", strength);
      addParam(params, "radius", args.radius);
      addParam(params, "threshold", args.threshold);
      addParam(params, "darkness", args.darkness);
      addParam(params, "offset", args.offset);
      addParam(params, "amount", args.amount);
      addParam(params, "active", args.active);
      addParam(params, "wild", args.wild);
      addParam(params, "size", args.size ?? args.pixelSize);
      const data: FXBlockData = {
        effect: effect as FXBlockData["effect"],
        params,
      };
      const block = createBlock(
        "fx",
        "fx",
        start_ms,
        durationMsLocal,
        data,
        `fx:${effect}`
      );
      blocks.push(block);
      return;
    }

    case "post_reset":
    case "post_reset_effects": {
      const durationMsLocal = ensureDuration(
        typeof args.duration_ms === "number" ? args.duration_ms : null,
        options.eventBlockMs ?? DEFAULT_EVENT_BLOCK_MS
      );
      blocks.push(
        makeEventBlock(start_ms, durationMsLocal, {
          type: "start",
          targetLayerId: "fx",
          action: action.action,
          args,
        })
      );
      return;
    }

    case "play_background_audio":
    case "stop_background_audio":
    case "set_environment":
    case "set_background":
    case "speak_break":
    case "speak_marker":
    case "get_value":
    case "start":
    case "stop":
    case "start_listening":
    case "stop_listening":
    case "speak_to":
    case "set_speaker_target":
      externalActions.push(action);
      return;

    default:
      externalActions.push(action);
  }
};

export const directorPlanToTimeline = (
  plan: MergedPlan,
  options: DirectorToTimelineOptions
): DirectorToTimelineResult => {
  const timeline = createTimeline(
    plan.title || "Performance",
    options.durationMs
  );

  const blocks: TimelineBlock[] = [];
  const externalActions: PlanAction[] = [];

  for (const section of plan.sections) {
    addSectionDefaults(blocks, section, options);

    if (section.actions) {
      for (const action of section.actions) {
        mapActionToBlocks(action, options, options.durationMs, blocks, externalActions);
      }
    }
  }

  if (plan.actions) {
    for (const action of plan.actions) {
      mapActionToBlocks(action, options, options.durationMs, blocks, externalActions);
    }
  }

  // Create viseme block if word/viseme timings are provided
  if (options.wordTimings && options.wordTimings.words.length > 0) {
    const visemeData: VisemeBlockData = {
      source: options.audioUrl ? "audio" : "tts",
      audioUrl: options.audioUrl,
      wordTimings: options.wordTimings,
      visemeMapping: options.visemeMapping,
    };

    const visemeBlock = createBlock(
      "viseme",
      "viseme",
      0, // Start at beginning
      options.durationMs, // Span entire duration
      visemeData,
      "lipsync"
    );

    blocks.push(visemeBlock);
  }

  timeline.blocks = blocks.sort((a, b) => a.start_ms - b.start_ms);
  return { timeline, externalActions };
};
