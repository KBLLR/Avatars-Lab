type MlxOverrides = {
  llmModel?: string;
  vlmModel?: string;
  sttModel?: string;
  ttsModel?: string;
  directorModel?: string;
  embedModel?: string;
};

const STORAGE_KEY = "avatarLabs.mlxOverrides";

const readOverrides = (): MlxOverrides => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const writeOverrides = (overrides: MlxOverrides) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
};

const setOverride = (key: keyof MlxOverrides, value: string | undefined) => {
  const overrides = readOverrides();
  if (value) {
    overrides[key] = value;
  } else {
    delete overrides[key];
  }
  writeOverrides(overrides);
};

const getMlxConfig = () => {
  const overrides = readOverrides();
  const llmModel = overrides.llmModel || import.meta.env.VITE_MLX_DEFAULT_LLM_MODEL;
  const vlmModel = overrides.vlmModel || import.meta.env.VITE_MLX_DEFAULT_VLM_MODEL || llmModel;
  const sttModel = overrides.sttModel || import.meta.env.VITE_MLX_DEFAULT_STT_MODEL;
  const ttsModel = overrides.ttsModel || import.meta.env.VITE_MLX_DEFAULT_TTS_MODEL;
  const directorModel = overrides.directorModel || llmModel;
  const embedModel = overrides.embedModel || import.meta.env.VITE_MLX_DEFAULT_EMBED_MODEL;

  return {
    llmBaseUrl: import.meta.env.VITE_MLX_LLM_BASE_URL,
    audioBaseUrl: import.meta.env.VITE_MLX_AUDIO_BASE_URL,
    vlmBaseUrl:
      import.meta.env.VITE_MLX_VLM_BASE_URL ||
      import.meta.env.VITE_MLX_VLM_URL ||
      "http://127.0.0.1:8082",
    dataLakeUrl:
      import.meta.env.VITE_DATA_LAKE_URL ||
      import.meta.env.VITE_MLX_DATA_LAKE_URL ||
      "http://127.0.0.1:8012",
    llmModel,
    vlmModel,
    sttModel,
    ttsModel,
    directorModel,
    embedModel,
    ttsVoice: import.meta.env.VITE_MLX_DEFAULT_TTS_VOICE || "default"
  };
};

export { getMlxConfig, setOverride, readOverrides };
