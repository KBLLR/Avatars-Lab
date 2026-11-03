import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const houseRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(houseRoot, "../..");
const avatarDir = join(houseRoot, "public", "avatars");
const manifestPath = join(avatarDir, "manifest.json");
const runtimeManifestPath = join(avatarDir, "runtime-manifest.json");
const fixtureDir = join(houseRoot, "fixtures", "avatars");
const fixturePath = join(fixtureDir, "brunette.glb");
const warehouseAvatarRoot = join(
  repoRoot,
  "warehouse",
  "var",
  "cache",
  "objects",
  "avatar-labs",
  "intake-2026-05-05",
  "public",
  "avatars",
);
const riggingStagingRoot = join(repoRoot, "houses", "rigging-portal", "staging", "rigged");
const assetRoot = process.env.AVATAR_LABS_ASSET_ROOT
  ? resolve(process.env.AVATAR_LABS_ASSET_ROOT)
  : null;
const snapshot = process.env.AVATAR_LABS_ASSET_SNAPSHOT ||
  "f30557f438792264d9e173d7f4b6b7f95679e981";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const isGlb = (path) => {
  if (!existsSync(path) || statSync(path).size < 12) return false;
  const fd = openSync(path, "r");
  try {
    const magic = Buffer.alloc(4);
    readSync(fd, magic, 0, 4, 0);
    return magic.toString("ascii") === "glTF";
  } finally {
    closeSync(fd);
  }
};

const extractSnapshotAsset = (file, destination) => {
  const temporary = `${destination}.tmp`;
  const fd = openSync(temporary, "w");
  const result = spawnSync(
    "git",
    ["show", `${snapshot}:public/avatars/${file}`],
    { cwd: houseRoot, stdio: ["ignore", fd, "pipe"] },
  );
  closeSync(fd);

  if (result.status !== 0 || !isGlb(temporary)) {
    unlinkSync(temporary);
    return false;
  }
  renameSync(temporary, destination);
  return true;
};

mkdirSync(avatarDir, { recursive: true });
const canonical = readJson(manifestPath);
const available = [];
const missing = [];

for (const rawEntry of canonical.avatars || []) {
  const entry = typeof rawEntry === "string"
    ? { id: rawEntry.replace(/\.glb$/i, ""), file: rawEntry }
    : rawEntry;
  const file = basename(entry.file || "");
  if (!file.toLowerCase().endsWith(".glb")) continue;

  const destination = join(avatarDir, file);
  const candidateSources = [
    assetRoot ? join(assetRoot, file) : null,
    join(warehouseAvatarRoot, file),
    join(fixtureDir, file),
    join(riggingStagingRoot, entry.id || file.replace(/\.glb$/i, ""), file),
  ].filter(Boolean);

  for (const source of candidateSources) {
    if (!isGlb(destination) && isGlb(source)) {
      copyFileSync(source, destination);
      break;
    }
  }
  if (!isGlb(destination)) extractSnapshotAsset(file, destination);

  // Also hydrate paired .m2mr.fbx if present in Rigging Palace staging
  if (entry.m2mr_fbx) {
    const fbxFile = basename(entry.m2mr_fbx);
    const fbxDest = join(avatarDir, fbxFile);
    const fbxSource = join(riggingStagingRoot, entry.id || "", fbxFile);
    if (!existsSync(fbxDest) && existsSync(fbxSource)) {
      copyFileSync(fbxSource, fbxDest);
    }
  }

  if (isGlb(destination)) available.push({ ...entry, file });
  else missing.push(file);
}

if (available.length === 0 && isGlb(fixturePath)) {
  const file = "preview.glb";
  copyFileSync(fixturePath, join(avatarDir, file));
  available.push({
    id: "preview",
    file,
    display_name: "Preview Avatar",
    body: "F",
    default_mood: "neutral",
    tags: ["fixture"],
  });
}

writeFileSync(runtimeManifestPath, `${JSON.stringify({
  schema_version: "1.0",
  generated_at: new Date().toISOString(),
  source: assetRoot ? "asset-root+git-snapshot" : "git-snapshot",
  source_snapshot: snapshot,
  avatars: available,
  unavailable: missing,
}, null, 2)}\n`);

console.log(
  `[avatar-assets] ${available.length} ready, ${missing.length} unavailable; ` +
  `runtime manifest: ${runtimeManifestPath}`,
);
if (missing.length) console.log(`[avatar-assets] unavailable: ${missing.join(", ")}`);
