import type { RegistryModel, ModelSelectorElements, MlxConfig } from "./types";
import { directorModelFallback } from "../stage/constants";
import {
  loadModelRegistry,
  filterModels,
  dedupeModels,
  isWhisperModel,
  isTtsModel,
  populateModelSelect
} from "./model-registry";

export interface MlxOverrides {
  llmModel?: string;
  vlmModel?: string;
  sttModel?: string;
  ttsModel?: string;
  directorModel?: string;
  embedModel?: string;
}

export interface InitModelSelectorsResult {
  registry: RegistryModel[];
  llmModels: RegistryModel[];
  vlmModels: RegistryModel[];
  sttModels: RegistryModel[];
  ttsModels: RegistryModel[];
  embedModels: RegistryModel[];
}

export type SetChipFn = (chip: HTMLElement, label: string, value: string) => void;

export const initModelSelectors = async (
  els: ModelSelectorElements,
  config: MlxConfig,
  overrides: MlxOverrides,
  setChip: SetChipFn
): Promise<InitModelSelectorsResult> => {
  const registry = await loadModelRegistry();

  const llmModels = filterModels(registry, "chat");
  const vlmModels = dedupeModels([
    ...filterModels(registry, "vision"),
    ...filterModels(registry, "vlm"),
    ...registry.filter((model) => {
      const type = (model.type || "").toLowerCase();
      const id = (model.id || "").toLowerCase();
      const caps = Array.isArray(model.capabilities)
        ? model.capabilities.map((cap) => cap.toLowerCase())
        : [];
      return (
        type.includes("vlm") ||
        type.includes("vision") ||
        caps.includes("vision") ||
        caps.includes("image") ||
        id.includes("vlm") ||
        id.includes("llava") ||
        id.includes("clip")
      );
    })
  ]);
  const sttModels = dedupeModels([
    ...filterModels(registry, "audio-transcribe"),
    ...registry.filter((model) => isWhisperModel(model))
  ]);
  const ttsCandidates = filterModels(registry, "audio-generate");
  const ttsModels = ttsCandidates.filter((model) => isTtsModel(model));
  const embedModels = dedupeModels([
    ...filterModels(registry, "embedding"),
    ...registry.filter((model) => (model.type || "").toLowerCase() === "embedding")
  ]);

  const llmDefault = overrides.llmModel || config.llmModel || "";
  const vlmDefault = overrides.vlmModel || config.vlmModel || "";
  const directorDefault = overrides.directorModel || config.directorModel || directorModelFallback;
  const sttDefault = overrides.sttModel || config.sttModel || "";
  const ttsDefault = overrides.ttsModel || config.ttsModel || "";
  const embedDefault = overrides.embedModel || config.embedModel || "";

  populateModelSelect(els.llmModelSelect, llmModels, llmDefault);
  populateModelSelect(els.vlmModelSelect, vlmModels.length ? vlmModels : llmModels, vlmDefault);
  populateModelSelect(els.directorModelSelect, llmModels, directorDefault);
  populateModelSelect(els.llmRuntimeModelSelect, llmModels, directorDefault || llmDefault);
  populateModelSelect(els.sttModelSelect, sttModels, sttDefault);
  populateModelSelect(els.embedModelSelect, embedModels, embedDefault);

  if (llmDefault) {
    config.llmModel = llmDefault;
    setChip(els.chatChip, "Chat", llmDefault);
  }
  if (vlmDefault) {
    config.vlmModel = vlmDefault;
    setChip(els.vlmChip, "VLM", vlmDefault);
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
  if (embedDefault) {
    config.embedModel = embedDefault;
    setChip(els.embedChip, "Embed", embedDefault);
  }

  return { registry, llmModels, vlmModels, sttModels, ttsModels, embedModels };
};
