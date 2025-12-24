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
  sttModel?: string;
  ttsModel?: string;
  directorModel?: string;
}

export interface InitModelSelectorsResult {
  registry: RegistryModel[];
  llmModels: RegistryModel[];
  sttModels: RegistryModel[];
  ttsModels: RegistryModel[];
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
  const sttModels = dedupeModels([
    ...filterModels(registry, "audio-transcribe"),
    ...registry.filter((model) => isWhisperModel(model))
  ]);
  const ttsCandidates = filterModels(registry, "audio-generate");
  const ttsModels = ttsCandidates.filter((model) => isTtsModel(model));

  const llmDefault = overrides.llmModel || config.llmModel || "";
  const directorDefault = overrides.directorModel || config.directorModel || directorModelFallback;
  const sttDefault = overrides.sttModel || config.sttModel || "";
  const ttsDefault = overrides.ttsModel || config.ttsModel || "";

  populateModelSelect(els.llmModelSelect, llmModels, llmDefault);
  populateModelSelect(els.directorModelSelect, llmModels, directorDefault);
  populateModelSelect(els.llmRuntimeModelSelect, llmModels, directorDefault || llmDefault);
  populateModelSelect(els.sttModelSelect, sttModels, sttDefault);

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

  return { registry, llmModels, sttModels, ttsModels };
};
