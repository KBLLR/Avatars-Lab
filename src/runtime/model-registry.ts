import type { RegistryModel } from "./types";

type GatewayModel = {
  id?: unknown;
  owned_by?: unknown;
  supports_vision?: unknown;
  is_default?: unknown;
  loaded?: unknown;
  _service?: unknown;
  _audio_lane?: unknown;
};

const gatewayModelsUrl = (baseUrl: string): string => {
  const normalized = baseUrl.replace(/\/$/, "");
  return normalized.endsWith("/v1") ? `${normalized}/models` : `${normalized}/v1/models`;
};

const normalizeGatewayModel = (raw: GatewayModel): RegistryModel | null => {
  if (typeof raw.id !== "string" || !raw.id) return null;

  const service = typeof raw._service === "string" ? raw._service : "";
  const audioLane = typeof raw._audio_lane === "string" ? raw._audio_lane : "";
  const capabilities = new Set<string>();

  if (service === "mlx-llm" || raw.id.startsWith("text/")) capabilities.add("chat");
  if (service === "mlx-vision" || raw.supports_vision === true) capabilities.add("vision");
  if (service === "mlx-embed") capabilities.add("embedding");
  if (audioLane === "stt" || raw.id.startsWith("stt/")) capabilities.add("audio-transcribe");
  if (audioLane === "tts" || raw.id.startsWith("tts/")) capabilities.add("audio-generate");

  return {
    id: raw.id,
    capabilities: [...capabilities],
    description: typeof raw.owned_by === "string" ? `Gateway · ${raw.owned_by}` : "Gateway model",
    type: audioLane || service || null,
    tags: [service, audioLane].filter(Boolean),
    isDefault: raw.is_default === true,
    loaded: raw.loaded === true
  };
};

const loadGatewayModels = async (baseUrl?: string): Promise<RegistryModel[]> => {
  if (!baseUrl) return [];
  try {
    const response = await fetch(gatewayModelsUrl(baseUrl), {
      signal: AbortSignal.timeout(2500)
    });
    if (!response.ok) return [];
    const payload = await response.json();
    if (!Array.isArray(payload?.data)) return [];
    return payload.data
      .map((model: GatewayModel) => normalizeGatewayModel(model))
      .filter((model: RegistryModel | null): model is RegistryModel => model !== null);
  } catch {
    return [];
  }
};

const loadSnapshotModels = async (): Promise<RegistryModel[]> => {
  try {
    const response = await fetch("/models/registry.json");
    if (!response.ok) return [];
    const payload = await response.json();
    return Array.isArray(payload.models) ? payload.models : [];
  } catch {
    return [];
  }
};

export const loadModelRegistry = async (gatewayBaseUrl?: string): Promise<RegistryModel[]> => {
  const gatewayModels = await loadGatewayModels(gatewayBaseUrl);
  return gatewayModels.length ? gatewayModels : loadSnapshotModels();
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
  select: HTMLSelectElement | null,
  models: RegistryModel[],
  selected?: string
): void => {
  if (!select) return;
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
