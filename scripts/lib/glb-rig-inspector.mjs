import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from "node:fs";

const GLTF_MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK_TYPE = 0x4e4f534a; // "JSON"

/**
 * Inspect a binary GLB buffer's JSON chunk for authentic armature, skinning,
 * morph-target, and embedded animation counts without requiring a WebGL context.
 */
export function inspectGlbBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20) {
    return null;
  }
  if (buffer.readUInt32LE(0) !== GLTF_MAGIC) {
    return null;
  }
  const chunkLength = buffer.readUInt32LE(12);
  const chunkType = buffer.readUInt32LE(16);
  if (chunkType !== JSON_CHUNK_TYPE || 20 + chunkLength > buffer.length) {
    return null;
  }

  let gltf;
  try {
    gltf = JSON.parse(buffer.subarray(20, 20 + chunkLength).toString("utf8"));
  } catch {
    return null;
  }

  const nodes = Array.isArray(gltf.nodes) ? gltf.nodes : [];
  const skins = Array.isArray(gltf.skins) ? gltf.skins : [];
  const meshes = Array.isArray(gltf.meshes) ? gltf.meshes : [];
  const animations = Array.isArray(gltf.animations) ? gltf.animations : [];

  const jointIndices = new Set();
  for (const skin of skins) {
    if (Array.isArray(skin?.joints)) {
      for (const idx of skin.joints) {
        if (typeof idx === "number") jointIndices.add(idx);
      }
    }
  }

  const jointNamesSample = Array.from(jointIndices)
    .slice(0, 16)
    .map((idx) => (typeof nodes[idx]?.name === "string" ? nodes[idx].name : `joint_${idx}`));

  const targetNames = new Set();
  let maxPrimitiveTargets = 0;
  for (const mesh of meshes) {
    const extraNames = Array.isArray(mesh?.extras?.targetNames) ? mesh.extras.targetNames : [];
    for (const name of extraNames) {
      if (typeof name === "string" && name) targetNames.add(name);
    }
    const primitives = Array.isArray(mesh?.primitives) ? mesh.primitives : [];
    for (const prim of primitives) {
      const count = Array.isArray(prim?.targets) ? prim.targets.length : 0;
      if (count > maxPrimitiveTargets) maxPrimitiveTargets = count;
    }
  }

  const embeddedAnimations = animations
    .map((anim, index) => (typeof anim?.name === "string" && anim.name.trim() ? anim.name.trim() : `clip_${index + 1}`))
    .slice(0, 24);

  const skinCount = skins.length;
  const jointCount = jointIndices.size;
  const morphTargetCount = Math.max(targetNames.size, maxPrimitiveTargets);
  const armatureVerified = skinCount > 0 && jointCount > 0;
  const rigStatus = armatureVerified ? "rigged" : morphTargetCount > 0 ? "head-only" : "static";

  return {
    armatureVerified,
    rigStatus,
    skinCount,
    jointCount,
    jointNamesSample,
    morphTargetCount,
    embeddedAnimationCount: animations.length,
    embeddedAnimations,
    meshCount: meshes.length,
  };
}

/**
 * Read only the GLB header + JSON chunk from disk and inspect rig metadata.
 */
export function inspectGlbFile(filePath) {
  if (!existsSync(filePath)) return null;
  const size = statSync(filePath).size;
  if (size < 20) return null;

  const fd = openSync(filePath, "r");
  try {
    const header = Buffer.alloc(20);
    if (readSync(fd, header, 0, 20, 0) < 20) return null;
    if (header.readUInt32LE(0) !== GLTF_MAGIC || header.readUInt32LE(16) !== JSON_CHUNK_TYPE) {
      return null;
    }
    const chunkLength = header.readUInt32LE(12);
    if (20 + chunkLength > size || chunkLength <= 0 || chunkLength > 32 * 1024 * 1024) {
      return null;
    }
    const jsonBuf = Buffer.alloc(chunkLength);
    if (readSync(fd, jsonBuf, 0, chunkLength, 20) < chunkLength) return null;
    const combined = Buffer.concat([header, jsonBuf]);
    return {
      ...inspectGlbBuffer(combined),
      sizeBytes: size,
    };
  } finally {
    closeSync(fd);
  }
}

export function buildFakeGlb(gltfObject) {
  const jsonBytes = Buffer.from(JSON.stringify(gltfObject), "utf8");
  const pad = (4 - (jsonBytes.length % 4)) % 4;
  const padded = pad ? Buffer.concat([jsonBytes, Buffer.alloc(pad, 0x20)]) : jsonBytes;
  const header = Buffer.alloc(20);
  header.writeUInt32LE(GLTF_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(JSON_CHUNK_TYPE, 16);
  return Buffer.concat([header, padded]);
}
