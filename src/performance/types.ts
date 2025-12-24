import type { PlanSection, PlanAction, MergedPlan, WordTiming } from "../directors/types";

export type { PlanSection, PlanAction, MergedPlan, WordTiming };

export interface TimingSegment {
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface PerformanceState {
  head: unknown;
  audioBuffer: AudioBuffer | null;
  transcriptText: string;
  plan: MergedPlan | null;
  planApproved: boolean;
  wordTimings: WordTiming | null;
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
  performing: boolean;
  playbackStart: number | null;
  lyricIndex: number;
  lyricActive: boolean;
}

export interface ScheduledMarkers {
  markers: Array<() => void>;
  mtimes: number[];
}
