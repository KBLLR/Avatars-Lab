import type { TalkingHead } from "@met4citizen/talkinghead";
import type { LightingElements, LightingState, SetHudFn } from "./types";
import { lightPresets } from "../stage/constants";

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const updateStageLighting = (
  head: TalkingHead,
  lightState: LightingState,
  dt: number
): number => {
  let pulseAmount = lightState.lightPulseAmount;

  if (!lightState.lightPulse) {
    pulseAmount = 0;
  } else {
    const analyser = head.audioAnalyzerNode;
    if (analyser) {
      const bins = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(bins);
      const avg = bins.reduce((sum, v) => sum + v, 0) / bins.length / 255;
      pulseAmount = clamp(pulseAmount + (avg * 1.5 - pulseAmount) * (dt / 300), 0, 1.2);
    }
  }

  if (head.lightAmbient) {
    head.lightAmbient.intensity = lightState.stageLightingBase.ambient + pulseAmount * 0.6;
  }
  if (head.lightDirect) {
    head.lightDirect.intensity = lightState.stageLightingBase.direct + pulseAmount * 10;
  }
  if (head.lightSpot) {
    head.lightSpot.intensity = lightState.stageLightingBase.spot + pulseAmount * 14;
  }

  return pulseAmount;
};

export const updateSpotlightsOverlay = (lightColors: { ambient: string; direct: string; spot: string }): void => {
  const node = document.getElementById("spotlights");
  if (!node) return;
  const { ambient, direct, spot } = lightColors;
  node.style.background = `radial-gradient(circle at 20% 10%, ${ambient}55, transparent 45%),
    radial-gradient(circle at 80% 20%, ${direct}55, transparent 50%),
    radial-gradient(circle at 50% 80%, ${spot}55, transparent 55%)`;
};

export const applyLightSettings = (
  head: TalkingHead,
  lightState: LightingState
): void => {
  head.lightAmbient?.color?.set(lightState.lightColors.ambient);
  head.lightDirect?.color?.set(lightState.lightColors.direct);
  head.lightSpot?.color?.set(lightState.lightColors.spot);
  updateStageLighting(head, lightState, 16);
  updateSpotlightsOverlay(lightState.lightColors);
};

export const updateSliderReadouts = (els: LightingElements & {
  cameraDistanceVal: HTMLElement;
  cameraXVal: HTMLElement;
  cameraYVal: HTMLElement;
  cameraRotateXVal: HTMLElement;
  cameraRotateYVal: HTMLElement;
  autoRotateSpeedVal: HTMLElement;
  cameraDistance: HTMLInputElement;
  cameraX: HTMLInputElement;
  cameraY: HTMLInputElement;
  cameraRotateX: HTMLInputElement;
  cameraRotateY: HTMLInputElement;
  autoRotateSpeed: HTMLInputElement;
}): void => {
  els.cameraDistanceVal.textContent = Number(els.cameraDistance.value).toFixed(2);
  els.cameraXVal.textContent = Number(els.cameraX.value).toFixed(2);
  els.cameraYVal.textContent = Number(els.cameraY.value).toFixed(2);
  els.cameraRotateXVal.textContent = Number(els.cameraRotateX.value).toFixed(2);
  els.cameraRotateYVal.textContent = Number(els.cameraRotateY.value).toFixed(2);
  els.autoRotateSpeedVal.textContent = Number(els.autoRotateSpeed.value).toFixed(2);
  els.ambientIntensityVal.textContent = Number(els.ambientIntensity.value).toFixed(1);
  els.directIntensityVal.textContent = Number(els.directIntensity.value).toFixed(1);
  els.spotIntensityVal.textContent = Number(els.spotIntensity.value).toFixed(1);
};

export interface ApplyLightPresetResult {
  lightPreset: string;
  stageLightingBase: { ambient: number; direct: number; spot: number };
  lightColors: { ambient: string; direct: string; spot: string };
}

export const applyLightPreset = (
  presetId: string,
  head: TalkingHead | null,
  els: LightingElements,
  currentState: LightingState,
  updateSliders: () => void,
  setHud: SetHudFn
): ApplyLightPresetResult | null => {
  const preset = lightPresets[presetId];
  if (!preset) return null;

  const newState: ApplyLightPresetResult = {
    lightPreset: presetId,
    stageLightingBase: {
      ambient: preset.ambient,
      direct: preset.direct,
      spot: preset.spot
    },
    lightColors: {
      ambient: preset.ambientColor,
      direct: preset.directColor,
      spot: preset.spotColor
    }
  };

  els.ambientColor.value = preset.ambientColor;
  els.directColor.value = preset.directColor;
  els.spotColor.value = preset.spotColor;
  els.ambientIntensity.value = String(preset.ambient);
  els.directIntensity.value = String(preset.direct);
  els.spotIntensity.value = String(preset.spot);

  updateSliders();

  if (head) {
    applyLightSettings(head, { ...currentState, ...newState });
  }

  setHud(
    els.hudScene.textContent || "Idle",
    els.hudCamera.textContent || "Upper",
    preset.label,
    els.hudMode.textContent || "Awaiting"
  );

  return newState;
};
