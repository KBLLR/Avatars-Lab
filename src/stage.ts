import type { TalkingHead } from "@met4citizen/talkinghead";
import { initLipsync, speakWithLipsync } from "./modules/lipsync";
import { effectsManager } from "./effects/manager";
import { getMlxConfig, setOverride, readOverrides } from "./mlx-config";
import { createAnalysisController } from "./stage/analysis";
import { createAudioController } from "./stage/audio";
import { bootstrapStage } from "./stage/bootstrap";
import { initPerformanceLibrary } from "./data-pool/index";
import type {
  MergedPlan,
  CameraView,
  Mood,
  LightPreset,
  PlanAction,
  PlanSection,
  WordTiming
} from "./directors/types";

// Engine imports for timeline
import { createTimelineEditor, type TimelineEditor } from "./engine/ui";
import { directorPlanToTimeline } from "./engine/director-adapter";
import { type Timeline, createTimeline, createBlock } from "./engine/types";
import {
  saveTimeline,
  loadCurrentTimeline,
  exportTimelineAsFile,
  importTimelineFromFile,
} from "./engine/timeline-persistence";
import { initDanceLibrary } from "./dance/library";
import { getDanceDirector } from "./dance/director";

// Stage modules
import {
  getElements,
  lightPresets,
  directorModelFallback,
  gestures,
  moods,
  cameraViews,
  stageFunctionDefs,
  createStateManager,
  type StageState
} from "./stage/index";
import {
  initModelSelectors as initModelSelectorsModule,
  refreshRuntimePanel as refreshRuntimePanelModule,
  loadRuntimeModel as loadRuntimeModelModule,
  unloadRuntimeModel as unloadRuntimeModelModule,
  setRuntimeStatusText as setRuntimeStatusTextModule,
  initTtsSelectors
} from "./runtime/index";
import {
  ensureLipsync,
  buildVisemeTimings,
  decodeAudio as decodeAudioFile,
  transcribeAudio as transcribeAudioFile,
  createHead as createHeadModule,
  disposeHead,
  initHeadAudio as initHeadAudioModule,
  getDefaultHeadAudioConfig,
  loadAvatar as loadAvatarModule,
  loadAvatarList as loadAvatarListModule,
  populateAvatarSelects,
  DuoHeadManager,
  resolveAvatarUrl
} from "./avatar/index";
import {
  updateStageLighting as updateStageLightingModule,
  applyLightPreset as applyLightPresetModule,
  applyLightSettings as applyLightSettingsModule,
  updateSliderReadouts as updateSliderReadoutsModule
} from "./scene/lighting";
import {
  applyCameraSettings as applyCameraSettingsModule,
} from "./scene/camera";
import { initControls as initControlsModule, bindControls as bindControlsModule } from "./stage/controls";
import {
  fallbackPlan as createFallbackPlan,
  randomItem,
  encodeWords,
  createPerformanceController
} from "./performance/index";
import {
  updateStatus,
  setChip,
  setHud,
  updateHero,
  setAnalysisOverlay,
  resetAnalysisThoughts,
  setPlanApproved,
  updatePlanDetails,
  createSelect,
  createInlineInput,
  clearPlan,
  updateLyricsOverlay
} from "./ui/index";

// Elements are lazily loaded via getElements() from stage module
let els: ReturnType<typeof getElements>;

const config = getMlxConfig();
const engineLabEnabled = document.body?.dataset.engineLab === "true";

// Types now imported from ./stage/types: StageState

// State manager for staged migration off direct state mutations
const stateManager = createStateManager();
let state = stateManager.getState();
stateManager.subscribe((nextState) => {
  state = nextState;
});
const updateState = (partial: Partial<StageState>) => stateManager.update(partial);

let stateUiBound = false;
const bindStateUi = () => {
  if (stateUiBound) return;
  stateUiBound = true;
  stateManager.subscribe((nextState, changed) => {
    if (!els) return;
    if (changed.planApproved !== undefined || changed.plan !== undefined) {
      els.approveBtn.disabled = nextState.planApproved || !nextState.plan;
      els.playBtn.disabled = !nextState.planApproved;
      els.planStatus.textContent = nextState.planApproved
        ? "Approved"
        : nextState.plan
        ? "Awaiting approval"
        : "Pending analysis";
    }
    if (changed.directorNotes !== undefined) {
      if (nextState.directorNotes) {
        els.directorNotes.textContent = nextState.directorNotes;
      } else if (nextState.plan) {
        els.directorNotes.textContent = "Director notes unavailable.";
      }
    }
    if (changed.cameraSettings !== undefined && nextState.head) {
      applyCameraSettings();
    }
    if (
      (changed.lightPreset !== undefined ||
        changed.lightColors !== undefined ||
        changed.stageLightingBase !== undefined) &&
      nextState.head
    ) {
      applyLightSettings();
      updateSliderReadoutsModule(els);
      if (changed.lightPreset !== undefined) {
        const label = lightPresets[nextState.lightPreset]?.label || nextState.lightPreset;
        setHud(
          els,
          els.hudScene.textContent || "Idle",
          els.hudCamera.textContent || "Upper",
          label,
          els.hudMode.textContent || "Awaiting"
        );
      }
    }
    // Duo Mode state changes
    if (changed.duoMode !== undefined) {
      if (nextState.duoMode) {
        initDuoMode().catch((err) => {
          console.error("Failed to init duo mode:", err);
          updateStatus(els, "Duo Mode init failed.");
          updateState({ duoMode: false });
        });
      } else if (!nextState.duoMode && nextState.duoManager) {
        disposeDuoMode();
      }
    }
    // Reload duo avatars when selection changes
    if (nextState.duoMode && nextState.duoManager) {
      if (changed.avatarAUrl !== undefined || changed.avatarBUrl !== undefined) {
        reloadDuoAvatars().catch((err) => {
          console.error("Failed to reload duo avatars:", err);
        });
      }
    }
  });
};

