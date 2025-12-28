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
  PlanSection,
  WordTiming
} from "./directors/types";
import { ConversationManager, ConversationMode } from "./chat/conversation-manager";

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
  findAvatarEntry
} from "./avatar/index";
import type { AvatarManifestEntry } from "./avatar/index";
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

// Types now imported from ./stage/types: StageState

// State manager for staged migration off direct state mutations
const stateManager = createStateManager();
let state = stateManager.getState();
stateManager.subscribe((nextState) => {
  state = nextState;
});
const updateState = (partial: Partial<StageState>) => stateManager.update(partial);
let avatarManifest: AvatarManifestEntry[] = [];

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
  avatarManifest = avatars;
  if (baseUrl) {
    updateState({ avatarBaseUrl: baseUrl });
  }
};

const loadAvatar = async () => {
  if (!state.head) return;
  const name = els.avatarSelect.value;
  if (!name) return;
  const avatarEntry = findAvatarEntry(avatarManifest, name);
  await loadAvatarModule(
    state.head,
    name,
    state.avatarBaseUrl,
    (message) => updateStatus(els, message),
    (avatarName, songName, status) => updateHero(els, avatarName, songName, status),
    state.audioFile ? state.audioFile.name : undefined,
    avatarEntry
  );
  if (avatarEntry?.voice_id) {
    const voiceId = avatarEntry.voice_id;
    const hasVoice = Array.from(els.voiceSelect.options).some(
      (option) => option.value === voiceId
    );
    if (!hasVoice) {
      const option = document.createElement("option");
      option.value = voiceId;
      option.textContent = voiceId;
      els.voiceSelect.appendChild(option);
    }
    els.voiceSelect.value = voiceId;
    config.ttsVoice = voiceId;
    setOverride("ttsVoice", voiceId);
  }
  if (conversationManager && state.head) {
      conversationManager.setHead(state.head);
  }
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

const getConversationElements = () => ({
  startSessionBtn: document.getElementById("startSessionBtn") as HTMLButtonElement,
  stopSessionBtn: document.getElementById("stopSessionBtn") as HTMLButtonElement,
  pushModeBtn: document.getElementById("pushModeBtn") as HTMLButtonElement,
  vadModeBtn: document.getElementById("vadModeBtn") as HTMLButtonElement,
  recordBtn: document.getElementById("recordBtn") as HTMLButtonElement,
  vadThreshold: document.getElementById("vadThreshold") as HTMLInputElement,
  vadSilence: document.getElementById("vadSilence") as HTMLInputElement,
  levelMeter: document.getElementById("levelMeter") as HTMLElement,
  chatLog: document.getElementById("chatLog") as HTMLElement,
});

let conversationManager: ConversationManager;

const initConversationControls = () => {
   const cEls = getConversationElements();
   
   conversationManager = new ConversationManager({
       onStatusUpdate: (text) => updateStatus(els, text),
       onLogMessage: (role, text) => {
           const bubble = document.createElement("div");
           bubble.style.padding = "4px 8px";
           bubble.style.borderRadius = "4px";
           bubble.style.marginBottom = "4px";
           bubble.style.background = role === "user" ? "rgba(255,255,255,0.1)" : role === "assistant" ? "rgba(91, 242, 214, 0.1)" : "rgba(255, 179, 71, 0.1)";
           bubble.style.color = role === "assistant" ? "#5bf2d6" : role === "tool" ? "#ffb347" : "#fff";
           bubble.textContent = `[${role}] ${text}`;
           cEls.chatLog.appendChild(bubble);
           cEls.chatLog.scrollTop = cEls.chatLog.scrollHeight;
       },
       onModeChange: (mode, isRecording) => {
           cEls.pushModeBtn.classList.toggle("primary", mode === "push");
           cEls.vadModeBtn.classList.toggle("primary", mode === "vad");
           cEls.recordBtn.textContent = mode === "push" ? (isRecording ? "Release to Send" : "Hold to Talk") : (isRecording ? "Listening..." : "Auto-VAD Active");
           cEls.recordBtn.disabled = mode === "vad"; // In VAD mode, button is just status
       },
       onAudioLevel: (rms) => {
           const percent = Math.min(Math.max((rms * 200) * 100, 0), 100);
           cEls.levelMeter.style.width = `${percent}%`;
       }
   });

   cEls.startSessionBtn.addEventListener("click", async () => {
       await conversationManager.startSession();
       cEls.startSessionBtn.disabled = true;
       cEls.stopSessionBtn.disabled = false;
       cEls.recordBtn.disabled = false;
       // Ensure head is set
       if (state.head) conversationManager.setHead(state.head);
   });

   cEls.stopSessionBtn.addEventListener("click", async () => {
       await conversationManager.stopSession();
       cEls.startSessionBtn.disabled = false;
       cEls.stopSessionBtn.disabled = true;
       cEls.recordBtn.disabled = true;
   });

   cEls.pushModeBtn.addEventListener("click", () => conversationManager.setMode("push"));
   cEls.vadModeBtn.addEventListener("click", () => conversationManager.setMode("vad"));

   // Push-to-talk logic
   const startRec = () => conversationManager.startRecording("manual");
   const stopRec = () => conversationManager.stopRecording();
   
   cEls.recordBtn.addEventListener("pointerdown", startRec);
   cEls.recordBtn.addEventListener("pointerup", stopRec);
   cEls.recordBtn.addEventListener("pointerleave", stopRec);

   cEls.vadThreshold.addEventListener("input", () => {
       conversationManager.setVadSettings(Number(cEls.vadThreshold.value), Number(cEls.vadSilence.value));
   });
   cEls.vadSilence.addEventListener("input", () => {
       conversationManager.setVadSettings(Number(cEls.vadThreshold.value), Number(cEls.vadSilence.value));
   });
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
        setRuntimeStatusText
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

  initConversationControls();
};

init().catch((error) => {
  console.error(error);
  updateStatus(els, "Stage init failed.");
});
