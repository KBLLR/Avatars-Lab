import { getConfig } from "./lib/config.mjs";

const args = new Set(process.argv.slice(2));
const config = getConfig();

const printable = {
  repoRoot: config.repoRoot,
  manifestPath: config.manifestPath,
  registryPath: config.registryPath,
  llmBaseUrl: config.llmBaseUrl,
  audioBaseUrl: config.audioBaseUrl,
  defaultLlmModel: config.defaultLlmModel,
  defaultTtsModel: config.defaultTtsModel,
  defaultSttModel: config.defaultSttModel,
  defaultTtsVoice: config.defaultTtsVoice,
  dataPoolRoot: config.dataPoolRoot
};

  if (args.has("--export-env")) {
  const shellEscape = (value) => {
    const safe = String(value ?? "").replace(/'/g, "'\\''");
    return `'${safe}'`;
  };
  const lines = [
    `export VITE_MLX_LLM_BASE_URL=${shellEscape(config.llmBaseUrl || "")}`,
    `export VITE_MLX_DEFAULT_LLM_MODEL=${shellEscape(config.defaultLlmModel || "")}`,
    `export VITE_MLX_AUDIO_BASE_URL=${shellEscape(config.audioBaseUrl || "")}`,
    `export VITE_MLX_DEFAULT_TTS_MODEL=${shellEscape(config.defaultTtsModel || "")}`,
    `export VITE_MLX_DEFAULT_TTS_VOICE=${shellEscape(config.defaultTtsVoice || "default")}`,
    `export VITE_MLX_DEFAULT_STT_MODEL=${shellEscape(config.defaultSttModel || "")}`
  ];
  console.log(lines.join("\n"));
  process.exit(0);
}

console.log("Avatar Labs config:");
for (const [key, value] of Object.entries(printable)) {
  console.log(`- ${key}: ${value || "(missing)"}`);
}
