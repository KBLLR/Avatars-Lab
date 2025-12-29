import type { StatusElements, ChipElements, HudElements, HeroElements } from "./types";

export const updateStatus = (els: Pick<StatusElements, "status">, text: string): void => {
  if (els.status) {
    els.status.textContent = text;
  }
};

export const setChip = (el: HTMLElement | null, label: string, value?: string): void => {
  if (el) {
    el.textContent = `${label}: ${value || "-"}`;
  }
};

export const setHud = (els: HudElements, scene: string, camera: string, lights: string, mode: string): void => {
  if (els.hudScene) els.hudScene.textContent = scene;
  if (els.hudCamera) els.hudCamera.textContent = camera;
  if (els.hudLights) els.hudLights.textContent = lights;
  if (els.hudMode) els.hudMode.textContent = mode;
};

export const updateHero = (
  els: HeroElements,
  avatarName?: string,
  songName?: string,
  sectionLabel?: string
): void => {
  const avatarLabel = avatarName || (els.avatarSelect ? els.avatarSelect.value : "Avatar") || "Avatar";
  const rawSong = songName ? `Performing ${songName}` : "No song";
  const songLabel = rawSong ? rawSong : "Awaiting Audio";
  
  if (els.heroTitle) {
    els.heroTitle.textContent = `${avatarLabel.replace(/\.glb$/i, "")}`;
  }
  if (els.heroSubtitle) {
    els.heroSubtitle.textContent = sectionLabel ? `${songLabel} · ${sectionLabel}` : songLabel;
  }
};

export type StagePhase =
  | "idle"
  | "audio-loaded"
  | "transcribing"
  | "transcribed"
  | "analyzing"
  | "plan-ready"
  | "performing"
  | "complete";

const phaseDescriptions: Record<StagePhase, string> = {
  idle: "Upload a song to begin staging your AI performance.",
  "audio-loaded": "Song loaded. Click Transcribe to extract lyrics.",
  transcribing: "Processing audio to extract lyrics...",
  transcribed: "Lyrics ready. Click Analyze to plan the performance.",
  analyzing: "Directors are crafting your performance plan...",
  "plan-ready": "Plan ready. Review and Approve to enable AI Perform.",
  performing: "Performance in progress. Sit back and enjoy.",
  complete: "Performance complete. Load another song or adjust settings."
};

export const updateStageHeroDesc = (
  els: Pick<HeroElements, "stageHeroDesc">,
  phase: StagePhase
): void => {
  if (els.stageHeroDesc) {
    els.stageHeroDesc.textContent = phaseDescriptions[phase];
  }
};

export const setStageHeroDescText = (
  els: Pick<HeroElements, "stageHeroDesc">,
  text: string
): void => {
  if (els.stageHeroDesc) {
    els.stageHeroDesc.textContent = text;
  }
};
