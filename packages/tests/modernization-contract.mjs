import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const houseRoot = path.resolve(testsDir, "../..");
const read = (relativePath) => fs.readFileSync(path.join(houseRoot, relativePath), "utf8");
const readJson = (relativePath) => JSON.parse(read(relativePath));

const pkg = readJson("package.json");
const manifest = readJson("house.manifest.json");
const functionsManifest = readJson("functions.manifest.json");
const viteConfig = read("vite.config.mjs");
const devScript = read("scripts/dev.zsh");
const assetHydrator = read("scripts/hydrate-avatar-assets.mjs");
const styles = read("src/styles/avatar-labs.css");
const workbenchStyles = read("src/styles/case-workbench.css");
const audioStream = read("src/runtime/audio-stream.ts");
const sourceFiles = fs
  .readdirSync(path.join(houseRoot, "src"), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(?:ts|tsx|js|mjs)$/.test(entry.name))
  .map((entry) => read(path.relative(houseRoot, path.join(entry.parentPath, entry.name))))
  .join("\n");

assert.equal(pkg.devDependencies.vite, "8.1.5");
assert.equal(pkg.devDependencies.three, "0.185.1");
assert.equal(pkg.engines.node, ">=22.12.0");
assert.equal(manifest.house_id, "avatar-labs");
assert.equal(manifest.surface.base_url, "http://127.0.0.1:5185");
assert.equal(manifest.agents.default_agent, "avatar-labs:avatar-director");
assert.equal(functionsManifest.items[0].id, manifest.agents.default_agent);

for (const item of manifest.surface.cases) {
  if (item.path === "/") continue;
  assert.ok(
    fs.existsSync(path.join(houseRoot, item.path.slice(1))),
    `missing case entrypoint: ${item.path}`,
  );
}

for (const item of functionsManifest.items) {
  assert.ok(
    fs.existsSync(path.resolve(houseRoot, item.promptPath)),
    `missing agent prompt: ${item.promptPath}`,
  );
}

assert.match(viteConfig, /configurePreviewServer/);
assert.match(viteConfig, /rolldownOptions/);
assert.match(viteConfig, /AVATAR_LABS_VITE_PORT/);
assert.match(viteConfig, /AVATAR_LABS_COREX_PUBLIC_ROOT/);
assert.match(viteConfig, /AVATAR_LABS_ANIMATION_ROOT/);
assert.match(viteConfig, /AVATAR_LABS_RPM_ANIMATION_ROOT/);
assert.match(viteConfig, /avatar-labs\.animation-catalog\.v1/);
assert.match(viteConfig, /Content-Range/);
assert.match(devScript, /COREX_GATEWAY_URL.*8090/);
assert.match(devScript, /hydrate-avatar-assets\.mjs/);
assert.match(assetHydrator, /AVATAR_LABS_ASSET_ROOT/);
assert.match(assetHydrator, /runtime-manifest\.json/);
assert.doesNotMatch(devScript, /MLX_LLM_PORT:-8080|MLX_AUDIO_PORT:-7001/);
assert.doesNotMatch(devScript, /mlx-services\/(?:llm|audio)/);
assert.doesNotMatch(styles, /fonts\.googleapis\.com/);
assert.doesNotMatch(workbenchStyles, /letter-spacing:\s*-/);
for (const item of manifest.surface.cases) {
  if (["/", "/gemma-avatar.html", "/corex-head.html"].includes(item.path)) continue;
  const html = read(item.path.slice(1));
  assert.match(html, /case-workbench\.css/);
  assert.match(html, /workbench-shell\.ts/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com/);
}
assert.match(audioStream, /\/v1\/audio\/speech\/stream/);
assert.doesNotMatch(sourceFiles, /\/v1\/chat\/completions/);
assert.match(sourceFiles, /\/v1\/responses/);
assert.ok(fs.existsSync(path.join(houseRoot, "src/performance-engine/schedule.worker.ts")));
assert.match(read("engine-lab.html"), /performance-engine\.ts/);
assert.match(read("src/performance-engine/types.ts"), /avatar-labs\.performance-project\.v1/);
assert.match(read("src/performance-engine/director.ts"), /PerformanceShowDirector/);
assert.equal(pkg.dependencies["@dimforge/rapier3d-compat"], "0.19.3");
assert.match(read("src/performance-engine/music-analysis.ts"), /\/voice-snip\/transcribe-file/);
assert.match(read("src/performance-engine/music-analysis.ts"), /\/voice-snip\/diarise/);
assert.match(read("src/performance-engine/planning-rehearsal.ts"), /\/v1\/audio\/speech/);
assert.match(read("src/performance-engine/stage-effects.ts"), /rapier3d-compat/);
assert.match(read("src/performance-engine/stage-effects.ts"), /MeshBasicNodeMaterial/);
assert.match(read("src/performance-engine/types.ts"), /TRACK_KINDS[\s\S]*"lipsync"/);
assert.match(read("src/performance-engine/types.ts"), /TRACK_KINDS[\s\S]*"stagefx"/);

console.log(
  `Avatar Labs modernization contract OK: ${manifest.surface.cases.length} routes, ` +
  `${functionsManifest.items.length} house agent, Vite ${pkg.devDependencies.vite}`,
);
