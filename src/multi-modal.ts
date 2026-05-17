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

type VoiceBackend = "kokoro" | "chatterbox";

type VoiceRegistryEntry = {
  id: string;
  name?: string;
};

type VoiceRegistryBackend = {
  voices?: VoiceRegistryEntry[];
};

type VoiceRegistry = {
  backends?: Record<string, VoiceRegistryBackend>;
};

type PromptPreset = {
  id: string;
  label: string;
  prompt: string;
  summary?: string;
};

type PromptLibrary = {
  version: string;
  defaults?: {
    personality?: string;
    tool_guide?: string;
    memory_guide?: string;
  };
  personalities?: PromptPreset[];
  tool_guides?: PromptPreset[];
  memory_guides?: PromptPreset[];
};

type PromptSelection = {
  personality: string;
  tool: string;
  memory: string;
};

let voiceRegistry: VoiceRegistry | null = null;
let promptLibrary: PromptLibrary | null = null;

const PROMPT_LIBRARY_PATH = "/prompts/avatar-prompt-library.json";
const PROMPT_STORAGE_KEY = "avatarLabs.promptSelection";

const loadVoiceRegistry = async (force = false): Promise<VoiceRegistry | null> => {
  if (voiceRegistry && !force) return voiceRegistry;
  try {
    const response = await fetch("/voices/registry.json", { cache: "no-store" });
    if (!response.ok) return voiceRegistry;
    const payload = await response.json();
    voiceRegistry = payload && typeof payload === "object" ? payload : null;
    return voiceRegistry;
  } catch {
    return voiceRegistry;
  }
};

const dedupePush = (list: string[], value?: string) => {
  if (!value) return;
  if (!list.includes(value)) list.push(value);
};

const getCurrentBackend = (): VoiceBackend => {
  const overrides = readOverrides();
  const backend = overrides.ttsBackend || config.ttsBackend || "kokoro";
  return backend === "chatterbox" ? "chatterbox" : "kokoro";
};

const getAvatarVoiceId = (
  avatarEntry: AvatarManifestEntry | undefined,
  backend: VoiceBackend
): string => {
  if (!avatarEntry) return backend === "chatterbox" ? "default" : "";
  if (backend === "kokoro") {
    return avatarEntry.kokoro_voice || avatarEntry.voice_id || "";
  }
  return avatarEntry.chatterbox_voice || avatarEntry.id || "default";
};

const getSuggestedChatterboxVoice = (avatarEntry?: AvatarManifestEntry): string => {
  if (!avatarEntry) return "";
  const voice = avatarEntry.chatterbox_voice;
  if (voice && voice !== "default") return voice;
  return avatarEntry.id || "";
};

const extractChatterboxVoiceId = (path?: string): string => {
  if (!path) return "";
  const match = path.match(/\/voices\/chatterbox\/([^/]+)\.(wav|mp3|flac)$/);
  return match ? match[1] : "";
};

const getVoiceFileExtension = (file: File | null): string => {
  if (!file) return "wav";
  const name = file.name || "";
  const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (match) return match[1];
  const type = file.type.toLowerCase();
  if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
  if (type.includes("flac")) return "flac";
  if (type.includes("wav")) return "wav";
  return "wav";
};

const collectVoiceIds = async (
  backend: VoiceBackend,
  forceRegistry = false
): Promise<string[]> => {
  const voices: string[] = [];
  const registry = await loadVoiceRegistry(forceRegistry);
  const registryVoices = registry?.backends?.[backend]?.voices || [];

  registryVoices.forEach((voice) => dedupePush(voices, voice.id));

  avatarManifest.forEach((avatar) => {
    dedupePush(voices, getAvatarVoiceId(avatar, backend));
  });

  if (backend === "chatterbox") {
    const overrides = readOverrides();
    const refPath = overrides.voiceRefPath || (config as any).voiceRefPath;
    const refVoice = extractChatterboxVoiceId(refPath);
    dedupePush(voices, refVoice);
    dedupePush(voices, "default");
  }

  if (!voices.length) voices.push("default");
  return voices;
};

const loadPromptLibrary = async (force = false): Promise<PromptLibrary | null> => {
  if (promptLibrary && !force) return promptLibrary;
  try {
    const response = await fetch(PROMPT_LIBRARY_PATH, { cache: "no-store" });
    if (!response.ok) return promptLibrary;
    const payload = await response.json();
    promptLibrary = payload && typeof payload === "object" ? payload : null;
    return promptLibrary;
  } catch {
    return promptLibrary;
  }
};

