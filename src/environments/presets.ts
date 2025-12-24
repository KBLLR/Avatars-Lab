/**
 * Environment Presets
 */

import type { EnvironmentPreset, Environment } from "./types";

export const ENVIRONMENT_PRESETS: EnvironmentPreset[] = [
  {
    name: "studio",
    description: "Clean studio lighting",
    environment: { type: "hdri", preset: "studio", path: "/environments/studio.hdr", intensity: 1.0 }
  },
  {
    name: "outdoor",
    description: "Natural outdoor lighting",
    environment: { type: "hdri", preset: "outdoor", path: "/environments/outdoor.hdr", intensity: 1.0 }
  },
  {
    name: "neon-city",
    description: "Cyberpunk urban environment",
    environment: { type: "hdri", preset: "neon-city", path: "/environments/neon-city.hdr", intensity: 1.2 }
  },
  {
    name: "void",
    description: "Pure black background",
    environment: { type: "solid", color: "#000000" }
  },
  {
    name: "transparent",
    description: "Transparent for compositing",
    environment: { type: "transparent" }
  },
  {
    name: "sunset-gradient",
    description: "Warm sunset gradient",
    environment: { type: "gradient", colors: ["#ff6b35", "#1a1a2e"], angle: 0 }
  }
];

export function getEnvironmentPreset(name: string): EnvironmentPreset | undefined {
  return ENVIRONMENT_PRESETS.find(p => p.name === name);
}

export function getEnvironmentPresetNames(): string[] {
  return ENVIRONMENT_PRESETS.map(p => p.name);
}
