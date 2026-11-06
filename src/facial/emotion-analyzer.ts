/**
 * emotion-analyzer.ts — Pre-Speech Emotion Analysis & Dynamic Emotional State Engine.
 *
 * Provides:
 *  1. Text Prompt Emotion Analysis:
 *     - Parses explicit emotional cues (e.g. [Happy], [Angry], [Surprised], [Thinking], [Empathic], [Excited], [Neutral])
 *     - Strips cues to provide clean audio-ready speech text
 *     - Computes fallback sentence-level sentiment & emotion analysis
 *     - Builds a time-indexed Emotion Timeline for multi-sentence speeches
 *  2. EmotionEngine:
 *     - Translates emotion states into calibrated ARKit blendshapes (brows, cheeks, eyes, nose)
 *     - Smoothly transitions (eases) across emotional keyframes during speech
 *     - Composites emotional baselines with speech visemes without clipping
 */

export type EmotionState =
  | "neutral"
  | "happy"
  | "surprised"
  | "angry"
  | "empathic"
  | "thinking"
  | "excited";

export interface EmotionKeyframe {
  timeRatio: number; // 0.0 to 1.0
  emotion: EmotionState;
  intensity: number; // 0.0 to 1.0
  label: string;
  textSnippet: string;
}

export interface PromptAnalysisResult {
  cleanText: string;
  dominantEmotion: EmotionState;
  overallIntensity: number;
  timeline: EmotionKeyframe[];
  detectedTags: string[];
}

/**
 * ARKit blendshape configurations per emotional state.
 * These drive expressive facial features (brows, eyes, cheeks, nose, and mouth corners)
 * that form the expressive base layer underneath speech lip-sync.
 */
export const EMOTION_ARKIT_PRESETS: Record<EmotionState, Record<string, number>> = {
  neutral: {
    browInnerUp: 0.02,
    mouthSmileLeft: 0.03,
    mouthSmileRight: 0.03,
  },
  happy: {
    mouthSmileLeft: 0.52,
    mouthSmileRight: 0.52,
    cheekSquintLeft: 0.42,
    cheekSquintRight: 0.42,
    browInnerUp: 0.22,
    eyeSquintLeft: 0.2,
    eyeSquintRight: 0.2,
  },
  surprised: {
    browInnerUp: 0.65,
    browOuterUpLeft: 0.55,
    browOuterUpRight: 0.55,
    eyeWideLeft: 0.62,
    eyeWideRight: 0.62,
    jawOpen: 0.12,
  },
  angry: {
    browDownLeft: 0.68,
    browDownRight: 0.68,
    noseSneerLeft: 0.45,
    noseSneerRight: 0.45,
    jawForward: 0.22,
    mouthFrownLeft: 0.35,
    mouthFrownRight: 0.35,
    eyeSquintLeft: 0.32,
    eyeSquintRight: 0.32,
  },
  empathic: {
    browInnerUp: 0.58,
    mouthFrownLeft: 0.25,
    mouthFrownRight: 0.25,
    eyeSquintLeft: 0.18,
    eyeSquintRight: 0.18,
    mouthSmileLeft: 0.15,
    mouthSmileRight: 0.15,
  },
  thinking: {
    browDownLeft: 0.52,
    browOuterUpRight: 0.48, // Asymmetric brow raise for skeptical / contemplative thought
    browInnerUp: 0.28,
    eyeSquintLeft: 0.28,
    mouthPucker: 0.16,
    mouthDimpleRight: 0.22,
  },
  excited: {
    mouthSmileLeft: 0.68,
    mouthSmileRight: 0.68,
    cheekSquintLeft: 0.55,
    cheekSquintRight: 0.55,
    browInnerUp: 0.42,
    browOuterUpLeft: 0.48,
    browOuterUpRight: 0.48,
    eyeWideLeft: 0.42,
    eyeWideRight: 0.42,
  },
};

/**
 * Keyword lexicons for automatic prompt sentiment inference.
 */
