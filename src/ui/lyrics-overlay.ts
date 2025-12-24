import type { TalkingHead } from "@met4citizen/talkinghead";
import type { WordTiming } from "../directors/types";

export interface LyricsOverlayState {
  lyricActive: boolean;
  audioBuffer: AudioBuffer | null;
  head: TalkingHead | null;
  wordTimings: WordTiming | null;
  playbackStart: number | null;
  lyricIndex: number;
}

export interface LyricsOverlayElements {
  heroLyrics: HTMLElement;
}

export type LyricsOverlayUpdate = (partial: Partial<Pick<LyricsOverlayState, "lyricIndex" | "lyricActive">>) => void;
export type GetLyricsOverlayState = () => LyricsOverlayState;

export const updateLyricsOverlay = (
  getState: GetLyricsOverlayState,
  els: LyricsOverlayElements,
  updateState: LyricsOverlayUpdate,
  scheduleFrame: (cb: FrameRequestCallback) => number = requestAnimationFrame
): void => {
  const state = getState();
  if (!state.lyricActive || !state.audioBuffer || !state.head || !state.wordTimings) return;
  if (state.playbackStart === null) return;

  const nowMs = (state.head.audioCtx.currentTime - state.playbackStart) * 1000;
  const { words, wtimes, wdurations } = state.wordTimings;

  let nextIndex = state.lyricIndex;
  while (nextIndex < wtimes.length - 1 && nowMs > wtimes[nextIndex] + wdurations[nextIndex]) {
    nextIndex += 1;
  }
  if (nextIndex !== state.lyricIndex) {
    updateState({ lyricIndex: nextIndex });
  }

  const windowSize = 6;
  const start = Math.max(0, nextIndex - 2);
  const end = Math.min(words.length, start + windowSize);
  const line = words.slice(start, end).map((word, idx) => {
    const absoluteIndex = start + idx;
    const cls = absoluteIndex === nextIndex ? "current" : "word";
    return `<span class="${cls}">${word}</span>`;
  });
  els.heroLyrics.innerHTML = line.join(" ");

  if (nowMs > state.audioBuffer.duration * 1000 + 500) {
    if (state.lyricActive) {
      updateState({ lyricActive: false });
    }
  } else {
    scheduleFrame(() => updateLyricsOverlay(getState, els, updateState, scheduleFrame));
  }
};
