import type { StageElements } from "./elements";
import type { StageState } from "./types";
import type { MlxConfig } from "../runtime/types";
import { truncateForVoice } from "../ui/index";

export interface AudioControllerDeps {
  els: StageElements;
  config: MlxConfig;
  getState: () => StageState;
  updateState: (partial: Partial<StageState>) => void;
  updateStatus: (message: string) => void;
}

export interface AudioController {
  ensureAudioContext: (contextLabel: string) => Promise<boolean>;
  enqueueAnalysisVoice: (text: string) => void;
}

export const createAudioController = ({
  els,
  config,
  getState,
  updateState,
  updateStatus
}: AudioControllerDeps): AudioController => {
  const ensureAudioContext = async (contextLabel: string) => {
    const state = getState();
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

  const playAnalysisVoice = async (text: string) => {
    if (!config.audioBaseUrl || !config.ttsModel) {
      els.analysisHint.textContent = "Voiceover disabled (missing TTS model).";
      return;
    }
    const state = getState();
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
    const state = getState();
    const nextQueue = state.analysisVoiceQueue
      .then(() => playAnalysisVoice(trimmed))
      .catch(() => {
        els.analysisHint.textContent = "Voiceover unavailable.";
      });
    updateState({ analysisVoiceQueue: nextQueue });
  };

  return {
    ensureAudioContext,
    enqueueAnalysisVoice
  };
};
