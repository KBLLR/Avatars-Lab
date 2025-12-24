import fs from "node:fs";
import { getConfig } from "./lib/config.mjs";

const cfg = getConfig();
const lines = [
  `VITE_MLX_LLM_BASE_URL=${cfg.llmBaseUrl || ""}`,
  `VITE_MLX_AUDIO_BASE_URL=${cfg.audioBaseUrl || ""}`,
  `VITE_MLX_DEFAULT_LLM_MODEL=${cfg.defaultLlmModel || ""}`,
  `VITE_MLX_DEFAULT_TTS_MODEL=${cfg.defaultTtsModel || ""}`,
  `VITE_MLX_DEFAULT_STT_MODEL=${cfg.defaultSttModel || ""}`,
  `VITE_MLX_DEFAULT_TTS_VOICE=${cfg.defaultTtsVoice || "default"}`
];

fs.writeFileSync(new URL("../../.env.local", import.meta.url), lines.join("\n") + "\n", "utf-8");
console.log("Wrote .env.local");
