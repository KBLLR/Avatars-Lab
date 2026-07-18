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

const resolveDefault = (models: RegistryModel[], requested?: string): string =>
  models.find((model) => model.id === requested)?.id ||
  models.find((model) => model.isDefault && model.loaded)?.id ||
  models.find((model) => model.isDefault)?.id ||
  models.find((model) => model.loaded)?.id ||
  models[0]?.id ||
  requested ||
  "";

export const initModelSelectors = async (
  els: ModelSelectorElements,
  config: MlxConfig,
  overrides: MlxOverrides,
  setChip: SetChipFn
): Promise<InitModelSelectorsResult> => {
  const registry = await loadModelRegistry(config.llmBaseUrl);

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

  const llmDefault = resolveDefault(llmModels, overrides.llmModel || config.llmModel);
  const vlmDefault = resolveDefault(
    vlmModels.length ? vlmModels : llmModels,
    overrides.vlmModel || config.vlmModel
  );
  const directorDefault = resolveDefault(
    llmModels,
    overrides.directorModel || config.directorModel || directorModelFallback
  );
  const sttDefault = resolveDefault(sttModels, overrides.sttModel || config.sttModel);
  const ttsDefault = resolveDefault(ttsModels, overrides.ttsModel || config.ttsModel);
  const embedDefault = resolveDefault(embedModels, overrides.embedModel || config.embedModel);

  populateModelSelect(els.llmModelSelect, llmModels, llmDefault);
  populateModelSelect(els.vlmModelSelect, vlmModels.length ? vlmModels : llmModels, vlmDefault);
  populateModelSelect(els.directorModelSelect, llmModels, directorDefault);
  populateModelSelect(els.llmRuntimeModelSelect, llmModels, directorDefault || llmDefault);
  populateModelSelect(els.sttModelSelect, sttModels, sttDefault);
  populateModelSelect(els.ttsModelSelect, ttsModels, ttsDefault);
  populateModelSelect(els.embedModelSelect, embedModels, embedDefault);

  if (llmDefault) {
    config.llmModel = llmDefault;
    if (els.chatChip) setChip(els.chatChip, "Chat", llmDefault);
  }
  if (vlmDefault) {
    config.vlmModel = vlmDefault;
    if (els.vlmChip) setChip(els.vlmChip, "VLM", vlmDefault);
  }
  if (directorDefault) {
    config.directorModel = directorDefault;
    if (els.llmChip) setChip(els.llmChip, "LLM", directorDefault);
  }
  if (sttDefault) {
    config.sttModel = sttDefault;
    if (els.sttChip) setChip(els.sttChip, "STT", sttDefault);
  }
  if (ttsDefault) {
    config.ttsModel = ttsDefault;
    if (els.ttsChip) setChip(els.ttsChip, "TTS", ttsDefault);
  }
  if (embedDefault) {
    config.embedModel = embedDefault;
    if (els.embedChip) setChip(els.embedChip, "Embed", embedDefault);
  }

  return { registry, llmModels, vlmModels, sttModels, ttsModels, embedModels };
};
