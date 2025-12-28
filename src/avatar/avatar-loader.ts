import type { TalkingHead } from "@met4citizen/talkinghead";

export interface AvatarManifest {
  avatars: Array<string | AvatarManifestEntry>;
}

export interface AvatarManifestEntry {
  id: string;
  file: string;
  display_name?: string;
  body?: "M" | "F";
  voice_id?: string;
  intro?: string;
  background?: string;
  project?: string;
  tags?: string[];
  default_mood?: string;
}

const normalizeAvatarEntry = (entry: string | AvatarManifestEntry): AvatarManifestEntry => {
  if (typeof entry === "string") {
    const id = entry.replace(/\.glb$/i, "");
    return {
      id,
      file: entry,
      display_name: id,
      tags: []
    };
  }

  const id = entry.id || entry.file?.replace(/\.glb$/i, "") || "avatar";
  const file = entry.file || `${id}.glb`;
  return {
    ...entry,
    id,
    file,
    display_name: entry.display_name || id,
    tags: Array.isArray(entry.tags) ? entry.tags : []
  };
};

export const findAvatarEntry = (
  avatars: AvatarManifestEntry[],
  value: string
): AvatarManifestEntry | undefined =>
  avatars.find((avatar) => avatar.file === value || avatar.id === value);

export const getAvatarLabel = (avatar: AvatarManifestEntry): string =>
  avatar.display_name || avatar.id || avatar.file;

export const buildAvatarManifestCandidates = (): string[] => {
  const override = import.meta.env.VITE_AVATAR_MANIFEST_URL as string | undefined;
  const base = import.meta.env.BASE_URL || "/";
  const candidates = [
    override,
    `${base}avatars/manifest.json`,
    "avatars/manifest.json",
    "/avatars/manifest.json"
  ].filter((value): value is string => Boolean(value));
  return candidates.map((path) => new URL(path, window.location.href).toString());
};

export const resolveAvatarUrl = (name: string, baseUrl: string | null): string => {
  if (baseUrl) {
    return new URL(name, baseUrl).toString();
  }
  return new URL(`avatars/${name}`, window.location.href).toString();
};

export interface LoadAvatarListResult {
  avatars: AvatarManifestEntry[];
  baseUrl: string | null;
}

export const loadAvatarList = async (
  avatarSelect: HTMLSelectElement
): Promise<LoadAvatarListResult> => {
  const manifestUrls = buildAvatarManifestCandidates();
  let response: Response | null = null;
  let manifestUrl = "";

  for (const candidate of manifestUrls) {
    try {
      const attempt = await fetch(candidate, { cache: "no-store" });
      if (attempt.ok) {
        response = attempt;
        manifestUrl = candidate;
        break;
      }
    } catch {
      // Try next candidate.
    }
  }

  if (!response) {
    throw new Error(`Failed to load avatar manifest. Tried: ${manifestUrls.join(", ")}`);
  }

  const data: AvatarManifest = await response.json();
  const rawAvatars = Array.isArray(data.avatars) ? data.avatars : [];
  const avatars = rawAvatars.map(normalizeAvatarEntry);

  avatarSelect.innerHTML = "";
  avatars.forEach((avatar) => {
    const option = document.createElement("option");
    option.value = avatar.file;
    option.textContent = getAvatarLabel(avatar);
    avatarSelect.appendChild(option);
  });

  if (avatars.length) {
    // Select a random avatar on page load
    const randomIndex = Math.floor(Math.random() * avatars.length);
    avatarSelect.value = avatars[randomIndex].file;
  }

  const baseUrl = manifestUrl ? new URL(".", manifestUrl).toString() : null;

  return { avatars, baseUrl };
};

/**
 * Populate additional select elements with the same avatar list
 */
export const populateAvatarSelects = (
  avatars: AvatarManifestEntry[],
  ...selects: HTMLSelectElement[]
): void => {
  selects.forEach((select, idx) => {
    select.innerHTML = "";
    avatars.forEach((avatar) => {
      const option = document.createElement("option");
      option.value = avatar.file;
      option.textContent = getAvatarLabel(avatar);
      select.appendChild(option);
    });
    // Select different avatars for A/B if possible
    if (avatars.length > 1) {
      select.value = avatars[idx % avatars.length].file;
    } else if (avatars.length === 1) {
      select.value = avatars[0].file;
    }
  });
};

export const loadAvatar = async (
  head: TalkingHead,
  avatarName: string,
  avatarBaseUrl: string | null,
  updateStatus: (msg: string) => void,
  updateHero: (avatar?: string, song?: string, status?: string) => void,
  audioFileName?: string,
  avatarMeta?: AvatarManifestEntry | null
): Promise<void> => {
  if (!avatarName) return;

  const avatarFile = avatarMeta?.file || avatarName;
  const avatarLabel = avatarMeta ? getAvatarLabel(avatarMeta) : avatarName;
  const avatarMood = avatarMeta?.default_mood || "happy";

  updateStatus(`Loading avatar: ${avatarLabel}`);

  await head.showAvatar({
    url: resolveAvatarUrl(avatarFile, avatarBaseUrl),
    body: avatarMeta?.body || "F",
    avatarMood
  });

  head.setMood(avatarMood);
  updateHero(avatarLabel, audioFileName);
  updateStatus("Avatar ready. Upload a song to begin.");
};
