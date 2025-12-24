import type { PlanSection, Mood, CameraView, LightPreset } from "../directors/types";

export type { PlanSection, Mood, CameraView, LightPreset };

export interface StatusElements {
  status: HTMLElement;
  analysisOverlay: HTMLElement;
  analysisStepText: HTMLElement;
  analysisThoughts: HTMLElement;
  analysisHint: HTMLElement;
  analysisProgressBar: HTMLElement;
}

export interface ChipElements {
  sttChip: HTMLElement;
  chatChip: HTMLElement;
  llmChip: HTMLElement;
  audioChip: HTMLElement;
}

export interface HudElements {
  hudScene: HTMLElement;
  hudCamera: HTMLElement;
  hudLights: HTMLElement;
  hudMode: HTMLElement;
}

export interface HeroElements {
  heroTitle: HTMLElement;
  heroSubtitle: HTMLElement;
  heroLyrics: HTMLElement;
  avatarSelect: HTMLSelectElement;
}

export interface PlanElements {
  approveBtn: HTMLButtonElement;
  playBtn: HTMLButtonElement;
  planStatus: HTMLElement;
  planList: HTMLElement;
  planDetails: HTMLElement;
  directorNotes: HTMLElement;
}

export interface BadgeElements {
  stageBadgePerformance: HTMLElement;
  stageBadgeStage: HTMLElement;
  stageBadgeCamera: HTMLElement;
  stageBadgePostFx: HTMLElement;
}

export type DirectorStage = "performance" | "stage" | "camera" | "postfx";
export type BadgeStatus = "pending" | "active" | "complete" | "failed";
