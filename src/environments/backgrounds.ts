/**
 * Background Application
 * Apply different background types to TalkingHead scene
 */

import type { TalkingHead } from "@met4citizen/talkinghead";
import type { Environment, SolidEnvironment, GradientEnvironment } from "./types";
import * as THREE from "three";

/**
 * Apply solid color background
 */
export function applySolidBackground(head: TalkingHead, config: SolidEnvironment): void {
  if (head.scene) {
    head.scene.background = new THREE.Color(config.color);
    console.log(`[Environment] Apply solid: ${config.color}`);
  } else {
    console.warn("[Environment] head.scene not accessible");
  }
}

/**
 * Apply gradient background
 */
export function applyGradientBackground(head: TalkingHead, config: GradientEnvironment): void {
  // Create gradient texture from canvas
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;

  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, config.colors[0]);
  gradient.addColorStop(1, config.colors[1]);

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  if (head.scene) {
    head.scene.background = texture;
    console.log(`[Environment] Apply gradient: ${config.colors.join(" -> ")}`);
  } else {
    console.warn("[Environment] head.scene not accessible");
  }
}

/**
 * Apply transparent background
 */
export function applyTransparentBackground(head: TalkingHead): void {
  if (head.scene && head.renderer) {
    head.scene.background = null;
    head.renderer.setClearColor(0x000000, 0);
    console.log("[Environment] Apply transparent");
  } else {
     console.warn("[Environment] head.scene or head.renderer not accessible");
  }
}

/**
 * Apply any environment type
 */
export function applyEnvironment(head: TalkingHead, env: Environment): void {
  switch (env.type) {
    case "solid":
      applySolidBackground(head, env);
      break;
    case "gradient":
      applyGradientBackground(head, env);
      break;
    case "transparent":
      applyTransparentBackground(head);
      break;
    case "hdri":
      // HDRI requires async loading - see hdri-loader.ts (placeholder)
      console.log(`[Environment] HDRI requested: ${env.preset} (not fully implemented)`);
      break;
  }
}
