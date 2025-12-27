/**
 * Multi-Layer Performance Engine - Lighting Executor
 *
 * Handles stage lighting with:
 * - Light presets (neon, noir, sunset, frost, crimson, spotlight)
 * - Color and intensity control
 * - Smooth fade transitions
 * - Audio-reactive pulse effects
 */

import type { TalkingHead } from "@met4citizen/talkinghead";
import type {
  Timeline,
  TimelineBlock,
  LightingBlockData,
  LayerType,
  LightTransition,
} from "../types";
import { getBlockData } from "../types";
import { BaseExecutor } from "./base-executor";

// ============================================
// Light Presets
// ============================================

interface LightPreset {
  colors: {
    ambient: string;
    direct: string;
    spot: string;
  };
  intensities: {
    ambient: number;
    direct: number;
    spot: number;
  };
}

const LIGHT_PRESETS: Record<string, LightPreset> = {
  spotlight: {
    colors: { ambient: "#ffffff", direct: "#ffffff", spot: "#ffffff" },
    intensities: { ambient: 0.5, direct: 1, spot: 20 },
  },
  neon: {
    colors: { ambient: "#ff00ff", direct: "#00ffff", spot: "#ff00ff" },
    intensities: { ambient: 0.6, direct: 0.8, spot: 25 },
  },
  noir: {
    colors: { ambient: "#1a1a2e", direct: "#4a4a6a", spot: "#8888aa" },
    intensities: { ambient: 0.3, direct: 0.6, spot: 15 },
  },
  sunset: {
    colors: { ambient: "#ff6b35", direct: "#f7c59f", spot: "#ff8c42" },
    intensities: { ambient: 0.7, direct: 0.9, spot: 22 },
  },
  frost: {
    colors: { ambient: "#a8dadc", direct: "#e0fbfc", spot: "#3d5a80" },
    intensities: { ambient: 0.6, direct: 0.85, spot: 18 },
  },
  crimson: {
    colors: { ambient: "#660000", direct: "#cc0000", spot: "#ff3333" },
    intensities: { ambient: 0.5, direct: 0.9, spot: 25 },
  },
};

// ============================================
// Lighting Executor
// ============================================

export class LightingExecutor extends BaseExecutor {
  readonly layerType: LayerType = "lighting";

  // Current light state
  private currentColors = {
    ambient: "#ffffff",
    direct: "#ffffff",
    spot: "#ffffff",
  };
  private currentIntensities = { ambient: 0.5, direct: 1, spot: 20 };

  // Transition state
  private targetColors = { ...this.currentColors };
  private targetIntensities = { ...this.currentIntensities };
  private transitionStartColors = { ...this.currentColors };
  private transitionStartIntensities = { ...this.currentIntensities };
  private transitionProgress = 1;
  private transitionDuration_ms = 0;
  private transitionStartTime = 0;

  // Pulse state
  private pulseActive = false;
  private pulsePhase = 0;

  // Track current preset
  private currentPreset: string | null = null;

  constructor(head: TalkingHead) {
    super(head);
  }

  // ─────────────────────────────────────────────────────────
  // Main Update
  // ─────────────────────────────────────────────────────────

  update(
    time_ms: number,
    delta_ms: number,
    activeBlocks: TimelineBlock[]
  ): void {
    if (this.isPaused) return;

    // Get highest priority lighting block
    const block = activeBlocks[0];
    if (!block) {
      // No active block, maintain current state
      this.updateTransition(time_ms);
      return;
    }

    const data = getBlockData(block, "lighting");
    if (!data) return;

    const progress = this.getBlockProgress(block, time_ms);

    // Check if we need to start a new transition
    if (data.preset && data.preset !== this.currentPreset) {
      this.startPresetTransition(data.preset, data.transition || "fade");
      this.currentPreset = data.preset;
    } else if (data.colors || data.intensities) {
      // Custom colors/intensities
      this.applyCustomLighting(data, data.transition || "fade");
    }

    // Update pulse if active
    if (data.audioPulse) {
      this.pulseActive = true;
      this.updatePulse(delta_ms);
    } else {
      this.pulseActive = false;
    }

    // Update transition
    this.updateTransition(time_ms);

    // Apply to TalkingHead
    this.applyToHead();

    this.currentBlocks = activeBlocks;
  }

  // ─────────────────────────────────────────────────────────
  // Transitions
  // ─────────────────────────────────────────────────────────

  private startPresetTransition(
    presetName: string,
    transition: LightTransition
  ): void {
    const preset = LIGHT_PRESETS[presetName];
    if (!preset) {
      this.warn(`Unknown preset: ${presetName}`);
      return;
    }

    if (transition === "cut") {
      // Immediate change
      this.currentColors = { ...preset.colors };
      this.currentIntensities = { ...preset.intensities };
      this.transitionProgress = 1;
    } else {
      // Start fade transition
      this.transitionStartColors = { ...this.currentColors };
      this.transitionStartIntensities = { ...this.currentIntensities };
      this.targetColors = { ...preset.colors };
      this.targetIntensities = { ...preset.intensities };
      this.transitionProgress = 0;
      this.transitionDuration_ms = transition === "fade" ? 500 : 300;
      this.transitionStartTime = performance.now();
    }
  }