const applyPlanApproved = (approved: boolean) => {
  updateState({ planApproved: approved });
  setPlanApproved(els, state, approved);
};

const applyPlanDirty = () => {
  if (!state.plan) return;
  if (state.planApproved) {
    applyPlanApproved(false);
  } else {
    els.planStatus.textContent = "Awaiting approval";
  }
};

let analysisController: ReturnType<typeof createAnalysisController> | null = null;
const analyzePerformance = () => analysisController?.analyzePerformance() ?? Promise.resolve();
let performanceController: ReturnType<typeof createPerformanceController> | null = null;
const performSong = () => performanceController?.performSong() ?? Promise.resolve();
const stopPerformance = () => performanceController?.stopPerformance();

// randomItem, encodeWords are now imported from modules

const buildWordTimings = (words: string[], durationMs: number): WordTiming => {
  if (!words.length) {
    return { words: [], wtimes: [], wdurations: [] };
  }
  const perWord = durationMs / words.length;
  const wtimes = words.map((_, index) => Math.max(0, Math.round(index * perWord - 120)));
  const wdurations = words.map(() => Math.round(perWord));
  return { words, wtimes, wdurations };
};

const updateStageLighting = (head: TalkingHead, dt: number) => {
  const pulseAmount = updateStageLightingModule(
    head,
    {
      lightPulse: state.lightPulse,
      lightPulseAmount: state.lightPulseAmount,
      stageLightingBase: state.stageLightingBase,
      lightColors: state.lightColors,
      lightPreset: state.lightPreset
    },
    dt
  );
  if (pulseAmount !== state.lightPulseAmount) {
    updateState({ lightPulseAmount: pulseAmount });
  }
};

const createHead = () =>
  createHeadModule({
    avatarElement: els.avatar,
    cameraSettings: state.cameraSettings,
    lightingBase: state.stageLightingBase
  });

const resetHead = () => {
  if (state.head) {
    disposeHead(state.head);
  }
  const head = createHead();
  updateState({ head, headaudio: null, audioBuffer: null });
};

// ─────────────────────────────────────────────────────────────
// Duo Mode
// ─────────────────────────────────────────────────────────────

const initDuoMode = async () => {
  if (state.duoManager) return; // Already initialized

  const avatarAName = els.avatarASelect.value;
  const avatarBName = els.avatarBSelect.value;

  if (!avatarAName || !avatarBName) {
    updateStatus(els, "Select both avatars for Duo Mode.");
    return;
  }

  updateStatus(els, "Initializing Duo Mode...");

  // Dispose solo head if exists
  if (state.head) {
    disposeHead(state.head);
    updateState({ head: null, headaudio: null });
  }

  const duoManager = new DuoHeadManager({
    container: els.avatar,
    cameraSettings: state.cameraSettings,
    lightingBase: state.stageLightingBase,
    avatarAUrl: resolveAvatarUrl(avatarAName, state.avatarBaseUrl),
    avatarBUrl: resolveAvatarUrl(avatarBName, state.avatarBaseUrl),
    avatarABody: "F",
    avatarBBody: "M",
    spacing: 0.8
  });

  await duoManager.init(updateStageLighting);
  duoManager.start();

  // Set mutual gaze by default
  duoManager.setMutualGaze();

  updateState({
    duoManager,
    avatarAUrl: avatarAName,
    avatarBUrl: avatarBName
  });

  updateStatus(els, `Duo Mode active: ${avatarAName} + ${avatarBName}`);
};

const disposeDuoMode = () => {
  if (state.duoManager) {
    state.duoManager.dispose();
    updateState({ duoManager: null });
  }

  // Restore solo head
  resetHead();
  updateStatus(els, "Solo mode restored.");
};

const reloadDuoAvatars = async () => {
  if (!state.duoMode || !state.duoManager) return;

  // Dispose and reinit with new selections
  state.duoManager.dispose();
  updateState({ duoManager: null });
  await initDuoMode();
};

