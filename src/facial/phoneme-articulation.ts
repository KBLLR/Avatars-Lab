/**
 * phoneme-articulation.ts — Expressive ARKit Lip & Jaw Articulation for Speech.
 *
 * Maps Oculus / HeadAudio neural viseme classifications onto full 51 ARKit
 * blendshapes with rich lip dynamics (pucker, funnel, stretch, roll, shrug,
 * upper lip elevation, and lower lip depression).
 *
 * Implements exponential attack/decay co-articulation filtering so phoneme
 * transitions feel organic and fluid rather than stepped or rigid.
 */

export interface VisemeWeights {
  jawOpen?: number;
  jawForward?: number;
  jawLeft?: number;
  jawRight?: number;
  mouthClose?: number;
  mouthFunnel?: number;
  mouthPucker?: number;
  mouthStretchLeft?: number;
  mouthStretchRight?: number;
  mouthUpperUpLeft?: number;
  mouthUpperUpRight?: number;
  mouthLowerDownLeft?: number;
  mouthLowerDownRight?: number;
  mouthRollUpper?: number;
  mouthRollLower?: number;
  mouthShrugUpper?: number;
  mouthShrugLower?: number;
  mouthPressLeft?: number;
  mouthPressRight?: number;
  mouthSmileLeft?: number;
  mouthSmileRight?: number;
  mouthFrownLeft?: number;
  mouthFrownRight?: number;
  mouthDimpleLeft?: number;
  mouthDimpleRight?: number;
  [key: string]: number | undefined;
}

/**
 * Expressive ARKit blendshape mappings per Oculus viseme.
 *
 * Calibrated specifically for Core-X ChatAvatar heads (kbllr, anja, eli,
 * sofia, susi-q, david).
 */
export const EXPRESSIVE_VISEME_TO_ARKIT: Record<string, VisemeWeights> = {
  viseme_sil: {},
  // Bilabial plosives / nasals (P, B, M): gentle lip seal without elevating lower lip over top lip
  viseme_PP: {
    jawOpen: 0.02,
    mouthClose: 0.05,
    mouthPressLeft: 0.22,
    mouthPressRight: 0.22,
    mouthUpperUpLeft: 0,
    mouthUpperUpRight: 0,
    mouthLowerDownLeft: 0,
    mouthLowerDownRight: 0,
  },
  // Labiodental fricatives (F, V): lower lip rolls inward under incisors, upper lip lifts
  viseme_FF: {
    jawOpen: 0.18,
    mouthRollLower: 0.7,
    mouthShrugUpper: 0.42,
    mouthLowerDownLeft: 0.38,
    mouthLowerDownRight: 0.38,
    mouthUpperUpLeft: 0.22,
    mouthUpperUpRight: 0.22,
  },
  // Interdental fricatives (TH): tongue between teeth, lips parted horizontally
  viseme_TH: {
    jawOpen: 0.22,
    mouthStretchLeft: 0.38,
    mouthStretchRight: 0.38,
    mouthUpperUpLeft: 0.28,
    mouthUpperUpRight: 0.28,
    mouthLowerDownLeft: 0.28,
    mouthLowerDownRight: 0.28,
  },
  // Alveolar plosives (T, D, N): slight jaw drop, lips parted exposing upper/lower teeth
  viseme_DD: {
    jawOpen: 0.28,
    mouthStretchLeft: 0.32,
    mouthStretchRight: 0.32,
    mouthUpperUpLeft: 0.38,
    mouthUpperUpRight: 0.38,
    mouthLowerDownLeft: 0.32,
    mouthLowerDownRight: 0.32,
  },
  // Velar plosives (K, G, NG): relaxed lips, moderate jaw opening
  viseme_kk: {
    jawOpen: 0.36,
    mouthUpperUpLeft: 0.24,
    mouthUpperUpRight: 0.24,
    mouthLowerDownLeft: 0.28,
    mouthLowerDownRight: 0.28,
    mouthStretchLeft: 0.15,
    mouthStretchRight: 0.15,
  },
  // Palato-alveolar affricates / sibilants (CH, SH, J): square protruding lip funnel
  viseme_CH: {
    jawOpen: 0.28,
    mouthFunnel: 0.78,
    mouthPucker: 0.58,
    mouthShrugUpper: 0.38,
    mouthUpperUpLeft: 0.24,
    mouthUpperUpRight: 0.24,
  },
  // Alveolar sibilants (S, Z): teeth close together, lips pulled back horizontally in wide smile/stretch
  viseme_SS: {
    jawOpen: 0.16,
    mouthStretchLeft: 0.72,
    mouthStretchRight: 0.72,
    mouthSmileLeft: 0.28,
    mouthSmileRight: 0.28,
    mouthUpperUpLeft: 0.36,
    mouthUpperUpRight: 0.36,
    mouthLowerDownLeft: 0.28,
    mouthLowerDownRight: 0.28,
  },
  // Alveolar nasal / liquid (N, L): mild stretch and lip parting
  viseme_nn: {
    jawOpen: 0.22,
    mouthStretchLeft: 0.28,
    mouthStretchRight: 0.28,
    mouthUpperUpLeft: 0.22,
    mouthUpperUpRight: 0.22,
    mouthLowerDownLeft: 0.22,
    mouthLowerDownRight: 0.22,
  },
  // Retroflex / approximant (R): lips rounded and funneled slightly forward
  viseme_RR: {
    jawOpen: 0.25,
    mouthPucker: 0.65,
    mouthFunnel: 0.48,
    mouthRollUpper: 0.22,
    mouthRollLower: 0.22,
  },
  // Open back unrounded vowel (AA, AH): large jaw drop, deep lower lip depression, upper lip lift showing teeth
  viseme_aa: {
    jawOpen: 0.88,
    mouthLowerDownLeft: 0.72,
    mouthLowerDownRight: 0.72,
    mouthUpperUpLeft: 0.48,
    mouthUpperUpRight: 0.48,
    mouthStretchLeft: 0.22,
    mouthStretchRight: 0.22,
  },
  // Front open-mid vowel (EH, AE, EY): jaw open, strong horizontal stretch, lip corners pulled back
  viseme_E: {
    jawOpen: 0.48,
    mouthStretchLeft: 0.65,
    mouthStretchRight: 0.65,
    mouthUpperUpLeft: 0.46,
    mouthUpperUpRight: 0.46,
    mouthLowerDownLeft: 0.42,
    mouthLowerDownRight: 0.42,
    mouthSmileLeft: 0.22,
    mouthSmileRight: 0.22,
  },
  // Close front unrounded vowel (IY, IH): narrow jaw, maximum lateral stretch and upper lip raise
  viseme_I: {
    jawOpen: 0.26,
    mouthStretchLeft: 0.78,
    mouthStretchRight: 0.78,
    mouthUpperUpLeft: 0.52,
    mouthUpperUpRight: 0.52,
    mouthLowerDownLeft: 0.38,
    mouthLowerDownRight: 0.38,
    mouthSmileLeft: 0.32,
    mouthSmileRight: 0.32,
  },
  // Open-mid back rounded vowel (OW, AO): jaw dropped with prominent circular funnel
  viseme_O: {
    jawOpen: 0.58,
    mouthFunnel: 0.88,
    mouthPucker: 0.52,
    mouthLowerDownLeft: 0.32,
    mouthLowerDownRight: 0.32,
    mouthUpperUpLeft: 0.24,
    mouthUpperUpRight: 0.24,
  },
  // Close back rounded vowel (UW, UH): small jaw opening, prominent pursed lip pucker
  viseme_U: {
    jawOpen: 0.26,
    mouthPucker: 0.95,
    mouthFunnel: 0.58,
    mouthRollUpper: 0.25,
    mouthRollLower: 0.25,
  },
};

