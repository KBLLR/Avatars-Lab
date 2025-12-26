import type { TalkingHead } from "@met4citizen/talkinghead";
import {
  dolly, pan, tilt, orbit, shake, punch, sweep,
  type DollyConfig, type PanConfig, type TiltConfig,
  type OrbitConfig, type ShakeConfig, type PunchConfig, type SweepConfig
} from "../camera";
import { applyEnvironment, getEnvironmentPreset } from "../environments";
import type { Environment } from "../environments";
import type { EffectsManager } from "../effects/manager";
import type { DuoHeadManager, AvatarId, SpeakTarget } from "../avatar/duo-head-manager";
import type { PlanSection, PlanAction, Mood, CameraView } from "../directors/types";
import type { ScheduledMarkers } from "./types";
import { gestures } from "../stage/constants";
import { randomItem } from "./fallback-plan";

export type ActionHandler = (action: PlanAction) => void;
export type UpdateStatusFn = (msg: string) => void;
export type ApplyCameraSettingsFn = () => void;
export type ApplyLightPresetFn = (preset: string) => void;

export interface SchedulerContext {
  head: TalkingHead;
  cameraSettings: {
    view: string;
    distance: number;
    x: number;
    y: number;
    rotateX: number;
    rotateY: number;
    autoRotate: boolean;
    autoRotateSpeed: number;
  };
  lightPreset: string;
  updateStatus: UpdateStatusFn;
  applyCameraSettings: ApplyCameraSettingsFn;
  applyLightPreset: ApplyLightPresetFn;
  effectsManager?: EffectsManager;
  duoManager?: DuoHeadManager;
}

export const scheduleAction = (
  action: PlanAction,
  markers: Array<() => void>,
  mtimes: number[],
  ctx: SchedulerContext
): void => {
  const time = Math.max(0, Math.round(action.time_ms));
  markers.push(() => {
    const { head } = ctx;
    if (!head) return;

    const args = action.args || {};
    const gesture = args.gesture || args.name;

    switch (action.action) {
      case "set_mood":
        if (args.mood) head.setMood(args.mood as Mood);
        break;
      case "play_gesture":
        if (gesture) {
          head.playGesture(gesture as string, args.duration ?? 2.5, args.mirror ?? false, args.ms ?? 800);
        }
        break;
      case "stop_gesture":
        head.stopGesture(args.ms ?? 800);
        break;
      case "speak_emoji":
      case "make_facial_expression":
        if (args.emoji) head.speakEmoji(args.emoji as string);
        break;
      case "speak_break":
        if (typeof args.duration_ms === "number") {
          head.speakBreak(args.duration_ms);
        }
        break;
      case "speak_marker":
        if (args.marker) {
          ctx.updateStatus(`Marker: ${args.marker}`);
        }
        break;
      case "look_at":
        if (typeof args.x === "number" && typeof args.y === "number") {
          head.lookAt(args.x, args.y, args.t ?? 600);
        }
        break;
      case "look_at_camera":
      case "make_eye_contact":
        head.lookAtCamera(args.ms ?? args.t ?? 600);
        break;
      case "set_value":
        if (args.mt && typeof args.value === "number") {
          head.setValue(args.mt as string, args.value, typeof args.ms === "number" ? args.ms : null);
        }
        break;
      case "get_value":
        if (args.mt) {
          const value = head.getValue(args.mt as string);
          ctx.updateStatus(`Value ${args.mt}: ${value ?? "n/a"}`);
        }
        break;
      case "play_background_audio":
        if (args.url) {
          head.audioCtx.resume().catch(() => null);
          head.playBackgroundAudio(args.url as string);
          if (typeof args.volume === "number") {
            const vol = Math.min(1, Math.max(0, args.volume));
            head.setMixerGain(null, vol);
          }
        }
        break;
      case "stop_background_audio":
        head.stopBackgroundAudio();
        break;
      case "start":
        head.audioCtx.resume().catch(() => null);
        head.start();
        break;
      case "stop":
        head.stop();
        break;
      case "start_listening":
      case "stop_listening":
        break;
      case "set_view":
        if (args.view) {
          ctx.cameraSettings.view = args.view as CameraView;
          if (typeof args.cameraDistance === "number") ctx.cameraSettings.distance = args.cameraDistance;
          if (typeof args.cameraX === "number") ctx.cameraSettings.x = args.cameraX;
          if (typeof args.cameraY === "number") ctx.cameraSettings.y = args.cameraY;
          if (typeof args.cameraRotateX === "number") ctx.cameraSettings.rotateX = args.cameraRotateX;
          if (typeof args.cameraRotateY === "number") ctx.cameraSettings.rotateY = args.cameraRotateY;
          ctx.applyCameraSettings();
        }
        break;
      case "set_light_preset":
        if (args.preset) ctx.applyLightPreset(args.preset as string);
        break;
      case "camera_dolly":
        dolly(head, args as unknown as DollyConfig);
        break;
      case "camera_pan":
        pan(head, args as unknown as PanConfig);
        break;
      case "camera_tilt":
        tilt(head, args as unknown as TiltConfig);
        break;
      case "camera_orbit":
        orbit(head, args as unknown as OrbitConfig);
        break;
      case "camera_shake":
        shake(head, args as unknown as ShakeConfig);
        break;
      case "camera_punch":
        punch(head, args as unknown as PunchConfig);
        break;
      case "camera_sweep":
        sweep(head, args as unknown as SweepConfig);
        break;
      // Environment Actions
      case "set_environment":
        if (args.preset) {
          const preset = getEnvironmentPreset(args.preset as string);
          if (preset) {
            applyEnvironment(head, preset.environment);
            ctx.updateStatus(`Env: ${preset.name}`);
          }
        }
        break;
      case "set_background":
        // args matches Environment (Solid, Gradient, Transparent) structure
        applyEnvironment(head, args as unknown as Environment);
        break;
      // PostFX Actions
      case "post_bloom":
        if (ctx.effectsManager) {
          ctx.effectsManager.setBloom(
            typeof args.strength === "number" ? args.strength : 1.5,
            typeof args.radius === "number" ? args.radius : 0.4,
            typeof args.threshold === "number" ? args.threshold : 0.85
          );
        }
        break;
      case "post_vignette":
        if (ctx.effectsManager) {
          ctx.effectsManager.setVignette(
            typeof args.offset === "number" ? args.offset : 1.0,
            typeof args.darkness === "number" ? args.darkness : 1.0
          );
        }
        break;
      case "post_chromatic_aberration":
        if (ctx.effectsManager) {
          ctx.effectsManager.setChromaticAberration({
            amount: typeof args.offset === "number" ? args.offset : 0.005,
            radialModulation: typeof args.radialModulation === "boolean" ? args.radialModulation : true,
            modulationOffset: typeof args.modulationOffset === "number" ? args.modulationOffset : 0.0
          });
        }
        break;
      case "post_pixelation":
        if (ctx.effectsManager) {
          ctx.effectsManager.setPixelation({
            pixelSize: typeof args.pixelSize === "number" ? args.pixelSize : 1.0,
            normalEdgeStrength: typeof args.normalEdgeStrength === "number" ? args.normalEdgeStrength : 0.3,
            depthEdgeStrength: typeof args.depthEdgeStrength === "number" ? args.depthEdgeStrength : 0.4
          });
        }
        break;
      case "post_glitch":
        if (ctx.effectsManager) {
          ctx.effectsManager.setGlitch(
             Boolean(args.active ?? true),
             Boolean(args.wild ?? false)
          );
        }
        break;
      case "post_reset_effects":
        if (ctx.effectsManager) {
          ctx.effectsManager.resetEffects();
        }
        break;
      // Duo Mode Actions
      case "speak_to":
        if (ctx.duoManager) {
          const speaker = args.speaker as AvatarId;
          const target = args.target as SpeakTarget;
          ctx.duoManager.setSpeakTo(speaker, target);
          if (args.emotion) {
            ctx.duoManager.setMood(speaker, args.emotion as string);
          }
          if (args.gesture_hint) {
            ctx.duoManager.playGesture(speaker, args.gesture_hint as string);
          }
          ctx.updateStatus(`${speaker} speaking to ${target}`);
        }
        break;
      case "set_speaker_target":
        if (ctx.duoManager) {
          const speaker = args.speaker as AvatarId;
          const target = args.target as SpeakTarget;
          ctx.duoManager.setSpeakTo(speaker, target);
        }
        break;
      // Dance/Animation Actions
      case "play_animation":
        if (args.url) {
          head.playAnimation(
            args.url as string,
            null, // progressCallback
            typeof args.duration === "number" ? args.duration : undefined,
            null  // onComplete
          );
          ctx.updateStatus(`Animation: ${args.name || args.url}`);
        }
        break;
      case "play_pose":
        if (args.url) {
          head.playPose(
            args.url as string,
            null, // progressCallback
            typeof args.duration === "number" ? args.duration : undefined
          );
          ctx.updateStatus(`Pose: ${args.name || args.url}`);
        }
        break;
      case "stop_animation":
        // TalkingHead will handle animation cleanup via stop()
        head.stop();
        head.start();
        break;
      default:
        break;
    }
  });
  mtimes.push(time);
};

