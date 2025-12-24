import type { TalkingHead } from "@met4citizen/talkinghead";

export interface AvatarManifest {
  avatars: string[];
}

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
  avatars: string[];
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

  const data = await response.json();
  const avatars: string[] = Array.isArray(data.avatars) ? data.avatars : [];

  avatarSelect.innerHTML = "";
  avatars.forEach((name: string) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name.replace(/\.glb$/i, "");
    avatarSelect.appendChild(option);
  });

  if (avatars.length) {
    avatarSelect.value = avatars[0];
  }

  const baseUrl = manifestUrl ? new URL(".", manifestUrl).toString() : null;

  return { avatars, baseUrl };
};

export const loadAvatar = async (
  head: TalkingHead,
  avatarName: string,
  avatarBaseUrl: string | null,
  updateStatus: (msg: string) => void,
  updateHero: (avatar?: string, song?: string, status?: string) => void,
  audioFileName?: string
): Promise<void> => {
  if (!avatarName) return;

  updateStatus(`Loading avatar: ${avatarName}`);

  await head.showAvatar({
    url: resolveAvatarUrl(avatarName, avatarBaseUrl),
    body: "F",
    avatarMood: "neutral"
  });

  head.setMood("happy");
  updateHero(avatarName, audioFileName);
  updateStatus("Avatar ready. Upload a song to begin.");
};
