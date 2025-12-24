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

export interface PerformanceDeps {
  els: Pick<StageElements, "soloOnly" | "hudScene" | "hudCamera" | "hudLights" | "hudMode">;
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

  const scheduleAction = (action: PlanAction, markers: Array<() => void>, mtimes: number[]) => {
    const time = Math.max(0, Math.round(action.time_ms));
    markers.push(() => {
      const state = getState();
      const head = state.head;
      if (!head) return;
      const args = action.args || {};
      const gesture = args.gesture || args.name;
      switch (action.action) {
        case "set_mood":
          if (args.mood) head.setMood(args.mood as Mood);
          break;
        case "play_gesture":
          if (gesture) {
            head.playGesture(gesture as string, args.duration ?? 2.5, args.mirror ?? false, args.ms ?? 800);
          }
          break;
        case "stop_gesture":
          head.stopGesture(args.ms ?? 800);
          break;
        case "speak_emoji":
        case "make_facial_expression":
          if (args.emoji) head.speakEmoji(args.emoji as string);
          break;
        case "speak_break":
          if (typeof args.duration_ms === "number") {
            head.speakBreak(args.duration_ms);
          }
          break;
        case "speak_marker":
          if (args.marker) {
            updateStatus(`Marker: ${args.marker}`);
          }
          break;
        case "look_at":
          if (typeof args.x === "number" && typeof args.y === "number") {
            head.lookAt(args.x, args.y, args.t ?? 600);
          }
          break;
        case "look_at_camera":
        case "make_eye_contact":
          head.lookAtCamera(args.ms ?? args.t ?? 600);
          break;
        case "set_value":
          if (args.mt && typeof args.value === "number") {
            head.setValue(args.mt as string, args.value, typeof args.ms === "number" ? args.ms : null);
          }
          break;
        case "get_value":
          if (args.mt) {
            const value = head.getValue(args.mt as string);
            updateStatus(`Value ${args.mt}: ${value ?? "n/a"}`);
          }
          break;
        case "play_background_audio":
          if (args.url) {
            head.audioCtx.resume().catch(() => null);
            head.playBackgroundAudio(args.url as string);
            if (typeof args.volume === "number") {
              const vol = Math.min(1, Math.max(0, args.volume));
              head.setMixerGain(null, vol);
            }
          }
          break;
        case "stop_background_audio":
          head.stopBackgroundAudio();
          break;
        case "start":
          head.audioCtx.resume().catch(() => null);
          head.start();
          break;
        case "stop":
          head.stop();
          break;
        case "start_listening":
        case "stop_listening":
          break;
        case "set_view": {
          const partial: Partial<CameraSettings> = {};
          if (args.view) partial.view = args.view as CameraView;
          if (typeof args.cameraDistance === "number") partial.distance = args.cameraDistance;
          if (typeof args.cameraX === "number") partial.x = args.cameraX;
          if (typeof args.cameraY === "number") partial.y = args.cameraY;
          if (typeof args.cameraRotateX === "number") partial.rotateX = args.cameraRotateX;
          if (typeof args.cameraRotateY === "number") partial.rotateY = args.cameraRotateY;
          if (Object.keys(partial).length) {
            updateCameraSettings(partial);
            applyCameraSettings();
          }
          break;
        }
        case "set_light_preset":
          if (args.preset) applyLightPreset(args.preset as string);
          break;
        default:
          break;
      }
    });
    mtimes.push(time);
  };

  const buildMarkersFromPlan = (
    plan: { sections: PlanSection[]; actions?: PlanAction[] }
  ): { markers: Array<() => void>; mtimes: number[] } => {
    const markers: Array<() => void> = [];
    const mtimes: number[] = [];
    const state = getState();

    plan.sections.forEach((section) => {
      scheduleAction(
        {
          time_ms: section.start_ms,
          action: "set_mood",
          args: { mood: section.mood || "neutral" }
        },
        markers,
        mtimes
      );
      scheduleAction(
        {
          time_ms: section.start_ms,
          action: "set_view",
          args: { view: section.camera || state.cameraSettings.view }
        },
        markers,
        mtimes
      );
      scheduleAction(
        {
          time_ms: section.start_ms,
          action: "set_light_preset",
          args: { preset: section.light || state.lightPreset }
        },
        markers,
        mtimes
      );

      const actionCount = Math.min(3, Math.max(1, Math.floor((section.end_ms - section.start_ms) / 8000)));
      for (let i = 0; i < actionCount; i += 1) {
        const time = section.start_ms + (i + 1) * ((section.end_ms - section.start_ms) / (actionCount + 1));
        scheduleAction(
          {
            time_ms: time,
            action: "play_gesture",
            args: { gesture: randomItem(gestures), duration: 2.5 }
          },
          markers,
          mtimes
        );
      }

      if (section.actions) {
        section.actions.forEach((action) => scheduleAction(action, markers, mtimes));
      }
    });

    plan.actions?.forEach((action) => scheduleAction(action, markers, mtimes));

    return { markers, mtimes };
  };

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
    const markers = buildMarkersFromPlan(activePlan);
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
      lightPresets[state.lightPreset].label,
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
    updateState({ performing: false, lyricActive: false });
    setHud(
      els.hudScene.textContent || "Idle",
      state.cameraSettings.view,
      lightPresets[state.lightPreset].label,
      "Stopped"
    );
    updateStatus("Performance stopped.");
  };

  return { performSong, stopPerformance };
};