export const buildMarkersFromPlan = (
  plan: { sections: PlanSection[]; actions?: PlanAction[] },
  durationMs: number,
  ctx: SchedulerContext
): ScheduledMarkers => {
  const markers: Array<() => void> = [];
  const mtimes: number[] = [];

  plan.sections.forEach((section) => {
    scheduleAction(
      {
        time_ms: section.start_ms,
        action: "set_mood",
        args: { mood: section.mood || "neutral" }
      },
      markers,
      mtimes,
      ctx
    );
    scheduleAction(
      {
        time_ms: section.start_ms,
        action: "set_view",
        args: { view: section.camera || ctx.cameraSettings.view }
      },
      markers,
      mtimes,
      ctx
    );
    scheduleAction(
      {
        time_ms: section.start_ms,
        action: "set_light_preset",
        args: { preset: section.light || ctx.lightPreset }
      },
      markers,
      mtimes,
      ctx
    );

    const actionCount = Math.min(3, Math.max(1, Math.floor((section.end_ms - section.start_ms) / 8000)));
    for (let i = 0; i < actionCount; i += 1) {
      const time = section.start_ms + (i + 1) * ((section.end_ms - section.start_ms) / (actionCount + 1));
      scheduleAction(
        {
          time_ms: time,
          action: "play_gesture",
          args: { gesture: randomItem(gestures), duration: 2.5 }
        },
        markers,
        mtimes,
        ctx
      );
    }

    if (section.actions) {
      section.actions.forEach((action) => scheduleAction(action, markers, mtimes, ctx));
    }
  });

  plan.actions?.forEach((action) => scheduleAction(action, markers, mtimes, ctx));

  // Add END marker to reset to spotlight when performance finishes
  const endTime = Math.max(durationMs - 500, durationMs * 0.99);
  markers.push(() => {
    ctx.applyLightPreset("spotlight");
    ctx.updateStatus("Performance complete. Ready for next act.");
  });
  mtimes.push(endTime);

  return { markers, mtimes };
};