const readPromptSelection = (): PromptSelection | null => {
  try {
    const raw = localStorage.getItem(PROMPT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      personality: String(parsed.personality || ""),
      tool: String(parsed.tool || ""),
      memory: String(parsed.memory || "")
    };
  } catch {
    return null;
  }
};

const writePromptSelection = (selection: PromptSelection) => {
  localStorage.setItem(PROMPT_STORAGE_KEY, JSON.stringify(selection));
};

const populatePromptSelect = (
  select: HTMLSelectElement | null,
  items: PromptPreset[] | undefined,
  selectedId?: string
): string => {
  if (!select || !items?.length) return "";
  select.innerHTML = "";
  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.label;
    if (item.summary) option.title = item.summary;
    select.appendChild(option);
  });
  const fallback = items[0]?.id || "";
  const target = selectedId && items.some((item) => item.id === selectedId) ? selectedId : fallback;
  if (target) select.value = target;
  return target;
};

const buildSystemPrompt = (
  library: PromptLibrary,
  selection: PromptSelection
): string => {
  const personalities = library.personalities || [];
  const toolGuides = library.tool_guides || [];
  const memoryGuides = library.memory_guides || [];

  const personality = personalities.find((item) => item.id === selection.personality);
  const toolGuide = toolGuides.find((item) => item.id === selection.tool);
  const memoryGuide = memoryGuides.find((item) => item.id === selection.memory);

  const sections: string[] = [];
  if (personality?.prompt) {
    sections.push(`# Personality\n${personality.prompt}`);
  }
  if (toolGuide?.prompt) {
    sections.push(`# Tool Usage\n${toolGuide.prompt}`);
  }
  if (memoryGuide?.prompt) {
    sections.push(`# Memory\n${memoryGuide.prompt}`);
  }
  return sections.join("\n\n");
};

const resetChatLog = (chatLog: HTMLElement | null, message: string) => {
  if (!chatLog) return;
  chatLog.innerHTML = "";
  const bubble = document.createElement("div");
  bubble.className = "chat-message assistant";
  bubble.innerHTML = `
    <div class="chat-avatar">A</div>
    <div class="chat-bubble">${escapeHtml(message)}</div>
  `;
  chatLog.appendChild(bubble);
};

const populateVoiceSelect = (voices: string[], selected?: string): string => {
  if (!els?.voiceSelect) return "";
  els.voiceSelect.innerHTML = "";
  voices.forEach((voice) => {
    const option = document.createElement("option");
    option.value = voice;
    option.textContent = voice;
    els.voiceSelect.appendChild(option);
  });
  const finalSelection =
    selected && voices.includes(selected) ? selected : voices[0] || "";
  if (finalSelection) {
    els.voiceSelect.value = finalSelection;
  }
  return finalSelection;
};

const refreshVoiceOptions = async (
  backend: VoiceBackend,
  options: { preferAvatar?: boolean; forceRegistry?: boolean } = {}
): Promise<void> => {
  if (!els?.voiceSelect || !els?.avatarSelect) return;
  const voices = await collectVoiceIds(backend, options.forceRegistry);
  const overrides = readOverrides();
  const current = els.voiceSelect.value;
  const avatarEntry = findAvatarEntry(avatarManifest, els.avatarSelect.value);

  let targetVoice = options.preferAvatar
    ? getAvatarVoiceId(avatarEntry, backend)
    : overrides.ttsVoice || config.ttsVoice || current;

  if (!targetVoice || !voices.includes(targetVoice)) {
    targetVoice = current && voices.includes(current) ? current : voices[0];
  }

  const selection = populateVoiceSelect(voices, targetVoice);
  if (selection) {
    config.ttsVoice = selection;
    setOverride("ttsVoice", selection);
  }
};

const refreshAvatarManifest = async (): Promise<void> => {
  if (!els?.avatarSelect) return;
  const current = els.avatarSelect.value;
  await loadAvatarList();
  if (current) {
    const hasAvatar = Array.from(els.avatarSelect.options).some(
      (option) => option.value === current
    );
    if (hasAvatar) {
      els.avatarSelect.value = current;
    }
  }
};

