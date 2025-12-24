import type { DirectorStyle } from "./types";

export const DIRECTOR_STYLE_TEMPLATES: Record<DirectorStyle, string> = {
  cinematic: [
    "Focus on dramatic arcs and clear section beats.",
    "Use bold mood shifts, strong lighting cues, and purposeful camera moves.",
    "Favor memorable moments over constant activity."
  ].join("\n"),
  intimate: [
    "Keep actions subtle and close to the emotion in the lyrics.",
    "Prefer tighter camera views and gentle lighting transitions.",
    "Limit changes; let small gestures carry the scene."
  ].join("\n"),
  hype: [
    "Maximize energy with punchy gestures and dynamic staging.",
    "Use brighter, higher-contrast lighting and quicker camera changes.",
    "Emphasize peaks and drops in the music."
  ].join("\n"),
  minimal: [
    "Reduce actions to the essentials; avoid busy plans.",
    "Favor steady camera views and restrained lighting changes.",
    "Let the lyrics carry the performance."
  ].join("\n"),
  experimental: [
    "Surprise with unexpected but coherent choices.",
    "Mix lighting and camera styles creatively within constraints.",
    "Balance novelty with clarity."
  ].join("\n")
};

export const getDirectorStyleTemplate = (style: string): string => {
  const template = DIRECTOR_STYLE_TEMPLATES[style as DirectorStyle];
  if (template) return template;
  return [
    `Custom style: ${style}.`,
    "Favor clarity and respect the plan constraints."
  ].join("\n");
};

export const formatDirectorStylePrompt = (style: string): string => {
  const guidance = getDirectorStyleTemplate(style);
  return `STYLE: ${style}\nSTYLE_GUIDANCE:\n${guidance}`;
};
