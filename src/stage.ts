import { TalkingHead } from "@met4citizen/talkinghead";
import { HeadAudio } from "@met4citizen/headaudio/dist/headaudio.min.mjs";
import { initLipsync, speakWithLipsync } from "./modules/lipsync";
import { getMlxConfig, setOverride, readOverrides } from "./mlx-config";
import { createAnalysisController } from "./stage/analysis";
import type {
  MergedPlan,
  CameraView,
  Mood,
  LightPreset,
  PlanSection,
  WordTiming
} from "./directors/types";

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
  type RegistryModel,
  type ModelRuntimeStatus,
  type StageState
} from "./stage/index";
import {
  ensureLipsync,
  buildVisemeTimings,
  decodeAudio as decodeAudioFile,
  transcribeAudio as transcribeAudioFile
} from "./avatar/index";
import {
  updateStageLighting as updateStageLightingModule,
  applyLightPreset as applyLightPresetModule,
  applyLightSettings as applyLightSettingsModule,
  updateSliderReadouts as updateSliderReadoutsModule
} from "./scene/lighting";
import {
  applyCameraSettings as applyCameraSettingsModule,
  getCameraSettingsFromInputs
} from "./scene/camera";
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
  truncateForVoice,
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

// Types now imported from ./stage/types: RegistryModel, ModelRuntimeStatus, StageState

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

const ensureAudioContext = async (contextLabel: string) => {
  if (!state.head) return false;
  if (state.head.audioCtx.state === "running") return true;
  try {
    await state.head.audioCtx.resume();
  } catch {
    // Resume requires a user gesture.
  }
  if (state.head.audioCtx.state !== "running") {
    updateStatus(els, `Audio blocked. Click ${contextLabel} again to enable audio.`);
    return false;
  }
  return true;
};

