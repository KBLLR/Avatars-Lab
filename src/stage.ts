import { TalkingHead } from "@met4citizen/talkinghead";
import { HeadAudio } from "@met4citizen/headaudio/dist/headaudio.min.mjs";
import { initLipsync, speakWithLipsync } from "./modules/lipsync";
import { getMlxConfig, setOverride, readOverrides } from "./mlx-config";
import {
  DirectorOrchestrator,
  createOrchestrator,
  type PipelineResult
} from "./pipeline/orchestrator";
import type {
  InputSection,
  MergedPlan,
  ProgressEvent,
  StreamChunkEvent,
  DirectorStage,
  CameraView,
  Mood,
  LightPreset,
  PlanSection,
  PlanAction,
  WordTiming
} from "./directors/types";

// Stage modules
import {
  getElements,
  lightPresets,
  directorModelFallback,
  directorMaxTokens,
  gestures,
  moods,
  cameraViews,
  stageFunctionDefs,
  createInitialState,
  type RegistryModel,
  type ModelRuntimeStatus,
  type StageState
} from "./stage/index";
import {
  ensureLipsync,
  buildVisemeTimings
} from "./avatar/index";
import { clamp } from "./scene/lighting";
import {
  buildSectionsFromTimings,
  fallbackPlan as createFallbackPlan,
  randomItem,
  encodeWords
} from "./performance/index";

// Elements are lazily loaded via getElements() from stage module
let els: ReturnType<typeof getElements>;

const config = getMlxConfig();

// Types now imported from ./stage/types: RegistryModel, ModelRuntimeStatus, StageState

// State object using createInitialState from stage module
const state: StageState = createInitialState();

const updateStatus = (text: string) => {
  els.status.textContent = text;
};

const ensureAudioContext = async (contextLabel: string) => {
  if (!state.head) return false;
  if (state.head.audioCtx.state === "running") return true;
  try {
    await state.head.audioCtx.resume();
  } catch {
    // Resume requires a user gesture.
  }
  if (state.head.audioCtx.state !== "running") {
    updateStatus(`Audio blocked. Click ${contextLabel} again to enable audio.`);
    return false;
  }
  return true;
};

const setAnalysisOverlay = (active: boolean, step?: string) => {
  els.analysisOverlay.classList.toggle("active", active);
  if (step) {
    els.analysisStepText.textContent = step;
  }
};

const resetAnalysisThoughts = (text: string) => {
  state.analysisSegments = text ? [text] : [];
  els.analysisThoughts.textContent = state.analysisSegments.join("\n\n") || "Awaiting performance analysis.";
};

const appendAnalysisThought = (text: string) => {
  if (!text) return;
  state.analysisSegments.push(text.trim());
  els.analysisThoughts.textContent = state.analysisSegments.join("\n\n");
};

