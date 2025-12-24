import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "./lib/config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfg = getConfig();

const registryPath = cfg.registryPath;
let registry = { models: {} };
if (registryPath && fs.existsSync(registryPath)) {
  registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
}

const models = Object.entries(registry.models || {}).map(([id, entry]) => ({
  id,
  type: entry.type || null,
  capabilities: entry.capabilities || [],
  description: entry.description || null,
  tags: entry.tags || []
}));

const repoRoot = cfg.repoRoot;
const voicesDir = path.join(repoRoot, "model-zoo", "mlx", "models", "voices");
let voices = [];
if (fs.existsSync(voicesDir)) {
  voices = fs.readdirSync(voicesDir).filter((name) => !name.startsWith("."));
}

const payload = {
  generated_at: new Date().toISOString(),
  registry_path: registryPath,
  models,
  voices_dir: voicesDir,
  voices
};

const outDir = path.join(repoRoot, "houses", "avatar-labs", "public", "models");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "registry.json");
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n", "utf-8");
console.log(`Wrote ${outPath}`);