const playAnalysisVoice = async (text: string) => {
  if (!config.audioBaseUrl || !config.ttsModel) {
    els.analysisHint.textContent = "Voiceover disabled (missing TTS model).";
    return;
  }
  if (!state.head) {
    els.analysisHint.textContent = "Voiceover unavailable (avatar not ready).";
    return;
  }
  const unlocked = await ensureAudioContext("Analyze");
  if (!unlocked) {
    els.analysisHint.textContent = "Click Analyze again to enable voiceover.";
    return;
  }

  const response = await fetch(`${config.audioBaseUrl}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.ttsModel,
      input: text,
      voice: config.ttsVoice || "default",
      response_format: "wav",
      speed: 1.0
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`TTS error (${response.status}): ${detail}`);
  }

  const buffer = await response.arrayBuffer();
  const audioBuffer = await state.head.audioCtx.decodeAudioData(buffer.slice(0));
  const source = state.head.audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(state.head.audioCtx.destination);
  els.analysisHint.textContent = "Voiceover playing...";
  await new Promise<void>((resolve) => {
    source.onended = () => resolve();
    source.start(0);
  });
};

const enqueueAnalysisVoice = (text: string) => {
  const trimmed = truncateForVoice(text);
  if (!trimmed) return;
  const nextQueue = state.analysisVoiceQueue
    .then(() => playAnalysisVoice(trimmed))
    .catch(() => {
      els.analysisHint.textContent = "Voiceover unavailable.";
    });
  updateState({ analysisVoiceQueue: nextQueue });
};

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

// ensureLipsync and buildVisemeTimings are now imported from ./avatar/index

const createHead = () => {
  const head = new TalkingHead(els.avatar, {
    ttsEndpoint: "N/A",
    lipsyncLang: "en",
    lipsyncModules: [],
    cameraView: "upper",
    cameraDistance: state.cameraSettings.distance,
    cameraX: state.cameraSettings.x,
    cameraY: state.cameraSettings.y,
    cameraRotateX: state.cameraSettings.rotateX,
    cameraRotateY: state.cameraSettings.rotateY,
    cameraRotateEnable: true,
    mixerGainSpeech: 3,
    lightAmbientIntensity: state.stageLightingBase.ambient,
    lightDirectIntensity: state.stageLightingBase.direct,
    lightSpotIntensity: state.stageLightingBase.spot
  });
  if (head.controls) {
    head.controls.autoRotate = state.cameraSettings.autoRotate;
    head.controls.autoRotateSpeed = state.cameraSettings.autoRotateSpeed;
  }
  ensureLipsync(head).catch(() => null);
  return head;
};

const resetHead = () => {
  if (state.head && typeof state.head.dispose === "function") {
    state.head.dispose();
  }
  const head = createHead();
  updateState({ head, headaudio: null, audioBuffer: null });
};

const initHeadAudio = async () => {
  const head = state.head;
  if (!head || state.headaudio) return;
  await head.audioCtx.audioWorklet.addModule(workletUrl);
  const headaudio = new HeadAudio(head.audioCtx, {
    processorOptions: {
      visemeEventsEnabled: true
    }
  });
  updateState({ headaudio });
  await headaudio.loadModel(modelUrl);
  head.audioSpeechGainNode.connect(headaudio);
  headaudio.onvalue = (key, value) => {
    if (head.mtAvatar?.[key]) {
      Object.assign(head.mtAvatar[key], { newvalue: value, needsUpdate: true });
    }
  };

  const originalUpdate = head.opt.update;
  head.opt.update = (dt: number) => {
    if (state.headaudio) {
      state.headaudio.update(dt);
    }
    if (originalUpdate) {
      originalUpdate(dt);
    }
    updateStageLighting(head, dt);
  };
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

const updateSliderReadouts = () => {
  updateSliderReadoutsModule(els);
};

const applyLightPreset = (presetId: string) => {
  const result = applyLightPresetModule(
    presetId,
    state.head,
    els,
    {
      lightPulse: state.lightPulse,
      lightPulseAmount: state.lightPulseAmount,
      stageLightingBase: state.stageLightingBase,
      lightColors: state.lightColors,
      lightPreset: state.lightPreset
    },
    () => updateSliderReadoutsModule(els),
    (scene, camera, lights, mode) => setHud(els, scene, camera, lights, mode)
  );
  if (result) {
    updateState({
      lightPreset: result.lightPreset,
      stageLightingBase: result.stageLightingBase,
      lightColors: result.lightColors
    });
  }
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

const loadModelRegistry = async () => {
  try {
    const response = await fetch("/models/registry.json");
    if (!response.ok) return [];
    const payload = await response.json();
    const models = Array.isArray(payload.models) ? payload.models : [];
    updateState({ modelRegistry: models });
    return models;
  } catch {
    return [];
  }
};

const modelLabel = (model: RegistryModel) => {
  const desc = model.description ? ` - ${model.description}` : "";
  return `${model.id}${desc}`;
};

const buildAvatarManifestCandidates = (): string[] => {
  const override = import.meta.env.VITE_AVATAR_MANIFEST_URL as string | undefined;
  const base = import.meta.env.BASE_URL || "/";
  const candidates = [
    override,
    `${base}avatars/manifest.json`,
    "avatars/manifest.json",
    "/avatars/manifest.json"
  ].filter((value): value is string => Boolean(value));
  return candidates.map((path) => new URL(path, window.location.href).toString());
};

const resolveAvatarUrl = (name: string) => {
  if (state.avatarBaseUrl) {
    return new URL(name, state.avatarBaseUrl).toString();
  }
  return new URL(`avatars/${name}`, window.location.href).toString();
};

const trimModelId = (value?: string | null) => {
  if (!value) return "-";
  if (value.length <= 52) return value;
  return `${value.slice(0, 24)}...${value.slice(-18)}`;
};

const setRuntimeStatusText = (text: string) => {
  els.llmRuntimeStatus.textContent = text;
};

const setRuntimeValue = (el: HTMLElement, value: string, title?: string | null) => {
  el.textContent = value;
  if (title) {
    el.title = title;
  } else {
    el.removeAttribute("title");
  }
};

const filterModels = (capability: string) =>
  state.modelRegistry.filter((model) => Array.isArray(model.capabilities) && model.capabilities.includes(capability));

const isWhisperModel = (model: RegistryModel) => {
  const id = (model.id || "").toLowerCase();
  const desc = (model.description || "").toLowerCase();
  return id.includes("whisper") || desc.includes("whisper");
};

const isTtsModel = (model: RegistryModel) => {
  const id = (model.id || "").toLowerCase();
  const type = (model.type || "").toLowerCase();
  const desc = (model.description || "").toLowerCase();
  if (type.includes("text-to-speech") || desc.includes("text-to-speech")) {
    return true;
  }
  return id.includes("tts") || id.includes("chatterbox") || id.includes("kokoro");
};

const dedupeModels = (models: RegistryModel[]) => {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
};

const populateModelSelect = (select: HTMLSelectElement, models: RegistryModel[], selected?: string) => {
  select.innerHTML = "";
  if (!models.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No models found";
    select.appendChild(option);
    return;
  }
  models.forEach((model) => {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = modelLabel(model);
    select.appendChild(option);
  });
  if (selected) {
    const match = models.find((model) => model.id === selected);
    if (match) {
      select.value = selected;
    }
  }
};

const initModelSelectors = async () => {
  await loadModelRegistry();
  const overrides = readOverrides();
  const llmModels = filterModels("chat");
  const sttModels = dedupeModels([
    ...filterModels("audio-transcribe"),
    ...state.modelRegistry.filter((model) => isWhisperModel(model))
  ]);
  const ttsCandidates = filterModels("audio-generate");
  const ttsModels = ttsCandidates.filter((model) => isTtsModel(model));

  const llmDefault = overrides.llmModel || config.llmModel || "";
  const directorDefault = overrides.directorModel || config.directorModel || directorModelFallback;
  const sttDefault = overrides.sttModel || config.sttModel || "";
  const ttsDefault = overrides.ttsModel || config.ttsModel || "";

  populateModelSelect(els.llmModelSelect, llmModels, llmDefault);
  populateModelSelect(els.directorModelSelect, llmModels, directorDefault);
  populateModelSelect(els.llmRuntimeModelSelect, llmModels, directorDefault || llmDefault);
  populateModelSelect(els.sttModelSelect, sttModels, sttDefault);
  // populateModelSelect(els.ttsModelSelect, ttsModels, ttsDefault); // This will be handled by new fetchTtsModels/populateModelSelect

  if (llmDefault) {
    config.llmModel = llmDefault;
    setChip(els.chatChip, "Chat", llmDefault);
  }
  if (directorDefault) {
    config.directorModel = directorDefault;
    setChip(els.llmChip, "LLM", directorDefault);
  }
  if (sttDefault) {
    config.sttModel = sttDefault;
    setChip(els.sttChip, "STT", sttDefault);
  }
  if (ttsDefault) {
    config.ttsModel = ttsDefault;
  }
};

const fetchModelRuntimeStatus = async (): Promise<ModelRuntimeStatus | null> => {
  if (!config.llmBaseUrl) return null;
  const statusUrl = `${config.llmBaseUrl}/internal/models/status`;
  const diagnosticsUrl = `${config.llmBaseUrl}/internal/diagnostics`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(statusUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (response.ok) {
      return await response.json();
    }
    if (response.status !== 404) {
      throw new Error(`Status endpoint error (${response.status})`);
    }
  } catch {
    // fall through to diagnostics
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(diagnosticsUrl, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) {
      throw new Error(`Diagnostics endpoint error (${response.status})`);
    }
    const diagnostics = await response.json();
    return {
      status: diagnostics.status,
      loaded: diagnostics.handler_initialized,
      model_id: diagnostics.loaded_model?.model_id,
      model_path: diagnostics.loaded_model?.model_path,
      model_type: diagnostics.loaded_model?.model_type,
      queue: diagnostics.queue || null,
      config: diagnostics.config || null
    };
  } catch {
    return null;
  }
};

const updateRuntimePanel = (status: ModelRuntimeStatus | null) => {
  if (!status) {
    setRuntimeValue(els.llmRuntimeLoaded, "Unavailable");
    setRuntimeValue(els.llmRuntimeType, "-");
    setRuntimeValue(els.llmRuntimeModel, "-");
    setRuntimeValue(els.llmRuntimeQueue, "-");
    setRuntimeValue(els.llmRuntimeActive, "-");
    setRuntimeValue(els.llmRuntimeConfig, "-");
    setRuntimeStatusText("LLM diagnostics unavailable.");
    return;
  }

  const loaded = status.loaded ? "Loaded" : "Not loaded";
  const modelId = status.model_id || status.model_path || "";
  const modelType = status.model_type || "-";
  const queueStats = status.queue?.queue_stats;
  const activeRequests = queueStats?.active_requests ?? 0;
  const queued = queueStats?.queue_size ?? 0;
  const activeStreams = status.queue?.active_streams ?? 0;
  const configBits = [];

  if (status.config?.max_concurrency != null) {
    configBits.push(`max:${status.config.max_concurrency}`);
  }
  if (status.config?.queue_size != null) {
    configBits.push(`q:${status.config.queue_size}`);
  }
  if (status.config?.queue_timeout != null) {
    configBits.push(`timeout:${status.config.queue_timeout}s`);
  }
  if (typeof status.config?.mlx_warmup === "boolean") {
    configBits.push(status.config.mlx_warmup ? "warmup:on" : "warmup:off");
  }

  setRuntimeValue(els.llmRuntimeLoaded, loaded);
  setRuntimeValue(els.llmRuntimeType, modelType);
  setRuntimeValue(els.llmRuntimeModel, trimModelId(modelId), modelId || null);
  setRuntimeValue(els.llmRuntimeQueue, `${activeRequests} active / ${queued} queued`);
  setRuntimeValue(els.llmRuntimeActive, `${activeStreams} streams`);
  setRuntimeValue(els.llmRuntimeConfig, configBits.length ? configBits.join(" | ") : "-");
  setRuntimeStatusText("LLM status updated.");
};

const setRuntimeBusy = (busy: boolean) => {
  els.llmRuntimeRefresh.disabled = busy;
  els.llmRuntimeUnload.disabled = busy;
  els.llmRuntimeLoad.disabled = busy;
};

const refreshRuntimePanel = async () => {
  if (!config.llmBaseUrl) {
    updateRuntimePanel(null);
    setRuntimeStatusText("Missing LLM base URL.");
    return;
  }
  setRuntimeBusy(true);
  setRuntimeStatusText("Refreshing...");
  const status = await fetchModelRuntimeStatus();
  updateRuntimePanel(status);
  setRuntimeBusy(false);
};

const unloadRuntimeModel = async () => {
  if (!config.llmBaseUrl) {
    setRuntimeStatusText("Missing LLM base URL.");
    return;
  }
  setRuntimeBusy(true);
  setRuntimeStatusText("Unloading model...");
  const response = await fetch(`${config.llmBaseUrl}/internal/models/unload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ force: els.llmRuntimeForce.checked })
  });
  if (!response.ok) {
    const detail = await response.text();
    setRuntimeStatusText(`Unload failed (${response.status}): ${detail}`);
    setRuntimeBusy(false);
    return;
  }
  await refreshRuntimePanel();
  setRuntimeBusy(false);
};

