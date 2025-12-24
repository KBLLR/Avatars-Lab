import type { TalkingHead } from "@met4citizen/talkinghead";
import type { HeadAudio } from "@met4citizen/headaudio/dist/headaudio.min.mjs";

export type { WordTiming } from "../directors/types";

export interface HeadConfig {
  avatarElement: HTMLElement;
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
  lightingBase: {
    ambient: number;
    direct: number;
    spot: number;
  };
}

export interface HeadAudioConfig {
  workletUrl: string;
  modelUrl: string;
}

export interface AvatarLoaderElements {
  avatarSelect: HTMLSelectElement;
}

export interface TranscribeConfig {
  audioBaseUrl?: string;
  sttModel?: string;
}

export interface TranscribeResult {
  text: string;
  wordTimings: {
    words: string[];
    wtimes: number[];
    wdurations: number[];
  } | null;
}

export type UpdateStageLightingFn = (head: TalkingHead, dt: number) => void;

export type TalkingHeadInstance = TalkingHead;
export type HeadAudioInstance = HeadAudio;
