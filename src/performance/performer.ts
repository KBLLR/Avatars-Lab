import {
  scheduleAction,
  buildMarkersFromPlan,
  type SchedulerContext
} from "./action-scheduler";
import type { TalkingHead } from "@met4citizen/talkinghead";
import {
  BlendshapeExecutor,
  CameraExecutor,
  DanceExecutor,
  EmojiExecutor,
  EngineStateMachine,
  FXExecutor,
  LightingExecutor,
  directorPlanToTimeline
} from "../engine";
import { getDanceDirector } from "../dance/director";
import { initDanceLibrary } from "../dance/library";
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
  useEngine?: boolean;
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

const addAutoGestures = (
  plan: MergedPlan,
  gestures: readonly string[],
  randomItem: <T>(items: readonly T[]) => T
): MergedPlan => {
  if (!gestures.length) return plan;

  const sections = plan.sections.map((section) => {
    const durationMs = section.end_ms - section.start_ms;
    const actions = section.actions ? [...section.actions] : [];
    const actionCount = Math.min(
      3,
      Math.max(1, Math.floor(durationMs / 8000))
    );

    for (let i = 0; i < actionCount; i += 1) {
      const time =
        section.start_ms +
        (i + 1) * (durationMs / (actionCount + 1));
      actions.push({
        time_ms: time,
        action: "play_gesture",
        args: { gesture: randomItem(gestures), duration: 2.5 }
      });
    }

    return {
      ...section,
      actions: actions.length > 0 ? actions : undefined
    };
  });

  return { ...plan, sections };
};

let danceLibraryReady: Promise<void> | null = null;

const ensureDanceLibrary = async (): Promise<void> => {
  if (!danceLibraryReady) {
    danceLibraryReady = initDanceLibrary().then(() => undefined);
  }
  await danceLibraryReady;
};

const hasDanceActions = (plan: MergedPlan): boolean => {
  const hasDanceInActions = (actions?: PlanAction[]) =>
    Boolean(actions?.some((action) =>
      action.action === "play_animation" || action.action === "play_pose"
    ));

  if (hasDanceInActions(plan.actions)) return true;
  return plan.sections.some((section) => hasDanceInActions(section.actions));
};

const addAutoDance = async (plan: MergedPlan): Promise<MergedPlan> => {
  if (hasDanceActions(plan)) return plan;

  await ensureDanceLibrary();
  const director = getDanceDirector();
  let injected = false;

  const sections = plan.sections.map((section) => {
    const sectionDuration = section.end_ms - section.start_ms;
    let density: "sparse" | "normal" | "dense" = "normal";
    if (sectionDuration < 7000) density = "sparse";
    if (sectionDuration > 20000) density = "dense";

    const danceActions = director.generateDanceActions(
      section.start_ms,
      section.end_ms,
      density
    );

    if (danceActions.length === 0) return section;
    injected = true;

    const actions = [...(section.actions || []), ...danceActions].sort(
      (a, b) => a.time_ms - b.time_ms
    );

    return { ...section, actions };
  });

  return injected ? { ...plan, sections } : plan;
};

