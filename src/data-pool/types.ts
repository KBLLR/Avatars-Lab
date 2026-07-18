import type { MergedPlan, WordTiming } from "../directors/types";

export interface PerformanceModels {
  llmModel?: string;
  vlmModel?: string;
  directorModel?: string;
  sttModel?: string;
  ttsModel?: string;
  embedModel?: string;
  ttsVoice?: string;
}

export interface PerformanceAudio {
  name: string;
  type: string;
  size: number;
  warehouseId?: string;
  // Legacy records may still contain embedded audio.
  dataBase64?: string;
}

export interface PerformanceRecord {
  id: string;
  title: string;
  createdAt: string;
  transcriptText: string;
  wordTimings: WordTiming | null;
  plan: MergedPlan | null;
  planSource: "none" | "heuristic" | "llm";
  directorNotes: string;
  analysisSeed: string | null;
  directorStyle: string;
  models: PerformanceModels;
  audio: PerformanceAudio | null;
}

export interface PerformanceListItem {
  id?: string;
  path: string;
  name: string;
  modified?: number | null;
}
