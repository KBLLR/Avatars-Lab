import { TalkingHead } from "@met4citizen/talkinghead";
import { HeadAudio } from "@met4citizen/headaudio/dist/headaudio.min.mjs";
import type { HeadConfig, HeadAudioConfig, UpdateStageLightingFn } from "./types";
import { ensureLipsync } from "./lipsync-bridge";
import { effectsManager } from "../effects/manager";

import workletUrl from "@met4citizen/headaudio/dist/headworklet.min.mjs?url";
import modelUrl from "@met4citizen/headaudio/dist/model-en-mixed.bin?url";

export const getDefaultHeadAudioConfig = (): HeadAudioConfig => ({
  workletUrl,
  modelUrl
});

export const createHead = (config: HeadConfig): TalkingHead => {
  const head = new TalkingHead(config.avatarElement, {
    ttsEndpoint: "N/A",
    lipsyncLang: "en",
    lipsyncModules: [],
    cameraView: config.cameraSettings.view,
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

  // Hook EffectsManager
  if (head.renderer && head.scene && head.camera) {
    effectsManager.init(head.renderer, head.scene, head.camera);

    // Disable internal render by overriding the render method provided by TalkingHead (if it uses a standard loop)
    // or by hijacking the internal renderer.render if exposed.
    // Assuming TalkingHead calls this.renderer.render(this.scene, this.camera);
    // We can replace head.render if it exists, or update loop.

    // If we can't disable, we just accept double render for now, but usually libraries have a 'render' method we can stub.
    // head.render = () => {}; // if it exists
  }

  const originalUpdate = head.opt.update;
  head.opt.update = (dt: number) => {
    if (originalUpdate) originalUpdate(dt);
    // Render using effects composer
    effectsManager.render(dt);
  };

  ensureLipsync(head).catch(() => null);

  return head;
};

export const disposeHead = (head: TalkingHead): void => {
  if (!head) return;

  try {
    // Stop any running animations/audio first
    if (typeof head.stop === "function") {
      head.stop();
    }

    // TalkingHead.dispose() may fail if avatar wasn't fully loaded
    // (e.g., setPoseFromTemplate tries to clone undefined poses)
    if (typeof head.dispose === "function") {
      head.dispose();
    }
  } catch (err) {
    console.warn("disposeHead: error during disposal (avatar may not be fully loaded):", err);
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