let stateUiBound = false;
const bindStateUi = () => {
  if (stateUiBound) return;
  stateUiBound = true;
  stateManager.subscribe((nextState, changed) => {
    if (!els) return;
    if (changed.planApproved !== undefined || changed.plan !== undefined) {
      if (els.approveBtn) els.approveBtn.disabled = nextState.planApproved || !nextState.plan;
      if (els.playBtn) els.playBtn.disabled = !nextState.planApproved;
      if (els.planStatus) {
        els.planStatus.textContent = nextState.planApproved
          ? "Approved"
          : nextState.plan
          ? "Awaiting approval"
          : "Pending analysis";
      }
    }
    if (changed.directorNotes !== undefined) {
      if (els.directorNotes) {
        if (nextState.directorNotes) {
          els.directorNotes.textContent = nextState.directorNotes;
        } else if (nextState.plan) {
          els.directorNotes.textContent = "Director notes unavailable.";
        }
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
          els.hudScene?.textContent || "Idle",
          els.hudCamera?.textContent || "Upper",
          label,
          els.hudMode?.textContent || "Awaiting"
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
    if (els.planStatus) els.planStatus.textContent = "Awaiting approval";
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
      ttsChip: els.ttsChip,
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
  await refreshVoiceOptions(getCurrentBackend(), { preferAvatar: true });
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
  await refreshVoiceOptions(getCurrentBackend(), { preferAvatar: true });
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
  sendBtn: document.getElementById("sendBtn") as HTMLButtonElement,
  vadThreshold: document.getElementById("vadThreshold") as HTMLInputElement,
  vadSilence: document.getElementById("vadSilence") as HTMLInputElement,
  levelMeter: document.getElementById("levelMeter") as HTMLElement,
  chatLog: document.getElementById("chatLog") as HTMLElement,
  chatInput: document.getElementById("chatInput") as HTMLTextAreaElement,
  sessionDot: document.getElementById("sessionDot") as HTMLElement,
  sessionStatus: document.getElementById("sessionStatus") as HTMLElement,
  canvasStatus: document.getElementById("canvasStatus") as HTMLElement,
  promptPersonality: document.getElementById("promptPersonality") as HTMLSelectElement,
  promptTool: document.getElementById("promptTool") as HTMLSelectElement,
  promptMemory: document.getElementById("promptMemory") as HTMLSelectElement,
  promptApplyBtn: document.getElementById("promptApplyBtn") as HTMLButtonElement,
  promptResetBtn: document.getElementById("promptResetBtn") as HTMLButtonElement,
  // Pipeline status elements
  vadStatus: document.getElementById("vadStatus") as HTMLElement,
  vadDot: document.getElementById("vadDot") as HTMLElement,
  sttStatus: document.getElementById("sttStatus") as HTMLElement,
  sttDot: document.getElementById("sttDot") as HTMLElement,
  ttsStatus: document.getElementById("ttsStatus") as HTMLElement,
  ttsDot: document.getElementById("ttsDot") as HTMLElement,
  // Service health elements
  llmServiceDot: document.getElementById("llmServiceDot") as HTMLElement,
  audioServiceDot: document.getElementById("audioServiceDot") as HTMLElement,
  sttServiceDot: document.getElementById("sttServiceDot") as HTMLElement,
  ttsServiceDot: document.getElementById("ttsServiceDot") as HTMLElement,
  // TTS backend elements
  kokoroBackendBtn: document.getElementById("kokoroBackendBtn") as HTMLButtonElement,
  chatterboxBackendBtn: document.getElementById("chatterboxBackendBtn") as HTMLButtonElement,
  refreshVoicesBtn: document.getElementById("refreshVoicesBtn") as HTMLButtonElement,
  voiceCloningSection: document.getElementById("voiceCloningSection") as HTMLElement,
  voiceRefInput: document.getElementById("voiceRefInput") as HTMLInputElement,
  selectVoiceRefBtn: document.getElementById("selectVoiceRefBtn") as HTMLButtonElement,
  clearVoiceRefBtn: document.getElementById("clearVoiceRefBtn") as HTMLButtonElement,
  voiceRefStatus: document.getElementById("voiceRefStatus") as HTMLElement,
  // Voice save elements
  voiceSaveSection: document.getElementById("voiceSaveSection") as HTMLElement,
  voiceSpeakerName: document.getElementById("voiceSpeakerName") as HTMLInputElement,
  saveVoiceRefBtn: document.getElementById("saveVoiceRefBtn") as HTMLButtonElement,
});

let conversationManager: ConversationManager;

const initPromptControls = async (cEls: ReturnType<typeof getConversationElements>) => {
   if (!cEls.promptPersonality || !cEls.promptTool || !cEls.promptMemory) return;

   const library = await loadPromptLibrary();
   if (!library) return;

   const defaults = library.defaults || {};
   const saved = readPromptSelection();

   const selection: PromptSelection = {
     personality: saved?.personality || defaults.personality || "",
     tool: saved?.tool || defaults.tool_guide || "",
     memory: saved?.memory || defaults.memory_guide || ""
   };

   selection.personality = populatePromptSelect(
     cEls.promptPersonality,
     library.personalities,
     selection.personality
   );
   selection.tool = populatePromptSelect(
     cEls.promptTool,
     library.tool_guides,
     selection.tool
   );
   selection.memory = populatePromptSelect(
     cEls.promptMemory,
     library.memory_guides,
     selection.memory
   );

   writePromptSelection(selection);

   const applySelection = (resetChat: boolean) => {
     if (!conversationManager) return;
     if (conversationManager.isBusy()) {
       updateStatus(els, "Please wait...");
       return;
     }
     const currentSelection: PromptSelection = {
       personality: cEls.promptPersonality.value,
       tool: cEls.promptTool.value,
       memory: cEls.promptMemory.value
     };
     const systemPrompt = buildSystemPrompt(library, currentSelection);
     if (!systemPrompt) {
       updateStatus(els, "Prompt library is missing text.");
       return;
     }
     conversationManager.setSystemPrompt(systemPrompt, { resetHistory: true });
     writePromptSelection(currentSelection);
     if (resetChat) {
       resetChatLog(cEls.chatLog, "Prompt updated. Start talking when ready.");
     }
     updateStatus(els, "Prompt updated");
   };

   applySelection(false);

   cEls.promptApplyBtn?.addEventListener("click", () => {
     applySelection(true);
   });

   cEls.promptResetBtn?.addEventListener("click", () => {
     const resetSelection: PromptSelection = {
       personality: defaults.personality || selection.personality,
       tool: defaults.tool_guide || selection.tool,
       memory: defaults.memory_guide || selection.memory
     };
     cEls.promptPersonality.value = resetSelection.personality;
     cEls.promptTool.value = resetSelection.tool;
     cEls.promptMemory.value = resetSelection.memory;
     applySelection(true);
   });
};

const initConversationControls = async () => {
   const cEls = getConversationElements();

   // Check service health on init
   cEls.canvasStatus.textContent = "Checking services...";
   cEls.startSessionBtn.disabled = true;
   const health = await checkServiceHealth();
   updateServiceHealthUI(health);

   // Create or get typing indicator
   let typingIndicator: HTMLElement | null = document.getElementById("typingIndicator");
   if (!typingIndicator) {
     typingIndicator = document.createElement("div");
     typingIndicator.id = "typingIndicator";
     typingIndicator.className = "typing-indicator";
     typingIndicator.innerHTML = `
       <span class="dot"></span>
       <span class="dot"></span>
       <span class="dot"></span>
     `;
     typingIndicator.style.cssText = `
       display: none;
       padding: 8px 12px;
       background: rgba(91, 242, 214, 0.1);
       border-radius: 8px;
       margin-bottom: 4px;
     `;
     cEls.chatLog.appendChild(typingIndicator);
   }

   const showTypingIndicator = (show: boolean) => {
     if (typingIndicator) {
       typingIndicator.style.display = show ? "flex" : "none";
       if (show) {
         cEls.chatLog.scrollTop = cEls.chatLog.scrollHeight;
       }
     }
   };

   conversationManager = new ConversationManager({
       onStatusUpdate: (text) => {
         updateStatus(els, text);
         // Show typing indicator when thinking
         if (text === "Thinking...") {
           showTypingIndicator(true);
         } else if (text === "Ready" || text.startsWith("Error") || text === "Speaking...") {
           showTypingIndicator(false);
         }

         // Update pipeline status indicators based on status text
         if (text === "Transcribing...") {
           setPipelineStatus(cEls.sttStatus, cEls.sttDot, "STT: Transcribing", "busy");
         } else if (text === "Processing..." || text === "Thinking...") {
           setPipelineStatus(cEls.sttStatus, cEls.sttDot, "STT: Done", "active");
         } else if (text === "Synthesizing speech...") {
           setPipelineStatus(cEls.ttsStatus, cEls.ttsDot, "TTS: Generating", "busy");
         } else if (text === "Speaking...") {
           setPipelineStatus(cEls.ttsStatus, cEls.ttsDot, "TTS: Speaking", "active");
         } else if (text === "Ready" || text === "Listening...") {
           setPipelineStatus(cEls.sttStatus, cEls.sttDot, "STT: Idle", "idle");
           setPipelineStatus(cEls.ttsStatus, cEls.ttsDot, "TTS: Idle", "idle");
         } else if (text.startsWith("Error")) {
           setPipelineStatus(cEls.sttStatus, cEls.sttDot, "STT: Error", "error");
           setPipelineStatus(cEls.ttsStatus, cEls.ttsDot, "TTS: Error", "error");
         }
       },
       onLogMessage: (role, text) => {
           // Hide typing indicator when assistant responds
           if (role === "assistant") {
             showTypingIndicator(false);
           }

           const bubble = document.createElement("div");
           bubble.className = `chat-message ${role}`;
           bubble.style.cssText = `
             padding: 8px 12px;
             border-radius: 8px;
             margin-bottom: 4px;
             background: ${role === "user" ? "rgba(255,255,255,0.1)" : role === "assistant" ? "rgba(91, 242, 214, 0.1)" : "rgba(255, 179, 71, 0.1)"};
             color: ${role === "assistant" ? "#5bf2d6" : role === "tool" ? "#ffb347" : "#fff"};
           `;

           // Format message with avatar initial
           const avatar = role === "user" ? "U" : role === "assistant" ? "A" : "T";
           bubble.innerHTML = `
             <div style="display: flex; gap: 8px; align-items: flex-start;">
               <span style="
                 width: 24px; height: 24px;
                 border-radius: 50%;
                 background: ${role === "assistant" ? "#5bf2d6" : role === "tool" ? "#ffb347" : "#666"};
                 color: #000;
                 display: flex; align-items: center; justify-content: center;
                 font-size: 12px; font-weight: bold; flex-shrink: 0;
               ">${avatar}</span>
               <span style="flex: 1; word-break: break-word;">${escapeHtml(text)}</span>
             </div>
           `;
           cEls.chatLog.appendChild(bubble);
           cEls.chatLog.scrollTop = cEls.chatLog.scrollHeight;
       },
       onModeChange: (mode, isRecording) => {
           cEls.pushModeBtn.classList.toggle("primary", mode === "push");
           cEls.vadModeBtn.classList.toggle("primary", mode === "vad");
           cEls.recordBtn.textContent = mode === "push" ? (isRecording ? "Release to Send" : "Hold to Talk") : (isRecording ? "Listening..." : "Auto-VAD Active");
           cEls.recordBtn.disabled = mode === "vad"; // In VAD mode, button is just status

           // Update VAD pipeline status
           if (mode === "vad") {
             setPipelineStatus(cEls.vadStatus, cEls.vadDot, isRecording ? "VAD: Recording" : "VAD: Listening", isRecording ? "busy" : "active");
           } else {
             setPipelineStatus(cEls.vadStatus, cEls.vadDot, isRecording ? "VAD: Recording" : "VAD: Off", isRecording ? "busy" : "idle");
           }
       },
       onThinking: (text) => {
            showTypingIndicator(true);
            const bubble = document.createElement("div");
            bubble.className = "chat-message tool thinking";
            bubble.style.cssText = `
              padding: 4px 12px;
              margin-bottom: 4px;
              border-radius: 8px;
              background: rgba(255, 255, 255, 0.05);
              border: 1px solid rgba(255, 255, 255, 0.1);
            `;
            
            const summary = text.slice(0, 60).replace(/\n/g, " ") + (text.length > 60 ? "..." : "");
            
            const escapeHtml = (text: string): string => {
                const div = document.createElement("div");
                div.textContent = text;
                return div.innerHTML;
            };

            bubble.innerHTML = `
              <div style="font-size: 0.85rem; color: #aaa;">
                <details>
                    <summary style="cursor: pointer; outline: none;">💭 Thinking: ${escapeHtml(summary)}</summary>
                    <div style="
                        margin-top: 8px; 
                        padding-top: 8px; 
                        border-top: 1px solid rgba(255,255,255,0.1); 
                        white-space: pre-wrap; 
                        font-family: monospace;
                        font-size: 0.8em;
                        color: #bbb;
                    ">${escapeHtml(text)}</div>
                </details>
              </div>
            `;
            cEls.chatLog.appendChild(bubble);
            cEls.chatLog.scrollTop = cEls.chatLog.scrollHeight;
        },
        onAudioLevel: (rms) => {
           const percent = Math.min(Math.max((rms * 200) * 100, 0), 100);
           cEls.levelMeter.style.width = `${percent}%`;
       }
   });

   await initPromptControls(cEls);

   cEls.startSessionBtn.addEventListener("click", async () => {
       await conversationManager.startSession();
       cEls.startSessionBtn.disabled = true;
       cEls.stopSessionBtn.disabled = false;
       cEls.recordBtn.disabled = false;
       // Update session status
       cEls.sessionDot.classList.add("active");
       cEls.sessionStatus.textContent = "Connected";
       cEls.canvasStatus.textContent = "Session active";
       // Ensure head is set
       if (state.head) conversationManager.setHead(state.head);
   });

   cEls.stopSessionBtn.addEventListener("click", async () => {
       await conversationManager.stopSession();
       cEls.startSessionBtn.disabled = false;
       cEls.stopSessionBtn.disabled = true;
       cEls.recordBtn.disabled = true;
       // Update session status
       cEls.sessionDot.classList.remove("active");
       cEls.sessionStatus.textContent = "Disconnected";
       cEls.canvasStatus.textContent = "Ready to connect";
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

   // Text input handler - Enter to send (Shift+Enter for newline)
   cEls.chatInput.addEventListener("keydown", async (e) => {
       if (e.key === "Enter" && !e.shiftKey) {
           e.preventDefault();
           const text = cEls.chatInput.value.trim();
           if (!text) return;

           // Check if session is active
           if (!conversationManager.isSessionActive()) {
               updateStatus(els, "Start a session first.");
               return;
           }

           // Clear input immediately
           cEls.chatInput.value = "";

           // Log user message to chat
           const userBubble = document.createElement("div");
           userBubble.className = "chat-message user";
           userBubble.innerHTML = `
               <div class="chat-avatar">U</div>
               <div class="chat-bubble">${escapeHtml(text)}</div>
           `;
           cEls.chatLog.appendChild(userBubble);
           cEls.chatLog.scrollTop = cEls.chatLog.scrollHeight;

           // Process via ConversationManager
           try {
               await conversationManager.handleUserText(text);
           } catch (err: any) {
               updateStatus(els, `Error: ${err.message}`);
           }
       }
   });

   // Send button click handler
   cEls.sendBtn.addEventListener("click", async () => {
       const text = cEls.chatInput.value.trim();
       if (!text) return;

       // Check if session is active
       if (!conversationManager.isSessionActive()) {
           updateStatus(els, "Start a session first.");
           return;
       }

       // Clear input immediately
       cEls.chatInput.value = "";

       // Log user message to chat
       const userBubble = document.createElement("div");
       userBubble.className = "chat-message user";
       userBubble.innerHTML = `
           <div class="chat-avatar">U</div>
           <div class="chat-bubble">${escapeHtml(text)}</div>
       `;
       cEls.chatLog.appendChild(userBubble);
       cEls.chatLog.scrollTop = cEls.chatLog.scrollHeight;

       // Process via ConversationManager
       try {
           await conversationManager.handleUserText(text);
       } catch (err: any) {
           updateStatus(els, `Error: ${err.message}`);
       }
   });

   // TTS Backend toggle handlers
   const currentBackend = getCurrentBackend();

   // Initialize button states based on saved preference
   if (currentBackend === "chatterbox") {
     cEls.kokoroBackendBtn.classList.remove("active");
     cEls.chatterboxBackendBtn.classList.add("active");
     cEls.voiceCloningSection.style.display = "block";
   }

   cEls.refreshVoicesBtn.addEventListener("click", async () => {
     await refreshAvatarManifest();
     await refreshVoiceOptions(getCurrentBackend(), { preferAvatar: true, forceRegistry: true });
   });

   await refreshVoiceOptions(currentBackend, { preferAvatar: true, forceRegistry: true });

   cEls.kokoroBackendBtn.addEventListener("click", async () => {
     cEls.kokoroBackendBtn.classList.add("active");
     cEls.chatterboxBackendBtn.classList.remove("active");
     cEls.voiceCloningSection.style.display = "none";
      setOverride("ttsBackend", "kokoro");
      (config as any).ttsBackend = "kokoro";

      await refreshVoiceOptions("kokoro", { preferAvatar: true, forceRegistry: true });
   });

   cEls.chatterboxBackendBtn.addEventListener("click", async () => {
     cEls.chatterboxBackendBtn.classList.add("active");
     cEls.kokoroBackendBtn.classList.remove("active");
     cEls.voiceCloningSection.style.display = "block";
      setOverride("ttsBackend", "chatterbox");
      (config as any).ttsBackend = "chatterbox";

      await refreshVoiceOptions("chatterbox", { preferAvatar: true, forceRegistry: true });
   });

   // Voice cloning handlers
   let voiceRefFile: File | null = null;
   let voiceRefArrayBuffer: ArrayBuffer | null = null;

   cEls.selectVoiceRefBtn.addEventListener("click", () => {
     cEls.voiceRefInput.click();
   });

   cEls.voiceRefInput.addEventListener("change", async () => {
     const files = cEls.voiceRefInput.files;
     if (!files || files.length === 0) return;

     voiceRefFile = files[0];
     voiceRefArrayBuffer = await voiceRefFile.arrayBuffer();
     cEls.voiceRefStatus.textContent = `Selected: ${voiceRefFile.name}`;
     cEls.voiceRefStatus.style.color = "#5bf2d6";
     cEls.clearVoiceRefBtn.disabled = false;

     // Show save section and pre-fill with current avatar name
     cEls.voiceSaveSection.style.display = "block";
     const currentAvatar = findAvatarEntry(avatarManifest, els.avatarSelect.value);
     const suggestedVoice = getSuggestedChatterboxVoice(currentAvatar);
     cEls.voiceSpeakerName.value =
       suggestedVoice ||
       (els.avatarSelect.value || "").toLowerCase().replace(/[^a-z0-9]/g, "_");
   });

   cEls.clearVoiceRefBtn.addEventListener("click", () => {
     voiceRefFile = null;
     voiceRefArrayBuffer = null;
     cEls.voiceRefInput.value = "";
     cEls.voiceRefStatus.textContent = "";
     cEls.clearVoiceRefBtn.disabled = true;
     cEls.voiceSaveSection.style.display = "none";
     setOverride("voiceRefPath", "");
   });

   // Save voice reference to public/voices/chatterbox/
   cEls.saveVoiceRefBtn.addEventListener("click", async () => {
     if (!voiceRefArrayBuffer) {
       cEls.voiceRefStatus.textContent = "No audio file selected";
       cEls.voiceRefStatus.style.color = "#ff6b6b";
       return;
     }

     const speakerName = cEls.voiceSpeakerName.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
     if (!speakerName) {
       cEls.voiceRefStatus.textContent = "Enter a speaker name";
       cEls.voiceRefStatus.style.color = "#ff6b6b";
       return;
     }

     try {
       cEls.voiceRefStatus.textContent = "Saving...";
       cEls.voiceRefStatus.style.color = "var(--muted)";

       // Send to server endpoint to save the file
       const extension = getVoiceFileExtension(voiceRefFile);
       const formData = new FormData();
       const contentType = voiceRefFile?.type || "audio/wav";
       formData.append(
         "file",
         new Blob([voiceRefArrayBuffer], { type: contentType }),
         `${speakerName}.${extension}`
       );
       formData.append("speaker", speakerName);

       const response = await fetch("/api/voices/save", {
         method: "POST",
         body: formData
       });

       if (response.ok) {
         const result = await response.json();
         cEls.voiceRefStatus.textContent = `Saved: ${result.path}`;
         cEls.voiceRefStatus.style.color = "#5bf2d6";

         // Update voice select with new option
         const voicePath = `/voices/chatterbox/${speakerName}.${extension}`;
         const hasVoice = Array.from(els.voiceSelect.options).some(o => o.value === speakerName);
         if (!hasVoice) {
           const opt = document.createElement("option");
           opt.value = speakerName;
           opt.textContent = speakerName;
           els.voiceSelect.appendChild(opt);
         }
         els.voiceSelect.value = speakerName;
         config.ttsVoice = speakerName;
         setOverride("ttsVoice", speakerName);
         setOverride("voiceRefPath", voicePath);
         (config as any).voiceRefPath = voicePath;

         const avatarEntry = findAvatarEntry(avatarManifest, els.avatarSelect.value);
         if (avatarEntry) {
           avatarEntry.chatterbox_voice = speakerName;
         }
         await refreshVoiceOptions("chatterbox", { preferAvatar: true, forceRegistry: true });
       } else {
         // Fallback: download the file for manual placement
         const blob = new Blob([voiceRefArrayBuffer], { type: contentType });
         const url = URL.createObjectURL(blob);
         const a = document.createElement("a");
         a.href = url;
         a.download = `${speakerName}.${extension}`;
         a.click();
         URL.revokeObjectURL(url);

         cEls.voiceRefStatus.innerHTML = `Downloaded <strong>${speakerName}.${extension}</strong> - move to public/voices/chatterbox/`;
         cEls.voiceRefStatus.style.color = "#ffb347";
       }
     } catch (err: any) {
       // Fallback: download the file for manual placement
       const contentType = voiceRefFile?.type || "audio/wav";
       const blob = new Blob([voiceRefArrayBuffer], { type: contentType });
       const url = URL.createObjectURL(blob);
       const a = document.createElement("a");
       a.href = url;
       const extension = getVoiceFileExtension(voiceRefFile);
       a.download = `${speakerName}.${extension}`;
       a.click();
       URL.revokeObjectURL(url);

       cEls.voiceRefStatus.innerHTML = `Downloaded <strong>${speakerName}.${extension}</strong> - move to public/voices/chatterbox/`;
       cEls.voiceRefStatus.style.color = "#ffb347";
     }
   });
};

// Helper to escape HTML for display
const escapeHtml = (text: string): string => {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
};

// Service health check types
interface ServiceHealth {
  llm: boolean;
  audio: boolean;
  stt: boolean;
  tts: boolean;
}

// Check health of MLX services on page load
const checkServiceHealth = async (): Promise<ServiceHealth> => {
  const health: ServiceHealth = {
    llm: false,
    audio: false,
    stt: false,
    tts: false
  };

  // Check LLM service
  try {
    const llmResponse = await fetch(`${config.llmBaseUrl}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(3000)
    });
    health.llm = llmResponse.ok;
  } catch {
    // LLM service offline
  }

  // Check Audio service (includes STT and TTS status)
  try {
    const audioResponse = await fetch(`${config.audioBaseUrl}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(3000)
    });
    if (audioResponse.ok) {
      const audioHealth = await audioResponse.json();
      health.audio = true;
      health.stt = audioHealth.stt_ready ?? false;
      health.tts = audioHealth.tts_ready ?? false;
    }
  } catch {
    // Audio service offline
  }

  return health;
};

// Update UI based on service health
const updateServiceHealthUI = (health: ServiceHealth) => {
  const cEls = getConversationElements();

  // Update individual service dots
  const setDot = (dot: HTMLElement | null, isActive: boolean) => {
    if (!dot) return;
    dot.classList.toggle("active", isActive);
    dot.classList.toggle("error", !isActive);
  };

  setDot(cEls.llmServiceDot, health.llm);
  setDot(cEls.audioServiceDot, health.audio);
  setDot(cEls.sttServiceDot, health.stt);
  setDot(cEls.ttsServiceDot, health.tts);

  const services: string[] = [];
  if (!health.llm) services.push("LLM");
  if (!health.audio) services.push("Audio");
  else {
    if (!health.stt) services.push("STT");
    if (!health.tts) services.push("TTS");
  }

  if (services.length === 0) {
    cEls.canvasStatus.textContent = "All services online";
    cEls.canvasStatus.style.color = "#5bf2d6";
    cEls.startSessionBtn.disabled = false;
    setRuntimeStatusText("All services online");
  } else {
    cEls.canvasStatus.textContent = `Offline: ${services.join(", ")}`;
    cEls.canvasStatus.style.color = "#ff6b6b";
    cEls.startSessionBtn.disabled = true;
    cEls.startSessionBtn.title = `Cannot start session: ${services.join(", ")} service(s) offline`;
    setRuntimeStatusText(`Offline: ${services.join(", ")}`);
  }
};

// Pipeline status helpers
const setPipelineStatus = (
  statusEl: HTMLElement | null,
  dotEl: HTMLElement | null,
  label: string,
  state: "idle" | "active" | "busy" | "error"
) => {
  if (!statusEl || !dotEl) return;
  statusEl.innerHTML = `<span class="status-dot" id="${dotEl.id}"></span>${label}`;
  const newDot = statusEl.querySelector(".status-dot");
  if (newDot) {
    newDot.classList.remove("active", "warning", "error");
    if (state === "active") newDot.classList.add("active");
    else if (state === "busy") newDot.classList.add("warning");
    else if (state === "error") newDot.classList.add("error");
  }
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
  const stopSpeech = () => {
    audioController.stopAnalysisVoice();
    const current = state;
    if (current.duoManager) {
      current.duoManager.stopAll();
      return;
    }
    if (current.head) {
      try {
        current.head.stop();
      } catch {
        // TalkingHead can throw if not fully initialized.
      }
      if (typeof (current.head as any).stopBackgroundAudio === "function") {
        (current.head as any).stopBackgroundAudio();
      }
    }
  };
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
    stopSpeech,
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

  await initConversationControls();
};

init().catch((error) => {
  console.error(error);
  updateStatus(els, "Stage init failed.");
});
