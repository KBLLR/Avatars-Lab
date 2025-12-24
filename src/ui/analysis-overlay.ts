import type { StatusElements } from "./types";

export interface AnalysisState {
  analysisSegments: string[];
}

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
  state: AnalysisState,
  text: string
): void => {
  state.analysisSegments = text ? [text] : [];
  els.analysisThoughts.textContent = state.analysisSegments.join("\n\n") || "Awaiting performance analysis.";
};

export const appendAnalysisThought = (
  els: Pick<StatusElements, "analysisThoughts">,
  state: AnalysisState,
  text: string
): void => {
  if (!text) return;
  state.analysisSegments.push(text.trim());
  els.analysisThoughts.textContent = state.analysisSegments.join("\n\n");
};

export const truncateForVoice = (text: string, max = 360): string => {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trim()}...`;
};
