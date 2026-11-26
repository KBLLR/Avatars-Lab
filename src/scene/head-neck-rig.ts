import {
  Bone, Box3, Float32BufferAttribute, Matrix4, Mesh, Object3D, Skeleton,
  SkinnedMesh, Uint16BufferAttribute, Vector3,
} from "three";

export type NeckMotion = "turn" | "yes" | "no";
export const NECK_MOTION_MS = 2400;

export function createHeadNeckRig(root: Object3D) {
  root.updateWorldMatrix(true, true);
  const worldToRoot = root.matrixWorld.clone().invert();
  const bounds = new Box3();
  const parts: { mesh: Mesh; toRoot: Matrix4; followsHead: boolean }[] = [];
  root.traverse((node) => {
    if (!(node instanceof Mesh) || !node.geometry.attributes.position || !node.parent) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
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
    parts.push({ mesh: node, toRoot, followsHead });
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
  root.updateWorldMatrix(true, true);
  const skeleton = new Skeleton([chest, neck, head]);

  for (const { mesh, toRoot, followsHead } of parts) {
    const geometry = mesh.geometry.clone();
    const position = geometry.attributes.position;
    const indices = new Uint16Array(position.count * 4);
    const weights = new Float32Array(position.count * 4);
    for (let i = 0; i < position.count; i++) {
      const y = (point.fromBufferAttribute(position, i).applyMatrix4(toRoot).y - bounds.min.y) / size.y;
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
    pose(motion: NeckMotion, progress: number) {
      const phase = Math.max(0, Math.min(1, progress));
      const envelope = Math.sin(Math.PI * phase) ** 2;
      const yaw = motion === "turn" ? envelope * 0.45
        : motion === "no" ? envelope * Math.sin(4 * Math.PI * phase) * 0.38 : 0;
      const pitch = motion === "yes" ? envelope * Math.sin(4 * Math.PI * phase) * 0.32 : 0;
      neck.rotation.set(pitch * 0.35, yaw * 0.35, 0);
      head.rotation.set(pitch * 0.65, yaw * 0.65, 0);
    },
  };
}

const point = new Vector3();
function smoothstep(value: number, low: number, high: number): number {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}
