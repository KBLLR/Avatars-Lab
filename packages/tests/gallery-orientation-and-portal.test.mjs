import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Group, Object3D, Vector3 } from "three";

const here = dirname(fileURLToPath(import.meta.url));
const houseRoot = resolve(here, "../..");

// Dynamically import TS module via Vite/Node 22 strip-types or inline contract test + Three.js check
const { normalizeStandingBodyUpAxis, HEAD_ROSTER } = await import("../../src/scene/avatar-orientation.ts");

// 1. Z-up exported character (like Adam, Donna, Eli lying along -Z) rotates upright to Y+
{
  const root = new Group();
  const arm = new Group();
  arm.name = "Armature";
  const hips = new Object3D();
  hips.name = "Hips";
  hips.position.set(0, 0, -0.95);
  const head = new Object3D();
  head.name = "Head";
  head.position.set(0, 0, -1.75);
  arm.add(hips, head);
  root.add(arm);

  const res = normalizeStandingBodyUpAxis(root);
  assert.ok(Math.abs(res.rotatedXRad - Math.PI / 2) < 1e-4, `expected +PI/2 rotation, got ${res.rotatedXRad}`);

  const headWorld = head.getWorldPosition(new Vector3());
  const hipsWorld = hips.getWorldPosition(new Vector3());
  assert.ok(headWorld.y > 1.5, `expected headWorld.y > 1.5, got ${headWorld.y}`);
  assert.ok(headWorld.y > hipsWorld.y, "expected head above hips after Y+ normalization");
}

// 2. Already Y+ upright character (like Rick, Dave, Chloe) keeps zero X rotation
{
  const root = new Group();
  const hips = new Object3D();
  hips.name = "Hips";
  hips.position.set(0, 0.95, 0);
  const head = new Object3D();
  head.name = "Head";
  head.position.set(0, 1.75, 0);
  root.add(hips, head);

  const res = normalizeStandingBodyUpAxis(root);
  assert.equal(res.rotatedXRad, 0);
}

// 3. Core-X heads carry canonical hair definitions where applicable
assert.ok(HEAD_ROSTER.kbllr.hairUrl?.includes("kbllr-hair.glb"));
assert.ok(HEAD_ROSTER.anja.hairUrl?.includes("anja-hair.glb"));
assert.ok(HEAD_ROSTER["susi-q"].hairUrl?.includes("susi-q-hair.glb"));

// 4. Floating Rigging Vault drawer and Mocap Lab wiring exist
const shellSrc = readFileSync(join(houseRoot, "src/cases/workbench-shell.ts"), "utf8");
assert.match(shellSrc, /caseVaultDrawer/);
assert.match(shellSrc, /fetchRiggingPortalCharacters/);

const mocapSrc = readFileSync(join(houseRoot, "src/mocap-lab.ts"), "utf8");
assert.match(mocapSrc, /fetchRiggingPortalCharacters/);
assert.match(mocapSrc, /COREX_SELECT_CHARACTER_EVENT/);
assert.match(mocapSrc, /normalizeStandingBodyUpAxis/);

console.log("Gallery orientation, Core-X head & Rigging Vault contract tests passed.");
