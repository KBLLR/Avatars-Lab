/**
 * Environment Types
 */

export type EnvironmentType = "hdri" | "solid" | "gradient" | "transparent";

export interface HDRIEnvironment {
  type: "hdri";
  preset: string;
  path: string;
  intensity?: number;
}

export interface SolidEnvironment {
  type: "solid";
  color: string;  // hex color
}

export interface GradientEnvironment {
  type: "gradient";
  colors: [string, string];  // [top, bottom] hex colors
  angle?: number;  // degrees, default 0 (vertical)
}

export interface TransparentEnvironment {
  type: "transparent";
}

export type Environment =
  | HDRIEnvironment
  | SolidEnvironment
  | GradientEnvironment
  | TransparentEnvironment;

export interface EnvironmentPreset {
  name: string;
  description: string;
  environment: Environment;
}