const initHeadAudio = async () => {
  const head = state.head;
  if (!head || state.headaudio) return;
  const headaudio = await initHeadAudioModule(
    head,
    getDefaultHeadAudioConfig(),
    updateStageLighting
  );
  updateState({ headaudio });
};

const applyLightSettings = () => {
  if (!state.head) return;
  applyLightSettingsModule(state.head, {
    lightPulse: state.lightPulse,
    lightPulseAmount: state.lightPulseAmount,
    stageLightingBase: state.stageLightingBase,
    lightColors: state.lightColors,
    lightPreset: state.lightPreset
  });
};

const applyLightPreset = (presetId: string) => {
  const preset = lightPresets[presetId];
  if (!preset) return;
  updateState({
    lightPreset: presetId,
    stageLightingBase: {
      ambient: preset.ambient,
      direct: preset.direct,
      spot: preset.spot
    },
    lightColors: {
      ambient: preset.ambientColor,
      direct: preset.directColor,
      spot: preset.spotColor
    }
  });
};

const applyCameraSettings = () => {
  if (!state.head) return;
  applyCameraSettingsModule(
    state.head,
    state.cameraSettings,
    els,
    (scene, camera, lights, mode) => setHud(els, scene, camera, lights, mode)
  );
};

const initModelSelectors = async () => {
  const overrides = readOverrides();
  const { registry } = await initModelSelectorsModule(
    {
      llmModelSelect: els.llmModelSelect,
      vlmModelSelect: els.vlmModelSelect,
      directorModelSelect: els.directorModelSelect,
      sttModelSelect: els.sttModelSelect,
      ttsModelSelect: els.ttsModelSelect,
      embedModelSelect: els.embedModelSelect,
      llmRuntimeModelSelect: els.llmRuntimeModelSelect,
      sttChip: els.sttChip,
      chatChip: els.chatChip,
      vlmChip: els.vlmChip,
      llmChip: els.llmChip,
      embedChip: els.embedChip
    },
    config,
    overrides,
    (chip, label, value) => setChip(chip, label, value)
  );
  updateState({ modelRegistry: registry });
};

const setRuntimeStatusText = (text: string) => setRuntimeStatusTextModule(els, text);
const refreshRuntimePanel = () => refreshRuntimePanelModule(els, config.llmBaseUrl);
const unloadRuntimeModel = () => unloadRuntimeModelModule(els, config.llmBaseUrl);
const loadRuntimeModel = () => loadRuntimeModelModule(els, config.llmBaseUrl);

const loadAvatarList = async () => {
  const { avatars, baseUrl } = await loadAvatarListModule(els.avatarSelect);
  if (baseUrl) {
    updateState({ avatarBaseUrl: baseUrl });
  }
  // Also populate Duo Mode avatar selects
  populateAvatarSelects(avatars, els.avatarASelect, els.avatarBSelect);
  // Set initial values in state
  if (avatars.length >= 2) {
    updateState({ avatarAUrl: avatars[0], avatarBUrl: avatars[1] });
  } else if (avatars.length === 1) {
    updateState({ avatarAUrl: avatars[0], avatarBUrl: avatars[0] });
  }
};

const loadAvatar = async () => {
  if (!state.head) return;
  const name = els.avatarSelect.value;
  if (!name) return;
  await loadAvatarModule(
    state.head,
    name,
    state.avatarBaseUrl,
    (message) => updateStatus(els, message),
    (avatarName, songName, status) => updateHero(els, avatarName, songName, status),
    state.audioFile ? state.audioFile.name : undefined
  );
};

const transcribeAudio = async () => {
  if (!state.audioFile) {
    updateStatus(els, "Select an audio file first.");
    return;
  }
  if (!config.audioBaseUrl || !config.sttModel) {
    updateStatus(els, "Missing VITE_MLX_AUDIO_BASE_URL or VITE_MLX_DEFAULT_STT_MODEL.");
    return;
  }

  const { text, wordTimings } = await transcribeAudioFile(
    state.audioFile,
    {
      audioBaseUrl: config.audioBaseUrl,
      sttModel: config.sttModel
    },
    (msg) => updateStatus(els, msg)
  );

  updateState({
    transcriptText: text,
    wordTimings,
    plan: null,
    planSource: "none",
    directorNotes: ""
  });

  els.transcript.value = text;
  setAnalysisOverlay(els, false);
  updateState({
    analysisSegments: resetAnalysisThoughts(els, "Transcript ready. Analyze performance.")
  });
  els.playBtn.disabled = true;
  applyPlanApproved(false);
  renderPlan([]);
  els.heroLyrics.textContent = "Transcript ready. Analyze performance.";
  updateHero(els, undefined, state.audioFile ? state.audioFile.name : undefined, "Transcript Ready");
  updateStatus(els, "Transcript ready. Analyze performance to stage the song.");
};

