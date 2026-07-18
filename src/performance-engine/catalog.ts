import type {
  ActorAsset,
  PerformanceCatalog,
  PerformanceEnvironment
} from "./types";

const COREX_HEADS = [
  "kbllr",
  "anja",
  "david",
  "eli",
  "nino",
  "nyx",
  "sofia",
  "susi-q",
  "vee"
] as const;

const headLabel = (id: string): string =>
  id.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");

const HEAD_ASSETS: ActorAsset[] = COREX_HEADS.map((id) => ({
  id: `head:${id}`,
  label: `${headLabel(id)} / Head`,
  kind: "head",
  url: `/corex-assets/avatars/heads/${id}/${id}.glb`
}));

const ENVIRONMENTS: PerformanceEnvironment[] = [
  {
    id: "room:cyclorama",
    label: "Cyclorama Studio",
    room: "cyclorama",
    hdriUrl: "/corex-assets/hdri/ferndale_studio_01.hdr",
    exposure: 1.05,
    backgroundIntensity: 0.55,
    environmentIntensity: 0.9
  },
  {
    id: "room:black-box",
    label: "Black Box",
    room: "black-box",
    hdriUrl: "/corex-assets/hdri/blocky_photo_studio.hdr",
    exposure: 0.9,
    backgroundIntensity: 0.18,
    environmentIntensity: 0.65
  },
  {
    id: "room:broadcast",
    label: "Broadcast Room",
    room: "broadcast",
    hdriUrl: "/corex-assets/hdri/art_studio.hdr",
    exposure: 1.1,
    backgroundIntensity: 0.42,
    environmentIntensity: 1
  },
  {
    id: "room:neon-grid",
    label: "Neon Grid",
    room: "neon-grid",
    hdriUrl: "/corex-assets/hdri/cobblestone_street_night.hdr",
    exposure: 1.15,
    backgroundIntensity: 0.4,
    environmentIntensity: 0.75
  }
];

interface AvatarManifestEntry {
  id?: string;
  file: string;
  display_name?: string;
  body?: "M" | "F";
}

export const loadPerformanceCatalog = async (): Promise<PerformanceCatalog> => {
  const [avatarResponse, animationResponse] = await Promise.all([
    fetch("/avatars/runtime-manifest.json"),
    fetch("/performance-assets/catalog.json"),
  ]);
  if (!avatarResponse.ok) throw new Error(`Avatar catalog failed (${avatarResponse.status}).`);
  if (!animationResponse.ok) throw new Error(`Animation catalog failed (${animationResponse.status}).`);
  const [avatarPayload, animationPayload] = await Promise.all([
    avatarResponse.json(),
    animationResponse.json(),
  ]);
  if (animationPayload?.schema !== "avatar-labs.animation-catalog.v1" || !Array.isArray(animationPayload.animations)) {
    throw new Error("Animation catalog returned an unsupported schema.");
  }
  const bodies: ActorAsset[] = (Array.isArray(avatarPayload?.avatars) ? avatarPayload.avatars : [])
    .filter((entry: AvatarManifestEntry) => entry?.file?.endsWith(".glb"))
    .map((entry: AvatarManifestEntry) => {
      const id = entry.id || entry.file.replace(/\.glb$/i, "");
      return {
        id: `body:${id}`,
        label: `${entry.display_name || headLabel(id)} / Body`,
        kind: "body" as const,
        url: `/avatars/${entry.file}`,
        body: entry.body
      };
    });

  return {
    actors: [...HEAD_ASSETS, ...bodies],
    animations: animationPayload.animations,
    animationSummary: {
      total: Number(animationPayload.summary?.total) || animationPayload.animations.length,
      curated: Number(animationPayload.summary?.curated) || 0,
      rpm: Number(animationPayload.summary?.rpm) || 0,
    },
    environments: ENVIRONMENTS
  };
};

export const probeAsset = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url, { headers: { Range: "bytes=0-31" } });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || contentType.includes("text/html")) return false;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length > 0 && bytes[0] !== 0x3c;
  } catch {
    return false;
  }
};
