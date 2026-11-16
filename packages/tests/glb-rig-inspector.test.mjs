import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFakeGlb, inspectGlbBuffer, inspectGlbFile } from "../../scripts/lib/glb-rig-inspector.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const houseRoot = resolve(here, "../..");

// 1. Synthetic rigged GLB with skin + joints + animation
{
  const riggedGlb = buildFakeGlb({
    asset: { version: "2.0" },
    nodes: [{ name: "mixamorig:Hips" }, { name: "mixamorig:Spine" }, { name: "MeshNode" }],
    skins: [{ joints: [0, 1] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    animations: [{ name: "Idle" }],
  });
  const info = inspectGlbBuffer(riggedGlb);
  assert.ok(info);
  assert.equal(info.armatureVerified, true);
  assert.equal(info.rigStatus, "rigged");
  assert.equal(info.skinCount, 1);
  assert.equal(info.jointCount, 2);
  assert.deepEqual(info.jointNamesSample, ["mixamorig:Hips", "mixamorig:Spine"]);
  assert.equal(info.embeddedAnimationCount, 1);
}

// 2. Synthetic rig-less head (morph targets only, zero skins)
{
  const headGlb = buildFakeGlb({
    asset: { version: "2.0" },
    nodes: [{ name: "Head" }],
    meshes: [{ primitives: [{ targets: [{ POSITION: 1 }, { POSITION: 2 }] }], extras: { targetNames: ["jawOpen", "eyeBlinkLeft"] } }],
  });
  const info = inspectGlbBuffer(headGlb);
  assert.ok(info);
  assert.equal(info.armatureVerified, false);
  assert.equal(info.rigStatus, "head-only");
  assert.equal(info.skinCount, 0);
  assert.equal(info.jointCount, 0);
  assert.equal(info.morphTargetCount, 2);
}

// 3. Real fixture / hydrated avatar GLB check
const fixturePath = join(houseRoot, "fixtures/avatars/brunette.glb");
if (existsSync(fixturePath)) {
  const brunette = inspectGlbFile(fixturePath);
  assert.ok(brunette);
  assert.equal(brunette.armatureVerified, true);
  assert.ok(brunette.jointCount > 20, `expected >20 joints on brunette.glb, got ${brunette.jointCount}`);
}

const miaChar = join(houseRoot, "public/avatars/drive_char_1319.glb");
if (existsSync(miaChar)) {
  const mia = inspectGlbFile(miaChar);
  assert.ok(mia);
  assert.equal(mia.armatureVerified, true);
  assert.ok(mia.jointCount >= 52, `expected >=52 joints on drive_char_1319.glb, got ${mia.jointCount}`);
}

console.log("GLB rig inspector tests passed.");