const EMOTION_LEXICONS: Record<EmotionState, string[]> = {
  neutral: [],
  happy: [
    "happy", "good", "great", "excellent", "wonderful", "love", "awesome",
    "pleased", "glad", "delighted", "smile", "fun", "joy", "welcome"
  ],
  surprised: [
    "wow", "oh", "really", "amazing", "incredible", "unbelievable", "shocking",
    "unexpected", "astonishing", "whoa", "gosh", "surprise", "suddenly"
  ],
  angry: [
    "angry", "frustrated", "annoyed", "mad", "furious", "irritated", "outraged",
    "broken", "error", "critical", "fail", "danger", "urgent", "must not", "bug"
  ],
  empathic: [
    "sorry", "understand", "care", "together", "help", "support", "sad", "unfortunate",
    "gently", "empathy", "patience", "listen", "kindness"
  ],
  thinking: [
    "hmm", "perhaps", "maybe", "consider", "ponder", "wonder", "why", "how",
    "analyzing", "evaluating", "curious", "hypothesis", "let me see", "calculating"
  ],
  excited: [
    "excited", "thrilled", "fast", "super", "breakthrough", "colossal", "future",
    "phenomenal", "revolutionary", "genius", "outstanding", "yes", "launch", "live"
  ],
};

const EMOTION_TAG_PATTERN = /\[(happy|surprised|angry|empathic|thinking|excited|neutral|joy|intense|skeptical|sad)\]|\((happy|surprised|angry|empathic|thinking|excited|neutral)\)/gi;

function normalizeTag(raw: string): EmotionState {
  const lower = raw.toLowerCase().trim();
  if (lower === "joy") return "happy";
  if (lower === "intense") return "angry";
  if (lower === "skeptical") return "thinking";
  if (lower === "sad") return "empathic";
  if (
    lower === "happy" ||
    lower === "surprised" ||
    lower === "angry" ||
    lower === "empathic" ||
    lower === "thinking" ||
    lower === "excited"
  ) {
    return lower as EmotionState;
  }
  return "neutral";
}

/**
 * Analyzes a speech prompt text prior to speech execution.
 */
export function analyzeSpeechPrompt(inputText: string): PromptAnalysisResult {
  const text = inputText || "";
  const detectedTags: string[] = [];

  // 1. Check for explicit bracketed tags
  const explicitMatches: { tag: EmotionState; index: number; raw: string }[] = [];
  let match: RegExpExecArray | null;
  const tagRegex = new RegExp(EMOTION_TAG_PATTERN);

  while ((match = tagRegex.exec(text)) !== null) {
    const rawTag = match[1] || match[2];
    if (rawTag) {
      const normalized = normalizeTag(rawTag);
      explicitMatches.push({ tag: normalized, index: match.index, raw: match[0] });
      detectedTags.push(rawTag);
    }
  }

  // 2. Clean text for TTS playback
  const cleanText = text.replace(EMOTION_TAG_PATTERN, " ").replace(/\s{2,}/g, " ").trim();

  // 3. Sentence segmentation
  const sentences = cleanText
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const timeline: EmotionKeyframe[] = [];

  if (explicitMatches.length > 0) {
    // Generate timeline based on explicit tags and their relative character offsets
    const totalChars = Math.max(1, text.length);
    for (let i = 0; i < explicitMatches.length; i++) {
      const item = explicitMatches[i];
      const timeRatio = Math.min(1, Math.max(0, item.index / totalChars));
      timeline.push({
        timeRatio,
        emotion: item.tag,
        intensity: 0.85,
        label: `Explicit [${item.tag}]`,
        textSnippet: text.slice(item.index, item.index + 45).replace(EMOTION_TAG_PATTERN, ""),
      });
    }
  } else if (sentences.length > 0) {
    // Keyword sentiment per sentence
    let cumulativeChars = 0;
    const totalChars = cleanText.length || 1;

    for (const sentence of sentences) {
      const lowerSentence = sentence.toLowerCase();
      let bestEmotion: EmotionState = "neutral";
      let highestScore = 0;

      for (const [emotion, words] of Object.entries(EMOTION_LEXICONS) as [EmotionState, string[]][]) {
        let score = 0;
        for (const w of words) {
          if (lowerSentence.includes(w)) score += 1;
        }
        if (emotion === "excited" && sentence.includes("!")) score += 1.5;
        if (emotion === "thinking" && sentence.includes("?")) score += 1.5;

        if (score > highestScore) {
          highestScore = score;
          bestEmotion = emotion;
        }
      }

      const timeRatio = Math.min(1, cumulativeChars / totalChars);
      timeline.push({
        timeRatio,
        emotion: bestEmotion,
        intensity: highestScore > 0 ? Math.min(1, 0.6 + highestScore * 0.15) : 0.5,
        label: `Sentence: ${bestEmotion}`,
        textSnippet: sentence.slice(0, 40),
      });

      cumulativeChars += sentence.length + 1;
    }
  }

  // Ensure there is at least one starting keyframe at ratio 0.0
  if (timeline.length === 0 || timeline[0].timeRatio > 0.05) {
    timeline.unshift({
      timeRatio: 0.0,
      emotion: timeline[0]?.emotion || "neutral",
      intensity: 0.75,
      label: "Initial State",
      textSnippet: cleanText.slice(0, 30),
    });
  }

  // Determine dominant emotion
  const emotionCounts: Partial<Record<EmotionState, number>> = {};
  for (const kf of timeline) {
    emotionCounts[kf.emotion] = (emotionCounts[kf.emotion] || 0) + 1;
  }
  let dominantEmotion: EmotionState = "neutral";
  let maxCount = 0;
  for (const [em, count] of Object.entries(emotionCounts) as [EmotionState, number][]) {
    if (count > maxCount && em !== "neutral") {
      maxCount = count;
      dominantEmotion = em;
    }
  }

  return {
    cleanText: cleanText.length > 0 ? cleanText : inputText,
    dominantEmotion,
    overallIntensity: 0.8,
    timeline,
    detectedTags,
  };
}

