import type { TalkingHead } from "@met4citizen/talkinghead";
import type { StageElements } from "./elements";
import type { StageState } from "./types";
import type { MlxConfig } from "../runtime/types";

export interface BootstrapDeps {
  els: StageElements;
  config: MlxConfig;
  directorModelFallback: string;
  getLightLabel: (presetId: string) => string;
  getState: () => StageState;
  updateState: (partial: Partial<StageState>) => void;
  applyPlanApproved: (approved: boolean) => void;
  initControls: () => void;
  initModelSelectors: () => Promise<void>;
  refreshRuntimePanel: () => Promise<void>;
  setRuntimeStatusText: (text: string) => void;
  loadAvatarList: () => Promise<void>;
  resetHead: () => void;
  loadAvatar: () => Promise<void>;
  initHeadAudio: () => Promise<void>;
  initLipsync: (head: TalkingHead | null) => void;
  decodeAudioFile: (file: File, audioCtx: AudioContext) => Promise<AudioBuffer>;
  handleFile: (file: File) => Promise<void>;
  transcribeAudio: () => Promise<void>;
  analyzePerformance: () => Promise<void>;
  performSong: () => Promise<void>;
  stopPerformance: () => void;
  bindControls: () => void;
  setHud: (scene: string, camera: string, lights: string, mode: string) => void;
  setChip: (chip: HTMLElement, label: string, value: string) => void;
  updateHero: (avatarName?: string, songName?: string, status?: string) => void;
  updateStatus: (message: string) => void;
  speakWithLipsync: (text: string) => Promise<void>;
}

export const bootstrapStage = async ({
  els,
  config,
  directorModelFallback,
  getLightLabel,
  getState,
  updateState,
  applyPlanApproved,
  initControls,
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
  bindControls,
  setHud,
  setChip,
  updateHero,
  updateStatus,
  speakWithLipsync
}: BootstrapDeps): Promise<void> => {
  const state = getState();
  setHud("Idle", state.cameraSettings.view, getLightLabel(state.lightPreset), "Awaiting");
  setChip(els.sttChip, "STT", config.sttModel || "-");
  setChip(els.chatChip, "Chat", config.llmModel || "-");
  setChip(els.vlmChip, "VLM", config.vlmModel || "-");
  const defaultDirector = config.directorModel || directorModelFallback;
  setChip(els.llmChip, "LLM", defaultDirector);
  setChip(els.embedChip, "Embed", config.embedModel || "-");
  setChip(els.audioChip, "Audio", "-");
  updateHero(undefined, undefined, "Awaiting Audio");
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
    updateStatus(`Failed to load avatars: ${message}`);
  }

  resetHead();
  loadAvatar()
    .then(initHeadAudio)
    .then(() => {
      initLipsync(getState().head);
    })
    .catch(() => updateStatus("Avatar preview requires a user gesture."));

  els.avatarSelect.addEventListener("change", () => {
    resetHead();
    loadAvatar()
      .then(initHeadAudio)
      .then(async () => {
        const nextState = getState();
        initLipsync(nextState.head);
        if (nextState.audioFile && nextState.head) {
          const audioBuffer = await decodeAudioFile(nextState.audioFile, nextState.head.audioCtx);
          updateState({ audioBuffer });
        }
        return null;
      })
      .catch((error) => updateStatus(error instanceof Error ? error.message : "Failed to load avatar."));
  });

  els.songInput.addEventListener("change", () => {
    const file = els.songInput.files?.[0];
    if (!file) return;
    handleFile(file).catch((error) => updateStatus(error instanceof Error ? error.message : "Failed to load audio."));
  });

  els.transcribeBtn.addEventListener("click", () => {
    transcribeAudio().catch((error) =>
      updateStatus(error instanceof Error ? error.message : "Transcribe failed.")
    );
  });

  els.analyzeBtn.addEventListener("click", () => {
    analyzePerformance().catch((error) =>
      updateStatus(error instanceof Error ? error.message : "Analysis failed.")
    );
  });

  els.playBtn.addEventListener("click", () => {
    performSong().catch((error) =>
      updateStatus(error instanceof Error ? error.message : "Performance failed.")
    );
  });

  els.lipsyncBtn.addEventListener("click", () => {
    const text = els.transcript.value || "Hello, I am ready to lipsync.";
    speakWithLipsync(text).catch((error) =>
      updateStatus(error instanceof Error ? `Lipsync failed: ${error.message}` : "Lipsync failed.")
    );
  });

  els.stopBtn.addEventListener("click", () => {
    stopPerformance();
  });

  bindControls();
};
