import {
  Bone, Box3, Float32BufferAttribute, Matrix4, Mesh, Object3D, Skeleton,
  SkinnedMesh, Uint16BufferAttribute, Vector3,
} from "three";

import type { HeadPose } from "./head-expression-motion";

export const HEAD_MOTION_LIMITS = { pitch: 0.22, yaw: 0.46, roll: 0.14 };
export const EYE_GAZE_LIMITS = { pitch: 0.11, yaw: 0.16 };

export function createHeadNeckRig(root: Object3D) {
  root.updateWorldMatrix(true, true);
  const worldToRoot = root.matrixWorld.clone().invert();
  const bounds = new Box3();
  const parts: { mesh: Mesh; toRoot: Matrix4; followsHead: boolean; isEye: boolean }[] = [];
  root.traverse((node) => {
    if (!(node instanceof Mesh) || !node.geometry.attributes.position || !node.parent) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const isEye = materials.every((mat) => /^eyes?(?:[.:]|$)/i.test(mat.name));
    let followsHead = materials.every((mat) => /eye|lash|teeth|mouth_interior|fluid/i.test(mat.name));
    for (let parent: Object3D | null = node; parent && parent !== root; parent = parent.parent) {
      followsHead ||= Boolean(parent.userData.corexHairFor || /eyeball/i.test(parent.name));
    }
    const toRoot = new Matrix4().multiplyMatrices(worldToRoot, node.matrixWorld);
    const position = node.geometry.attributes.position;
    if (!followsHead) {
      for (let i = 0; i < position.count; i++) {
        bounds.expandByPoint(point.fromBufferAttribute(position, i).applyMatrix4(toRoot));
      }
    }
    parts.push({ mesh: node, toRoot, followsHead, isEye });
  });
  const size = bounds.getSize(new Vector3());
  if (!Number.isFinite(size.y) || size.y <= 0) throw new Error("Head has no usable neck bounds");

  const chest = new Bone();
  const neck = new Bone();
  const head = new Bone();
  chest.name = "ChestAnchor";
  neck.name = "Neck";
  head.name = "Head";
  const center = bounds.getCenter(new Vector3());
  chest.position.set(center.x, bounds.min.y, center.z);
  neck.position.y = size.y * 0.17;
  head.position.y = size.y * 0.26;
  root.add(chest);
  chest.add(neck);
  neck.add(head);
  // A single eye primitive may contain two globes. Split spatially and fit
  // each pivot to its own vertices so gaze also works on those exports.
  const eyeBounds = [new Box3(), new Box3()];
  const eyeIndex = (x: number) => x < center.x ? 0 : 1;
  for (const { mesh, toRoot, isEye } of parts) {
    if (!isEye) continue;
    const position = mesh.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(toRoot);
      eyeBounds[eyeIndex(point.x)].expandByPoint(point);
    }
  }
  const headPivot = chest.position.clone().add(neck.position).add(head.position);
  const eyes = eyeBounds.map((box, index) => {
    const eye = new Bone();
    eye.name = index === 0 ? "EyeNegativeX" : "EyePositiveX";
    eye.position.copy(box.isEmpty() ? headPivot : box.getCenter(new Vector3())).sub(headPivot);
    head.add(eye);
    return eye;
  });
  root.updateWorldMatrix(true, true);
  const skeleton = new Skeleton([chest, neck, head, ...eyes]);

  const geometries: Mesh["geometry"][] = [];
  for (const { mesh, toRoot, followsHead, isEye } of parts) {
    const geometry = mesh.geometry.clone();
    geometries.push(geometry);
    const position = geometry.attributes.position;
    const indices = new Uint16Array(position.count * 4);
    const weights = new Float32Array(position.count * 4);
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(toRoot);
      if (isEye) {
        indices[i * 4] = 3 + eyeIndex(point.x);
        weights[i * 4] = 1;
        continue;
      }
      const y = (point.y - bounds.min.y) / size.y;
      const neckWeight = followsHead ? 1 : smoothstep(y, 0.08, 0.28);
      const headWeight = followsHead ? 1 : smoothstep(y, 0.25, 0.47);
      indices.set([0, 1, 2, 0], i * 4);
      weights.set([1 - neckWeight, neckWeight * (1 - headWeight), neckWeight * headWeight, 0], i * 4);
    }
    geometry.setAttribute("skinIndex", new Uint16BufferAttribute(indices, 4));
    geometry.setAttribute("skinWeight", new Float32BufferAttribute(weights, 4));
    const skinned = new SkinnedMesh(geometry, mesh.material);
    Mesh.prototype.copy.call(skinned, mesh, false);
    skinned.geometry = geometry;
    skinned.frustumCulled = false;
    const parent = mesh.parent!;
    for (const child of mesh.children.slice()) skinned.add(child);
    parent.remove(mesh);
    parent.add(skinned);
    skinned.updateWorldMatrix(true, false);
    skinned.bind(skeleton, skinned.matrixWorld);
  }

  return {
    pose(pose: HeadPose, gaze: Pick<HeadPose, "pitch" | "yaw">) {
      const pitch = bounded(pose.pitch, HEAD_MOTION_LIMITS.pitch);
      const yaw = bounded(pose.yaw, HEAD_MOTION_LIMITS.yaw);
      const roll = bounded(pose.roll, HEAD_MOTION_LIMITS.roll);
      neck.rotation.set(pitch * 0.35, yaw * 0.35, roll * 0.35, "YXZ");
      head.rotation.set(pitch * 0.65, yaw * 0.65, roll * 0.65, "YXZ");
      for (const eye of eyes) {
        eye.rotation.set(bounded(gaze.pitch, EYE_GAZE_LIMITS.pitch),
          bounded(gaze.yaw, EYE_GAZE_LIMITS.yaw), 0, "YXZ");
      }
    },
    dispose() {
      skeleton.dispose();
      for (const geometry of geometries) geometry.dispose();
    },
  };
}

const point = new Vector3();
function smoothstep(value: number, low: number, high: number): number {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

function bounded(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}
