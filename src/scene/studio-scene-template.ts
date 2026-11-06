/**
 * StudioSceneTemplate — Canonical WebGPU-first 3D Scene Template for Avatar Labs.
 *
 * Implements modern Three.js (r185+) and WebGPU standards ported directly from Core-X UI:
 *   - WebGPURenderer with automatic WebGL2 fallback detection
 *   - Dual-mode framing: Core-X Floating Bust (canonical) vs Architectural Plinth
 *   - Calibrated 3-point cinematic lighting (Key, Fill, Ambient) with PCF soft shadow maps
 *   - ACESFilmic tone mapping with calibrated exposure and sRGB color space
 *   - Flattering portrait lens framing (55° FOV, close-up matching Core-X voice-scene)
 *   - Canonical Core-X material realism pipeline (avatar-loader-v2-bridge):
 *       • Face/Skin: Pure diffuse + GGX specular, SSS-extinction to prevent black cutouts
 *       • Eyes: Wet cornea high-gloss clearcoat (0.28), specular (0.72), cornea IOR (1.38)
 *       • Mouth Interior: Polygon offset (1.0) & deep red-black (0x1a0808) to prevent slit artifacts
 *       • Teeth: Wet enamel clearcoat (0.6), roughness (0.35)
 *       • Lashes: Clean alpha-test (0.5), double-sided, opaque depthWrite
 *       • Occlusion helpers: Completely hidden from rendering
 */

import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  Group,
  Material,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { MeshPhysicalNodeMaterial, WebGPURenderer } from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface StudioSceneOptions {
  mode?: "portrait" | "full-body";
  showPlinth?: boolean;
  enableControls?: boolean;
  backgroundColor?: number;
  exposure?: number;
  onRendererReady?: (rendererLabel: string) => void;
}

export interface StudioSceneInstance {
  renderer: WebGPURenderer | WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  lights: {
    ambient: AmbientLight;
    key: DirectionalLight;
    fill: DirectionalLight;
    rim: PointLight;
  };
  plinth?: Group;
  floor: Mesh;
  rendererLabel: string;
  isWebGPU: boolean;
  frameSubject: (object: Mesh | Group) => void;
  applyMaterialRealism: (root: Mesh | Group) => void;
  resize: () => void;
  dispose: () => void;
}

/**
 * Architectural Minimalist Studio Plinth for Head & Bust Performers.
 * Cap is positioned at y = -0.48 so it sits safely below the lowest neck base
 * without ever obstructing the chin, lips, or jawline.
 */
export function createArchitecturalPlinth(topY = -0.48): Group {
  const plinth = new Group();
  plinth.name = "studio-architectural-plinth";

  const stoneMaterial = new MeshPhysicalMaterial({
    color: 0x242628,
    metalness: 0.04,
    roughness: 0.42,
    clearcoat: 0.15,
    clearcoatRoughness: 0.35,
  });

  const trimMaterial = new MeshPhysicalMaterial({
    color: 0x141618,
    metalness: 0.72,
    roughness: 0.22,
    clearcoat: 0.45,
    clearcoatRoughness: 0.15,
  });

  // Base stepped cylinders positioned relative to topY
  const base = new Mesh(new CylinderGeometry(0.26, 0.30, 0.06, 64), stoneMaterial);
  base.position.y = topY - 0.65;

  const lowerTrim = new Mesh(new CylinderGeometry(0.23, 0.26, 0.03, 64), trimMaterial);
  lowerTrim.position.y = topY - 0.60;

  const column = new Mesh(new CylinderGeometry(0.16, 0.22, 0.52, 64), stoneMaterial.clone());
  column.position.y = topY - 0.32;

  const upperTrim = new Mesh(new CylinderGeometry(0.19, 0.16, 0.04, 64), trimMaterial.clone());
  upperTrim.position.y = topY - 0.04;

  const cap = new Mesh(new CylinderGeometry(0.18, 0.19, 0.03, 64), stoneMaterial.clone());
  cap.position.y = topY;

  for (const m of [base, lowerTrim, column, upperTrim, cap]) {
    m.castShadow = true;
    m.receiveShadow = true;
    plinth.add(m);
  }

  return plinth;
}