const loadRuntimeModel = async () => {
  if (!config.llmBaseUrl) {
    setRuntimeStatusText("Missing LLM base URL.");
    return;
  }
  const modelId = els.llmRuntimeModelSelect.value;
  if (!modelId) {
    setRuntimeStatusText("Select a model to load.");
    return;
  }
  setRuntimeBusy(true);
  setRuntimeStatusText(`Loading ${modelId}...`);
  const response = await fetch(`${config.llmBaseUrl}/internal/models/load`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model_id: modelId, force: els.llmRuntimeForce.checked })
  });
  if (!response.ok) {
    const detail = await response.text();
    setRuntimeStatusText(`Load failed (${response.status}): ${detail}`);
    setRuntimeBusy(false);
    return;
  }
  await refreshRuntimePanel();
  setRuntimeBusy(false);
};

const loadAvatarList = async () => {
  const manifestUrls = buildAvatarManifestCandidates();
  let response: Response | null = null;
  let manifestUrl = "";

  for (const candidate of manifestUrls) {
    try {
      const attempt = await fetch(candidate, { cache: "no-store" });
      if (attempt.ok) {
        response = attempt;
        manifestUrl = candidate;
        break;
      }
    } catch {
      // Try next candidate.
    }
  }

  if (!response) {
    throw new Error(`Failed to load avatar manifest. Tried: ${manifestUrls.join(", ")}`);
  }

  const data = await response.json();
  const avatars = Array.isArray(data.avatars) ? data.avatars : [];
  els.avatarSelect.innerHTML = "";
  avatars.forEach((name: string) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name.replace(/\.glb$/i, "");
    els.avatarSelect.appendChild(option);
  });
  if (avatars.length) {
    els.avatarSelect.value = avatars[0];
  }
  if (manifestUrl) {
    updateState({ avatarBaseUrl: new URL(".", manifestUrl).toString() });
  }
};

