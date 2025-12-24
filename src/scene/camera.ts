import type { TalkingHead } from "@met4citizen/talkinghead";
import type { CameraSettings } from "./types";

export type SetHudFn = (scene: string, camera: string, lights: string, mode: string) => void;

export interface CameraHudElements {
  hudScene: HTMLElement;
  hudCamera: HTMLElement;
  hudLights: HTMLElement;
  hudMode: HTMLElement;
}

export const applyCameraSettings = (
  head: TalkingHead,
  settings: CameraSettings,
  els: CameraHudElements,
  setHud: SetHudFn
): void => {
  const view = settings.view;

  head.opt.cameraDistance = settings.distance;
  head.opt.cameraX = settings.x;
  head.opt.cameraY = settings.y;
  head.opt.cameraRotateX = settings.rotateX;
  head.opt.cameraRotateY = settings.rotateY;

  head.setView(view, {
    cameraDistance: settings.distance,
    cameraX: settings.x,
    cameraY: settings.y,
    cameraRotateX: settings.rotateX,
    cameraRotateY: settings.rotateY
  });

  if (head.controls) {
    head.controls.autoRotate = settings.autoRotate;
    head.controls.autoRotateSpeed = settings.autoRotateSpeed;
  }

  setHud(
    els.hudScene.textContent || "Idle",
    view,
    els.hudLights.textContent || "Neon",
    els.hudMode.textContent || "Awaiting"
  );
};

export const getCameraSettingsFromInputs = (els: {
  cameraView: HTMLSelectElement;
  cameraDistance: HTMLInputElement;
  cameraX: HTMLInputElement;
  cameraY: HTMLInputElement;
  cameraRotateX: HTMLInputElement;
  cameraRotateY: HTMLInputElement;
  autoRotate: HTMLInputElement;
  autoRotateSpeed: HTMLInputElement;
}): CameraSettings => ({
  view: els.cameraView.value,
  distance: parseFloat(els.cameraDistance.value),
  x: parseFloat(els.cameraX.value),
  y: parseFloat(els.cameraY.value),
  rotateX: parseFloat(els.cameraRotateX.value),
  rotateY: parseFloat(els.cameraRotateY.value),
  autoRotate: els.autoRotate.checked,
  autoRotateSpeed: parseFloat(els.autoRotateSpeed.value)
});