/**
 * Normalizes material name to determine canonical role.
 */
function normalizeMatName(name?: string): string {
  return (name || "").toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

/**
 * Upgrades standard glTF materials to physical realism matching Core-X UI canonical contract
 * (core-x/ui/src/lib/avatar-loader-v2-bridge.ts).
 */
export function applyStudioMaterialRealism(root: Mesh | Group, isWebGPU: boolean): void {
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;

    node.castShadow = true;
    node.receiveShadow = true;

    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const upgradedMaterials: Material[] = [];

    for (const mat of materials) {
      const source = mat as MeshStandardMaterial & Partial<MeshPhysicalMaterial>;
      if (!source.isMeshStandardMaterial && !source.isMeshPhysicalMaterial) {
        upgradedMaterials.push(mat);
        continue;
      }

      const matName = normalizeMatName(mat?.name);
      const meshName = normalizeMatName(node?.name);

      // 1. Occlusion hidden helper geometry
      if (matName.includes("occlusion") || meshName.includes("occlusion")) {
        source.transparent = true;
        source.opacity = 0;
        source.depthWrite = false;
        source.depthTest = false;
        source.visible = false;
        upgradedMaterials.push(source);
        continue;
      }

      // 2. Mouth interior (polygon-offset prevents black slits around lips)
      if (matName.includes("mouth") || matName.includes("interior") || meshName.includes("mouth")) {
        const mouthMat = source.clone() as MeshPhysicalMaterial;
        mouthMat.name = `${source.name || node.name}:corex-mouth-interior`;
        mouthMat.side = FrontSide;
        mouthMat.roughness = 0.8;
        mouthMat.metalness = 0;
        mouthMat.color = new Color(0x1a0808);
        mouthMat.transparent = false;
        mouthMat.depthWrite = true;
        mouthMat.depthTest = true;
        mouthMat.polygonOffset = true;
        mouthMat.polygonOffsetFactor = 1;
        mouthMat.polygonOffsetUnits = 1;
        mouthMat.transmission = 0;
        mouthMat.thickness = 0;
        mouthMat.sheen = 0;
        mouthMat.clearcoat = 0;
        upgradedMaterials.push(mouthMat);
        continue;
      }

      // 3. Teeth (wet enamel)
      if (matName.includes("teeth") || meshName.includes("teeth")) {
        const teethMat = source.clone() as MeshPhysicalMaterial;
        teethMat.name = `${source.name || node.name}:corex-teeth`;
        teethMat.side = FrontSide;
        teethMat.roughness = 0.35;
        teethMat.metalness = 0;
        teethMat.clearcoat = 0.6;
        teethMat.clearcoatRoughness = 0.1;
        teethMat.transmission = 0;
        teethMat.thickness = 0;
        teethMat.sheen = 0;
        teethMat.iridescence = 0;
        upgradedMaterials.push(teethMat);
        continue;
      }

      // 4. Eyelashes / Eyebrows (clean alpha-test, no coverage-MSAA black artifacts)
      const isLash = matName.includes("lash") || meshName.includes("lash");
      const isBrow = matName.includes("brow") || meshName.includes("brow");
      if (isLash || isBrow) {
        const hairMat = source.clone() as MeshStandardMaterial;
        hairMat.name = `${source.name || node.name}:corex-hair-card`;
        hairMat.side = isLash ? DoubleSide : FrontSide;
        hairMat.alphaTest = 0.5;
        hairMat.transparent = false;
        hairMat.depthWrite = true;
        hairMat.depthTest = true;
        hairMat.roughness = 0.52;
        hairMat.metalness = 0;
        upgradedMaterials.push(hairMat);
        continue;
      }

      // 5. Eyeballs / Cornea (wet clearcoat, keep authored diffuse colors)
      const isEye = matName.includes("eye") || meshName.includes("eye") || matName.includes("cornea");
      if (isEye) {
        const eyeMat = source.clone() as MeshPhysicalMaterial;
        eyeMat.name = `${source.name || node.name}:corex-eyes`;
        eyeMat.side = FrontSide;
        eyeMat.roughness = Math.min(eyeMat.roughness || 0.18, 0.18);
        eyeMat.metalness = 0;
        eyeMat.transparent = false;
        eyeMat.depthWrite = true;
        eyeMat.opacity = 1;
        eyeMat.transmission = 0;
        eyeMat.thickness = 0;
        eyeMat.sheen = 0;
        eyeMat.iridescence = 0;
        eyeMat.clearcoat = Math.max(eyeMat.clearcoat || 0, 0.28);
        eyeMat.clearcoatRoughness = Math.min(eyeMat.clearcoatRoughness || 0.08, 0.08);
        eyeMat.specularIntensity = Math.max(eyeMat.specularIntensity || 0, 0.72);
        eyeMat.envMapIntensity = Math.max(eyeMat.envMapIntensity || 0, 0.55);
        eyeMat.ior = 1.38;
        eyeMat.emissive = new Color(0, 0, 0);
        eyeMat.emissiveIntensity = 0;
        upgradedMaterials.push(eyeMat);
        continue;
      }

      // 6. Skin / Face / Head / Body (Core-X canonical SSS extinction)
      // Non-zero transmission/thickness punches black holes in Three.js WebGPU / WebGL.
      // Canonical Core-X uses pure physical diffuse + calibrated GGX roughness.
      const isSkin =
        matName.includes("skin") ||
        matName.includes("face") ||
        matName.includes("head") ||
        matName.includes("body") ||
        meshName.includes("face") ||
        meshName.includes("head");

      if (isSkin) {
        const skinMat = isWebGPU ? new MeshPhysicalNodeMaterial() : new MeshPhysicalMaterial();
        skinMat.name = `${source.name || node.name}:corex-skin`;
        if (source.color) skinMat.color.copy(source.color);
        if (source.map) skinMat.map = source.map;
        if (source.normalMap) {
          skinMat.normalMap = source.normalMap;
          if (source.normalScale) skinMat.normalScale.copy(source.normalScale);
        }
        if (source.roughnessMap) skinMat.roughnessMap = source.roughnessMap;
        if (source.metalnessMap) skinMat.metalnessMap = source.metalnessMap;
        if (source.aoMap) {
          skinMat.aoMap = source.aoMap;
          skinMat.aoMapIntensity = source.aoMapIntensity ?? 1;
        }

        skinMat.side = FrontSide;
        skinMat.roughness = 0.58;
        skinMat.metalness = 0;
        skinMat.transparent = false;
        skinMat.depthWrite = true;
        skinMat.depthTest = true;

        // SSS extinction — prevent black cutouts
        skinMat.transmission = 0;
        skinMat.thickness = 0;
        skinMat.attenuationDistance = Infinity;
        skinMat.sheen = 0;
        skinMat.clearcoat = 0;
        skinMat.clearcoatRoughness = 0;
        skinMat.iridescence = 0;
        skinMat.ior = 1.5;
        skinMat.envMapIntensity = 0.85;

        upgradedMaterials.push(skinMat);
        continue;
      }

      upgradedMaterials.push(mat);
    }

    node.material = upgradedMaterials.length === 1 ? upgradedMaterials[0] : upgradedMaterials;
  });
}

