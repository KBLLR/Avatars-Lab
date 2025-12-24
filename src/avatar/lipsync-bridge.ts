import type { TalkingHead } from "@met4citizen/talkinghead";
import type { WordTiming } from "./types";

const lipsyncModuleId = "@nicoleverse/lipsync-en/dist/lipsync-en.mjs";

let lipsyncReadyPromise: Promise<void> | null = null;

export const ensureLipsync = async (head: TalkingHead): Promise<void> => {
  if (lipsyncReadyPromise) {
    await lipsyncReadyPromise;
    return;
  }

  lipsyncReadyPromise = (async () => {
    try {
      console.log("Loading lipsync module from:", lipsyncModuleId);
      const module = await import(lipsyncModuleId);
      console.log("Lipsync module loaded:", Object.keys(module));

      const target = head as unknown as {
        lipsync?: Record<string, unknown>;
        lipsyncs?: Record<string, unknown>;
      };
      if (!target.lipsync) target.lipsync = {};
      if (!target.lipsyncs) target.lipsyncs = {};

      const LipsyncClass = module.LipsyncEn || module.default;
      if (!LipsyncClass) {
        console.error("Failed to load LipsyncEn class from module:", module);
        return;
      }

      console.log("Initializing LipsyncEn...");
      const instance = new LipsyncClass();
      target.lipsync.en = instance;
      target.lipsyncs.en = instance;
      console.log("LipsyncEn initialized and attached to head. lipsync keys:", Object.keys(target.lipsync));
    } catch (e) {
      console.error("Failed to load lipsync module:", e);
    }
  })();

  await lipsyncReadyPromise;
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