const truncateForVoice = (text: string, max = 360) => {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trim()}...`;
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
  state.analysisVoiceQueue = state.analysisVoiceQueue
    .then(() => playAnalysisVoice(trimmed))
    .catch(() => {
      els.analysisHint.textContent = "Voiceover unavailable.";
    });
};

const setChip = (el: HTMLElement, label: string, value?: string) => {
  el.textContent = `${label}: ${value || "-"}`;
};

const setPlanApproved = (approved: boolean) => {
  state.planApproved = approved;
  els.approveBtn.disabled = approved || !state.plan;
  els.playBtn.disabled = !approved;
  els.planStatus.textContent = approved ? "Approved" : state.plan ? "Awaiting approval" : "Pending analysis";
};

const markPlanDirty = () => {
  if (!state.plan) return;
  if (state.planApproved) {
    setPlanApproved(false);
  } else {
    els.planStatus.textContent = "Awaiting approval";
  }
};

const setHud = (scene: string, camera: string, lights: string, mode: string) => {
  els.hudScene.textContent = scene;
  els.hudCamera.textContent = camera;
  els.hudLights.textContent = lights;
  els.hudMode.textContent = mode;
};

const updateHero = (avatarName?: string, songName?: string, sectionLabel?: string) => {
  const avatarLabel = avatarName || els.avatarSelect.value || "Avatar";
  const rawSong = songName ? `Performing ${songName}` : "No song";
  const songLabel = rawSong ? rawSong : "Awaiting Audio";
  els.heroTitle.textContent = `${avatarLabel.replace(/\\.glb$/i, "")}`;
  els.heroSubtitle.textContent = sectionLabel ? `${songLabel} · ${sectionLabel}` : songLabel;
};

// clamp, randomItem, encodeWords are now imported from modules

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
  if (!state.lightPulse) {
    state.lightPulseAmount = 0;
  } else {
    const analyser = head.audioAnalyzerNode;
    if (analyser) {
      const bins = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(bins);
      const avg = bins.reduce((sum, v) => sum + v, 0) / bins.length / 255;
      state.lightPulseAmount = clamp(state.lightPulseAmount + (avg * 1.5 - state.lightPulseAmount) * (dt / 300), 0, 1.2);
    }
  }

  if (head.lightAmbient) {
    head.lightAmbient.intensity = state.stageLightingBase.ambient + state.lightPulseAmount * 0.6;
  }
  if (head.lightDirect) {
    head.lightDirect.intensity = state.stageLightingBase.direct + state.lightPulseAmount * 10;
  }
  if (head.lightSpot) {
    head.lightSpot.intensity = state.stageLightingBase.spot + state.lightPulseAmount * 14;
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
  state.head = createHead();
  state.headaudio = null;
  state.audioBuffer = null;
};

const initHeadAudio = async () => {
  if (!state.head || state.headaudio) return;
  await state.head.audioCtx.audioWorklet.addModule(workletUrl);
  state.headaudio = new HeadAudio(state.head.audioCtx, {
    processorOptions: {
      visemeEventsEnabled: true
    }
  });
  await state.headaudio.loadModel(modelUrl);
  state.head.audioSpeechGainNode.connect(state.headaudio);
  state.headaudio.onvalue = (key, value) => {
    if (state.head?.mtAvatar?.[key]) {
      Object.assign(state.head.mtAvatar[key], { newvalue: value, needsUpdate: true });
    }
  };

  const originalUpdate = state.head.opt.update;
  state.head.opt.update = (dt: number) => {
    if (state.headaudio) {
      state.headaudio.update(dt);
    }
    if (originalUpdate) {
      originalUpdate(dt);
    }
    updateStageLighting(state.head!, dt);
  };
};

const updateSpotlightsOverlay = () => {
  const node = document.getElementById("spotlights");
  if (!node) return;
  const { ambient, direct, spot } = state.lightColors;
  node.style.background = `radial-gradient(circle at 20% 10%, ${ambient}55, transparent 45%),
    radial-gradient(circle at 80% 20%, ${direct}55, transparent 50%),
    radial-gradient(circle at 50% 80%, ${spot}55, transparent 55%)`;
};

const applyLightSettings = () => {
  if (!state.head) return;
  state.head.lightAmbient?.color?.set(state.lightColors.ambient);
  state.head.lightDirect?.color?.set(state.lightColors.direct);
  state.head.lightSpot?.color?.set(state.lightColors.spot);
  updateStageLighting(state.head, 16);
  updateSpotlightsOverlay();
};

const applyLightPreset = (presetId: string) => {
  const preset = lightPresets[presetId];
  if (!preset) return;
  state.lightPreset = presetId;
  state.stageLightingBase.ambient = preset.ambient;
  state.stageLightingBase.direct = preset.direct;
  state.stageLightingBase.spot = preset.spot;
  state.lightColors.ambient = preset.ambientColor;
  state.lightColors.direct = preset.directColor;
  state.lightColors.spot = preset.spotColor;
  els.ambientColor.value = preset.ambientColor;
  els.directColor.value = preset.directColor;
  els.spotColor.value = preset.spotColor;
  els.ambientIntensity.value = String(preset.ambient);
  els.directIntensity.value = String(preset.direct);
  els.spotIntensity.value = String(preset.spot);
  updateSliderReadouts();
  applyLightSettings();
  setHud(els.hudScene.textContent || "Idle", els.hudCamera.textContent || "Upper", preset.label, els.hudMode.textContent || "Awaiting");
};

const applyCameraSettings = () => {
  if (!state.head) return;
  const view = state.cameraSettings.view;
  state.head.opt.cameraDistance = state.cameraSettings.distance;
  state.head.opt.cameraX = state.cameraSettings.x;
  state.head.opt.cameraY = state.cameraSettings.y;
  state.head.opt.cameraRotateX = state.cameraSettings.rotateX;
  state.head.opt.cameraRotateY = state.cameraSettings.rotateY;
  state.head.setView(view, {
    cameraDistance: state.cameraSettings.distance,
    cameraX: state.cameraSettings.x,
    cameraY: state.cameraSettings.y,
    cameraRotateX: state.cameraSettings.rotateX,
    cameraRotateY: state.cameraSettings.rotateY
  });
  if (state.head.controls) {
    state.head.controls.autoRotate = state.cameraSettings.autoRotate;
    state.head.controls.autoRotateSpeed = state.cameraSettings.autoRotateSpeed;
  }
  setHud(els.hudScene.textContent || "Idle", view, els.hudLights.textContent || "Neon", els.hudMode.textContent || "Awaiting");
};

const updateSliderReadouts = () => {
  els.cameraDistanceVal.textContent = Number(els.cameraDistance.value).toFixed(2);
  els.cameraXVal.textContent = Number(els.cameraX.value).toFixed(2);
  els.cameraYVal.textContent = Number(els.cameraY.value).toFixed(2);
  els.cameraRotateXVal.textContent = Number(els.cameraRotateX.value).toFixed(2);
  els.cameraRotateYVal.textContent = Number(els.cameraRotateY.value).toFixed(2);
  els.autoRotateSpeedVal.textContent = Number(els.autoRotateSpeed.value).toFixed(2);
  els.ambientIntensityVal.textContent = Number(els.ambientIntensity.value).toFixed(1);
  els.directIntensityVal.textContent = Number(els.directIntensity.value).toFixed(1);
  els.spotIntensityVal.textContent = Number(els.spotIntensity.value).toFixed(1);
};

const loadModelRegistry = async () => {
  try {
    const response = await fetch("/models/registry.json");
    if (!response.ok) return [];
    const payload = await response.json();
    const models = Array.isArray(payload.models) ? payload.models : [];
    state.modelRegistry = models;
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

const updateLyricsOverlay = () => {
  if (!state.lyricActive || !state.audioBuffer || !state.head || !state.wordTimings) return;
  if (state.playbackStart === null) return;
  const nowMs = (state.head.audioCtx.currentTime - state.playbackStart) * 1000;
  const words = state.wordTimings.words;
  const times = state.wordTimings.wtimes;
  const durations = state.wordTimings.wdurations;

  while (state.lyricIndex < times.length - 1 && nowMs > times[state.lyricIndex] + durations[state.lyricIndex]) {
    state.lyricIndex += 1;
  }

  const windowSize = 6;
  const start = Math.max(0, state.lyricIndex - 2);
  const end = Math.min(words.length, start + windowSize);
  const line = words.slice(start, end).map((word, idx) => {
    const absoluteIndex = start + idx;
    const cls = absoluteIndex === state.lyricIndex ? "current" : "word";
    return `<span class="${cls}">${word}</span>`;
  });
  els.heroLyrics.innerHTML = line.join(" ");

  if (nowMs > state.audioBuffer.duration * 1000 + 500) {
    state.lyricActive = false;
  } else {
    requestAnimationFrame(updateLyricsOverlay);
  }
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
    state.avatarBaseUrl = new URL(".", manifestUrl).toString();
  }
};

const loadAvatar = async () => {
  if (!state.head) return;
  const name = els.avatarSelect.value;
  if (!name) return;
  updateStatus(`Loading avatar: ${name}`);
  await state.head.showAvatar({
    url: resolveAvatarUrl(name),
    body: "F",
    avatarMood: "neutral"
  });
  state.head.setMood("happy");
  updateHero(name, state.audioFile ? state.audioFile.name : undefined);
  updateStatus("Avatar ready. Upload a song to begin.");
};

const transcribeAudio = async () => {
  if (!state.audioFile) {
    updateStatus("Select an audio file first.");
    return;
  }
  if (!config.audioBaseUrl || !config.sttModel) {
    updateStatus("Missing VITE_MLX_AUDIO_BASE_URL or VITE_MLX_DEFAULT_STT_MODEL.");
    return;
  }

  updateStatus("Transcribing with MLX STT...");
  const form = new FormData();
  form.append("file", state.audioFile);
  form.append("model", config.sttModel);
  form.append("language", "en");
  form.append("word_timestamps", "true");

  const response = await fetch(`${config.audioBaseUrl}/v1/audio/transcriptions`, {
    method: "POST",
    body: form
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`STT error (${response.status}): ${detail}`);
  }

  const payload = await response.json();
  const text = payload?.text || "";
  if (!text) {
    updateStatus("STT returned empty transcript.");
    return;
  }

  state.transcriptText = text;
  els.transcript.value = text;
  if (
    Array.isArray(payload?.words) &&
    Array.isArray(payload?.wtimes) &&
    Array.isArray(payload?.wdurations) &&
    payload.words.length === payload.wtimes.length &&
    payload.words.length === payload.wdurations.length
  ) {
    state.wordTimings = {
      words: payload.words,
      wtimes: payload.wtimes,
      wdurations: payload.wdurations
    };
  } else {
    state.wordTimings = null;
  }
  state.plan = null;
  state.planSource = "none";
  state.directorNotes = "";
  setAnalysisOverlay(false);
  resetAnalysisThoughts("Transcript ready. Analyze performance.");
  els.playBtn.disabled = true;
  setPlanApproved(false);
  renderPlan([]);
  els.heroLyrics.textContent = "Transcript ready. Analyze performance.";
  updateHero(undefined, state.audioFile ? state.audioFile.name : undefined, "Transcript Ready");
  updateStatus("Transcript ready. Analyze performance to stage the song.");
};

const decodeAudio = async () => {
  if (!state.audioFile || !state.head) return;
  const arrayBuffer = await state.audioFile.arrayBuffer();
  state.audioBuffer = await state.head.audioCtx.decodeAudioData(arrayBuffer.slice(0));
};

// buildSectionsFromTimings is imported from ./performance/index
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
      state.availableTtsModels = data.data || [];
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
      state.availableVoices = data.data || [];
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

// ─────────────────────────────────────────────────────────────
// Director Orchestration (using new modular pipeline)
// ─────────────────────────────────────────────────────────────

/**
 * Initialize or get the orchestrator instance
 */
const getOrchestrator = (): DirectorOrchestrator => {
  const model = els.directorModelSelect.value || config.directorModel || directorModelFallback;
  const style = els.directorStyle.value || "cinematic";
  const seed = state.analysisSeed || new Date().toISOString();

  if (!state.orchestrator) {
    state.orchestrator = createOrchestrator({
      baseUrl: config.llmBaseUrl,
      model,
      style,
      seed,
      timeoutMs: 60000,
      maxTokens: 1500,
      retries: 2,
      streaming: true,
      enableChunking: true,
      parallelStageCamera: true
    });
  } else {
    // Update seed for fresh generation
    state.orchestrator.updateSeed(seed);
  }

  return state.orchestrator;
};

/**
 * Cancel the running analysis
 */
const cancelAnalysis = () => {
  if (state.orchestrator && state.isAnalyzing) {
    state.orchestrator.cancel();
    state.isAnalyzing = false;
    updateAnalyzeButton(false);
    setAnalysisOverlay(false);
    updateStatus("Analysis cancelled.");
  }
};

/**
 * Update analyze button state (Analyze vs Cancel)
 */
const updateAnalyzeButton = (isAnalyzing: boolean) => {
  state.isAnalyzing = isAnalyzing;
  els.analyzeBtn.textContent = isAnalyzing ? "Cancel" : "Analyze";
  els.analyzeBtn.classList.toggle("cancel-mode", isAnalyzing);
};

/**
 * Get stage display name
 */
const getStageDisplayName = (stage: DirectorStage): string => {
  const names: Record<DirectorStage, string> = {
    performance: "Performance Director",
    stage: "Stage Director",
    camera: "Camera Director"
  };
  return names[stage];
};

/**
 * Update progress bar (0-100)
 */
const updateProgressBar = (percent: number) => {
  if (els.analysisProgressBar) {
    els.analysisProgressBar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  }
};

/**
 * Update stage badges to reflect pipeline state
 */
const updateStageBadges = (
  stage: DirectorStage,
  status: "pending" | "active" | "complete" | "failed"
) => {
  const badges: Record<DirectorStage, HTMLElement | null> = {
    performance: els.stageBadgePerformance,
    stage: els.stageBadgeStage,
    camera: els.stageBadgeCamera
  };

  const badge = badges[stage];
  if (!badge) return;

  // Remove all state classes
  badge.classList.remove("active", "complete", "failed");

  // Add the appropriate state class
  if (status === "active") {
    badge.classList.add("active");
  } else if (status === "complete") {
    badge.classList.add("complete");
  } else if (status === "failed") {
    badge.classList.add("failed");
  }
};

/**
 * Reset all stage badges to pending state
 */
const resetStageBadges = () => {
  const badges = [
    els.stageBadgePerformance,
    els.stageBadgeStage,
    els.stageBadgeCamera
  ];
  badges.forEach((badge) => {
    if (badge) {
      badge.classList.remove("active", "complete", "failed");
    }
  });
};

/**
 * Main analysis function using the orchestrator
 */
const analyzePerformance = async () => {
  // If already analyzing, cancel instead
  if (state.isAnalyzing) {
    cancelAnalysis();
    return;
  }

  // Validation
  if (!state.audioBuffer) {
    updateStatus("Load audio before analyzing performance.");
    return;
  }
  if (!state.transcriptText) {
    updateStatus("Transcript required. Run transcribe first.");
    return;
  }
  if (!config.llmBaseUrl) {
    updateStatus("Missing VITE_MLX_LLM_BASE_URL.");
    return;
  }

  const model = els.directorModelSelect.value || config.directorModel || directorModelFallback;
  if (!model) {
    updateStatus("Missing VITE_MLX_DEFAULT_LLM_MODEL.");
    return;
  }

  // Reset state
  setPlanApproved(false);
  state.analysisSeed = new Date().toISOString();
  state.directorNotes = "Performance Director: thinking...";
  els.directorNotes.textContent = state.directorNotes;
  state.analysisVoiceQueue = Promise.resolve();
  updateAnalyzeButton(true);
  setAnalysisOverlay(true, "Performance Director");
  els.analysisHint.textContent = config.ttsModel
    ? "Voiceover will play when available."
    : "Voiceover disabled (missing TTS model).";
  resetAnalysisThoughts(`Creative seed: ${state.analysisSeed}\nPerformance Director: listening to the lyrics...`);
  renderPlan([]);

  // Reset progress UI
  updateProgressBar(0);
  resetStageBadges();

  try {
    const durationMs = state.audioBuffer.duration * 1000;
    const timings = state.wordTimings || buildWordTimings(encodeWords(state.transcriptText), durationMs);
    const sections: InputSection[] = buildSectionsFromTimings(timings);

    // Get or create orchestrator
    const orchestrator = getOrchestrator();

    updateStatus("Director pipeline: analyzing performance...");

    // Run the pipeline with callbacks
    const result: PipelineResult = await orchestrator.run(
      {
        sections,
        durationMs,
        defaultLightPreset: state.lightPreset,
        defaultCameraView: state.cameraSettings.view
      },
      {
        // Progress callback - update UI overlay
        onProgress: (event: ProgressEvent) => {
          const stageName = getStageDisplayName(event.stage);
          setAnalysisOverlay(true, stageName);

          // Update stage badges based on current stage
          if (event.status === "running") {
            updateStageBadges(event.stage, "active");

            // Calculate progress: performance=0-33%, stage=33-66%, camera=66-100%
            const stageProgress: Record<DirectorStage, number> = {
              performance: 10,
              stage: 45,
              camera: 78
            };
            updateProgressBar(stageProgress[event.stage]);

            const chunkInfo = event.chunk && event.totalChunks
              ? ` (${event.chunk}/${event.totalChunks})`
              : "";
            updateStatus(`${stageName}${chunkInfo}: ${event.message || "analyzing..."}`);

            if (event.thoughtsPreview) {
              els.directorNotes.textContent = `${state.directorNotes}\n\n${stageName}: ${event.thoughtsPreview}`;
            }
          } else if (event.status === "complete") {
            updateStageBadges(event.stage, "complete");

            // Update progress bar for completed stages
            const completedProgress: Record<DirectorStage, number> = {
              performance: 33,
              stage: 66,
              camera: 100
            };
            updateProgressBar(completedProgress[event.stage]);

            appendAnalysisThought(`${stageName}: Complete`);
          } else if (event.status === "failed") {
            updateStageBadges(event.stage, "failed");
            appendAnalysisThought(`${stageName}: ${event.message || "Failed"}`);
          }
        },

        // Streaming chunk callback - show real-time progress
        onChunk: (event: StreamChunkEvent) => {
          // Could add character-by-character streaming display here
          // For now, we rely on the progress callback
        },

        // Thoughts callback - display and queue voiceover
        onThoughts: (stage: DirectorStage, thoughts: string) => {
          const stageName = getStageDisplayName(stage);
          const displayText = `${stageName}: ${thoughts}`;
          appendAnalysisThought(displayText);
          enqueueAnalysisVoice(`${stageName}. ${thoughts}`);

          // Update director notes
          state.directorNotes = [state.directorNotes, displayText]
            .filter(Boolean)
            .join("\n\n");
          els.directorNotes.textContent = state.directorNotes;
        },

        // Fallback callback
        onFallback: (reason: string) => {
          appendAnalysisThought(`Using fallback plan: ${reason}`);
          updateStatus(`Fallback: ${reason}`);
        }
      }
    );

    // Process result
    if (result.usedFallback) {
      state.plan = result.plan;
      state.planSource = "heuristic";
      state.directorNotes = "Fallback plan used because director output was invalid.";
      els.directorNotes.textContent = state.directorNotes;
      updateStatus("Using fallback staging plan.");
    } else {
      state.plan = result.plan;
      state.planSource = "llm";

      // Combine all director notes
      const allNotes = [
        result.plan.performanceNotes,
        result.plan.stageNotes,
        result.plan.cameraNotes
      ].filter(Boolean).join("\n\n");

      state.directorNotes = allNotes || "Director pipeline completed.";
      els.directorNotes.textContent = state.directorNotes;
      updateStatus(`Performance plan ready (${(result.totalDurationMs / 1000).toFixed(1)}s). Hit Perform.`);
    }

    renderPlan(state.plan.sections);
    updateHero(
      undefined,
      state.audioFile ? state.audioFile.name : undefined,
      state.plan.title || "Performance Plan"
    );
    els.analysisHint.textContent = "Analysis complete.";
    setAnalysisOverlay(false);
    setPlanApproved(false);

  } catch (error) {
    console.error("Analysis error:", error);
    const message = error instanceof Error ? error.message : String(error);

    // Check if it was a cancellation
    if (message.includes("cancelled")) {
      updateStatus("Analysis cancelled by user.");
    } else {
      updateStatus(`Analysis failed: ${message}`);
    }

    setAnalysisOverlay(false);

  } finally {
    updateAnalyzeButton(false);
  }
};

const renderPlan = (sections: PlanSection[]) => {
  els.planList.innerHTML = "";
  if (!sections.length) {
    const empty = document.createElement("div");
    empty.className = "plan-item";
    empty.textContent = "No staged sections yet.";
    els.planList.appendChild(empty);
    els.planDetails.textContent = "No performance plan yet.";
    els.directorNotes.textContent = "Director notes will appear here after analysis.";
    return;
  }

  const updatePlanDetails = (activeSections: PlanSection[]) => {
    const details: string[] = [];
    activeSections.forEach((section, index) => {
      details.push(
        `${index + 1}. ${section.label} [${Math.round(section.start_ms / 1000)}s-${Math.round(
          section.end_ms / 1000
        )}s] role=${section.role} mood=${section.mood || "neutral"} camera=${section.camera || "upper"} light=${section.light || state.lightPreset}`
      );
      if (section.notes) details.push(`   notes: ${section.notes}`);
      if (section.actions?.length) details.push(`   actions: ${section.actions.length}`);
    });
    const header = `Source: ${state.planSource === "llm" ? "Director LLM" : "Fallback"} · Sections: ${activeSections.length}`;
    els.planDetails.textContent = [header, ...details].join("\n");
    els.directorNotes.textContent = state.directorNotes || "Director notes unavailable.";
  };

  const createSelect = (
    className: string,
    value: string,
    options: Array<{ value: string; label: string }>,
    onChange: (next: string) => void
  ) => {
    const select = document.createElement("select");
    select.className = `chip-select ${className}`;
    options.forEach((option) => {
      const node = document.createElement("option");
      node.value = option.value;
      node.textContent = option.label;
      select.appendChild(node);
    });
    select.value = value;
    select.addEventListener("change", () => onChange(select.value));
    return select;
  };

  const createInlineInput = (
    label: string,
    value: string,
    onChange: (next: string) => void
  ) => {
    const wrap = document.createElement("div");
    wrap.className = "chip-inline";
    const text = document.createElement("span");
    text.textContent = label;
    const input = document.createElement("input");
    input.value = value;
    input.addEventListener("change", () => onChange(input.value));
    wrap.appendChild(text);
    wrap.appendChild(input);
    return wrap;
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
        if (!state.plan) return;
        state.plan.sections[index].role = next as "solo" | "ensemble";
        markPlanDirty();
        updatePlanDetails(state.plan.sections);
        renderPlan(state.plan.sections);
      }
    );

    const moodSelect = createSelect(
      "mood",
      section.mood || "neutral",
      moods.map((mood) => ({ value: mood, label: `Mood:${mood}` })),
      (next) => {
        if (!state.plan) return;
        state.plan.sections[index].mood = next as Mood;
        markPlanDirty();
        updatePlanDetails(state.plan.sections);
      }
    );

    const cameraSelect = createSelect(
      "camera",
      section.camera || state.cameraSettings.view,
      cameraViews.map((view) => ({ value: view, label: `Cam:${view}` })),
      (next) => {
        if (!state.plan) return;
        state.plan.sections[index].camera = next as CameraView;
        markPlanDirty();
        updatePlanDetails(state.plan.sections);
      }
    );

    const lightSelect = createSelect(
      "light",
      section.light || state.lightPreset,
      Object.keys(lightPresets).map((key) => ({ value: key, label: `Light:${key}` })),
      (next) => {
        if (!state.plan) return;
        state.plan.sections[index].light = next as LightPreset;
        markPlanDirty();
        updatePlanDetails(state.plan.sections);
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
            if (!state.plan) return;
            const target = state.plan.sections[index].actions?.[actionIndex];
            if (!target) return;
            target.action = next;
            target.args = {};
            markPlanDirty();
            renderPlan(state.plan.sections);
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
                if (!state.plan) return;
                const target = state.plan.sections[index].actions?.[actionIndex];
                if (!target) return;
                target.args = { ...target.args, mood: next as Mood };
                markPlanDirty();
                updatePlanDetails(state.plan.sections);
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
                if (!state.plan) return;
                const target = state.plan.sections[index].actions?.[actionIndex];
                if (!target) return;
                target.args = { ...target.args, gesture: next };
                markPlanDirty();
                updatePlanDetails(state.plan.sections);
              }
            )
          );
        } else if (action.action === "make_facial_expression") {
          actionWrap.appendChild(
            createInlineInput("Emoji", (action.args?.emoji as string) || "🙂", (next) => {
              if (!state.plan) return;
              const target = state.plan.sections[index].actions?.[actionIndex];
              if (!target) return;
              target.args = { ...target.args, emoji: next };
              markPlanDirty();
              updatePlanDetails(state.plan.sections);
            })
          );
        } else if (action.action === "speak_break") {
          actionWrap.appendChild(
            createInlineInput("Break ms", String(action.args?.duration_ms ?? 400), (next) => {
              if (!state.plan) return;
              const target = state.plan.sections[index].actions?.[actionIndex];
              if (!target) return;
              const ms = Number(next);
              target.args = { ...target.args, duration_ms: Number.isFinite(ms) ? ms : 400 };
              markPlanDirty();
              updatePlanDetails(state.plan.sections);
            })
          );
        } else if (action.action === "set_view") {
          actionWrap.appendChild(
            createSelect(
              "camera",
              (action.args?.view as CameraView) || section.camera || "upper",
              cameraViews.map((view) => ({ value: view, label: view })),
              (next) => {
                if (!state.plan) return;
                const target = state.plan.sections[index].actions?.[actionIndex];
                if (!target) return;
                target.args = { ...target.args, view: next as CameraView };
                markPlanDirty();
                updatePlanDetails(state.plan.sections);
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
                if (!state.plan) return;
                const target = state.plan.sections[index].actions?.[actionIndex];
                if (!target) return;
                target.args = { ...target.args, preset: next as LightPreset };
                markPlanDirty();
                updatePlanDetails(state.plan.sections);
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

  updatePlanDetails(sections);
};

const filterWordsForSolo = (timings: WordTiming, sections: PlanSection[]) => {
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

const scheduleAction = (action: PlanAction, markers: Array<() => void>, mtimes: number[]) => {
  const time = Math.max(0, Math.round(action.time_ms));
  markers.push(() => {
    if (!state.head) return;
    const args = action.args || {};
    const gesture = args.gesture || args.name;
    switch (action.action) {
      case "set_mood":
        if (args.mood) state.head.setMood(args.mood as Mood);
        break;
      case "play_gesture":
        if (gesture) {
          state.head.playGesture(gesture as string, args.duration ?? 2.5, args.mirror ?? false, args.ms ?? 800);
        }
        break;
      case "stop_gesture":
        state.head.stopGesture(args.ms ?? 800);
        break;
      case "speak_emoji":
      case "make_facial_expression":
        if (args.emoji) state.head.speakEmoji(args.emoji as string);
        break;
      case "speak_break":
        if (typeof args.duration_ms === "number") {
          state.head.speakBreak(args.duration_ms);
        }
        break;
      case "speak_marker":
        if (args.marker) {
          updateStatus(`Marker: ${args.marker}`);
        }
        break;
      case "look_at":
        if (typeof args.x === "number" && typeof args.y === "number") {
          state.head.lookAt(args.x, args.y, args.t ?? 600);
        }
        break;
      case "look_at_camera":
      case "make_eye_contact":
        state.head.lookAtCamera(args.ms ?? args.t ?? 600);
        break;
      case "set_value":
        if (args.mt && typeof args.value === "number") {
          state.head.setValue(args.mt as string, args.value, typeof args.ms === "number" ? args.ms : null);
        }
        break;
      case "get_value":
        if (args.mt) {
          const value = state.head.getValue(args.mt as string);
          updateStatus(`Value ${args.mt}: ${value ?? "n/a"}`);
        }
        break;
      case "play_background_audio":
        if (args.url) {
          state.head.audioCtx.resume().catch(() => null);
          state.head.playBackgroundAudio(args.url as string);
          if (typeof args.volume === "number") {
            const vol = Math.min(1, Math.max(0, args.volume));
            state.head.setMixerGain(null, vol);
          }
        }
        break;
      case "stop_background_audio":
        state.head.stopBackgroundAudio();
        break;
      case "start":
        state.head.audioCtx.resume().catch(() => null);
        state.head.start();
        break;
      case "stop":
        state.head.stop();
        break;
      case "start_listening":
      case "stop_listening":
        break;
      case "set_view":
        if (args.view) {
          state.cameraSettings.view = args.view as CameraView;
          if (typeof args.cameraDistance === "number") state.cameraSettings.distance = args.cameraDistance;
          if (typeof args.cameraX === "number") state.cameraSettings.x = args.cameraX;
          if (typeof args.cameraY === "number") state.cameraSettings.y = args.cameraY;
          if (typeof args.cameraRotateX === "number") state.cameraSettings.rotateX = args.cameraRotateX;
          if (typeof args.cameraRotateY === "number") state.cameraSettings.rotateY = args.cameraRotateY;
          applyCameraSettings();
        }
        break;
      case "set_light_preset":
          if (args.preset) applyLightPreset(args.preset as string);
        break;
      default:
        break;
    }
  });
  mtimes.push(time);
};

const buildMarkersFromPlan = (plan: { sections: PlanSection[]; actions?: PlanAction[] }, durationMs: number) => {
  const markers: Array<() => void> = [];
  const mtimes: number[] = [];

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
  if (!unlocked) {
    return;
  }

  await ensureLipsync(state.head);
  state.head.start();
  const durationMs = state.audioBuffer.duration * 1000;
  const baseTimings =
    state.wordTimings || buildWordTimings(encodeWords(state.transcriptText), durationMs);
  const activePlan = state.plan || fallbackPlan(durationMs, baseTimings);
  state.plan = activePlan;
  if (state.planSource === "none") {
    state.planSource = "heuristic";
    renderPlan(activePlan.sections);
  }

  const timings = els.soloOnly.checked ? filterWordsForSolo(baseTimings, activePlan.sections) : baseTimings;
  const visemeTimings = buildVisemeTimings(state.head, timings);
  const markers = buildMarkersFromPlan(activePlan, durationMs);
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

  state.performing = true;
  setHud(activePlan.title || "Performance", state.cameraSettings.view, lightPresets[state.lightPreset].label, "Performing");
  updateStatus("Performance started...");
  state.playbackStart = state.head.audioCtx.currentTime;
  state.lyricIndex = 0;
  state.lyricActive = Boolean(state.wordTimings?.words.length);
  if (state.lyricActive) {
    requestAnimationFrame(updateLyricsOverlay);
  }
  updateHero(undefined, state.audioFile ? state.audioFile.name : undefined, activePlan.title || "Performance");
  state.head.speakAudio(audio);
};

const stopPerformance = () => {
  if (!state.head) return;
  state.head.stop();
  state.performing = false;
  state.lyricActive = false;
  setHud(els.hudScene.textContent || "Idle", state.cameraSettings.view, lightPresets[state.lightPreset].label, "Stopped");
  updateStatus("Performance stopped.");
};

const handleFile = async (file: File) => {
  state.audioFile = file;
  els.playBtn.disabled = true;
  els.transcript.value = "";
  state.transcriptText = "";
  state.plan = null;
  state.planSource = "none";
  state.directorNotes = "";
  setPlanApproved(false);
  setAnalysisOverlay(false);
  resetAnalysisThoughts("Awaiting performance analysis.");
  renderPlan([]);
  updateStatus("Loading audio...");
  resetHead();
  await loadAvatar();
  await initHeadAudio();
  await decodeAudio();
  setChip(els.audioChip, "Audio", `${file.name}`);
  updateHero(undefined, file.name);
  els.heroLyrics.textContent = "Audio loaded. Transcribe, then analyze to enable performance.";
  updateStatus("Audio loaded. Transcribe, then analyze to continue.");
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
  const cameraInputs = [
    ["cameraView", els.cameraView],
    ["cameraDistance", els.cameraDistance],
    ["cameraX", els.cameraX],
    ["cameraY", els.cameraY],
    ["cameraRotateX", els.cameraRotateX],
    ["cameraRotateY", els.cameraRotateY],
    ["autoRotateSpeed", els.autoRotateSpeed]
  ] as const;

  cameraInputs.forEach(([key, input]) => {
    input.addEventListener("input", () => {
      updateSliderReadouts();
      state.cameraSettings.view = els.cameraView.value as typeof state.cameraSettings.view;
      state.cameraSettings.distance = Number(els.cameraDistance.value);
      state.cameraSettings.x = Number(els.cameraX.value);
      state.cameraSettings.y = Number(els.cameraY.value);
      state.cameraSettings.rotateX = Number(els.cameraRotateX.value);
      state.cameraSettings.rotateY = Number(els.cameraRotateY.value);
      state.cameraSettings.autoRotateSpeed = Number(els.autoRotateSpeed.value);
      if (state.head) applyCameraSettings();
    });
  });

  els.autoRotate.addEventListener("change", () => {
    state.cameraSettings.autoRotate = els.autoRotate.checked;
    if (state.head) applyCameraSettings();
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
      state.lightColors.ambient = els.ambientColor.value;
      state.lightColors.direct = els.directColor.value;
      state.lightColors.spot = els.spotColor.value;
      state.stageLightingBase.ambient = Number(els.ambientIntensity.value);
      state.stageLightingBase.direct = Number(els.directIntensity.value);
      state.stageLightingBase.spot = Number(els.spotIntensity.value);
      updateSliderReadouts();
      applyLightSettings();
    });
  });

  els.lightPulse.addEventListener("change", () => {
    state.lightPulse = els.lightPulse.checked;
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
      updateStatus("Analyze a plan before approval.");
      return;
    }
    setPlanApproved(true);
    updateStatus("Plan approved. Ready to perform.");
  });
};

const initStage = async () => {
  setHud("Idle", state.cameraSettings.view, lightPresets[state.lightPreset].label, "Awaiting");
  setChip(els.sttChip, "STT", config.sttModel);
  setChip(els.chatChip, "Chat", config.llmModel);
  const defaultDirector = config.directorModel || directorModelFallback;
  setChip(els.llmChip, "LLM", defaultDirector);
  setChip(els.audioChip, "Audio", "-");
  updateHero(undefined, undefined, "Awaiting Audio");
  setPlanApproved(false);
  initControls();
  await initModelSelectors();
  refreshRuntimePanel().catch(() => {
    setRuntimeStatusText("Failed to refresh LLM status.");
  });

  try {
    await loadAvatarList();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    updateStatus(`Failed to load avatars: ${message}`);
  }

  resetHead();
  loadAvatar()
    .then(initHeadAudio)
    .then(() => {
        initLipsync(state.head);
    })
    .catch(() => updateStatus("Avatar preview requires a user gesture."));

  els.avatarSelect.addEventListener("change", () => {
    resetHead();
    loadAvatar()
      .then(initHeadAudio)
      .then(() => {
        initLipsync(state.head);
        if (state.audioFile) {
          return decodeAudio();
        }
        return null;
      })
      .catch((error) => updateStatus(error.message || "Failed to load avatar."));
  });

  els.songInput.addEventListener("change", () => {
    const file = els.songInput.files?.[0];
    if (!file) return;
    handleFile(file).catch((error) => updateStatus(error.message || "Failed to load audio."));
  });

  els.transcribeBtn.addEventListener("click", () => {
    transcribeAudio().catch((error) => updateStatus(error.message || "Transcribe failed."));
  });

  els.analyzeBtn.addEventListener("click", () => {
    analyzePerformance().catch((error) => updateStatus(error.message || "Analysis failed."));
  });

  els.playBtn.addEventListener("click", () => {
    performSong().catch((error) => updateStatus(error.message || "Performance failed."));
  });

  els.lipsyncBtn.addEventListener("click", () => {
     const text = els.transcript.value || "Hello, I am ready to lipsync.";
     speakWithLipsync(text).catch(e => updateStatus("Lipsync failed: " + e.message));
  });

  els.stopBtn.addEventListener("click", () => {
    stopPerformance();
  });

  bindControls();
};

const init = async () => {
  // Initialize elements from the DOM
  els = getElements();

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
  updateStatus("Stage init failed.");
});