/**
 * Normalizes and frames a Core-X bust head exactly like VoiceScene in Core-X UI:
 * Centers the head at (0, 0, 0) and sets the portrait camera to (0, 0.08, 1.8) looking at (0, 0, 0).
 */
export function centerAndFrameCoreXHead(
  scene: Object3D,
  camera: PerspectiveCamera,
  controls: OrbitControls
): void {
  scene.updateMatrixWorld(true);
  const box = new Box3().setFromObject(scene);
  const center = box.getCenter(new Vector3());

  // Center model bounding box around origin (0, 0, 0)
  scene.position.sub(center);
  scene.updateMatrixWorld(true);

  // Canonical VoiceScene camera config
  camera.fov = 55;
  camera.position.set(0, 0.08, 1.8);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  controls.target.set(0, 0, 0);
  controls.update();
}

/**
 * Creates and initializes a complete high-fidelity Minimalist Studio Scene.
 */
export async function createStudioSceneTemplate(
  container: HTMLElement,
  options: StudioSceneOptions = {}
): Promise<StudioSceneInstance> {
  const {
    mode = "portrait",
    showPlinth = false, // Canonical Core-X UI floats without pedestal by default
    enableControls = true,
    backgroundColor = 0x141516,
    exposure = 1.0,
    onRendererReady,
  } = options;

  const forceWebGL = new URLSearchParams(window.location.search).get("renderer") === "webgl";
  let renderer: WebGPURenderer | WebGLRenderer;
  let rendererLabel = "webgpu";
  let isWebGPU = false;

  if ("gpu" in navigator && !forceWebGL) {
    try {
      const webgpu = new WebGPURenderer({ antialias: true, alpha: true });
      await webgpu.init();
      renderer = webgpu;
      isWebGPU = true;
      rendererLabel = "webgpu";
    } catch {
      renderer = new WebGLRenderer({ antialias: true, alpha: true });
      rendererLabel = "webgl2-fallback";
    }
  } else {
    renderer = new WebGLRenderer({ antialias: true, alpha: true });
    rendererLabel = forceWebGL ? "webgl-forced" : "webgl2-fallback";
  }

  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  if (renderer instanceof WebGLRenderer) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
  }

  container.replaceChildren(renderer.domElement);
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.display = "block";

  const scene = new Scene();
  scene.background = new Color(backgroundColor);

  // Canonical VoiceScene FOV = 55 for portrait bust, 38 for full body
  const fov = mode === "portrait" ? 55 : 38;
  const camera = new PerspectiveCamera(fov, container.clientWidth / container.clientHeight, 0.01, 50);

  if (mode === "portrait") {
    camera.position.set(0, 0.08, 1.8);
    camera.lookAt(0, 0, 0);
  } else {
    camera.position.set(0, 1.25, 4.4);
    camera.lookAt(0, 1.0, 0);
  }

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enabled = enableControls;
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.enableZoom = true;
  controls.enablePan = true;
  controls.minDistance = 0.6;
  controls.maxDistance = 5.0;
  controls.target.set(0, mode === "portrait" ? 0 : 1.0, 0);

  // Canonical Core-X UI lighting rig (voice-scene.ts)
  const ambient = new AmbientLight(0xffffff, 0.42);

  const key = new DirectionalLight(0xfff8ef, 1.15);
  key.position.set(1.1, 1.95, 2.6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.2;
  key.shadow.camera.far = 6.0;
  key.shadow.camera.left = -1.15;
  key.shadow.camera.right = 1.15;
  key.shadow.camera.top = 1.2;
  key.shadow.camera.bottom = -1.2;
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 2;

  const fill = new DirectionalLight(0x90a4ff, 0.35);
  fill.position.set(-1.2, 1.6, -2.4);

  const rim = new PointLight(0xffe4cc, 0.85, 8);
  rim.position.set(0, 2.2, -2.2);

  scene.add(ambient, key, fill, rim);

  // Soft shadow catcher floor placed at canonical y = -0.78
  const floorGeo = new PlaneGeometry(12, 12);
  const floorMat = new ShadowMaterial({ transparent: true, opacity: 0.32 });
  const floor = new Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = mode === "portrait" ? -0.78 : 0;
  floor.receiveShadow = true;
  scene.add(floor);

  // Optional plinth (positioned safely below bust)
  let plinth: Group | undefined;
  if (showPlinth && mode === "portrait") {
    plinth = createArchitecturalPlinth(-0.52);
    scene.add(plinth);
  }

  const resize = () => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  const frameSubject = (object: Mesh | Group) => {
    if (mode === "portrait") {
      centerAndFrameCoreXHead(object, camera, controls);
    } else {
      const box = new Box3().setFromObject(object);
      const center = box.getCenter(new Vector3());
      const size = box.getSize(new Vector3());
      controls.target.set(center.x, center.y * 0.9, center.z);
      camera.lookAt(center.x, center.y * 0.9, center.z);
      camera.position.set(center.x, center.y + size.y * 0.1, center.z + Math.max(1.8, size.y * 2.2));
      controls.update();
    }
  };

  let isDisposed = false;
  const loop = () => {
    if (isDisposed) return;
    if (controls.enabled) controls.update();
    renderer.render(scene, camera);
  };
  renderer.setAnimationLoop(loop);

  onRendererReady?.(rendererLabel);

  return {
    renderer,
    scene,
    camera,
    controls,
    lights: { ambient, key, fill, rim },
    plinth,
    floor,
    rendererLabel,
    isWebGPU,
    frameSubject,
    applyMaterialRealism: (root: Mesh | Group) => applyStudioMaterialRealism(root, isWebGPU),
    resize,
    dispose: () => {
      isDisposed = true;
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
    },
  };
}