/**
 * Co-articulation engine with attack/decay temporal smoothing and dynamic lip gain.
 */
export class SpeechArticulationEngine {
  private currentWeights: Record<string, number> = {};
  private targetWeights: Record<string, number> = {};
  public lipGain = 1.35;
  public jawGain = 1.0;

  constructor(options: { lipGain?: number; jawGain?: number } = {}) {
    if (options.lipGain !== undefined) this.lipGain = options.lipGain;
    if (options.jawGain !== undefined) this.jawGain = options.jawGain;
  }

  /**
   * Updates target ARKit weights from raw viseme state.
   */
  public updateTargets(visemeLevels: Record<string, number>): void {
    const rawTarget: Record<string, number> = {};

    for (const [viseme, level] of Object.entries(visemeLevels)) {
      if (level <= 0.001) continue;
      const combo = EXPRESSIVE_VISEME_TO_ARKIT[viseme];
      if (!combo) continue;

      for (const [morph, baseWeight] of Object.entries(combo)) {
        if (baseWeight === undefined) continue;
        // mouthClose should never be amplified by lipGain, otherwise the lower lip lifts above top lip
        const gain = morph === "mouthClose" ? 1.0 : (morph.startsWith("jaw") ? this.jawGain : this.lipGain);
        const scaled = Math.min(1.0, level * baseWeight * gain);
        if (scaled > (rawTarget[morph] ?? 0)) {
          rawTarget[morph] = scaled;
        }
      }
    }

    // Safety guard: mouthClose in ARKit is purely compensatory when the jaw is open.
    // If jawOpen is small or zero, mouthClose must be clamped to prevent the lower lip
    // from riding over the upper lip into an exaggerated underbite.
    if (rawTarget.mouthClose !== undefined) {
      const jaw = rawTarget.jawOpen ?? 0;
      rawTarget.mouthClose = Math.min(rawTarget.mouthClose, Math.max(0, jaw * 0.5), 0.12);
    }
    if (rawTarget.mouthPressLeft !== undefined) {
      rawTarget.mouthPressLeft = Math.min(0.28, rawTarget.mouthPressLeft);
    }
    if (rawTarget.mouthPressRight !== undefined) {
      rawTarget.mouthPressRight = Math.min(0.28, rawTarget.mouthPressRight);
    }

    this.targetWeights = rawTarget;
  }

  /**
   * Advances the smoother by dtMs and returns current interpolated weights.
   */
  public step(dtMs: number): Record<string, number> {
    const dt = Math.max(1, Math.min(100, dtMs));
    // Fast attack (speaking onset ~22ms) and natural release (~58ms)
    const attackAlpha = 1 - Math.exp(-dt / 22);
    const decayAlpha = 1 - Math.exp(-dt / 58);

    const allKeys = new Set([
      ...Object.keys(this.currentWeights),
      ...Object.keys(this.targetWeights),
    ]);

    for (const key of allKeys) {
      const target = this.targetWeights[key] ?? 0;
      const current = this.currentWeights[key] ?? 0;
      const alpha = target > current ? attackAlpha : decayAlpha;
      const next = current + (target - current) * alpha;

      if (Math.abs(next) < 0.002 && target === 0) {
        delete this.currentWeights[key];
      } else {
        this.currentWeights[key] = next;
      }
    }

    return this.currentWeights;
  }

  /**
   * Resets all current and target weights to 0.
   */
  public reset(): void {
    this.currentWeights = {};
    this.targetWeights = {};
  }
}
