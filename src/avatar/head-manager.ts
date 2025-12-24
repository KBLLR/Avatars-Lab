import { TalkingHead } from "@met4citizen/talkinghead";
import { HeadAudio } from "@met4citizen/headaudio/dist/headaudio.min.mjs";
import type { HeadConfig, HeadAudioConfig, UpdateStageLightingFn } from "./types";
import { ensureLipsync } from "./lipsync-bridge";

// @ts-expect-error static asset imports
import workletUrl from "@nicoleverse/headaudio/dist/headworklet.min.mjs?url";
// @ts-expect-error static asset imports
import modelUrl from "@nicoleverse/headaudio/dist/model-en-mixed.bin?url";

export const getDefaultHeadAudioConfig = (): HeadAudioConfig => ({
  workletUrl,
  modelUrl
});

export const createHead = (config: HeadConfig): TalkingHead => {
  const head = new TalkingHead(config.avatarElement, {
    ttsEndpoint: "N/A",
    lipsyncLang: "en",
    lipsyncModules: [],
    cameraView: "upper",
    cameraDistance: config.cameraSettings.distance,
    cameraX: config.cameraSettings.x,
    cameraY: config.cameraSettings.y,
    cameraRotateX: config.cameraSettings.rotateX,
    cameraRotateY: config.cameraSettings.rotateY,
    cameraRotateEnable: true,
    mixerGainSpeech: 3,
    lightAmbientIntensity: config.lightingBase.ambient,
    lightDirectIntensity: config.lightingBase.direct,
    lightSpotIntensity: config.lightingBase.spot
  });

  if (head.controls) {
    head.controls.autoRotate = config.cameraSettings.autoRotate;
    head.controls.autoRotateSpeed = config.cameraSettings.autoRotateSpeed;
  }

  ensureLipsync(head).catch(() => null);

  return head;
};

export const disposeHead = (head: TalkingHead): void => {
  if (typeof head.dispose === "function") {
    head.dispose();
  }
};

export interface InitHeadAudioResult {
  headaudio: HeadAudio;
}

export const initHeadAudio = async (
  head: TalkingHead,
  audioConfig: HeadAudioConfig,
  updateStageLighting: UpdateStageLightingFn
): Promise<HeadAudio> => {
  await head.audioCtx.audioWorklet.addModule(audioConfig.workletUrl);

  const headaudio = new HeadAudio(head.audioCtx, {
    processorOptions: {
      visemeEventsEnabled: true
    }
  });

  await headaudio.loadModel(audioConfig.modelUrl);
  head.audioSpeechGainNode.connect(headaudio);

  headaudio.onvalue = (key: string, value: number) => {
    if (head.mtAvatar?.[key]) {
      Object.assign(head.mtAvatar[key], { newvalue: value, needsUpdate: true });
    }
  };

  const originalUpdate = head.opt.update;
  head.opt.update = (dt: number) => {
    headaudio.update(dt);
    if (originalUpdate) {
      originalUpdate(dt);
    }
    updateStageLighting(head, dt);
  };

  return headaudio;
};