// fallbackPlan wrapper using imported createFallbackPlan
const fallbackPlan = (durationMs: number, timings: WordTiming | null): MergedPlan =>
  createFallbackPlan(durationMs, timings, state.transcriptText);

const renderPlan = (sections: PlanSection[]) => {
  els.planList.innerHTML = "";
  if (!sections.length) {
    clearPlan(els);
    return;
  }

  const clonePlan = (plan: MergedPlan): MergedPlan => ({
    ...plan,
    sections: plan.sections.map((section) => ({
      ...section,
      actions: section.actions?.map((action) => ({
        ...action,
        args: action.args ? { ...action.args } : undefined
      }))
    })),
    actions: plan.actions?.map((action) => ({
      ...action,
      args: action.args ? { ...action.args } : undefined
    }))
  });

  const updatePlanState = (mutate: (plan: MergedPlan) => void): MergedPlan | null => {
    if (!state.plan) return null;
    const nextPlan = clonePlan(state.plan);
    mutate(nextPlan);
    updateState({ plan: nextPlan });
    return nextPlan;
  };

  const actionTypeOptions = [
    { value: "set_mood", label: "Mood" },
    { value: "play_gesture", label: "Gesture" },
    { value: "make_facial_expression", label: "Emoji" },
    { value: "look_at_camera", label: "LookCam" },
    { value: "speak_break", label: "Break" },
    { value: "set_view", label: "Cam" },
    { value: "set_light_preset", label: "Light" }
  ];

  sections.forEach((section, index) => {
    const node = document.createElement("div");
    node.className = "plan-item plan-section";

    const header = document.createElement("div");
    header.innerHTML = `<strong>${index + 1}. ${section.label}</strong>`;
    const meta = document.createElement("div");
    meta.className = "plan-meta";
    meta.textContent = `${Math.round(section.start_ms / 1000)}s - ${Math.round(section.end_ms / 1000)}s · ${section.role}`;

    const chips = document.createElement("div");
    chips.className = "plan-chips";

    const roleSelect = createSelect(
      "role",
      section.role,
      [
        { value: "solo", label: "Solo" },
        { value: "ensemble", label: "Ensemble" }
      ],
      (next) => {
        const nextPlan = updatePlanState((plan) => {
          plan.sections[index].role = next as "solo" | "ensemble";
        });
        if (!nextPlan) return;
        applyPlanDirty();
        updatePlanDetails(els, nextPlan.sections, state);
        renderPlan(nextPlan.sections);
      }
    );

    const moodSelect = createSelect(
      "mood",
      section.mood || "neutral",
      moods.map((mood) => ({ value: mood, label: `Mood:${mood}` })),
      (next) => {
        const nextPlan = updatePlanState((plan) => {
          plan.sections[index].mood = next as Mood;
        });
        if (!nextPlan) return;
        applyPlanDirty();
        updatePlanDetails(els, nextPlan.sections, state);
      }
    );

    const cameraSelect = createSelect(
      "camera",
      section.camera || state.cameraSettings.view,
      cameraViews.map((view) => ({ value: view, label: `Cam:${view}` })),
      (next) => {
        const nextPlan = updatePlanState((plan) => {
          plan.sections[index].camera = next as CameraView;
        });
        if (!nextPlan) return;
        applyPlanDirty();
        updatePlanDetails(els, nextPlan.sections, state);
      }
    );

    const lightSelect = createSelect(
      "light",
      section.light || state.lightPreset,
      Object.keys(lightPresets).map((key) => ({ value: key, label: `Light:${key}` })),
      (next) => {
        const nextPlan = updatePlanState((plan) => {
          plan.sections[index].light = next as LightPreset;
        });
        if (!nextPlan) return;
        applyPlanDirty();
        updatePlanDetails(els, nextPlan.sections, state);
      }
    );

    chips.appendChild(roleSelect);
    chips.appendChild(moodSelect);
    chips.appendChild(cameraSelect);
    chips.appendChild(lightSelect);

    if (section.actions?.length) {
      section.actions.forEach((action, actionIndex) => {
        const actionWrap = document.createElement("div");
        actionWrap.className = "plan-chips";
        const typeSelect = createSelect(
          "action",
          action.action,
          actionTypeOptions,
          (next) => {
            const nextPlan = updatePlanState((plan) => {
              const target = plan.sections[index].actions?.[actionIndex];
              if (!target) return;
              target.action = next;
              target.args = {};
            });
            if (!nextPlan) return;
            applyPlanDirty();
            renderPlan(nextPlan.sections);
          }
        );
        actionWrap.appendChild(typeSelect);

        if (action.action === "set_mood") {
          actionWrap.appendChild(
            createSelect(
              "mood",
              action.args?.mood as Mood || section.mood || "neutral",
              moods.map((mood) => ({ value: mood, label: mood })),
              (next) => {
                const nextPlan = updatePlanState((plan) => {
                  const target = plan.sections[index].actions?.[actionIndex];
                  if (!target) return;
                  target.args = { ...target.args, mood: next as Mood };
                });
                if (!nextPlan) return;
                applyPlanDirty();
                updatePlanDetails(els, nextPlan.sections, state);
              }
            )
          );
        } else if (action.action === "play_gesture") {
          actionWrap.appendChild(
            createSelect(
              "gesture",
              (action.args?.gesture as string) || (action.args?.name as string) || gestures[0],
              gestures.map((gesture) => ({ value: gesture, label: gesture })),
              (next) => {
                const nextPlan = updatePlanState((plan) => {
                  const target = plan.sections[index].actions?.[actionIndex];
                  if (!target) return;
                  target.args = { ...target.args, gesture: next };
                });
                if (!nextPlan) return;
                applyPlanDirty();
                updatePlanDetails(els, nextPlan.sections, state);
              }
            )
          );
        } else if (action.action === "make_facial_expression") {
          actionWrap.appendChild(
            createInlineInput("Emoji", (action.args?.emoji as string) || "🙂", (next) => {
              const nextPlan = updatePlanState((plan) => {
                const target = plan.sections[index].actions?.[actionIndex];
                if (!target) return;
                target.args = { ...target.args, emoji: next };
              });
              if (!nextPlan) return;
              applyPlanDirty();
              updatePlanDetails(els, nextPlan.sections, state);
            })
          );
        } else if (action.action === "speak_break") {
          actionWrap.appendChild(
            createInlineInput("Break ms", String(action.args?.duration_ms ?? 400), (next) => {
              const nextPlan = updatePlanState((plan) => {
                const target = plan.sections[index].actions?.[actionIndex];
                if (!target) return;
                const ms = Number(next);
                target.args = { ...target.args, duration_ms: Number.isFinite(ms) ? ms : 400 };
              });
              if (!nextPlan) return;
              applyPlanDirty();
              updatePlanDetails(els, nextPlan.sections, state);
            })
          );
        } else if (action.action === "set_view") {
          actionWrap.appendChild(
            createSelect(
              "camera",
              (action.args?.view as CameraView) || section.camera || "upper",
              cameraViews.map((view) => ({ value: view, label: view })),
              (next) => {
                const nextPlan = updatePlanState((plan) => {
                  const target = plan.sections[index].actions?.[actionIndex];
                  if (!target) return;
                  target.args = { ...target.args, view: next as CameraView };
                });
                if (!nextPlan) return;
                applyPlanDirty();
                updatePlanDetails(els, nextPlan.sections, state);
              }
            )
          );
        } else if (action.action === "set_light_preset") {
          actionWrap.appendChild(
            createSelect(
              "light",
              (action.args?.preset as LightPreset) || section.light || state.lightPreset,
              Object.keys(lightPresets).map((key) => ({ value: key, label: key })),
              (next) => {
                const nextPlan = updatePlanState((plan) => {
                  const target = plan.sections[index].actions?.[actionIndex];
                  if (!target) return;
                  target.args = { ...target.args, preset: next as LightPreset };
                });
                if (!nextPlan) return;
                applyPlanDirty();
                updatePlanDetails(els, nextPlan.sections, state);
              }
            )
          );
        }

        chips.appendChild(actionWrap);
      });
    }

    node.appendChild(header);
    node.appendChild(meta);
    node.appendChild(chips);
    if (section.notes) {
      const notes = document.createElement("div");
      notes.className = "plan-meta";
      notes.textContent = section.notes;
      node.appendChild(notes);
    }
    els.planList.appendChild(node);
  });

  updatePlanDetails(els, sections, state);
};