const loadAvatar = async () => {
  if (!state.head) return;
  const name = els.avatarSelect.value;
  if (!name) return;
  updateStatus(els, `Loading avatar: ${name}`);
  await state.head.showAvatar({
    url: resolveAvatarUrl(name),
    body: "F",
    avatarMood: "neutral"
  });
  state.head.setMood("happy");
  updateHero(els, name, state.audioFile ? state.audioFile.name : undefined);
  updateStatus(els, "Avatar ready. Upload a song to begin.");
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
  resetAnalysisThoughts(els, state, "Transcript ready. Analyze performance.");
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

// ─────────────────────────────────────────────────────────────
// Dynamic Configuration Fetching
// ─────────────────────────────────────────────────────────────

const fetchTtsModels = async () => {
  if (!config.audioBaseUrl) return;
  // User requested to stop TTS/ignore failures.
  // We will try gracefully but suppress errors.
  try {
    const response = await fetch(`${config.audioBaseUrl}/v1/audio/models`);
    if (response.ok) {
      const data = await response.json();
      updateState({ availableTtsModels: data.data || [] });
      populateTtsModelSelect();
    }
  } catch (e) {
    console.warn("Failed to fetch TTS models:", e);
  }
};

const fetchTtsVoices = async (modelId: string) => {
  if (!config.audioBaseUrl) return;
  try {
    const url = new URL(`${config.audioBaseUrl}/v1/audio/voices`);
    if (modelId) url.searchParams.set("model_id", modelId);
    
    const response = await fetch(url.toString());
    if (response.ok) {
      const data = await response.json();
      updateState({ availableVoices: data.data || [] });
      populateVoiceSelect();
    }
  } catch (e) {
    console.warn(`Failed to fetch voices for ${modelId}:`, e);
    // Fallback if fetch fails but we have a default list?
    // state.availableVoices = voiceOptions;
  }
};

const populateTtsModelSelect = () => {
    els.ttsModelSelect.innerHTML = "";
    if (state.availableTtsModels.length === 0) {
        // Fallback or empty state
        const op = document.createElement("option");
        op.value = config.ttsModel || "";
        op.textContent = "Default (Configured)";
        els.ttsModelSelect.appendChild(op);
        return;
    }
    
    state.availableTtsModels.forEach(m => {
        const op = document.createElement("option");
        op.value = m.id;
        op.textContent = m.id.split("/").pop() || m.id;
        if (m.id === config.ttsModel) op.selected = true;
        els.ttsModelSelect.appendChild(op);
    });
    
    // Trigger voice refresh for selected model
    if (els.ttsModelSelect.value) {
        fetchTtsVoices(els.ttsModelSelect.value);
    }
};

const populateVoiceSelect = () => {
    const current = els.voiceSelect.value;
    els.voiceSelect.innerHTML = "";
    
    if (state.availableVoices.length === 0) {
       const op = document.createElement("option");
       op.value = "default";
       op.textContent = "Default";
       els.voiceSelect.appendChild(op);
       return;
    }

    state.availableVoices.forEach(v => {
        const op = document.createElement("option");
        op.value = v;
        op.textContent = v;
        if (v === current) op.selected = true;
        els.voiceSelect.appendChild(op);
    });
};

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
  resetAnalysisThoughts(els, state, "Awaiting performance analysis.");
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

const initControls = () => {
  const presetOptions = Object.entries(lightPresets).map(([id, preset]) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = preset.label;
    return option;
  });
  presetOptions.forEach((option) => els.lightPreset.appendChild(option));
  els.lightPreset.value = state.lightPreset;
  applyLightPreset(state.lightPreset);

  els.cameraView.value = state.cameraSettings.view;
  els.cameraDistance.value = String(state.cameraSettings.distance);
  els.cameraX.value = String(state.cameraSettings.x);
  els.cameraY.value = String(state.cameraSettings.y);
  els.cameraRotateX.value = String(state.cameraSettings.rotateX);
  els.cameraRotateY.value = String(state.cameraSettings.rotateY);
  els.autoRotate.checked = state.cameraSettings.autoRotate;
  els.autoRotateSpeed.value = String(state.cameraSettings.autoRotateSpeed);
  updateSliderReadouts();
};

