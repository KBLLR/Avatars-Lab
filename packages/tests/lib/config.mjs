import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const findRepoRoot = (startDir) => {
  let current = startDir;
  while (current && current !== path.dirname(current)) {
    const candidate = path.join(current, "services.manifest.json");
    if (fs.existsSync(candidate)) return current;
    current = path.dirname(current);
  }
  return null;
};

const readJson = (filePath) => {
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw);
};

const getManifest = (repoRoot) => {
  const manifestPath = path.join(repoRoot, "services.manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  const manifest = readJson(manifestPath);
  return { manifest, manifestPath };
};

const getRegistry = (repoRoot) => {
  const envPath = process.env.MLX_REGISTRY_PATH;
  const registryPath = envPath || path.join(repoRoot, "model-zoo", "registry.json");
  if (!fs.existsSync(registryPath)) {
    return { registry: null, registryPath };
  }
  return { registry: readJson(registryPath), registryPath };
};

const resolveServiceUrl = (name, manifest) => {
  const envKey = `MLX_${name.toUpperCase()}_BASE_URL`;
  const legacyEnvKey = `MLX_${name.toUpperCase()}_URL`;
  if (process.env[envKey]) return process.env[envKey];
  if (process.env[legacyEnvKey]) return process.env[legacyEnvKey];

  const entry = manifest?.services?.[name];
  if (entry?.host && entry?.port) {
    return `http://${entry.host}:${entry.port}`;
  }
  return null;
};

const resolveLocalModelPath = (repoRoot, entry) => {
  if (!entry) return null;
  const relPath = entry.path;
  if (relPath) {
    return path.join(repoRoot, "model-zoo", relPath);
  }
  const snapshotPath = entry.local?.snapshot_path;
  if (snapshotPath) {
    return path.join(repoRoot, snapshotPath);
  }
  return null;
};

const findModelByCapability = (registry, capability, repoRoot) => {
  if (!registry?.models) return null;
  const candidates = [];
  for (const [modelId, entry] of Object.entries(registry.models)) {
    const caps = Array.isArray(entry.capabilities) ? entry.capabilities : [];
    if (caps.includes(capability)) {
      const localPath = resolveLocalModelPath(repoRoot, entry);
      const localExists = localPath ? fs.existsSync(localPath) : false;
      candidates.push({ modelId, localExists });
    }
  }
  const localMatch = candidates.find((candidate) => candidate.localExists);
  if (localMatch) return localMatch.modelId;
  return candidates[0]?.modelId || null;
};

const findModelById = (registry, modelId) => {
  if (!registry?.models) return null;
  return registry.models[modelId] ? modelId : null;
};

const assertNoOpenAIKey = () => {
  if (process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is set. Unset it to avoid outbound OpenAI calls.");
  }
};

const getConfig = () => {
  const repoRoot = findRepoRoot(path.resolve(__dirname, "../../../../"));
  if (!repoRoot) {
    throw new Error("Unable to find repo root containing services.manifest.json");
  }

  const { manifest, manifestPath } = getManifest(repoRoot) || {};
  const { registry, registryPath } = getRegistry(repoRoot);

  const llmBaseUrl = resolveServiceUrl("llm", manifest);
  const audioBaseUrl = resolveServiceUrl("audio", manifest);

  const defaultLlmModel = process.env.MLX_DEFAULT_LLM_MODEL || findModelByCapability(registry, "chat", repoRoot);
  const defaultTtsModel = process.env.MLX_DEFAULT_TTS_MODEL || findModelByCapability(registry, "audio-generate", repoRoot);
  const preferredStt =
    findModelById(registry, "hf/mlx-community__whisper-small-mlx-q4") ||
    findModelById(registry, "hf/mlx-community__whisper-large-v3-turbo-4bit");
  const defaultSttModel =
    process.env.MLX_DEFAULT_STT_MODEL ||
    preferredStt ||
    findModelByCapability(registry, "audio-transcribe", repoRoot);
  const defaultTtsVoice = process.env.MLX_DEFAULT_TTS_VOICE || "default";

  return {
    repoRoot,
    manifestPath,
    registryPath,
    llmBaseUrl,
    audioBaseUrl,
    defaultLlmModel,
    defaultTtsModel,
    defaultSttModel,
    defaultTtsVoice,
    dataPoolRoot: process.env.DATA_POOL_ROOT || path.join(repoRoot, "data-pool")
  };
};

export {
  getConfig,
  assertNoOpenAIKey
};
