/**
 * Easing Functions
 * Standard easing curves for smooth animations
 */

import type { EasingFn, EasingName } from "./types";

/** Linear interpolation (no easing) */
export const linear: EasingFn = (t) => t;

/** Quadratic ease-in */
export const easeIn: EasingFn = (t) => t * t;

/** Quadratic ease-out */
export const easeOut: EasingFn = (t) => t * (2 - t);

/** Quadratic ease-in-out */
export const easeInOut: EasingFn = (t) =>
  t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

/** Bounce effect */
export const bounce: EasingFn = (t) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
};

/** Elastic effect */
export const elastic: EasingFn = (t) => {
  if (t === 0 || t === 1) return t;
  const p = 0.3;
  const s = p / 4;
  return Math.pow(2, -10 * t) * Math.sin((t - s) * (2 * Math.PI) / p) + 1;
};

/** Easing function lookup */
export const EASING_FUNCTIONS: Record<EasingName, EasingFn> = {
  linear,
  easeIn,
  easeOut,
  easeInOut,
  bounce,
  elastic
};

/** Get easing function by name */
export function getEasing(name?: EasingName): EasingFn {
  return EASING_FUNCTIONS[name || "easeInOut"] || easeInOut;
}

/** Interpolate between two values */
export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}