const handleFile = async (file: File) => {
  updateState({
    audioFile: file,
    transcriptText: "",
    plan: null,
    planSource: "none",
    directorNotes: ""
  });
  els.playBtn.disabled = true;
  els.transcript.value = "";
  applyPlanApproved(false);
  setAnalysisOverlay(els, false);
  updateState({
    analysisSegments: resetAnalysisThoughts(els, "Awaiting performance analysis.")
  });
  renderPlan([]);
  updateStatus(els, "Loading audio...");
  resetHead();
  await loadAvatar();
  await initHeadAudio();
  if (state.head) {
    const audioBuffer = await decodeAudioFile(file, state.head.audioCtx);
    updateState({ audioBuffer });
  }
  setChip(els.audioChip, "Audio", `${file.name}`);
  updateHero(els, undefined, file.name);
  els.heroLyrics.textContent = "Audio loaded. Transcribe, then analyze to enable performance.";
  updateStatus(els, "Audio loaded. Transcribe, then analyze to continue.");
};

const init = async () => {
  // Initialize elements from the DOM
  els = getElements();
  bindStateUi();
  const audioController = createAudioController({
    els,
    config,
    getState: () => state,
    updateState,
    updateStatus: (message) => updateStatus(els, message)
  });
  analysisController = createAnalysisController({
    els,
    config,
    getState: () => state,
    updateState,
    decodeAudio: decodeAudioFile,
    applyPlanApproved,
    renderPlan,
    enqueueAnalysisVoice: audioController.enqueueAnalysisVoice,
    buildWordTimings,
    directorModelFallback
  });
  performanceController = createPerformanceController({
    els,
    effectsManager,
    useEngine: engineLabEnabled,
    getState: () => state,
    updateState,
    ensureAudioContext: audioController.ensureAudioContext,
    ensureLipsync,
    buildVisemeTimings,
    buildWordTimings,
    encodeWords,
    fallbackPlan,
    renderPlan,
    updateStatus: (message) => updateStatus(els, message),
    updateHero: (avatarName, songName, sectionLabel) =>
      updateHero(els, avatarName, songName, sectionLabel),
    setHud: (scene, camera, lights, mode) => setHud(els, scene, camera, lights, mode),
    startLyricsOverlay: () =>
      updateLyricsOverlay(
        () => state,
        els,
        (partial) => updateState(partial)
      ),
    randomItem,
    gestures,
    lightPresets,
    applyLightPreset,
    applyCameraSettings,
    updateCameraSettings: (partial) =>
      updateState({ cameraSettings: { ...state.cameraSettings, ...partial } })
  });

  // Initial fetches
  // TTS Disabled as per user request
  await initTtsSelectors(
    {
      els,
      config,
      getState: () => state,
      updateState,
      setOverride
    },
    { autoFetch: false }
  );

  await bootstrapStage({
    els,
    config,
    directorModelFallback,
    getLightLabel: (presetId) => lightPresets[presetId]?.label || presetId,
    getState: () => state,
    updateState,
    applyPlanApproved,
    initControls: () => initControlsModule({ els, getState: () => state, updateState }),
    initModelSelectors,
    refreshRuntimePanel,
    setRuntimeStatusText,
    loadAvatarList,
    resetHead,
    loadAvatar,
    initHeadAudio,
    initLipsync,
    decodeAudioFile,
    handleFile,
    transcribeAudio,
    analyzePerformance,
    performSong,
    stopPerformance,
    bindControls: () =>
      bindControlsModule({
        els,
        getState: () => state,
        updateState,
        config,
        setOverride,
        setChip,
        updateStatus: (message) => updateStatus(els, message),
        applyPlanApproved,
        refreshRuntimePanel,
        unloadRuntimeModel,
        loadRuntimeModel,
        setRuntimeStatusText,
        // Duo Mode callbacks
        onDuoMutualGaze: () => {
          if (state.duoManager) {
            state.duoManager.setMutualGaze();
            updateStatus(els, "Avatars facing each other.");
          }
        },
        onDuoFaceCamera: () => {
          if (state.duoManager) {
            state.duoManager.setFaceCamera();
            updateStatus(els, "Avatars facing camera.");
          }
        },
        onDuoTestA: () => {
          if (state.duoManager) {
            state.duoManager.setMood("avatar_a", "happy");
            state.duoManager.playGesture("avatar_a", "handup", 2.5);
            updateStatus(els, "Avatar A: wave gesture");
          }
        },
        onDuoTestB: () => {
          if (state.duoManager) {
            state.duoManager.setMood("avatar_b", "happy");
            state.duoManager.playGesture("avatar_b", "thumbup", 2.5);
            updateStatus(els, "Avatar B: thumbs up gesture");
          }
        }
      }),
    setHud: (scene, camera, lights, mode) => setHud(els, scene, camera, lights, mode),
    setChip: (chip, label, value) => setChip(chip, label, value),
    updateHero: (avatarName, songName, status) =>
      updateHero(els, avatarName, songName, status),
    updateStatus: (message) => updateStatus(els, message),
    speakWithLipsync
  });

  initPerformanceLibrary({
    els,
    config,
    getState: () => state,
    updateState,
    decodeAudioFile,
    applyPlanApproved,
    renderPlan,
    setAnalysisOverlay: (active, step) => setAnalysisOverlay(els, active, step),
    setChip,
    updateHero: (avatarName, songName, status) =>
      updateHero(els, avatarName, songName, status),
    updateStatus: (message) => updateStatus(els, message),
    setOverride
  });

  // Initialize Timeline Editor (Engine Lab only)
  if (engineLabEnabled) {
    initTimelineEditor();
  }
};

