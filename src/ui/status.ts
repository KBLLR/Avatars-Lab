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