export interface TalkingHeadUpgradeOptions {
  showPlinth?: boolean;
  backgroundColor?: number;
  exposure?: number;
}

/**
 * Upgrades an existing TalkingHead instance to studio-grade lighting, shadows, and materials:
 *  - ACESFilmic tone mapping with calibrated exposure (1.05)
 *  - PCFSoftShadowMap enabled on WebGLRenderer
 *  - Calibrated 3-point key/fill/ambient studio lighting with soft directional shadows
 *  - Neutral dark slate background (0x141516)
 *  - Physically-based material realism (SSS skin, wet cornea, anisotropic hair)
 *  - Optional architectural pedestal / plinth for bust & portrait framing
 */
export function upgradeTalkingHeadScene(
  head: any,
  options: TalkingHeadUpgradeOptions = {}
): void {
  if (!head) return;

  const { showPlinth = false, backgroundColor = 0x141516, exposure = 1.05 } = options;

  if (head.renderer) {
    head.renderer.outputColorSpace = SRGBColorSpace;
    head.renderer.toneMapping = ACESFilmicToneMapping;
    head.renderer.toneMappingExposure = exposure;
    head.renderer.shadowMap.enabled = true;
    head.renderer.shadowMap.type = PCFSoftShadowMap;
  }

  if (head.scene) {
    head.scene.background = new Color(backgroundColor);

    if (head.lightDirect) {
      head.lightDirect.castShadow = true;
      head.lightDirect.color.setHex(0xfff8ef);
      head.lightDirect.intensity = Math.max(head.lightDirect.intensity || 1, 1.2);
      if (head.lightDirect.shadow) {
        head.lightDirect.shadow.mapSize.set(2048, 2048);
        head.lightDirect.shadow.camera.near = 0.2;
        head.lightDirect.shadow.camera.far = 10;
        head.lightDirect.shadow.camera.left = -1.2;
        head.lightDirect.shadow.camera.right = 1.2;
        head.lightDirect.shadow.camera.top = 1.2;
        head.lightDirect.shadow.camera.bottom = -1.2;
        head.lightDirect.shadow.bias = -0.0008;
        head.lightDirect.shadow.normalBias = 0.02;
        head.lightDirect.shadow.radius = 2;
      }
    }

    if (head.lightAmbient) {
      head.lightAmbient.color.setHex(0xdbe6f0);
    }

    if (showPlinth && !head.scene.getObjectByName("studio-architectural-plinth")) {
      const plinth = createArchitecturalPlinth();
      head.scene.add(plinth);
    }

    // Apply material realism on whatever meshes are present
    applyStudioMaterialRealism(head.armature || head.scene, false);
  }
}

/**
 * Calibrates eyeball scale and orbit depth for ChatAvatar heads:
 * Enlarges eyeballs (1.28x) so irises are naturally proportioned in the eye aperture,
 * and pushes eyeballs back (-0.52 units along -Z) into the orbital sockets.
 * Safe and idempotent. Only affects head meshes with eyeball_left/eyeball_right (RPM unaffected).
 */
export function calibrateChatAvatarEyes(
  headScene: Object3D,
  options: { scale?: number; depthOffset?: number } = {}
): void {
  const search = typeof window !== "undefined" ? window.location.search : "";
  const params = new URLSearchParams(search);
  const scaleMult = options.scale ?? (params.has("eyeScale") ? Number(params.get("eyeScale")) : 1.28);
  const depthOffset = options.depthOffset ?? (params.has("eyeDepth") ? Number(params.get("eyeDepth")) : -0.52);

  for (const name of ["eyeball_left", "eyeball_right"]) {
    const eye = headScene.getObjectByName(name);
    if (!eye || eye.userData.eyeCalibrated) continue;
    eye.scale.multiplyScalar(scaleMult);
    eye.position.z += depthOffset;
    eye.userData.eyeCalibrated = true;
  }
}


