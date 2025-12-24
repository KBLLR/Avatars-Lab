import type { StatusElements } from "./types";

export const setAnalysisOverlay = (
  els: Pick<StatusElements, "analysisOverlay" | "analysisStepText">,
  active: boolean,
  step?: string
): void => {
  els.analysisOverlay.classList.toggle("active", active);
  if (step) {
    els.analysisStepText.textContent = step;
  }
};

export const resetAnalysisThoughts = (
  els: Pick<StatusElements, "analysisThoughts">,
  text: string
): string[] => {
  const segments = text ? [text] : [];
  els.analysisThoughts.textContent = segments.join("\n\n") || "Awaiting performance analysis.";
  return segments;
};

export const appendAnalysisThought = (
  els: Pick<StatusElements, "analysisThoughts">,
  segments: string[],
  text: string
): string[] => {
  if (!text) return segments;
  const next = [...segments, text.trim()];
  els.analysisThoughts.textContent = next.join("\n\n");
  return next;
};

export const truncateForVoice = (text: string, max = 360): string => {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trim()}...`;
};
