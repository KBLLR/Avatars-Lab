import type { TalkingHead } from "@met4citizen/talkinghead";

export type { CameraSettings, LightingBase, LightColors, LightPresetConfig } from "../stage/types";

export interface LightingElements {
  ambientColor: HTMLInputElement;
  directColor: HTMLInputElement;
  spotColor: HTMLInputElement;
  ambientIntensity: HTMLInputElement;
  directIntensity: HTMLInputElement;
  spotIntensity: HTMLInputElement;
  ambientIntensityVal: HTMLElement;
  directIntensityVal: HTMLElement;
  spotIntensityVal: HTMLElement;
  lightPreset: HTMLSelectElement;
  lightPulse: HTMLInputElement;
  hudScene: HTMLElement;
  hudCamera: HTMLElement;
  hudLights: HTMLElement;
  hudMode: HTMLElement;
}

export interface CameraElements {
  cameraView: HTMLSelectElement;
  cameraDistance: HTMLInputElement;
  cameraX: HTMLInputElement;
  cameraY: HTMLInputElement;
  cameraRotateX: HTMLInputElement;
  cameraRotateY: HTMLInputElement;
  autoRotate: HTMLInputElement;
  autoRotateSpeed: HTMLInputElement;
  cameraDistanceVal: HTMLElement;
  cameraXVal: HTMLElement;
  cameraYVal: HTMLElement;
  cameraRotateXVal: HTMLElement;
  cameraRotateYVal: HTMLElement;
  autoRotateSpeedVal: HTMLElement;
  hudScene: HTMLElement;
  hudCamera: HTMLElement;
  hudLights: HTMLElement;
  hudMode: HTMLElement;
}

export interface LightingState {
  lightPulse: boolean;
  lightPulseAmount: number;
  stageLightingBase: { ambient: number; direct: number; spot: number };
  lightColors: { ambient: string; direct: string; spot: string };
  lightPreset: string;
}

export interface CameraState {
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
}

export type SetHudFn = (scene: string, camera: string, lights: string, mode: string) => void;

export type TalkingHeadRef = TalkingHead;
