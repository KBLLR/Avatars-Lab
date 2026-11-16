import { FrontSide, Mesh, Object3D, Vector3 } from "three";
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
export function normalizeChatAvatarHead(headScene: Object3D): void {
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
    if (!node) continue;
    const eyeWorldScale = node.getWorldScale(new Vector3()).x;
    const ratio = faceWorldScale / eyeWorldScale;
    if (ratio < 0.5 || ratio > 2) {
      node.scale.multiplyScalar(ratio);
      node.position.multiplyScalar(ratio);
    }
  }
  calibrateChatAvatarEyes(headScene);
  headScene.updateMatrixWorld(true);

  headScene.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      const name = (mat.name || "").toLowerCase();
      if (name.includes("occlusion")) mat.visible = false;
      if (name === "eyes") (mat as { side: number }).side = FrontSide;
    }
  });
}
