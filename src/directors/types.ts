/**
 * Director Types & Schemas
 * Shared types for the Performance, Stage, and Camera directors
 */

// ─────────────────────────────────────────────────────────────
// Core Enums & Constants
// ─────────────────────────────────────────────────────────────

export const MOODS = [
  "neutral", "happy", "love", "fear", "sad", "angry", "disgust", "sleep"
] as const;
export type Mood = typeof MOODS[number];

export const CAMERA_VIEWS = ["full", "mid", "upper", "head"] as const;
export type CameraView = typeof CAMERA_VIEWS[number];

export const LIGHT_PRESETS = ["neon", "noir", "sunset", "frost", "crimson"] as const;
export type LightPreset = typeof LIGHT_PRESETS[number];

export const GESTURES = [
  "handup", "index", "ok", "thumbup", "thumbdown", "side", "shrug", "namaste"
] as const;
export type Gesture = typeof GESTURES[number];

export const ROLES = ["solo", "ensemble"] as const;
export type Role = typeof ROLES[number];

export const DIRECTOR_STYLES = [
  "cinematic", "intimate", "hype", "minimal", "experimental"
] as const;
export type DirectorStyle = typeof DIRECTOR_STYLES[number];

// ─────────────────────────────────────────────────────────────
// Action Types
// ─────────────────────────────────────────────────────────────

export interface PlanAction {
  time_ms: number;
  action: string;
  args?: Record<string, unknown>;
}

export interface SetMoodAction extends PlanAction {
  action: "set_mood";
  args: { mood: Mood };
}

export interface PlayGestureAction extends PlanAction {
  action: "play_gesture";
  args: {
    gesture: string;
    duration?: number;
    mirror?: boolean;
    ms?: number;
  };
}

export interface StopGestureAction extends PlanAction {
  action: "stop_gesture";
  args?: { ms?: number };
}

export interface FacialExpressionAction extends PlanAction {
  action: "make_facial_expression";
  args: { emoji: string; duration?: number };
}

export interface SpeakEmojiAction extends PlanAction {
  action: "speak_emoji";
  args: { emoji: string; duration?: number };
}

export interface SpeakBreakAction extends PlanAction {
  action: "speak_break";
  args: { duration_ms: number };
}

export interface SpeakMarkerAction extends PlanAction {
  action: "speak_marker";
  args: { marker: string };
}

export interface LookAtAction extends PlanAction {
  action: "look_at";
  args: { x: number; y: number; t?: number };
}

export interface LookAtCameraAction extends PlanAction {
  action: "look_at_camera";
  args: { t: number };
}

export interface MakeEyeContactAction extends PlanAction {
  action: "make_eye_contact";
  args: { t: number };
}

export interface SetValueAction extends PlanAction {
  action: "set_value";
  args: { mt: string; value: number; ms?: number | null };
}

export interface GetValueAction extends PlanAction {
  action: "get_value";
  args: { mt: string };
}

export interface PlayBackgroundAudioAction extends PlanAction {
  action: "play_background_audio";
  args: { url: string; volume?: number };
}

export interface StopBackgroundAudioAction extends PlanAction {
  action: "stop_background_audio";
}

export interface StartAction extends PlanAction {
  action: "start";
}

export interface StopAction extends PlanAction {
  action: "stop";
}

export interface StartListeningAction extends PlanAction {
  action: "start_listening";
  args?: {
    listeningSilenceThresholdLevel?: number;
    listeningSilenceThresholdMs?: number;
    listeningSilenceDurationMax?: number;
    listeningActiveThresholdLevel?: number;
    listeningActiveThresholdMs?: number;
    listeningActiveDurationMax?: number;
  };
}

export interface StopListeningAction extends PlanAction {
  action: "stop_listening";
}

export interface SetViewAction extends PlanAction {
  action: "set_view";
  args: {
    view: CameraView;
    cameraDistance?: number;
    cameraX?: number;
    cameraY?: number;
    cameraRotateX?: number;
    cameraRotateY?: number;
  };
}

export interface SetLightPresetAction extends PlanAction {
  action: "set_light_preset";
  args: { preset: LightPreset };
}

export interface PlayPoseAction extends PlanAction {
  action: "play_pose";
  args: { url: string; dur?: number; ndx?: number; scale?: number };
}

export interface StopPoseAction extends PlanAction {
  action: "stop_pose";
}

