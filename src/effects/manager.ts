import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { GlitchPass } from "three/examples/jsm/postprocessing/GlitchPass.js";
import { RGBShiftShader } from "three/examples/jsm/shaders/RGBShiftShader.js";

// Custom Vignette Shader
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    offset: { value: 1.0 },
    darkness: { value: 1.0 }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: `
    uniform float offset;
    uniform float darkness;
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D( tDiffuse, vUv );
      vec2 uv = ( vUv - vec2( 0.5 ) ) * vec2( offset );
      float dist = dot( uv, uv );
      gl_FragColor = vec4( texel.rgb * ( 1.0 - darkness * dist ), texel.a );
    }
  `
};

export class EffectsManager {
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private vignettePass: ShaderPass | null = null;
  private rgbShiftPass: ShaderPass | null = null;
  private glitchPass: GlitchPass | null = null;
  private width = window.innerWidth;
  private height = window.innerHeight;

  constructor() {}

  init(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    this.composer = new EffectComposer(renderer);
    this.composer.setSize(this.width, this.height);

    // 1. Render Pass
    const renderPass = new RenderPass(scene, camera);
    this.composer.addPass(renderPass);

    // 2. Bloom Pass
    // resolution, strength, radius, threshold
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.width, this.height),
      0.0, // strength (start at 0)
      0.4, // radius
      0.85 // threshold
    );
    this.composer.addPass(this.bloomPass);

    // 3. Vignette Pass
    this.vignettePass = new ShaderPass(VignetteShader);
    this.vignettePass.uniforms["offset"].value = 0.95;
    this.vignettePass.uniforms["darkness"].value = 0.0;
    this.composer.addPass(this.vignettePass);

    // 4. Chromatic Aberration (RGB Shift)
    this.rgbShiftPass = new ShaderPass(RGBShiftShader);
    this.rgbShiftPass.uniforms["amount"].value = 0.0;
    this.composer.addPass(this.rgbShiftPass);

    // 5. Glitch Pass
    this.glitchPass = new GlitchPass();
    this.glitchPass.enabled = false;
    this.glitchPass.goWild = false;
    this.composer.addPass(this.glitchPass);

    // 6. Output Pass
    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);
  }

  resize(width: number, height: number) {
    if (this.composer) {
      this.composer.setSize(width, height);
    }
    this.width = width;
    this.height = height;
  }

  setBloom(strength: number, radius = 0.4, threshold = 0.85) {
    if (this.bloomPass) {
      this.bloomPass.strength = strength;
      this.bloomPass.radius = radius;
      this.bloomPass.threshold = threshold;
    }
  }

  setVignette(offset: number, darkness: number) {
    if (this.vignettePass) {
      this.vignettePass.uniforms["offset"].value = offset;
      this.vignettePass.uniforms["darkness"].value = darkness;
    }
  }

  setChromaticAberration(amount: number, radialModulation = true, modulationOffset = 0.0) {
    if (this.rgbShiftPass) {
      this.rgbShiftPass.uniforms["amount"].value = amount;
      // TODO: Implement radial modulation if supported by the shader
    }
  }

  setPixelation(pixelSize: number, normalEdgeStrength = 0.3, depthEdgeStrength = 0.4) {
     // TODO: Implement Pixelation shader/pass if needed.
     // For now, maybe just ignore or use low resolution render target?
     // Ignoring to save complexity for this sprint.
  }

  setGlitch(active: boolean, wild = false) {
    if (this.glitchPass) {
      this.glitchPass.enabled = active;
      this.glitchPass.goWild = wild;
    }
  }

  resetEffects() {
    this.setBloom(0);
    this.setVignette(0.95, 0);
    this.setChromaticAberration(0);
    this.setGlitch(false);
  }

  render(deltaTime: number) {
    if (this.composer) {
      this.composer.render(deltaTime);
    }
  }
}

export const effectsManager = new EffectsManager();