const bindControls = () => {
  const applyCameraInputState = () => {
    updateSliderReadouts();
    updateState({ cameraSettings: getCameraSettingsFromInputs(els) });
    if (state.head) applyCameraSettings();
  };

  const cameraInputs = [
    ["cameraView", els.cameraView],
    ["cameraDistance", els.cameraDistance],
    ["cameraX", els.cameraX],
    ["cameraY", els.cameraY],
    ["cameraRotateX", els.cameraRotateX],
    ["cameraRotateY", els.cameraRotateY],
    ["autoRotateSpeed", els.autoRotateSpeed]
  ] as const;

  cameraInputs.forEach(([, input]) => {
    input.addEventListener("input", () => {
      applyCameraInputState();
    });
  });

  els.autoRotate.addEventListener("change", () => {
    applyCameraInputState();
  });

  els.lightPreset.addEventListener("change", () => {
    applyLightPreset(els.lightPreset.value);
  });

  const lightInputs = [
    els.ambientColor,
    els.directColor,
    els.spotColor,
    els.ambientIntensity,
    els.directIntensity,
    els.spotIntensity
  ];

  lightInputs.forEach((input) => {
    input.addEventListener("input", () => {
      const lightColors = {
        ambient: els.ambientColor.value,
        direct: els.directColor.value,
        spot: els.spotColor.value
      };
      const stageLightingBase = {
        ambient: Number(els.ambientIntensity.value),
        direct: Number(els.directIntensity.value),
        spot: Number(els.spotIntensity.value)
      };
      updateState({ lightColors, stageLightingBase });
      updateSliderReadouts();
      applyLightSettings();
    });
  });

  els.lightPulse.addEventListener("change", () => {
    updateState({ lightPulse: els.lightPulse.checked });
  });

  els.directorModelSelect.addEventListener("change", () => {
    const value = els.directorModelSelect.value;
    if (value) {
      config.directorModel = value;
      setOverride("directorModel", value);
      setChip(els.llmChip, "LLM", value);
    }
  });

  els.llmModelSelect.addEventListener("change", () => {
    const value = els.llmModelSelect.value;
    if (value) {
      config.llmModel = value;
      setOverride("llmModel", value);
      setChip(els.chatChip, "Chat", value);
    }
  });

  els.sttModelSelect.addEventListener("change", () => {
    const value = els.sttModelSelect.value;
    if (value) {
      config.sttModel = value;
      setOverride("sttModel", value);
      setChip(els.sttChip, "STT", value);
    }
  });

  els.ttsModelSelect.addEventListener("change", () => {
    const value = els.ttsModelSelect.value;
    if (value) {
      config.ttsModel = value;
      setOverride("ttsModel", value);
    }
  });

  els.llmRuntimeRefresh.addEventListener("click", () => {
    refreshRuntimePanel().catch(() => {
      setRuntimeStatusText("Failed to refresh LLM status.");
    });
  });

  els.llmRuntimeUnload.addEventListener("click", () => {
    unloadRuntimeModel().catch(() => {
      setRuntimeStatusText("Failed to unload model.");
    });
  });

  els.llmRuntimeLoad.addEventListener("click", () => {
    loadRuntimeModel().catch(() => {
      setRuntimeStatusText("Failed to load model.");
    });
  });

  els.approveBtn.addEventListener("click", () => {
    if (!state.plan) {
      updateStatus(els, "Analyze a plan before approval.");
      return;
    }
    applyPlanApproved(true);
    updateStatus(els, "Plan approved. Ready to perform.");
  });
};

