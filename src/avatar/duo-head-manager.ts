/**
 * DuoHeadManager - Two TalkingHead avatars in a shared scene
 *
 * Uses TalkingHead's avatarOnly mode (Appendix H):
 * - headA: standalone instance (owns scene, renderer, camera, lights)
 * - headB: avatarOnly instance (armature only, added to headA's scene)
 * - speakTo: makes avatars face each other during speech
 */

import { TalkingHead } from "@met4citizen/talkinghead";
import type { HeadConfig, HeadAudioConfig, UpdateStageLightingFn } from "./types";
import { ensureLipsync } from "./lipsync-bridge";
import { effectsManager } from "../effects/manager";

import workletUrl from "@met4citizen/headaudio/dist/headworklet.min.mjs?url";
import modelUrl from "@met4citizen/headaudio/dist/model-en-mixed.bin?url";

export type AvatarId = "avatar_a" | "avatar_b";
export type SpeakTarget = AvatarId | "camera" | null;

export interface DuoConfig {
  container: HTMLElement;
  cameraSettings: HeadConfig["cameraSettings"];
  lightingBase: HeadConfig["lightingBase"];
  avatarAUrl: string;
  avatarBUrl: string;
  avatarABody?: "M" | "F";
  avatarBBody?: "M" | "F";
  spacing?: number;  // horizontal distance between avatars (default 0.8)
}

export interface SpeakOptions {
  audio: AudioBuffer;
  words?: string[];
  wtimes?: number[];
  wdurations?: number[];
  visemes?: string[];
  vtimes?: number[];
  vdurations?: number[];
  markers?: Array<() => void>;
  mtimes?: number[];
}

export class DuoHeadManager {
  private headA: TalkingHead | null = null;
  private headB: TalkingHead | null = null;
  private config: DuoConfig;
  private initialized = false;
  private updateStageLighting: UpdateStageLightingFn | null = null;

  constructor(config: DuoConfig) {
    this.config = {
      spacing: 0.8,
      avatarABody: "F",
      avatarBBody: "M",
      ...config
    };
  }

  async init(updateStageLighting?: UpdateStageLightingFn): Promise<void> {
    if (this.initialized) return;
    this.updateStageLighting = updateStageLighting || null;

    const { container, cameraSettings, lightingBase, spacing } = this.config;

    // Create standalone headA (owns scene, renderer, lights)
    this.headA = new TalkingHead(container, {
      ttsEndpoint: "N/A",
      lipsyncLang: "en",
      lipsyncModules: [],
      cameraView: cameraSettings.view,
      cameraDistance: cameraSettings.distance,
      cameraX: cameraSettings.x,
      cameraY: cameraSettings.y,
      cameraRotateX: cameraSettings.rotateX,
      cameraRotateY: cameraSettings.rotateY,
      cameraRotateEnable: true,
      mixerGainSpeech: 3,
      lightAmbientIntensity: lightingBase.ambient,
      lightDirectIntensity: lightingBase.direct,
      lightSpotIntensity: lightingBase.spot
    });

    // Create avatarOnly headB (armature only)
    this.headB = new TalkingHead(container, {
      ttsEndpoint: "N/A",
      lipsyncLang: "en",
      lipsyncModules: [],
      avatarOnly: true,
      avatarOnlyCamera: this.headA.camera,
      mixerGainSpeech: 3
    });

    // Hook effects manager to headA's renderer
    if (this.headA.renderer && this.headA.scene && this.headA.camera) {
      effectsManager.init(this.headA.renderer, this.headA.scene, this.headA.camera);
    }

    // Wire update loop: headA updates headB
    const originalUpdate = this.headA.opt.update;
    this.headA.opt.update = (dt: number) => {
      // Update headB's animation
      this.headB?.animate?.(dt);

      if (originalUpdate) originalUpdate(dt);

      // Stage lighting
      if (this.updateStageLighting && this.headA) {
        this.updateStageLighting(this.headA, dt);
      }

      // Render with effects
      effectsManager.render(dt);
    };

    // Load avatars
    await this.loadAvatars();

    // Position avatars (A on left, B on right)
    if (this.headB?.armature) {
      this.headB.armature.position.set(spacing!, 0, 0);
      // Add headB's armature to headA's scene
      this.headA.scene.add(this.headB.armature);
    }

    // Offset headA slightly to the left
    if (this.headA?.armature) {
      this.headA.armature.position.set(-spacing! / 2, 0, 0);
    }
    if (this.headB?.armature) {
      this.headB.armature.position.set(spacing! / 2, 0, 0);
    }

    // Setup camera controls
    if (this.headA.controls) {
      this.headA.controls.autoRotate = cameraSettings.autoRotate;
      this.headA.controls.autoRotateSpeed = cameraSettings.autoRotateSpeed;
    }

    // Ensure lipsync for both
    await Promise.all([
      ensureLipsync(this.headA).catch(() => null),
      ensureLipsync(this.headB).catch(() => null)
    ]);

    this.initialized = true;
  }

