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
const facialAssetHydrator = read("scripts/hydrate-facial-assets.mjs");
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
assert.equal(manifest.agents.orchestrator_id, "orchestrator:avatar-labs:avara");
assert.equal(manifest.agents.persona_name, "AVARA");
assert.equal(manifest.agents.default_agent, "avatar-labs:avatar-director");
assert.equal(functionsManifest.items[0].id, manifest.agents.default_agent);
assert.equal(manifest.surface.cases.length, 11); // launcher + 10 curated cases

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
assert.doesNotMatch(viteConfig, /AVATAR_LABS_SMART_CAMPUS_PROP_ROOT|smart-campus-assets/);
assert.match(viteConfig, /AVATAR_LABS_MEDIAPIPE_MODEL_ROOT/);
assert.match(viteConfig, /avatar-labs\.animation-catalog\.v1/);
assert.match(viteConfig, /Content-Range/);
assert.match(devScript, /COREX_GATEWAY_URL.*8090/);
assert.match(devScript, /hydrate-avatar-assets\.mjs/);
assert.match(devScript, /hydrate-facial-assets\.mjs/);
assert.match(assetHydrator, /AVATAR_LABS_ASSET_ROOT/);
assert.match(assetHydrator, /runtime-manifest\.json/);
assert.match(facialAssetHydrator, /face_landmarker\.task/);
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
assert.match(read("src/performance-engine/director.ts"), /timeoutMs: 120_000/);
assert.match(read("src/performance-engine.ts"), /preserveAttachedAudio: true/);
assert.match(read("src/performance-engine.ts"), /randomUnusedBodyAsset/);
assert.match(read("src/performance-engine.ts"), /setActorMutationBusy/);
assert.match(read("src/performance-engine.ts"), /Restore saved project|restoreProjectButton/);
assert.match(read("src/performance-engine.ts"), /actorSeed === null/);
assert.match(read("src/performance-engine/project.ts"), /catalog\.actors\.filter\(\(asset\) => asset\.kind === "body"\)/);
assert.match(read("src/performance-engine/room.ts"), /OrbitControls/);
assert.match(read("src/performance-engine/room.ts"), /createRealismusMaterial/);
assert.match(read("src/performance-engine/room.ts"), /const isEye = !isHair/);
assert.match(read("src/performance-engine/room.ts"), /if \(!isSkin\)[\s\S]*source\.clone\(\)/);
assert.match(read("src/performance-engine/room.ts"), /actorLoadVersions/);
assert.match(read("src/performance-engine/room.ts"), /normalizeWebGpuActorGeometry/);
assert.match(read("src/performance-engine/room.ts"), /deinterleaveGeometry/);
assert.match(read("src/performance-engine/room.ts"), /material\.side = FrontSide/);
assert.match(read("src/performance-engine/room.ts"), /authored\.alphaTest = Math\.max\(authored\.alphaTest, 0\.5\)/);
assert.match(read("src/performance-engine/room.ts"), /CanvasTexture/);
assert.match(read("src/performance-engine/room.ts"), /roughnessMap/);
assert.match(read("src/performance-engine/room.ts"), /bumpMap/);
assert.match(read("src/performance-engine/room.ts"), /crossFadeTo/);
assert.match(read("src/performance-engine/room.ts"), /CAMERA_FLOOR_Y/);
assert.match(read("src/performance-engine/room.ts"), /createStudioHeadPlinth/);
assert.match(read("src/performance-engine/room.ts"), /performanceRoot/);
assert.match(read("src/performance-engine/types.ts"), /pedestal: "studio-plinth" \| "none"/);
assert.doesNotMatch(read("src/performance-engine/room.ts"), /information_pylon|smart-campus-pylon/);
assert.match(read("src/performance-engine/room.ts"), /updateHeadPerformance/);
assert.match(read("src/performance-engine/room.ts"), /setHeadPose/);
assert.match(read("src/performance-engine/schedule.ts"), /outgoing pose alive across contiguous boundaries/);
assert.match(read("src/performance-engine.ts"), /actorY/);
assert.match(read("engine-lab.html"), /performanceBroadcast/);
assert.match(read("src/performance-engine/room.ts"), /HDRI unavailable; using the .* procedural room/);
assert.doesNotMatch(read("src/performance-engine/room.ts"), /throw new Error\(`Environment .* failed/);
assert.match(read("src/directors/camera-director.ts"), /primary narrative system/);
assert.equal(pkg.dependencies["@dimforge/rapier3d-compat"], "0.19.3");
assert.match(read("src/performance-engine/music-analysis.ts"), /\/voice-snip\/transcribe-file/);
assert.match(read("src/performance-engine/music-analysis.ts"), /\/voice-snip\/diarise/);
assert.match(read("src/performance-engine/planning-rehearsal.ts"), /\/v1\/audio\/speech/);
assert.match(read("src/performance-engine/stage-effects.ts"), /rapier3d-compat/);
assert.match(read("src/performance-engine/stage-effects.ts"), /MeshBasicNodeMaterial/);
assert.match(read("src/performance-engine/stage-effects.ts"), /Rapier physics unavailable; keeping shader and particle effects/);
assert.match(read("src/performance-engine/types.ts"), /TRACK_KINDS[\s\S]*"lipsync"/);
assert.match(read("src/performance-engine/types.ts"), /TRACK_KINDS[\s\S]*"stagefx"/);

console.log(
  `Avatar Labs modernization contract OK: ${manifest.surface.cases.length} routes, ` +
  `${functionsManifest.items.length} house agent, Vite ${pkg.devDependencies.vite}`,
);