export interface PostBloomAction extends PlanAction {
  action: "post_bloom";
  args: { intensity: number; duration_ms: number };
}

export interface PostVignetteAction extends PlanAction {
  action: "post_vignette";
  args: { darkness: number; duration_ms: number };
}

export interface PostResetAction extends PlanAction {
  action: "post_reset";
  args: { duration_ms: number };
}

export interface SetEnvironmentAction extends PlanAction {
  action: "set_environment";
  args: { preset: string };
}

export interface SetBackgroundAction extends PlanAction {
  action: "set_background";
  args: {
    type: "solid" | "gradient" | "transparent";
    color?: string;
    colors?: [string, string];
  };
}

// ─────────────────────────────────────────────────────────────
// Duo Mode Actions
// ─────────────────────────────────────────────────────────────

export type AvatarId = "avatar_a" | "avatar_b";
export type SpeakTarget = AvatarId | "camera";

export interface SpeakToAction extends PlanAction {
  action: "speak_to";
  args: {
    speaker: AvatarId;
    target: SpeakTarget;
    text?: string;
    audio_url?: string;
    emotion?: Mood;
    gesture_hint?: string;
    gesture_clip_id?: string;
    markers?: string[];
  };
}

export interface SetSpeakerTargetAction extends PlanAction {
  action: "set_speaker_target";
  args: {
    speaker: AvatarId;
    target: SpeakTarget;
  };
}

export type TypedPlanAction =
  | SetMoodAction
  | PlayGestureAction
  | StopGestureAction
  | FacialExpressionAction
  | SpeakEmojiAction
  | SpeakBreakAction
  | SpeakMarkerAction
  | LookAtAction
  | LookAtCameraAction
  | MakeEyeContactAction
  | SetValueAction
  | GetValueAction
  | PlayBackgroundAudioAction
  | StopBackgroundAudioAction
  | StartAction
  | StopAction
  | StartListeningAction
  | StopListeningAction
  | SetViewAction
  | SetLightPresetAction
  | PlayPoseAction
  | StopPoseAction
  | PostBloomAction
  | PostVignetteAction
  | PostResetAction
  | SetEnvironmentAction
  | SetBackgroundAction
  | SpeakToAction
  | SetSpeakerTargetAction
  | PlanAction;

// ─────────────────────────────────────────────────────────────
// Section & Plan Types
// ─────────────────────────────────────────────────────────────

