import type { BadgeElements, DirectorStage, BadgeStatus } from "./types";

export const updateProgressBar = (progressBar: HTMLElement | null, percent: number): void => {
  if (progressBar) {
    progressBar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  }
};

export const updateStageBadges = (
  els: BadgeElements,
  stage: DirectorStage,
  status: BadgeStatus
): void => {
  const badges: Record<DirectorStage, HTMLElement | null> = {
    performance: els.stageBadgePerformance,
    stage: els.stageBadgeStage,
    camera: els.stageBadgeCamera,
    postfx: els.stageBadgePostFx
  };

  const badge = badges[stage];
  if (!badge) return;

  badge.classList.remove("active", "complete", "failed");

  if (status === "active") {
    badge.classList.add("active");
  } else if (status === "complete") {
    badge.classList.add("complete");
  } else if (status === "failed") {
    badge.classList.add("failed");
  }
};

export const resetStageBadges = (els: BadgeElements): void => {
  const badges = [
    els.stageBadgePerformance,
    els.stageBadgeStage,
    els.stageBadgeCamera,
    els.stageBadgePostFx
  ];
  badges.forEach((badge) => {
    if (badge) {
      badge.classList.remove("active", "complete", "failed");
    }
  });
};
