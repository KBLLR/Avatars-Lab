import type { TalkingHead } from "@met4citizen/talkinghead";
import type { WordTiming } from "./types";



let lipsyncReadyPromise: Promise<any> | null = null;

export const ensureLipsync = async (head: TalkingHead): Promise<void> => {
  if (!lipsyncReadyPromise) {
    lipsyncReadyPromise = (async () => {
      try {
        console.log("Loading lipsync module...");
        const module = await import("@met4citizen/talkinghead/modules/lipsync-en.mjs");
        console.log("Lipsync module loaded:", Object.keys(module));
        return module.LipsyncEn || module.default;
      } catch (e) {
        console.error("Failed to load lipsync module:", e);
        return null;
      }
    })();
  }

  const LipsyncClass = await lipsyncReadyPromise;
  if (!LipsyncClass) return;

  const target = head as unknown as {
    lipsync?: Record<string, unknown>;
    lipsyncs?: Record<string, unknown>;
  };
  
  if (!target.lipsync) target.lipsync = {};
  if (!target.lipsyncs) target.lipsyncs = {};

  if (!target.lipsync.en) {
    console.log("Initializing LipsyncEn for head instance...");
    const instance = new LipsyncClass();
    target.lipsync.en = instance;
    target.lipsyncs.en = instance;
    console.log("LipsyncEn attached.");
  }
};

export interface VisemeTimings {
  visemes: string[];
  vtimes: number[];
  vdurations: number[];
}

export const buildVisemeTimings = (head: TalkingHead, timings: WordTiming): VisemeTimings => {
  const visemes: string[] = [];
  const vtimes: number[] = [];
  const vdurations: number[] = [];

  const target = head as unknown as {
    lipsync?: Record<string, unknown>;
    lipsyncPreProcessText?: (word: string, lang: string) => string;
    lipsyncWordsToVisemes?: (word: string, lang: string) => {
      visemes?: string[];
      times?: number[];
      durations?: number[];
    };
  };

  if (!target.lipsync || Object.keys(target.lipsync).length === 0) {
    console.warn("Lipsync module not loaded, skipping viseme generation");
    return { visemes, vtimes, vdurations };
  }

  for (let i = 0; i < timings.words.length; i += 1) {
    const word = timings.words[i] || "";
    const time = timings.wtimes[i] ?? 0;
    const duration = timings.wdurations[i] ?? 0;

    if (!word || duration <= 0 || !target.lipsyncWordsToVisemes) {
      continue;
    }

    try {
      const processed = target.lipsyncPreProcessText
        ? target.lipsyncPreProcessText(word, "en")
        : word;
      const val = target.lipsyncWordsToVisemes(processed, "en");
      const localVisemes = val?.visemes || [];
      const localTimes = val?.times || [];
      const localDurations = val?.durations || [];
      const lastIndex = localVisemes.length - 1;

      if (lastIndex < 0) continue;

      const dTotal = (localTimes[lastIndex] ?? 0) + (localDurations[lastIndex] ?? 0);
      if (!dTotal) continue;

      for (let j = 0; j < localVisemes.length; j += 1) {
        const t = time + (localTimes[j] / dTotal) * duration;
        const d = (localDurations[j] / dTotal) * duration;
        visemes.push(localVisemes[j]);
        vtimes.push(Math.max(0, Math.round(t)));
        vdurations.push(Math.max(1, Math.round(d)));
      }
    } catch (e) {
      console.warn("Viseme generation failed for word:", word, e);
    }
  }

  return { visemes, vtimes, vdurations };
};

export const resetLipsyncState = (): void => {
  lipsyncReadyPromise = null;
};
