import { MeshPhysicalNodeMaterial } from "three/webgpu";
import { FrontSide, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, Vector3 } from "three";
import { calibrateChatAvatarEyes } from "./studio-scene-template";
export {
  HEAD_ROSTER,
  normalizeStandingBodyUpAxis,
  resolveHeadDefinition,
  type HeadDefinition,
} from "./avatar-orientation";

/**
 * Normalizes ChatAvatar heads: raw eyeball scale adoption, eye alignment calibration,
 * hiding occlusion shells, and FrontSide eye rendering.
 */
const COREX_CALIBRATED_HEADS = new Set([
  "vee", "sofia", "eli", "susi-q",
  "raffaella", "evren", "malina", "trunks", "mystery-girl", "mystery-girl-2", "me", "me-kid",
]);

export function usesCoreXHeadFinish(headId: string): boolean {
  return COREX_CALIBRATED_HEADS.has(headId);
}

/** Apply the Core-X canonical skin policy after any preview material upgrade. */
export function applyCoreXHeadFinish(scene: Object3D, headId: string): void {
  if (!usesCoreXHeadFinish(headId)) return;
  scene.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const mat of materials) {
      if (!(mat instanceof MeshStandardMaterial || mat instanceof MeshPhysicalNodeMaterial)) continue;
      const role = mat.name.toLowerCase().split(/[.:]/, 1)[0];
      if (role === "face" || role === "backhead") {
        // Core-X avatar-loader skinRoughnessFor preserves the authored map.
        mat.roughness = mat.roughnessMap ? 1 : 0.52;
        // Core-X's WebGPU node-skin upgrade copies the factor without the map.
        if (mat instanceof MeshPhysicalNodeMaterial) mat.roughnessMap = null;
        mat.metalness = 0;
        mat.aoMap = null;
        mat.side = FrontSide;
        mat.transparent = false;
        mat.depthWrite = true;
        mat.depthTest = true;
        if (mat instanceof MeshPhysicalMaterial || "transmission" in mat) {
          const skin = mat as MeshPhysicalMaterial | MeshPhysicalNodeMaterial;
          skin.transmission = 0;
          skin.thickness = 0;
          skin.sheen = 0;
          skin.clearcoat = 0;
          skin.iridescence = 0;
          skin.ior = 1.5;
        }
        mat.needsUpdate = true;
      } else if (headId === "susi-q" && /^eyes?$/.test(role) && mat instanceof MeshPhysicalMaterial) {
        // Core-X chatavatar-eye-calibration.ts settings.
        mat.side = FrontSide;
        mat.roughness = 0.18;
        mat.clearcoat = 0.28;
        mat.clearcoatRoughness = 0.08;
        mat.specularIntensity = 0.72;
        mat.envMapIntensity = 0.55;
        mat.ior = 1.38;
        mat.needsUpdate = true;
      }
    }
  });
}

export function normalizeChatAvatarHead(headScene: Object3D, headId?: string): void {
  headScene.updateMatrixWorld(true);

  let faceMesh: Mesh | null = null;
  headScene.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!faceMesh && mesh.isMesh && (mesh.morphTargetInfluences?.length ?? 0) > 0) {
      faceMesh = mesh;
    }
  });
  const faceWorldScale = faceMesh ? (faceMesh as Mesh).getWorldScale(new Vector3()).x : 1;

  for (const name of ["eyeball_left", "eyeball_right"]) {
    const node = headScene.getObjectByName(name);
    if (!node || node.userData.eyeCalibrated) continue;
    const eyeWorldScale = node.getWorldScale(new Vector3()).x;
    const ratio = faceWorldScale / eyeWorldScale;
    if (Number.isFinite(ratio) && ratio > 0 && (ratio < 0.5 || ratio > 2)) {
      node.scale.multiplyScalar(ratio);
      node.position.multiplyScalar(ratio);
    }
  }
  if (headId === "susi-q") {
    calibrateChatAvatarEyes(headScene, { scale: 1.28, depthOffset: -0.52 });
  } else if (!headId || !COREX_CALIBRATED_HEADS.has(headId)) {
    calibrateChatAvatarEyes(headScene);
  }
  headScene.updateMatrixWorld(true);

  headScene.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      const name = (mat.name || "").toLowerCase();
      if (name.includes("occlusion")) mat.visible = false;
      if (name === "eyes") {
        mat.side = FrontSide;
        if (headId === "rosalia" && mat instanceof MeshStandardMaterial
            && mat.map && !mat.map.userData.rosaliaIrisCalibrated) {
          const map = mat.map.clone();
          // Rosalia's iris is centered in the baked diffuse map. Resample the
          // center at 80% UV span to enlarge it without scaling the eyeball.
          map.offset.x += map.repeat.x * 0.1;
          map.offset.y += map.repeat.y * 0.1;
          map.repeat.multiplyScalar(0.8);
          map.userData.rosaliaIrisCalibrated = true;
          mat.map = map;
          mat.needsUpdate = true;
        }
      }
    }
  });
}