  private async loadAvatars(): Promise<void> {
    const { avatarAUrl, avatarBUrl, avatarABody, avatarBBody } = this.config;

    const loadPromises: Promise<void>[] = [];

    if (this.headA) {
      loadPromises.push(
        this.headA.showAvatar({
          url: avatarAUrl,
          body: avatarABody,
          lipsyncLang: "en",
          avatarMood: "neutral"
        })
      );
    }

    if (this.headB) {
      loadPromises.push(
        this.headB.showAvatar({
          url: avatarBUrl,
          body: avatarBBody,
          lipsyncLang: "en",
          avatarMood: "neutral"
        })
      );
    }

    await Promise.all(loadPromises);
  }

  /**
   * Set who an avatar is speaking to
   */
  setSpeakTo(speaker: AvatarId, target: SpeakTarget): void {
    const speakerHead = speaker === "avatar_a" ? this.headA : this.headB;
    const targetHead = target === "avatar_a" ? this.headA :
                       target === "avatar_b" ? this.headB : null;

    if (!speakerHead) return;

    if (target === "camera" || target === null) {
      speakerHead.speakTo = null;
    } else if (targetHead) {
      speakerHead.speakTo = targetHead;
    }
  }

  /**
   * Make avatars face each other (mutual gaze)
   */
  setMutualGaze(): void {
    if (this.headA && this.headB) {
      this.headA.speakTo = this.headB;
      this.headB.speakTo = this.headA;
    }
  }

  /**
   * Make both avatars face the camera
   */
  setFaceCamera(): void {
    if (this.headA) this.headA.speakTo = null;
    if (this.headB) this.headB.speakTo = null;
  }

  /**
   * Make an avatar speak audio with word timings
   */
  async speak(avatarId: AvatarId, options: SpeakOptions): Promise<void> {
    const head = avatarId === "avatar_a" ? this.headA : this.headB;
    if (!head) return;

    await head.audioCtx.resume();
    head.start();

    head.speakAudio({
      audio: options.audio,
      words: options.words || [],
      wtimes: options.wtimes || [],
      wdurations: options.wdurations || [],
      visemes: options.visemes || [],
      vtimes: options.vtimes || [],
      vdurations: options.vdurations || [],
      markers: options.markers || [],
      mtimes: options.mtimes || []
    });
  }

  /**
   * Stop an avatar's speech
   */
  stop(avatarId: AvatarId): void {
    const head = avatarId === "avatar_a" ? this.headA : this.headB;
    head?.stop();
  }

  /**
   * Stop both avatars
   */
  stopAll(): void {
    this.headA?.stop();
    this.headB?.stop();
  }

  /**
   * Set mood for an avatar
   */
  setMood(avatarId: AvatarId, mood: string): void {
    const head = avatarId === "avatar_a" ? this.headA : this.headB;
    head?.setMood(mood);
  }

  /**
   * Play gesture on an avatar
   */
  playGesture(avatarId: AvatarId, gesture: string, duration = 2.5, mirror = false): void {
    const head = avatarId === "avatar_a" ? this.headA : this.headB;
    head?.playGesture(gesture, duration, mirror);
  }

  /**
   * Start animation loop
   */
  start(): void {
    this.headA?.start();
  }

  /**
   * Get reference to a head instance (for advanced use)
   */
  getHead(avatarId: AvatarId): TalkingHead | null {
    return avatarId === "avatar_a" ? this.headA : this.headB;
  }

  /**
   * Get the shared audio context
   */
  getAudioContext(): AudioContext | null {
    return this.headA?.audioCtx || null;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Dispose both heads
   */
  dispose(): void {
    // Wrap in try-catch - TalkingHead.dispose() may fail if avatar wasn't fully loaded
    try {
      if (this.headA) {
        this.headA.stop?.();
        this.headA.dispose?.();
      }
    } catch (err) {
      console.warn("DuoHeadManager: error disposing headA:", err);
    }

    try {
      if (this.headB) {
        this.headB.stop?.();
        this.headB.dispose?.();
      }
    } catch (err) {
      console.warn("DuoHeadManager: error disposing headB:", err);
    }

    this.headA = null;
    this.headB = null;
    this.initialized = false;
  }
}

// Re-export from head-manager to avoid duplication
// Use: import { getDefaultHeadAudioConfig } from "./head-manager"
