export const PERFORMANCE_PROJECT_SCHEMA = "avatar-labs.performance-project.v1" as const;

export const TRACK_KINDS = [
  "audio",
  "animation",
  "expression",
  "shader",
  "camera",
  "lighting",
  "environment",
  "lipsync",
  "stagefx"
] as const;

export type PerformanceTrackKind = (typeof TRACK_KINDS)[number];
export type ActorAssetKind = "head" | "body";
export type ShaderPresetId = "original" | "hologram" | "toon" | "chrome" | "xray";
export type CameraPresetId =
  | "wide"
  | "two-shot"
  | "portrait"
  | "orbit"
  | "profile"
  | "low-angle"
  | "overhead"
  | "dutch";
export type LightingPresetId =
  | "studio"
  | "concert"
  | "noir"
  | "sunset"
  | "chiaroscuro"
  | "silhouette";
export type AnimationCategory = "idle" | "dance" | "locomotion" | "gesture" | "action";
export type AnimationRig = "rpm" | "mixamo" | "humanoid";
export type AnimationBody = "F" | "M" | "any";

export interface ActorAsset {
  id: string;
  label: string;
  kind: ActorAssetKind;
  url: string;
  body?: "M" | "F";
}

export interface PerformanceActor {
  id: string;
  label: string;
  asset: ActorAsset;
  shader: ShaderPresetId;
  position: { x: number; y: number; z: number };
  rotationY: number;
  scale: number;
  visible: boolean;
}

export interface PerformanceClip<T = Record<string, unknown>> {
  id: string;
  label: string;
  startMs: number;
  durationMs: number;
  data: T;
  color?: string;
}

export interface PerformanceTrack {
  id: string;
  name: string;
  kind: PerformanceTrackKind;
  actorId?: string;
  muted: boolean;
  locked: boolean;
  color: string;
  clips: PerformanceClip[];
}

export interface PerformanceEnvironment {
  id: string;
  label: string;
  room: "cyclorama" | "black-box" | "broadcast" | "neon-grid";
  hdriUrl?: string;
  exposure: number;
  backgroundIntensity: number;
  environmentIntensity: number;
}

export type DirectorStageId = "performance" | "stage" | "camera" | "postfx";

export interface DirectorBriefing {
  stage: DirectorStageId;
  summary: string;
  status: "complete" | "failed";
  generatedAt: string;
}

export interface SongAnalysisSegment {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  speakerId?: string;
  energy: number;
  arousal: number;
  valence: number;
}

export interface SpeakerProfile {
  id: string;
  durationMs: number;
  actorId?: string;
  confidence: "low" | "medium" | "high";
}

export interface MusicAnalysis {
  schema: "avatar-labs.music-analysis.v1";
  analyzedAt: string;
  durationMs: number;
  tempoBpm?: number;
  beatsMs: number[];
  energyEnvelope: Array<{ timeMs: number; value: number }>;
  segments: SongAnalysisSegment[];
  speakers: SpeakerProfile[];
  source: {
    signal: "web-audio";
    transcription?: string;
    diarisation?: string;
  };
  warnings: string[];
}

export interface PerformanceProject {
  schema: typeof PERFORMANCE_PROJECT_SCHEMA;
  id: string;
  title: string;
  durationMs: number;
  fps: 24 | 25 | 30 | 50 | 60;
  actors: PerformanceActor[];
  environment: PerformanceEnvironment;
  tracks: PerformanceTrack[];
  audio?: {
    name: string;
    objectUrl?: string;
    warehouseId?: string;
    durationMs?: number;
    analysis?: MusicAnalysis;
  };
  direction?: {
    createdBy: "performance-director";
    model: string;
    style: string;
    brief: string;
    generatedAt: string;
    source: "llm";
    specialists: DirectorStageId[];
    notes: Partial<Record<DirectorStageId, string>>;
    briefings?: DirectorBriefing[];
  };
  createdAt: string;
  updatedAt: string;
}

export type CompiledEventAction =
  | "animation:start"
  | "animation:stop"
  | "expression:set"
  | "expression:reset"
  | "shader:set"
  | "camera:set"
  | "lighting:set"
  | "environment:set"
  | "lipsync:start"
  | "lipsync:stop"
  | "stagefx:set"
  | "stagefx:reset";

export interface CompiledPerformanceEvent {
  id: string;
  timeMs: number;
  endMs: number;
  action: CompiledEventAction;
  actorId?: string;
  clipId: string;
  data: Record<string, unknown>;
}

export interface CompiledSchedule {
  projectId: string;
  durationMs: number;
  events: CompiledPerformanceEvent[];
  warnings: string[];
  compiledAt: string;
  compileMs: number;
}

export interface PerformanceCatalog {
  actors: ActorAsset[];
  animations: Array<{
    id: string;
    label: string;
    url: string;
    durationMs: number;
    loop: boolean;
    category: AnimationCategory;
    source: "rigging-portal-curated" | "ready-player-me";
    rig: AnimationRig;
    body: AnimationBody;
    tags: string[];
  }>;
  animationSummary: {
    total: number;
    curated: number;
    rpm: number;
  };
  environments: PerformanceEnvironment[];
}

export interface ActorRuntimeCapabilities {
  actorId: string;
  assetId: string;
  kind: ActorAssetKind;
  skeletons: number;
  morphTargets: number;
  embeddedAnimations: number;
  animationCompatible: boolean;
}

export interface PerformanceEngineResult {
  ready: boolean;
  renderer: string;
  scheduler: "worker" | "main-thread" | "pending";
  projectId: string | null;
  actorsReady: number;
  frameCount: number;
  averageFps: number;
  errors: string[];
  analysisReady?: boolean;
  speakers?: number;
  planningState?: "idle" | "running" | "complete" | "failed";
}

export const createId = (prefix: string): string =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const trackColor = (kind: PerformanceTrackKind): string => ({
  audio: "#22c55e",
  animation: "#38bdf8",
  expression: "#fb923c",
  shader: "#e879f9",
  camera: "#a78bfa",
  lighting: "#facc15",
  environment: "#2dd4bf",
  lipsync: "#f43f5e",
  stagefx: "#84cc16"
})[kind];