// ─────────────────────────────────────────────────────────────
// Timeline Editor Integration
// ─────────────────────────────────────────────────────────────

let timelineEditor: TimelineEditor | null = null;
let currentTimeline: Timeline | null = null;
let timelineUpdateId = 0;
let danceLibraryReady: Promise<void> | null = null;

const ensureDanceLibrary = async () => {
  if (!danceLibraryReady) {
    danceLibraryReady = initDanceLibrary().then(() => undefined);
  }
  await danceLibraryReady;
};

const getPlanDuration = (plan: MergedPlan, fallbackMs: number) => {
  if (!plan.sections.length) return fallbackMs;
  const planEnd = plan.sections.reduce((max, section) => Math.max(max, section.end_ms), 0);
  return Math.max(planEnd || 0, fallbackMs);
};

const buildDanceBlocks = async (plan: MergedPlan, durationMs: number) => {
  await ensureDanceLibrary();
  const director = getDanceDirector();
  const blocks: Timeline["blocks"] = [];

  const toDanceBlock = (action: PlanAction) => {
    const args = action.args || {};
    const url = typeof args.url === "string" ? args.url : "";
    if (!url) return null;

    const start_ms = Math.max(0, Math.min(durationMs - 1, Math.round(action.time_ms)));
    const remaining = Math.max(0, durationMs - start_ms);
    if (remaining < 200) return null;

    const rawDuration = Math.round(
      typeof args.duration === "number"
        ? args.duration * 1000
        : typeof args.duration_ms === "number"
        ? args.duration_ms
        : 2500
    );
    const duration_ms = Math.min(remaining, Math.max(200, rawDuration));

    const data = {
      clipId: (args.name as string) || url,
      clipUrl: url,
      speed: typeof args.speed === "number" ? args.speed : undefined,
      mirror: typeof args.mirror === "boolean" ? args.mirror : undefined,
      loop: typeof args.loop === "boolean" ? args.loop : undefined,
    };

    return createBlock("dance", "dance", start_ms, duration_ms, data, `anim:${data.clipId}`);
  };

  for (const section of plan.sections) {
    const sectionDuration = section.end_ms - section.start_ms;
    let density: "sparse" | "normal" | "dense" = "normal";
    if (sectionDuration < 7000) density = "sparse";
    if (sectionDuration > 20000) density = "dense";

    const actions = director.generateDanceActions(section.start_ms, section.end_ms, density);
    for (const action of actions) {
      const block = toDanceBlock(action);
      if (block) blocks.push(block);
    }
  }

  return blocks;
};