export interface InputSection {
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface PlanSection {
  label: string;
  start_ms: number;
  end_ms: number;
  role: Role;
  mood?: Mood;
  camera?: CameraView;
  light?: LightPreset;
  notes?: string;
  actions?: PlanAction[];
}

export interface DirectorPlan {
  title?: string;
  sections: PlanSection[];
  actions?: PlanAction[];
}

export interface DirectorResponse {
  thoughts_summary?: string;
  analysis?: string;
  selection_reason?: string;
  plan: DirectorPlan;
}

export interface MergedPlan extends DirectorPlan {
  source: "llm" | "heuristic" | "cached";
  performanceNotes?: string;
  stageNotes?: string;
  cameraNotes?: string;
  postFxNotes?: string;
}

// ─────────────────────────────────────────────────────────────
// Word Timing Types
// ─────────────────────────────────────────────────────────────

export interface WordTiming {
  words: string[];
  wtimes: number[];
  wdurations: number[];
}

// ─────────────────────────────────────────────────────────────
// Director Configuration
// ─────────────────────────────────────────────────────────────

export interface DirectorConfig {
  model: string;
  style: DirectorStyle;
  seed: string;
  timeoutMs: number;
  maxTokens: number;
  retries: number;
}

export const DEFAULT_DIRECTOR_CONFIG: Partial<DirectorConfig> = {
  style: "cinematic",
  timeoutMs: 45000,
  maxTokens: 1500,
  retries: 2
};

// ─────────────────────────────────────────────────────────────
// Progress & Event Types
// ─────────────────────────────────────────────────────────────

export type DirectorStage = "performance" | "stage" | "camera" | "postfx";
export type StageStatus = "pending" | "running" | "complete" | "failed" | "cancelled";

export interface ProgressEvent {
  stage: DirectorStage;
  status: StageStatus;
  chunk?: number;
  totalChunks?: number;
  message?: string;
  thoughtsPreview?: string;
}

export interface StreamChunkEvent {
  stage: DirectorStage;
  text: string;
  accumulated: string;
}

// ─────────────────────────────────────────────────────────────
// Validation Helpers
// ─────────────────────────────────────────────────────────────

export function isValidMood(value: string): value is Mood {
  return MOODS.includes(value as Mood);
}

export function isValidCameraView(value: string): value is CameraView {
  return CAMERA_VIEWS.includes(value as CameraView);
}

export function isValidLightPreset(value: string): value is LightPreset {
  return LIGHT_PRESETS.includes(value as LightPreset);
}

export function isValidRole(value: string): value is Role {
  return ROLES.includes(value as Role);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ─────────────────────────────────────────────────────────────
// Compact Action Descriptions (for prompts)
// ─────────────────────────────────────────────────────────────

export const PERFORMANCE_ACTIONS_COMPACT = [
  "set_mood(mood: neutral|happy|love|fear|sad|angry|disgust|sleep)",
  "play_gesture(gesture: handup|index|ok|thumbup|thumbdown|side|shrug, duration?: sec, mirror?: bool)",
  "stop_gesture(ms?: number)",
  "make_facial_expression(emoji: string, duration?: sec)",
  "speak_emoji(emoji: string, duration?: sec)",
  "speak_break(duration_ms: number)",
  "speak_marker(marker: string)",
  "look_at(x: 0-1, y: 0-1, t?: ms)",
  "look_at_camera(t: ms)",
  "make_eye_contact(t: ms)",
  "set_value(mt: string, value: number, ms?: number)",
  "get_value(mt: string)",
  "play_pose(url: string, dur?: sec, ndx?: number, scale?: number)",
  "stop_pose()"
];

export const STAGE_ACTIONS_COMPACT = [
  "set_light_preset(preset: neon|noir|sunset|frost|crimson)",
  "set_environment(preset: string)",
  "set_background(type: solid|gradient|transparent, color?: hex, colors?: [hex, hex])",
  "play_background_audio(url: string, volume?: 0-1)",
  "stop_background_audio()",
  "set_view(view: full|mid|upper|head, cameraDistance?: number, cameraX?: number, cameraY?: number)"
];

export const CAMERA_ACTIONS_COMPACT = [
  "set_view(view: full|mid|upper|head)",
  "look_at(x: 0-1, y: 0-1, t?: ms)",
  "look_at_camera(t: ms)",
  "make_eye_contact(t: ms)"
];

export const CAMERA_MOVEMENT_ACTIONS = [
  "camera_dolly(distance: number, duration_ms: number, easing?: linear|easeIn|easeOut|easeInOut)",
  "camera_pan(angle: number, duration_ms: number, easing?: linear|easeIn|easeOut|easeInOut)",
  "camera_tilt(angle: number, duration_ms: number, easing?: linear|easeIn|easeOut|easeInOut)",
  "camera_orbit(angle: number, duration_ms: number, easing?: linear|easeIn|easeOut|easeInOut)",
  "camera_shake(intensity: 0-1, duration_ms: number)",
  "camera_punch(factor: number, duration_ms: number)",
  "camera_sweep(startAngle: number, endAngle: number, duration_ms: number, easing?: string)"
] as const;

export const POSTPROCESSING_ACTIONS = [
  "post_bloom(intensity: 0.0-3.0, duration_ms: number)",
  "post_vignette(darkness: 0.0-2.0, duration_ms: number)",
  "post_reset(duration_ms: number)"
] as const;

// ─────────────────────────────────────────────────────────────
// JSON Schema for Output Validation
// ─────────────────────────────────────────────────────────────

export const DIRECTOR_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    thoughts_summary: { type: "string", maxLength: 200 },
    analysis: { type: "string" },
    selection_reason: { type: "string" },
    plan: {
      type: "object",
      properties: {
        title: { type: "string" },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              start_ms: { type: "number" },
              end_ms: { type: "number" },
              role: { type: "string", enum: ROLES },
              mood: { type: "string", enum: MOODS },
              camera: { type: "string", enum: CAMERA_VIEWS },
              light: { type: "string", enum: LIGHT_PRESETS },
              notes: { type: "string" },
              actions: { type: "array" }
            },
            required: ["label", "start_ms", "end_ms"]
          }
        },
        actions: { type: "array" }
      },
      required: ["sections"]
    }
  },
  required: ["plan"]
} as const;