  private applyCustomLighting(
    data: LightingBlockData,
    transition: LightTransition
  ): void {
    const newColors = { ...this.currentColors };
    const newIntensities = { ...this.currentIntensities };

    if (data.colors) {
      if (data.colors.ambient) newColors.ambient = data.colors.ambient;
      if (data.colors.direct) newColors.direct = data.colors.direct;
      if (data.colors.spot) newColors.spot = data.colors.spot;
    }

    if (data.intensities) {
      if (data.intensities.ambient !== undefined)
        newIntensities.ambient = data.intensities.ambient;
      if (data.intensities.direct !== undefined)
        newIntensities.direct = data.intensities.direct;
      if (data.intensities.spot !== undefined)
        newIntensities.spot = data.intensities.spot;
    }

    if (transition === "cut") {
      this.currentColors = newColors;
      this.currentIntensities = newIntensities;
      this.transitionProgress = 1;
    } else {
      this.transitionStartColors = { ...this.currentColors };
      this.transitionStartIntensities = { ...this.currentIntensities };
      this.targetColors = newColors;
      this.targetIntensities = newIntensities;
      this.transitionProgress = 0;
      this.transitionDuration_ms = 500;
      this.transitionStartTime = performance.now();
    }
  }

  private updateTransition(_time_ms: number): void {
    if (this.transitionProgress >= 1) return;

    const elapsed = performance.now() - this.transitionStartTime;
    this.transitionProgress = Math.min(
      1,
      elapsed / this.transitionDuration_ms
    );

    // Apply easing
    const t = this.applyEasing(this.transitionProgress, "easeInOut");

    // Interpolate colors
    this.currentColors.ambient = this.lerpColor(
      this.transitionStartColors.ambient,
      this.targetColors.ambient,
      t
    );
    this.currentColors.direct = this.lerpColor(
      this.transitionStartColors.direct,
      this.targetColors.direct,
      t
    );
    this.currentColors.spot = this.lerpColor(
      this.transitionStartColors.spot,
      this.targetColors.spot,
      t
    );

    // Interpolate intensities
    this.currentIntensities.ambient = this.lerp(
      this.transitionStartIntensities.ambient,
      this.targetIntensities.ambient,
      t
    );
    this.currentIntensities.direct = this.lerp(
      this.transitionStartIntensities.direct,
      this.targetIntensities.direct,
      t
    );
    this.currentIntensities.spot = this.lerp(
      this.transitionStartIntensities.spot,
      this.targetIntensities.spot,
      t
    );
  }

  // ─────────────────────────────────────────────────────────
  // Pulse Effect
  // ─────────────────────────────────────────────────────────

  private updatePulse(delta_ms: number): void {
    // Simple sine wave pulse
    const pulseSpeed = 0.005; // Radians per ms
    this.pulsePhase += delta_ms * pulseSpeed;

    if (this.pulsePhase > Math.PI * 2) {
      this.pulsePhase -= Math.PI * 2;
    }

    // Modulate spot intensity
    const pulseAmount = 0.2; // 20% variation
    const pulseFactor = 1 + Math.sin(this.pulsePhase) * pulseAmount;
    this.currentIntensities.spot *= pulseFactor;
  }

  // ─────────────────────────────────────────────────────────
  // Apply to TalkingHead
  // ─────────────────────────────────────────────────────────

  private applyToHead(): void {
    try {
      // Access TalkingHead's Three.js lights
      const head = this.head as unknown as {
        lightAmbient?: { color?: { set: (c: string) => void }; intensity?: number };
        lightDirect?: { color?: { set: (c: string) => void }; intensity?: number };
        lightSpot?: { color?: { set: (c: string) => void }; intensity?: number };
      };

      if (head.lightAmbient) {
        head.lightAmbient.color?.set(this.currentColors.ambient);
        head.lightAmbient.intensity = this.currentIntensities.ambient;
      }

      if (head.lightDirect) {
        head.lightDirect.color?.set(this.currentColors.direct);
        head.lightDirect.intensity = this.currentIntensities.direct;
      }

      if (head.lightSpot) {
        head.lightSpot.color?.set(this.currentColors.spot);
        head.lightSpot.intensity = this.currentIntensities.spot;
      }
    } catch (err) {
      this.warn("Failed to apply lighting:", err);
    }
  }

  // ─────────────────────────────────────────────────────────
  // Cross-Layer Actions
  // ─────────────────────────────────────────────────────────

  executeAction(action: string, args?: Record<string, unknown>): void {
    switch (action) {
      case "set_light_preset":
        if (args?.preset) {
          this.startPresetTransition(
            args.preset as string,
            (args.transition as LightTransition) || "fade"
          );
          this.currentPreset = args.preset as string;
        }
        break;

      case "set_ambient_color":
        if (args?.color) {
          this.currentColors.ambient = args.color as string;
          this.applyToHead();
        }
        break;

      case "set_spot_intensity":
        if (typeof args?.intensity === "number") {
          this.currentIntensities.spot = args.intensity;
          this.applyToHead();
        }
        break;

      case "pulse":
        this.pulseActive = true;
        break;

      case "stop_pulse":
        this.pulseActive = false;
        break;

      default:
        this.warn(`Unknown action: ${action}`);
    }
  }

  // ─────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────

  stop(): void {
    super.stop();

    // Reset to spotlight preset
    this.startPresetTransition("spotlight", "cut");
    this.currentPreset = "spotlight";
    this.pulseActive = false;
    this.pulsePhase = 0;
    this.applyToHead();
  }

  dispose(): void {
    this.stop();
    super.dispose();
  }
}
