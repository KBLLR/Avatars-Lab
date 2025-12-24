import type { StageElements } from "../stage/elements";
import type { StageState } from "../stage/types";
import type { MlxConfig } from "./types";

export interface TtsSelectorDeps {
  els: Pick<StageElements, "ttsModelSelect" | "voiceSelect">;
  config: MlxConfig;
  getState: () => StageState;
  updateState: (partial: Partial<StageState>) => void;
  setOverride: (key: string, value: string) => void;
}

const populateTtsModelSelect = ({ els, config, getState }: TtsSelectorDeps): void => {
  const { availableTtsModels } = getState();
  els.ttsModelSelect.innerHTML = "";
  if (availableTtsModels.length === 0) {
    const op = document.createElement("option");
    op.value = config.ttsModel || "";
    op.textContent = "Default (Configured)";
    els.ttsModelSelect.appendChild(op);
    return;
  }

  availableTtsModels.forEach((model) => {
    const op = document.createElement("option");
    op.value = model.id;
    op.textContent = model.id.split("/").pop() || model.id;
    if (model.id === config.ttsModel) op.selected = true;
    els.ttsModelSelect.appendChild(op);
  });
};

const populateVoiceSelect = ({ els, getState }: TtsSelectorDeps): void => {
  const { availableVoices } = getState();
  const current = els.voiceSelect.value;
  els.voiceSelect.innerHTML = "";

  if (availableVoices.length === 0) {
    const op = document.createElement("option");
    op.value = "default";
    op.textContent = "Default";
    els.voiceSelect.appendChild(op);
    return;
  }

  availableVoices.forEach((voice) => {
    const op = document.createElement("option");
    op.value = voice;
    op.textContent = voice;
    if (voice === current) op.selected = true;
    els.voiceSelect.appendChild(op);
  });
};

export const fetchTtsVoices = async (deps: TtsSelectorDeps, modelId: string): Promise<void> => {
  if (!deps.config.audioBaseUrl) return;
  try {
    const url = new URL(`${deps.config.audioBaseUrl}/v1/audio/voices`);
    if (modelId) url.searchParams.set("model_id", modelId);

    const response = await fetch(url.toString());
    if (response.ok) {
      const data = await response.json();
      deps.updateState({ availableVoices: data.data || [] });
      populateVoiceSelect(deps);
    }
  } catch (error) {
    console.warn(`Failed to fetch voices for ${modelId}:`, error);
  }
};

export const fetchTtsModels = async (deps: TtsSelectorDeps): Promise<void> => {
  if (!deps.config.audioBaseUrl) return;
  try {
    const response = await fetch(`${deps.config.audioBaseUrl}/v1/audio/models`);
    if (response.ok) {
      const data = await response.json();
      deps.updateState({ availableTtsModels: data.data || [] });
      populateTtsModelSelect(deps);
      if (deps.els.ttsModelSelect.value) {
        await fetchTtsVoices(deps, deps.els.ttsModelSelect.value);
      }
    }
  } catch (error) {
    console.warn("Failed to fetch TTS models:", error);
  }
};

export const bindTtsSelectors = (deps: TtsSelectorDeps): void => {
  deps.els.ttsModelSelect.addEventListener("change", () => {
    const modelId = deps.els.ttsModelSelect.value;
    deps.config.ttsModel = modelId;
    deps.setOverride("ttsModel", modelId);
    fetchTtsVoices(deps, modelId);
  });

  deps.els.voiceSelect.addEventListener("change", () => {
    deps.config.ttsVoice = deps.els.voiceSelect.value;
  });
};

export const initTtsSelectors = async (
  deps: TtsSelectorDeps,
  options?: { autoFetch?: boolean }
): Promise<void> => {
  bindTtsSelectors(deps);
  if (options?.autoFetch) {
    await fetchTtsModels(deps);
  }
};
