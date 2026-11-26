import type { EmotionKeyframe, EmotionState, PromptAnalysisResult } from "../facial/emotion-analyzer";

export interface HeadPose {
  pitch: number;
  yaw: number;
  roll: number;
}

export const NECK_MOTIONS = {
  turn: { label: "Turn", durationMs: 2400 },
  yes: { label: "Nod yes", durationMs: 2100 },
  no: { label: "Shake no", durationMs: 2250 },
  acknowledge: { label: "Acknowledge", durationMs: 1250 },
  consider: { label: "Consider", durationMs: 2250 },
  brighten: { label: "Brighten", durationMs: 1500 },
} as const;
export type NeckMotion = keyof typeof NECK_MOTIONS;

export function sampleNeckMotion(motion: NeckMotion, progress: number): HeadPose {
  if (progress <= 0 || progress >= 1) return { pitch: 0, yaw: 0, roll: 0 };
  const ease = Math.sin(Math.PI * progress) ** 2;
  const cycle = Math.sin(4 * Math.PI * progress);
  switch (motion) {
    case "turn": return { pitch: 0, yaw: 0.45 * ease, roll: -0.025 * ease };
    case "yes": return { pitch: 0.32 * cycle * ease, yaw: 0, roll: 0 };
    case "no": return { pitch: 0.035 * ease, yaw: 0.38 * cycle * ease, roll: 0.035 * cycle * ease };
    case "acknowledge": return { pitch: 0.16 * ease, yaw: 0.035 * ease, roll: -0.035 * ease };
    case "consider": return { pitch: -0.075 * ease, yaw: -0.14 * ease, roll: 0.09 * ease };
    case "brighten": return { pitch: -0.125 * ease, yaw: 0.045 * ease, roll: -0.05 * ease };
  }
}

export interface SpeechMotionCue {
  motion: NeckMotion;
  ratio: number;
}

function motionForCue(cue: EmotionKeyframe): NeckMotion | undefined {
  const start = cue.textSnippet.trim();
  if (/^(yes|absolutely|exactly)\b/i.test(start)) return "yes";
  if (/^(no|nope)\b/i.test(start)) return "no";
  return motionForEmotion(cue.emotion);
}

export function motionForEmotion(emotion: EmotionState): NeckMotion | undefined {
  switch (emotion) {
    case "thinking": return "consider";
    case "empathic": return "acknowledge";
    case "happy":
    case "excited":
    case "surprised": return "brighten";
    default: return undefined;
  }
}

/** Pick sparse gestures locally using the existing emotion pre-analysis. */
export function planSpeechMotions(analysis: PromptAnalysisResult): SpeechMotionCue[] {
  const cues: SpeechMotionCue[] = [];
  for (const keyframe of analysis.timeline) {
    const motion = motionForCue(keyframe);
    if (!motion || keyframe.timeRatio > 0.86) continue;
    const last = cues.at(-1);
    if (last && (last.motion === motion || keyframe.timeRatio - last.ratio < 0.20)) continue;
    cues.push({ motion, ratio: keyframe.timeRatio });
    if (cues.length === 3) break;
  }
  return cues;
}
