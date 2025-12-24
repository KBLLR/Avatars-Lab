import type { RegistryModel } from "./types";

export const loadModelRegistry = async (): Promise<RegistryModel[]> => {
  try {
    const response = await fetch("/models/registry.json");
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload.models) ? payload.models : [];
  } catch {
    return [];
  }
};

export const filterModels = (registry: RegistryModel[], capability: string): RegistryModel[] =>
  registry.filter((model) => Array.isArray(model.capabilities) && model.capabilities.includes(capability));

export const isWhisperModel = (model: RegistryModel): boolean => {
  const id = (model.id || "").toLowerCase();
  const desc = (model.description || "").toLowerCase();
  return id.includes("whisper") || desc.includes("whisper");
};

export const isTtsModel = (model: RegistryModel): boolean => {
  const id = (model.id || "").toLowerCase();
  const type = (model.type || "").toLowerCase();
  const desc = (model.description || "").toLowerCase();
  if (type.includes("text-to-speech") || desc.includes("text-to-speech")) {
    return true;
  }
  return id.includes("tts") || id.includes("chatterbox") || id.includes("kokoro");
};

export const dedupeModels = (models: RegistryModel[]): RegistryModel[] => {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
};

export const modelLabel = (model: RegistryModel): string => {
  const desc = model.description ? ` - ${model.description}` : "";
  return `${model.id}${desc}`;
};

export const populateModelSelect = (
  select: HTMLSelectElement,
  models: RegistryModel[],
  selected?: string
): void => {
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
    const match = models.find((m) => m.id === selected);
    if (match) {
      select.value = selected;
    }
  }
};