const buildVisemeBlock = async (durationMs: number) => {
  if (!state.audioBuffer || !state.transcriptText) return null;
  if (!state.head) return null;

  const timings =
    state.wordTimings ||
    buildWordTimings(encodeWords(state.transcriptText), durationMs);
  if (!timings.words.length) return null;

  await ensureLipsync(state.head);
  const visemeTimings = buildVisemeTimings(state.head, timings);
  const hasVisemes = visemeTimings.visemes.length > 0;

  const data = {
    source: "audio",
    text: state.transcriptText,
    wordTimings: timings,
    visemeMapping: hasVisemes ? visemeTimings : undefined,
  };

  return createBlock("viseme", "viseme", 0, durationMs, data, "Lipsync");
};

const initTimelineEditor = () => {
  const container = document.getElementById("timelineContainer");
  if (!container) {
    console.warn("Timeline container not found");
    return;
  }

  timelineEditor = createTimelineEditor(container, {
    basePixelsPerMs: 0.03,
    trackHeight: 44,
    headerWidth: 100,
    showRuler: true,
    showMarkers: true,
    enableSelection: true,
    enableDragging: true,
  });

  // Listen for playhead seek events
  timelineEditor.on("playhead:seek", (event) => {
    if (event.time_ms !== undefined) {
      console.log("[Timeline] Seek to:", event.time_ms);
      // Could integrate with audio playback here
    }
  });

  timelineEditor.on("play", () => {
    if (!state.performing) {
      void performSong();
    }
  });

  timelineEditor.on("pause", () => {
    if (state.performing) {
      stopPerformance();
    }
  });

  timelineEditor.on("stop", () => {
    if (state.performing) {
      stopPerformance();
    }
  });

  // Save/Export/Import handlers
  timelineEditor.on("save", (event) => {
    if (event.timeline) {
      saveTimeline(event.timeline);
      updateStatus(els, "Timeline saved");
    }
  });

  timelineEditor.on("export", (event) => {
    if (event.timeline) {
      exportTimelineAsFile(event.timeline);
      updateStatus(els, "Timeline exported");
    }
  });

  timelineEditor.on("import", async (event) => {
    if (event.file) {
      const imported = await importTimelineFromFile(event.file);
      if (imported && timelineEditor) {
        currentTimeline = imported;
        timelineEditor.setTimeline(imported);
        updateStatus(els, `Imported: ${imported.name}`);
      } else {
        updateStatus(els, "Failed to import timeline");
      }
    }
  });

  // Wire up overlay buttons
  const saveBtn = document.getElementById("timelineSaveBtn");
  const exportBtn = document.getElementById("timelineExportBtn");
  const importBtn = document.getElementById("timelineImportBtn");

  saveBtn?.addEventListener("click", () => {
    if (currentTimeline) {
      saveTimeline(currentTimeline);
      updateStatus(els, "Timeline saved");
    }
  });

  exportBtn?.addEventListener("click", () => {
    if (currentTimeline) {
      exportTimelineAsFile(currentTimeline);
      updateStatus(els, "Timeline exported");
    }
  });

  importBtn?.addEventListener("click", () => {
    // Create hidden file input for import
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (file) {
        const imported = await importTimelineFromFile(file);
        if (imported && timelineEditor) {
          currentTimeline = imported;
          timelineEditor.setTimeline(imported);
          updateStatus(els, `Imported: ${imported.name}`);
        } else {
          updateStatus(els, "Failed to import timeline");
        }
      }
    };
    input.click();
  });

  // Subscribe to plan changes to update timeline
  stateManager.subscribe((nextState, changed) => {
    if (changed.plan !== undefined && nextState.plan) {
      void updateTimelineFromPlan(nextState.plan);
    }
  });

  // Try to load last saved timeline, otherwise create demo
  const savedTimeline = loadCurrentTimeline();
  if (savedTimeline) {
    currentTimeline = savedTimeline;
    timelineEditor.setTimeline(savedTimeline);
    console.log("[Timeline] Loaded saved timeline:", savedTimeline.name);
  } else if (!state.plan) {
    createDemoTimeline();
  }

  console.log("[Engine Lab] Timeline Editor initialized");
};

