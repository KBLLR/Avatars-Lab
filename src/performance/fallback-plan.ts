import type { WordTiming, PlanSection, MergedPlan, Mood, CameraView, LightPreset } from "../directors/types";
import type { TimingSegment } from "./types";
import { moods, cameraViews, lightPresets } from "../stage/constants";

export const randomItem = <T>(items: readonly T[]): T =>
  items[Math.floor(Math.random() * items.length)];

export const encodeWords = (text: string): string[] =>
  text
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);

export const buildSectionsFromTimings = (timings: WordTiming): TimingSegment[] => {
  const sections: TimingSegment[] = [];
  if (!timings.words.length) return sections;

  let currentWords: string[] = [];
  let startMs = timings.wtimes[0];
  let endMs = timings.wtimes[0] + timings.wdurations[0];
  let lastEnd = endMs;

  for (let i = 0; i < timings.words.length; i += 1) {
    const word = timings.words[i];
    const wtime = timings.wtimes[i];
    const wdur = timings.wdurations[i];
    const gap = wtime - lastEnd;
    const segmentDuration = endMs - startMs;
    const shouldSplit = gap > 1300 || segmentDuration > 16000;

    if (currentWords.length && shouldSplit) {
      sections.push({
        start_ms: Math.max(0, Math.round(startMs)),
        end_ms: Math.max(0, Math.round(endMs)),
        text: currentWords.join(" ")
      });
      currentWords = [];
      startMs = wtime;
    }

    currentWords.push(word);
    endMs = Math.max(endMs, wtime + wdur);
    lastEnd = wtime + wdur;
  }

  if (currentWords.length) {
    sections.push({
      start_ms: Math.max(0, Math.round(startMs)),
      end_ms: Math.max(0, Math.round(endMs)),
      text: currentWords.join(" ")
    });
  }

  return sections;
};

export const fallbackPlan = (
  durationMs: number,
  timings: WordTiming | null,
  transcriptText: string
): MergedPlan => {
  const words = timings?.words?.length ? timings.words : encodeWords(transcriptText);
  const segments = timings ? buildSectionsFromTimings(timings) : [];
  const sectionCount = Math.max(3, Math.min(segments.length || 4, 6));
  const step = durationMs / sectionCount;
  const sections: PlanSection[] = [];
  const presetKeys = Object.keys(lightPresets) as LightPreset[];

  for (let i = 0; i < sectionCount; i += 1) {
    const start_ms = Math.round(i * step);
    const end_ms = Math.round((i + 1) * step);
    sections.push({
      label: i === 0 ? "Intro" : i === sectionCount - 1 ? "Outro" : `Section ${i + 1}`,
      start_ms,
      end_ms,
      role: i % 2 === 0 ? "solo" : "ensemble",
      mood: randomItem(moods) as Mood,
      camera: cameraViews[i % cameraViews.length] as CameraView,
      light: presetKeys[i % presetKeys.length]
    });
  }

  return { title: "Auto Stage", sections, actions: [], source: "heuristic" as const };
};