const initStage = async () => {
  setHud(els, "Idle", state.cameraSettings.view, lightPresets[state.lightPreset].label, "Awaiting");
  setChip(els.sttChip, "STT", config.sttModel);
  setChip(els.chatChip, "Chat", config.llmModel);
  const defaultDirector = config.directorModel || directorModelFallback;
  setChip(els.llmChip, "LLM", defaultDirector);
  setChip(els.audioChip, "Audio", "-");
  updateHero(els, undefined, undefined, "Awaiting Audio");
  applyPlanApproved(false);
  initControls();
  await initModelSelectors();
  refreshRuntimePanel().catch(() => {
    setRuntimeStatusText("Failed to refresh LLM status.");
  });

  try {
    await loadAvatarList();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    updateStatus(els, `Failed to load avatars: ${message}`);
  }

  resetHead();
  loadAvatar()
    .then(initHeadAudio)
    .then(() => {
        initLipsync(state.head);
    })
    .catch(() => updateStatus(els, "Avatar preview requires a user gesture."));

  els.avatarSelect.addEventListener("change", () => {
    resetHead();
    loadAvatar()
      .then(initHeadAudio)
      .then(async () => {
        initLipsync(state.head);
        if (state.audioFile) {
          const audioBuffer = await decodeAudioFile(state.audioFile, state.head.audioCtx);
          updateState({ audioBuffer });
          return null;
        }
        return null;
      })
      .catch((error) => updateStatus(els, error.message || "Failed to load avatar."));
  });

  els.songInput.addEventListener("change", () => {
    const file = els.songInput.files?.[0];
    if (!file) return;
    handleFile(file).catch((error) => updateStatus(els, error.message || "Failed to load audio."));
  });

  els.transcribeBtn.addEventListener("click", () => {
    transcribeAudio().catch((error) => updateStatus(els, error.message || "Transcribe failed."));
  });

  els.analyzeBtn.addEventListener("click", () => {
    analyzePerformance().catch((error) => updateStatus(els, error.message || "Analysis failed."));
  });

  els.playBtn.addEventListener("click", () => {
    performSong().catch((error) => updateStatus(els, error.message || "Performance failed."));
  });

  els.lipsyncBtn.addEventListener("click", () => {
     const text = els.transcript.value || "Hello, I am ready to lipsync.";
     speakWithLipsync(text).catch(e => updateStatus(els, "Lipsync failed: " + e.message));
  });

  els.stopBtn.addEventListener("click", () => {
    stopPerformance();
  });

  bindControls();
};

const init = async () => {
  // Initialize elements from the DOM
  els = getElements();
  bindStateUi();
  analysisController = createAnalysisController({
    els,
    config,
    getState: () => state,
    updateState,
    applyPlanApproved,
    renderPlan,
    enqueueAnalysisVoice,
    buildWordTimings,
    directorModelFallback
  });
  performanceController = createPerformanceController({
    els,
    getState: () => state,
    updateState,
    ensureAudioContext,
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
  // fetchTtsModels().then(() => {
  //    if (config.ttsModel) {
  //        fetchTtsVoices(config.ttsModel).catch(e => console.warn("TTS Voices check skipped/failed:", e));
  //    }
  // }).catch(e => console.warn("TTS Models check skipped/failed:", e));

  // Event Listeners for Dynamic Selection
  els.ttsModelSelect.addEventListener("change", (e) => {
      const modelId = (e.target as HTMLSelectElement).value;
      config.ttsModel = modelId; // Update config ref
      fetchTtsVoices(modelId);
  });
  
  els.voiceSelect.addEventListener("change", (e) => {
      config.ttsVoice = (e.target as HTMLSelectElement).value;
  });

  initStage();
};

init().catch((error) => {
  console.error(error);
  updateStatus(els, "Stage init failed.");
});