const updateTimelineFromPlan = async (plan: MergedPlan) => {
  if (!timelineEditor) return;

  const updateId = ++timelineUpdateId;
  const audioDuration = state.audioBuffer
    ? Math.round(state.audioBuffer.duration * 1000)
    : 0;
  const planDuration = getPlanDuration(plan, 30000);
  const durationMs = Math.max(audioDuration, planDuration, 1000);

  const { timeline } = directorPlanToTimeline(plan, {
    durationMs,
    defaultCameraView: "upper",
    defaultLightPreset: "neon",
    defaultMood: "neutral",
  });

  const extraBlocks: Timeline["blocks"] = [];

  if (!timeline.blocks.some((block) => block.layerType === "viseme")) {
    const visemeBlock = await buildVisemeBlock(durationMs);
    if (visemeBlock) extraBlocks.push(visemeBlock);
  }

  if (!timeline.blocks.some((block) => block.layerType === "dance")) {
    const danceBlocks = await buildDanceBlocks(plan, durationMs);
    extraBlocks.push(...danceBlocks);
  }

  if (updateId !== timelineUpdateId || !timelineEditor) return;

  if (extraBlocks.length > 0) {
    timeline.blocks = [...timeline.blocks, ...extraBlocks].sort(
      (a, b) => a.start_ms - b.start_ms
    );
  }
  timeline.duration_ms = durationMs;

  currentTimeline = timeline;
  timelineEditor.setTimeline(timeline);
  console.log("[Timeline] Updated from plan:", timeline.blocks.length, "blocks");
};

const createDemoTimeline = () => {
  if (!timelineEditor) return;

  const timeline = createTimeline("Demo Performance", 30000);

  // Add demo blocks for each layer
  timeline.blocks.push(
    createBlock("blendshape", "blendshape", 0, 8000, { mood: "happy" }, "Happy"),
    createBlock("blendshape", "blendshape", 10000, 6000, { mood: "love" }, "Love"),
    createBlock("blendshape", "blendshape", 20000, 8000, { mood: "neutral" }, "Neutral"),

    createBlock("emoji", "emoji", 4000, 1500, { emoji: "😊" }, "emoji:😊"),

    createBlock("camera", "camera", 0, 10000, { view: "head", movement: "static" }, "Head"),
    createBlock("camera", "camera", 10000, 10000, { view: "upper", movement: "static" }, "Upper"),
    createBlock("camera", "camera", 20000, 10000, { view: "mid", movement: "orbit", orbit: 30 }, "Orbit"),

    createBlock("lighting", "lighting", 0, 15000, { preset: "neon", transition: "fade" }, "Neon"),
    createBlock("lighting", "lighting", 15000, 15000, { preset: "sunset", transition: "fade" }, "Sunset"),

    createBlock("fx", "fx", 5000, 3000, { effect: "bloom", params: { strength: 1.5 } }, "Bloom"),
    createBlock("fx", "fx", 18000, 4000, { effect: "vignette", params: { darkness: 0.5 } }, "Vignette")
  );

  // Add markers
  timeline.markers.push(
    { id: "m1", time_ms: 0, label: "Intro", color: "#4CAF50", snapPoint: true },
    { id: "m2", time_ms: 10000, label: "Verse", color: "#2196F3", snapPoint: true },
    { id: "m3", time_ms: 20000, label: "Chorus", color: "#FF9800", snapPoint: true }
  );

  currentTimeline = timeline;
  timelineEditor.setTimeline(timeline);
  console.log("[Timeline] Demo timeline created");
};

init().catch((error) => {
  console.error(error);
  updateStatus(els, "Stage init failed.");
});
