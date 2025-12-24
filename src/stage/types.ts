import type { TalkingHead } from "@met4citizen/talkinghead";
import type { HeadAudio } from "@met4citizen/headaudio/dist/headaudio.min.mjs";
import type { DirectorOrchestrator } from "../pipeline/orchestrator";
import type { MergedPlan, WordTiming } from "../directors/types";

export type PerformancePlan = MergedPlan;

export interface RegistryModel {
  id: string;
  capabilities?: string[];
  description?: string | null;
  type?: string | null;
  tags?: string[];
}

export interface ModelRuntimeStatus {
  status?: string;
  loaded?: boolean;
  model_id?: string | null;
  model_path?: string | null;
  model_type?: string | null;
  queue?: {
    queue_stats?: {
      active_requests?: number;
      queue_size?: number;
    };
    active_streams?: number;
  } | null;
  config?: {
    max_concurrency?: number | null;
    queue_timeout?: number | null;
    queue_size?: number | null;
    mlx_warmup?: boolean | null;
  } | null;
}

export interface CameraSettings {
  view: string;
  distance: number;
  x: number;
  y: number;
  rotateX: number;
  rotateY: number;
  autoRotate: boolean;
  autoRotateSpeed: number;
}

export interface LightingBase {
  ambient: number;
  direct: number;
  spot: number;
}

export interface LightColors {
  ambient: string;
  direct: string;
  spot: string;
}

export interface LightPresetConfig {
  label: string;
  ambient: number;
  direct: number;
  spot: number;
  ambientColor: string;
  directColor: string;
  spotColor: string;
}

export interface StageState {
  isAnalyzing: boolean;
  isPlaying: boolean;
  audioFile: File | null;
  transcriptText: string;
  plan: PerformancePlan | null;
  planApproved: boolean;
  analysisSeed: string | null;
  head: TalkingHead | null;
  headaudio: HeadAudio | null;
  audioBuffer: AudioBuffer | null;
  orchestrator: DirectorOrchestrator | null;
  analysisVoiceQueue: Promise<void>;
  cameraSettings: CameraSettings;
  stageLightingBase: LightingBase;
  lightPreset: string;
  lightColors: LightColors;
  lightPulse: boolean;
  lightPulseAmount: number;
  directorNotes: string;
  availableTtsModels: { id: string }[];
  availableVoices: string[];
  wordTimings: WordTiming | null;
  planSource: "none" | "heuristic" | "llm";
  modelRegistry: RegistryModel[];
  analysisSegments: string[];
  playbackStart: number | null;
  lyricIndex: number;
  lyricActive: boolean;
  performing: boolean;
  avatarBaseUrl: string | null;
}

export const createInitialState = (): StageState => ({
  isAnalyzing: false,
  isPlaying: false,
  audioFile: null,
  transcriptText: "",
  plan: null,
  planApproved: false,
  analysisSeed: null,
  head: null,
  headaudio: null,
  audioBuffer: null,
  orchestrator: null,
  analysisVoiceQueue: Promise.resolve(),
  cameraSettings: {
    view: "upper",
    distance: 2.5,
    x: 0,
    y: 1.6,
    rotateX: 0,
    rotateY: 0,
    autoRotate: true,
    autoRotateSpeed: 0.1
  },
  stageLightingBase: {
    ambient: 0.5,
    direct: 0.8,
    spot: 2.0
  },
  lightPreset: "neon",
  lightColors: {
    ambient: "#ffffff",
    direct: "#ffffff",
    spot: "#ffffff"
  },
  lightPulse: true,
  lightPulseAmount: 0,
  directorNotes: "",
  availableTtsModels: [],
  availableVoices: [],
  wordTimings: null,
  planSource: "none",
  modelRegistry: [],
  analysisSegments: [],
  playbackStart: null,
  lyricIndex: 0,
  lyricActive: false,
  performing: false,
  avatarBaseUrl: null
});