/**
 * Dynamic Emotion Engine for real-time state transitions and blendshape synthesis.
 */
export class DynamicEmotionEngine {
  private currentEmotion: EmotionState = "neutral";
  private targetEmotion: EmotionState = "neutral";
  private intensity = 0.8;
  private currentBlendshapes: Record<string, number> = {};
  private targetBlendshapes: Record<string, number> = {};
  private timeline: EmotionKeyframe[] = [];
  private activeTimelineIndex = -1;

  constructor(initialEmotion: EmotionState = "neutral", initialIntensity = 0.8) {
    this.setEmotion(initialEmotion, initialIntensity, true);
  }

  /**
   * Loads an emotion timeline calculated from pre-speech prompt analysis.
   */
  public loadTimeline(timeline: EmotionKeyframe[]): void {
    this.timeline = [...timeline].sort((a, b) => a.timeRatio - b.timeRatio);
    this.activeTimelineIndex = -1;
    if (this.timeline.length > 0) {
      this.setEmotion(this.timeline[0].emotion, this.timeline[0].intensity);
    }
  }

  /**
   * Sets or overrides the current emotional state.
   */
  public setEmotion(emotion: EmotionState, intensity = 0.8, immediate = false): void {
    this.targetEmotion = emotion;
    this.intensity = Math.max(0, Math.min(1, intensity));

    const preset = EMOTION_ARKIT_PRESETS[emotion] || EMOTION_ARKIT_PRESETS.neutral;
    const targets: Record<string, number> = {};

    for (const [morph, val] of Object.entries(preset)) {
      targets[morph] = val * this.intensity;
    }

    this.targetBlendshapes = targets;

    if (immediate) {
      this.currentEmotion = emotion;
      this.currentBlendshapes = { ...targets };
    }
  }

  /**
   * Advances the emotion timeline based on speech playback progress (0.0 to 1.0).
   */
  public updateProgress(progressRatio: number): EmotionState {
    if (this.timeline.length === 0) return this.targetEmotion;

    const ratio = Math.max(0, Math.min(1, progressRatio));
    let matchingIndex = 0;

    for (let i = 0; i < this.timeline.length; i++) {
      if (ratio >= this.timeline[i].timeRatio) {
        matchingIndex = i;
      } else {
        break;
      }
    }

    if (matchingIndex !== this.activeTimelineIndex) {
      this.activeTimelineIndex = matchingIndex;
      const kf = this.timeline[matchingIndex];
      this.setEmotion(kf.emotion, kf.intensity);
    }

    return this.targetEmotion;
  }

  /**
   * Smoothly eases emotional blendshapes toward their targets.
   */
  public step(dtMs: number): Record<string, number> {
    const dt = Math.max(1, Math.min(100, dtMs));
    // Smooth cinematic expression transition (~85ms response time)
    const alpha = 1 - Math.exp(-dt / 85);

    const allKeys = new Set([
      ...Object.keys(this.currentBlendshapes),
      ...Object.keys(this.targetBlendshapes),
    ]);

    for (const key of allKeys) {
      const target = this.targetBlendshapes[key] ?? 0;
      const current = this.currentBlendshapes[key] ?? 0;
      const next = current + (target - current) * alpha;

      if (Math.abs(next) < 0.001 && target === 0) {
        delete this.currentBlendshapes[key];
      } else {
        this.currentBlendshapes[key] = next;
      }
    }

    return this.currentBlendshapes;
  }

  public getActiveEmotion(): EmotionState {
    return this.targetEmotion;
  }

  public getTimeline(): EmotionKeyframe[] {
    return this.timeline;
  }

  public reset(): void {
    this.setEmotion("neutral", 0.8, true);
    this.timeline = [];
    this.activeTimelineIndex = -1;
  }
}
