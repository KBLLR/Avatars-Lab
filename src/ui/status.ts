import type { StatusElements, ChipElements, HudElements, HeroElements } from "./types";

export const updateStatus = (els: Pick<StatusElements, "status">, text: string): void => {
  els.status.textContent = text;
};

export const setChip = (el: HTMLElement, label: string, value?: string): void => {
  el.textContent = `${label}: ${value || "-"}`;
};

export const setHud = (els: HudElements, scene: string, camera: string, lights: string, mode: string): void => {
  els.hudScene.textContent = scene;
  els.hudCamera.textContent = camera;
  els.hudLights.textContent = lights;
  els.hudMode.textContent = mode;
};

export const updateHero = (
  els: HeroElements,
  avatarName?: string,
  songName?: string,
  sectionLabel?: string
): void => {
  const avatarLabel = avatarName || els.avatarSelect.value || "Avatar";
  const rawSong = songName ? `Performing ${songName}` : "No song";
  const songLabel = rawSong ? rawSong : "Awaiting Audio";
  els.heroTitle.textContent = `${avatarLabel.replace(/\.glb$/i, "")}`;
  els.heroSubtitle.textContent = sectionLabel ? `${songLabel} · ${sectionLabel}` : songLabel;
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
  els.stageHeroDesc.textContent = phaseDescriptions[phase];
};

export const setStageHeroDescText = (
  els: Pick<HeroElements, "stageHeroDesc">,
  text: string
): void => {
  els.stageHeroDesc.textContent = text;
};
