import type { TalkingHead } from "@met4citizen/talkinghead";
import type { CameraSettings, SetHudFn } from "./types";

export type { SetHudFn };

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
    (els.hudScene && els.hudScene.textContent) || "Idle",
    view,
    (els.hudLights && els.hudLights.textContent) || "Neon",
    (els.hudMode && els.hudMode.textContent) || "Awaiting"
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
  view: els.cameraView?.value || "upper",
  distance: els.cameraDistance ? parseFloat(els.cameraDistance.value) : 1.5,
  x: els.cameraX ? parseFloat(els.cameraX.value) : 0,
  y: els.cameraY ? parseFloat(els.cameraY.value) : 0,
  rotateX: els.cameraRotateX ? parseFloat(els.cameraRotateX.value) : 0,
  rotateY: els.cameraRotateY ? parseFloat(els.cameraRotateY.value) : 0,
  autoRotate: els.autoRotate ? els.autoRotate.checked : false,
  autoRotateSpeed: els.autoRotateSpeed ? parseFloat(els.autoRotateSpeed.value) : 1.0
});