export const createPerformanceController = (deps: PerformanceDeps): PerformanceController => {
  const {
    els,
    effectsManager,
    useEngine: useEngineOption,
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

  let engine: EngineStateMachine | null = null;

  const performSong = async () => {
    const state = getState();
    const isDuoMode = state.duoMode && state.duoManager;
    const useEngine = Boolean(useEngineOption) && !isDuoMode;

    // In Duo Mode, we use duoManager; otherwise require head
    if (!isDuoMode && !state.head) {
      updateStatus("Avatar not loaded.");
      return;
    }
    if (!state.audioBuffer) {
      updateStatus("Audio not loaded.");
      return;
    }
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

    // For Duo Mode, get the primary head from duoManager
    const activeHead = isDuoMode
      ? state.duoManager!.getHead("avatar_a")
      : state.head;

    if (!activeHead) {
      updateStatus("No active avatar available.");
      return;
    }

    await ensureLipsync(activeHead);
    if (isDuoMode) {
      state.duoManager!.start();
    } else {
      state.head!.start();
    }
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
    const visemeTimings = buildVisemeTimings(activeHead, timings);

    // Create context for scheduler (include duoManager if in Duo Mode)
    const schedulerContext: SchedulerContext = {
        head: activeHead,
        cameraSettings: state.cameraSettings,
        lightPreset: state.lightPreset,
        updateStatus,
        applyCameraSettings,
        applyLightPreset,
        effectsManager,
        duoManager: isDuoMode ? state.duoManager! : undefined
    };

    let playbackPlan = activePlan;
    if (useEngine) {
      playbackPlan = addAutoGestures(activePlan, gestures, randomItem);
      playbackPlan = await addAutoDance(playbackPlan);
      if (playbackPlan !== activePlan) {
        updateState({ plan: playbackPlan, planSource });
      }
    }

    let markers: { markers: Array<() => void>; mtimes: number[] };
    let externalActions: PlanAction[] = [];

    if (useEngine) {
      const { timeline, externalActions: passthrough } = directorPlanToTimeline(
        playbackPlan,
        {
          durationMs,
          defaultCameraView: state.cameraSettings.view,
          defaultLightPreset: state.lightPreset,
          defaultMood: "neutral"
        }
      );
      externalActions = passthrough;

      if (engine) {
        engine.stop();
        engine.dispose();
      }

      engine = new EngineStateMachine({ timeline, head: activeHead, effectsManager });
      engine.registerExecutor(new BlendshapeExecutor(activeHead));
      engine.registerExecutor(new EmojiExecutor(activeHead));
      engine.registerExecutor(new LightingExecutor(activeHead));
      engine.registerExecutor(new CameraExecutor(activeHead));
      engine.registerExecutor(new DanceExecutor(activeHead));
      if (effectsManager) {
        engine.registerExecutor(new FXExecutor(effectsManager));
      }
      await engine.initialize();
      engine.play();

      const markerCallbacks: Array<() => void> = [];
      const markerTimes: number[] = [];

      externalActions.forEach((action) =>
        scheduleAction(action, markerCallbacks, markerTimes, schedulerContext)
      );

      const endTime = Math.max(durationMs - 500, durationMs * 0.99);
      markerCallbacks.push(() => {
        applyLightPreset("spotlight");
        updateStatus("Performance complete. Ready for next act.");
      });
      markerTimes.push(endTime);

      markers = { markers: markerCallbacks, mtimes: markerTimes };
    } else {
      markers = buildMarkersFromPlan(activePlan, durationMs, schedulerContext);
      if (engine) {
        engine.stop();
        engine.dispose();
        engine = null;
      }
    }

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

    const playbackStart = activeHead.audioCtx.currentTime;
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

    // In Duo Mode, use duoManager.speak; otherwise use head.speakAudio
    if (isDuoMode && state.duoManager) {
      // For now, Avatar A speaks the performance
      // Future: distribute based on speak_to actions in the plan
      state.duoManager.speak("avatar_a", {
        audio: state.audioBuffer,
        words: timings.words,
        wtimes: timings.wtimes,
        wdurations: timings.wdurations,
        visemes: hasVisemes ? visemeTimings.visemes : undefined,
        vtimes: hasVisemes ? visemeTimings.vtimes : undefined,
        vdurations: hasVisemes ? visemeTimings.vdurations : undefined,
        markers: markers.markers,
        mtimes: markers.mtimes
      });
    } else {
      activeHead.speakAudio(audio);
    }
  };

  const stopPerformance = () => {
    const state = getState();
    const isDuoMode = state.duoMode && state.duoManager;

    if (isDuoMode && state.duoManager) {
      state.duoManager.stopAll();
    } else if (state.head) {
      state.head.stop();
    }

    if (engine) {
      engine.stop();
      engine.dispose();
      engine = null;
    }

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
