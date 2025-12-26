import {
  scheduleAction,
  buildMarkersFromPlan,
  type SchedulerContext
} from "./action-scheduler";
import type { TalkingHead } from "@met4citizen/talkinghead";
import type {
  CameraView,
  LightPreset,
  Mood,
  PlanAction,
  PlanSection,
  WordTiming,
  MergedPlan
} from "../directors/types";
import type { CameraSettings, StageState } from "../stage/types";
import type { StageElements } from "../stage/elements";
import type { EffectsManager } from "../effects/manager";

export interface PerformanceDeps {
  els: Pick<StageElements, "soloOnly" | "hudScene" | "hudCamera" | "hudLights" | "hudMode">;
  effectsManager?: EffectsManager;
  getState: () => StageState;
  updateState: (partial: Partial<StageState>) => void;
  ensureAudioContext: (label: string) => Promise<boolean>;
  ensureLipsync: (head: TalkingHead) => Promise<void>;
  buildVisemeTimings: (head: TalkingHead, timings: WordTiming) => {
    visemes: string[];
    vtimes: number[];
    vdurations: number[];
  };
  buildWordTimings: (words: string[], durationMs: number) => WordTiming;
  encodeWords: (text: string) => string[];
  fallbackPlan: (durationMs: number, timings: WordTiming | null) => MergedPlan;
  renderPlan: (sections: PlanSection[]) => void;
  updateStatus: (message: string) => void;
  updateHero: (avatarName?: string, songName?: string, sectionLabel?: string) => void;
  setHud: (scene: string, camera: string, lights: string, mode: string) => void;
  startLyricsOverlay: () => void;
  randomItem: <T>(items: readonly T[]) => T;
  gestures: readonly string[];
  lightPresets: Record<string, { label: string }>;
  applyLightPreset: (presetId: string) => void;
  applyCameraSettings: () => void;
  updateCameraSettings: (partial: Partial<CameraSettings>) => void;
}

export interface PerformanceController {
  performSong: () => Promise<void>;
  stopPerformance: () => void;
}

const filterWordsForSolo = (timings: WordTiming, sections: PlanSection[]): WordTiming => {
  if (!sections.length) return timings;
  const soloSegments = sections.filter((section) => section.role === "solo");
  if (!soloSegments.length) return timings;

  const soloWords: string[] = [];
  const soloTimes: number[] = [];
  const soloDurations: number[] = [];

  for (let i = 0; i < timings.words.length; i += 1) {
    const time = timings.wtimes[i];
    const segment = soloSegments.find((section) => time >= section.start_ms && time <= section.end_ms);
    if (segment) {
      soloWords.push(timings.words[i]);
      soloTimes.push(time);
      soloDurations.push(timings.wdurations[i]);
    }
  }

  return { words: soloWords, wtimes: soloTimes, wdurations: soloDurations };
};

export const createPerformanceController = (deps: PerformanceDeps): PerformanceController => {
  const {
    els,
    effectsManager,
    getState,
    updateState,
    ensureAudioContext,
    ensureLipsync,
    buildVisemeTimings,
    buildWordTimings,
    encodeWords,
    fallbackPlan,
    renderPlan,
    updateStatus,
    updateHero,
    setHud,
    startLyricsOverlay,
    randomItem,
    gestures,
    lightPresets,
    applyLightPreset,
    applyCameraSettings,
    updateCameraSettings
  } = deps;

  /* Local functions replaced by imports from ./action-scheduler.ts */

  const performSong = async () => {
    const state = getState();
    if (!state.head || !state.audioBuffer) return;
    if (!state.transcriptText) {
      updateStatus("Transcript required. Run transcribe first.");
      return;
    }
    if (!state.plan || !state.planApproved) {
      updateStatus("Approve the performance plan before performing.");
      return;
    }

    const unlocked = await ensureAudioContext("Perform");
    if (!unlocked) return;

    await ensureLipsync(state.head);
    state.head.start();
    const durationMs = state.audioBuffer.duration * 1000;
    const baseTimings =
      state.wordTimings || buildWordTimings(encodeWords(state.transcriptText), durationMs);
    const activePlan = state.plan || fallbackPlan(durationMs, baseTimings);
    let planSource = state.planSource;
    if (planSource === "none") {
      planSource = "heuristic";
      renderPlan(activePlan.sections);
    }
    updateState({ plan: activePlan, planSource });

    const timings = els.soloOnly.checked ? filterWordsForSolo(baseTimings, activePlan.sections) : baseTimings;
    const visemeTimings = buildVisemeTimings(state.head, timings);

    // Create context for scheduler
    const schedulerContext: SchedulerContext = {
        head: state.head,
        cameraSettings: state.cameraSettings,
        lightPreset: state.lightPreset,
        updateStatus,
        applyCameraSettings,
        applyLightPreset,
        effectsManager
    };

    const markers = buildMarkersFromPlan(activePlan, durationMs, schedulerContext);
    const hasVisemes = visemeTimings.visemes.length > 0;

    const audio = {
      audio: state.audioBuffer,
      words: timings.words,
      wtimes: timings.wtimes,
      wdurations: timings.wdurations,
      visemes: hasVisemes ? visemeTimings.visemes : [],
      vtimes: hasVisemes ? visemeTimings.vtimes : [],
      vdurations: hasVisemes ? visemeTimings.vdurations : [],
      markers: markers.markers,
      mtimes: markers.mtimes
    };

    // Apply spotlight preset at performance start
    applyLightPreset("spotlight");

    const playbackStart = state.head.audioCtx.currentTime;
    const lyricActive = Boolean(state.wordTimings?.words.length);
    updateState({
      performing: true,
      playbackStart,
      lyricIndex: 0,
      lyricActive
    });
    setHud(
      activePlan.title || "Performance",
      state.cameraSettings.view,
      "Spotlight",
      "Performing"
    );
    updateStatus("Performance started...");
    if (lyricActive) {
      startLyricsOverlay();
    }
    updateHero(undefined, state.audioFile ? state.audioFile.name : undefined, activePlan.title || "Performance");
    state.head.speakAudio(audio);
  };

  const stopPerformance = () => {
    const state = getState();
    if (!state.head) return;
    state.head.stop();

    // Apply spotlight preset when stopped
    applyLightPreset("spotlight");

    updateState({ performing: false, lyricActive: false });
    setHud(
      "Idle",
      state.cameraSettings.view,
      "Spotlight",
      "Ready"
    );
    updateStatus("Performance stopped. Ready for next act.");
  };

  return { performSong, stopPerformance };
};
