export interface RiggingPortalCharacter {
  id: string;
  displayName: string;
  status: string;
  sourceType: "actionforge-mia" | "rigging-model";
  viewerUrl: string;
  thumbnailUrl?: string;
  motionsCount: number;
  armatureVerified: true;
  retargetTargetId?: string;
}

export interface MotionTargetSummary {
  id: string;
  label: string;
  source: string;
}

export const COREX_SELECT_CHARACTER_EVENT = "avatar-labs:select-character";
const SELECTED_STORAGE_KEY = "avatarLabs.selectedRiggingCharacter";

function toRiggingPortalProxyUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("/api/rigging-portal/")) return url;
  if (url.startsWith("/")) return `/api/rigging-portal${url}`;
  return url;
}

interface RawDashboardChar {
  id?: string;
  title?: string;
  status?: string;
  rigged?: boolean;
  artifactState?: string;
  modelUrl?: string;
  viewerRuntimeUrl?: string;
  thumbnailUrl?: string;
  galleryShots?: { thumbnailSmall?: string };
}

interface RawBindingsPayload {
  characters?: Record<
    string,
    {
      viewerRuntimeUrl?: string;
      thumbnailUrl?: string;
      motions?: string[];
      actionforgeSource?: { characterId: string; viewerRuntimeUrl: string };
    }
  >;
}

export async function fetchMotionTargets(): Promise<MotionTargetSummary[]> {
  try {
    const res = await fetch("/api/motion/v1/motion/targets", { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as { ok?: boolean; targets?: MotionTargetSummary[] };
    return Array.isArray(data.targets) ? data.targets : [];
  } catch {
    return [];
  }
}

export async function fetchRiggingPortalCharacters(): Promise<{
  online: boolean;
  characters: RiggingPortalCharacter[];
  retargetTargets: MotionTargetSummary[];
}> {
  try {
    const [dashRes, bindRes, targets] = await Promise.all([
      fetch("/api/rigging-portal/ops/dashboard.json", { cache: "no-store" }),
      fetch("/api/rigging-portal/api/motion-evidence/actionforge-playable/character-bindings.json", {
        cache: "no-store",
      }).catch(() => null),
      fetchMotionTargets(),
    ]);

    if (!dashRes.ok) {
      return { online: false, characters: [], retargetTargets: targets };
    }

    const dash = (await dashRes.json()) as { characters?: RawDashboardChar[] };
    const bindings: RawBindingsPayload =
      bindRes && bindRes.ok ? ((await bindRes.json()) as RawBindingsPayload) : {};
    const targetIds = new Set(targets.map((t) => t.id));
    const seen = new Set<string>();
    const results: RiggingPortalCharacter[] = [];

    for (const c of dash.characters || []) {
      const id = (c.id || "").trim();
      if (!id || seen.has(id)) continue;

      const binding = bindings.characters?.[id];
      const hasActionforgeOwn = Boolean(binding?.viewerRuntimeUrl && !binding.actionforgeSource);
      const hasValidModel = Boolean(c.modelUrl && c.artifactState !== "qa-failed");
      const rawRuntime = c.viewerRuntimeUrl;

      if (!hasActionforgeOwn && !hasValidModel && !rawRuntime) continue;

      const viewerUrl = toRiggingPortalProxyUrl(
        binding?.viewerRuntimeUrl || rawRuntime || c.modelUrl || "",
      );
      if (!viewerUrl) continue;

      seen.add(id);
      const rawThumb = binding?.thumbnailUrl || c.galleryShots?.thumbnailSmall || c.thumbnailUrl || "";
      results.push({
        id,
        displayName: c.title || id,
        status: c.status || "review",
        sourceType: hasActionforgeOwn || rawRuntime ? "actionforge-mia" : "rigging-model",
        viewerUrl,
        thumbnailUrl: rawThumb ? toRiggingPortalProxyUrl(rawThumb) : undefined,
        motionsCount: Array.isArray(binding?.motions) ? binding.motions.length : 0,
        armatureVerified: true,
        retargetTargetId: targetIds.has(id) ? id : undefined,
      });
    }

    // Also include any verified binding keys not listed in dashboard.json.
    for (const [id, binding] of Object.entries(bindings.characters || {})) {
      if (seen.has(id) || !binding?.viewerRuntimeUrl || binding.actionforgeSource) continue;
      seen.add(id);
      results.push({
        id,
        displayName: id,
        status: "ready",
        sourceType: "actionforge-mia",
        viewerUrl: toRiggingPortalProxyUrl(binding.viewerRuntimeUrl),
        thumbnailUrl: binding.thumbnailUrl ? toRiggingPortalProxyUrl(binding.thumbnailUrl) : undefined,
        motionsCount: Array.isArray(binding.motions) ? binding.motions.length : 0,
        armatureVerified: true,
        retargetTargetId: targetIds.has(id) ? id : undefined,
      });
    }

    return { online: true, characters: results, retargetTargets: targets };
  } catch {
    return { online: false, characters: [], retargetTargets: await fetchMotionTargets() };
  }
}

export function saveSelectedRiggingCharacter(char: RiggingPortalCharacter): void {
  try {
    localStorage.setItem(SELECTED_STORAGE_KEY, JSON.stringify(char));
  } catch {
    // Ignore storage quota errors cleanly.
  }
  window.dispatchEvent(new CustomEvent(COREX_SELECT_CHARACTER_EVENT, { detail: char }));
}

export function readSelectedRiggingCharacter(): RiggingPortalCharacter | null {
  try {
    const raw = localStorage.getItem(SELECTED_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RiggingPortalCharacter;
    return parsed?.id && parsed?.viewerUrl ? parsed : null;
  } catch {
    return null;
  }
}
