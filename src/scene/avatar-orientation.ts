import { Box3, Object3D, Vector3 } from "three";

export interface HeadDefinition {
  id: string;
  label: string;
  url: string;
  hairUrl?: string;
  voice: string;
}

const LIBRARY_HEAD_NAMES = [
  ["raffaella", "Raffaella"],
  ["evren", "Evren"],
  ["malina", "Malina"],
  ["trunks", "Trunks"],
  ["mystery-girl", "Mystery Girl"],
  ["mystery-girl-2", "Mystery Girl 2"],
  ["me", "Me"],
  ["me-kid", "Me (Kid)"],
] as const;

/**
 * Canonical Core-X head roster and voice assignments.
 */
export const HEAD_ROSTER: Record<string, HeadDefinition> = {
  kbllr: {
    id: "kbllr",
    label: "KBLLR",
    url: "/corex-assets/avatars/heads/kbllr/kbllr.glb",
    hairUrl: "/corex-assets/avatars/heads/kbllr/kbllr-hair.glb",
    voice: "lullabot",
  },
  anja: {
    id: "anja",
    label: "Anja",
    url: "/corex-assets/avatars/heads/anja/anja.glb",
    hairUrl: "/corex-assets/avatars/heads/anja/anja-hair.glb",
    voice: "katanja",
  },
  "susi-q": {
    id: "susi-q",
    label: "Susi-Q",
    url: "/corex-assets/avatars/heads/susi-q/susi-q.glb",
    hairUrl: "/corex-assets/avatars/heads/susi-q/susi-q-hair.glb",
    voice: "katanja",
  },
  eli: {
    id: "eli",
    label: "Eli",
    url: "/corex-assets/avatars/heads/eli/eli.glb",
    hairUrl: "/corex-assets/avatars/heads/eli/eli-hair.glb",
    voice: "eli_luma",
  },
  sofia: {
    id: "sofia",
    label: "Sofia",
    url: "/corex-assets/avatars/heads/sofia/sofia.glb",
    hairUrl: "/corex-assets/avatars/heads/sofia/sofia-hair.glb",
    voice: "sofi_v",
  },
  rosalia: {
    id: "rosalia",
    label: "Rosalia",
    url: "/corex-assets/avatars/heads/rosalia/rosalia.glb",
    voice: "rosa_lia",
  },
  nyx: {
    id: "nyx",
    label: "Nyx",
    url: "/corex-assets/avatars/heads/nyx/nyx.glb",
    hairUrl: "/corex-assets/avatars/heads/nyx/nyx-hair.glb",
    voice: "vicky_spice",
  },
  vee: {
    id: "vee",
    label: "Vee",
    url: "/corex-assets/avatars/heads/vee/vee.glb",
    voice: "princess_leia",
  },
  nino: {
    id: "nino",
    label: "Nino",
    url: "/corex-assets/avatars/heads/nino/nino.glb",
    voice: "ninoo",
  },
  ...Object.fromEntries(LIBRARY_HEAD_NAMES.map(([id, label]) => [id, {
    id,
    label,
    url: `/corex-assets/avatars/heads/${id}/${id}.glb`,
    voice: "katanja",
  }])),
};

export function resolveHeadDefinition(keyOrUrl: string): HeadDefinition {
  if (HEAD_ROSTER[keyOrUrl]) return HEAD_ROSTER[keyOrUrl];
  for (const def of Object.values(HEAD_ROSTER)) {
    if (def.url === keyOrUrl || def.id === keyOrUrl) return def;
  }
  const filename = keyOrUrl.split("/").pop()?.replace(/\.glb$/i, "") || "custom";
  return {
    id: filename,
    label: filename.charAt(0).toUpperCase() + filename.slice(1),
    url: keyOrUrl,
    voice: "lullabot",
  };
}

/**
 * Normalizes full-body avatar orientation to Y+ standing upright with feet grounded at y = 0.
 * Fixes Blender Z-up exports (e.g. Adam, Donna, Eli whose Hips carry a -90 deg X rotation)
 * so the torso points +Y rather than lying along +/-Z.
 */
export function normalizeStandingBodyUpAxis(root: Object3D): { rotatedXRad: number } {
  root.updateMatrixWorld(true);

  let headBone: Object3D | null = null;
  let hipsBone: Object3D | null = null;
  root.traverse((obj) => {
    const n = (obj.name || "").toLowerCase();
    if (!headBone && (n === "head" || n.endsWith(":head"))) headBone = obj;
    if (!hipsBone && (n === "hips" || n.endsWith(":hips"))) hipsBone = obj;
  });

  let rotatedXRad = 0;
  if (headBone && hipsBone) {
    const headPos = (headBone as Object3D).getWorldPosition(new Vector3());
    const hipsPos = (hipsBone as Object3D).getWorldPosition(new Vector3());
    const dy = headPos.y - hipsPos.y;
    const dz = headPos.z - hipsPos.z;
    if (Math.abs(dz) > Math.abs(dy) * 1.5) {
      rotatedXRad = dz < 0 ? Math.PI / 2 : -Math.PI / 2;
      root.rotation.x += rotatedXRad;
      root.updateMatrixWorld(true);
    }
  } else {
    const box = new Box3().setFromObject(root);
    const size = box.getSize(new Vector3());
    if (size.z > size.y * 1.5 && size.y < 0.75) {
      rotatedXRad = Math.abs(box.min.z) >= Math.abs(box.max.z) ? Math.PI / 2 : -Math.PI / 2;
      root.rotation.x += rotatedXRad;
      root.updateMatrixWorld(true);
    }
  }

  const groundedBox = new Box3().setFromObject(root);
  if (Number.isFinite(groundedBox.min.y)) {
    root.position.y -= groundedBox.min.y;
    root.updateMatrixWorld(true);
  }
  return { rotatedXRad };
}
