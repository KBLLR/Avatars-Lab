import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationClip,
  AnimationMixer,
  Box3,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Euler,
  EquirectangularReflectionMapping,
  FrontSide,
  GridHelper,
  Group,
  LoopOnce,
  LoopRepeat,
  Material,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Quaternion,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3
} from "three";
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, WebGPURenderer } from "three/webgpu";
import { color, mix, normalWorld, positionWorld, sin, time } from "three/tsl";
import { GLTFLoader } from "three-stdlib";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { deinterleaveGeometry } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type {
  ActorRuntimeCapabilities,
  CameraAuthority,
  CameraPresetId,
  LightingPresetId,
  PerformanceActor,
  PerformanceEnvironment,
  ShaderPresetId
} from "./types";
import { StageEffectsController, type StageEffectCue } from "./stage-effects";
import { calibrateChatAvatarEyes } from "../scene/studio-scene-template";

interface CinematicCameraCue {
  preset: CameraPresetId;
  movement?: string;
  amount?: number;
  transitionMs?: number;
  targetActorId?: string;
  handheld?: number;
  lensMm?: number;
  energy?: number;
}

interface CameraMotion {
  startedAt: number;
  durationMs: number;
  from: Vector3;
  to: Vector3;
  lookFrom: Vector3;
  lookTo: Vector3;
  movement: string;
  amount: number;
  handheld: number;
  roll: number;
}

interface ActorRuntime {
  definition: PerformanceActor;
  root: Group;
  performanceRoot: Object3D;
  model: Object3D;
  mixer: AnimationMixer | null;
  currentAction: ReturnType<AnimationMixer["clipAction"]> | null;
  currentClipId: string | null;
  originalMaterials: Map<Mesh, Material | Material[]>;
  capabilities: ActorRuntimeCapabilities;
  animationTargets: Set<string>;
  animationClips: Map<string, AnimationClip>;
  morphMeshes: Mesh[];
  expressionTargets: Map<string, number>;
  eyeNodes: Array<{ node: Object3D; neutral: Quaternion }>;
  headPoseTarget: { pitch: number; yaw: number; roll: number };
  headPoseCurrent: { pitch: number; yaw: number; roll: number };
  nextBlinkAt: number;
  blinkStartedAt: number | null;
  blinkDurationMs: number;
  saccade: { x: number; y: number; nextAt: number };
}

export interface RoomStats {
  renderer: string;
  actors: number;
  drawCalls: number;
  triangles: number;
  frameCount: number;
  averageFps: number;
}

const normalizeHeadAssembly = (headScene: Object3D): void => {
  headScene.updateMatrixWorld(true);
  let faceMesh: Mesh | null = null;
  headScene.traverse((object) => {
    const mesh = object as Mesh;
    if (!faceMesh && mesh.isMesh && (mesh.morphTargetInfluences?.length ?? 0) > 0) {
      faceMesh = mesh;
    }
  });
  const faceScale = faceMesh ? faceMesh.getWorldScale(new Vector3()).x : 1;
  for (const name of ["eyeball_left", "eyeball_right"]) {
    const eye = headScene.getObjectByName(name);
    if (!eye) continue;
    const eyeScale = eye.getWorldScale(new Vector3()).x;
    const ratio = faceScale / eyeScale;
    if (ratio < 0.5 || ratio > 2) {
      eye.scale.multiplyScalar(ratio);
      eye.position.multiplyScalar(ratio);
    }
  }
  calibrateChatAvatarEyes(headScene);
  headScene.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const name = (material?.name || "").toLowerCase();
      if (name.includes("occlusion")) material.visible = false;
      if (name === "eyes") material.side = FrontSide;
    }
  });
};

const HEAD_CENTER_Y = 1.20;
const HEAD_MODEL_HEIGHT = 1.08;

const damp = (current: number, target: number, deltaMs: number, responseMs: number): number =>
  current + (target - current) * (1 - Math.exp(-Math.max(0, deltaMs) / responseMs));

const createStudioHeadPlinth = (): Group => {
  const pedestal = new Group();
  pedestal.name = "avatar-labs-head-pedestal-studio-plinth";
  pedestal.userData.avatarLabsPedestalSource = "studio-plinth";
  const stoneMaterial = new MeshPhysicalMaterial({
    color: 0x1e2022,
    metalness: 0.04,
    roughness: 0.42,
    clearcoat: 0.16,
    clearcoatRoughness: 0.32,
  });
  const trimMaterial = new MeshPhysicalMaterial({
    color: 0x121315,
    metalness: 0.72,
    roughness: 0.22,
    clearcoat: 0.45,
    clearcoatRoughness: 0.15,
  });
  const base = new Mesh(new CylinderGeometry(0.22, 0.26, 0.05, 64), stoneMaterial);
  base.position.y = 0.025;
  const lowerTrim = new Mesh(new CylinderGeometry(0.18, 0.22, 0.03, 64), trimMaterial);
  lowerTrim.position.y = 0.065;
  const column = new Mesh(new CylinderGeometry(0.11, 0.15, 0.46, 64), stoneMaterial.clone());
  column.position.y = 0.31;
  const upperTrim = new Mesh(new CylinderGeometry(0.12, 0.11, 0.03, 64), trimMaterial.clone());
  upperTrim.position.y = 0.555;
  const cap = new Mesh(new CylinderGeometry(0.095, 0.12, 0.03, 64), stoneMaterial.clone());
  cap.position.y = 0.585;
  for (const mesh of [base, lowerTrim, column, upperTrim, cap]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    pedestal.add(mesh);
  }
  return pedestal;
};

const normalizeWebGpuActorGeometry = (actorScene: Object3D): void => {
  actorScene.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    deinterleaveGeometry(mesh.geometry);
  });
};

const createNodeMaterial = (preset: Exclude<ShaderPresetId, "realismus" | "original">): MeshStandardNodeMaterial => {
  const material = new MeshStandardNodeMaterial();
  material.roughness = 0.42;
  material.metalness = 0.08;

  if (preset === "hologram") {
    const scan = sin(time.mul(3.2).add(positionWorld.y.mul(18))).mul(0.5).add(0.5);
    material.colorNode = mix(color("#071421"), color("#35f4ff"), scan);
    material.emissiveNode = color("#0aa6b8").mul(scan.mul(0.65));
    material.transparent = true;
    material.opacity = 0.82;
    material.roughness = 0.26;
    material.metalness = 0.35;
  } else if (preset === "toon") {
    const lightBand = normalWorld.y.mul(0.5).add(0.5).step(0.56);
    material.colorNode = mix(color("#172554"), color("#f97316"), lightBand);
    material.roughness = 0.76;
    material.metalness = 0;
  } else if (preset === "chrome") {
    const band = sin(positionWorld.y.mul(7).add(time.mul(0.55))).mul(0.5).add(0.5);
    material.colorNode = mix(color("#111827"), color("#e2e8f0"), band);
    material.metalness = 1;
    material.roughness = 0.08;
  } else {
    const edge = normalWorld.z.abs().oneMinus();
    material.colorNode = mix(color("#09090b"), color("#c084fc"), edge);
    material.emissiveNode = color("#7e22ce").mul(edge.mul(0.5));
    material.transparent = true;
    material.opacity = 0.36;
    material.side = DoubleSide;
    material.depthWrite = false;
  }
  return material;
};

const createRealismusMaterial = (
  source: Material,
  meshName: string,
  webgpu: boolean,
): Material => {
  const sourcePbr = source as MeshStandardMaterial & Partial<MeshPhysicalMaterial>;
  if (!sourcePbr.isMeshStandardMaterial && !sourcePbr.isMeshPhysicalMaterial) return source.clone();

  const materialIdentity = source.name.toLowerCase();
  const meshIdentity = meshName.toLowerCase();
  const roleIdentity = materialIdentity || meshIdentity;

  // 1. Occlusion hidden helper geometry
  if (roleIdentity.includes("occlusion")) {
    const hidden = source.clone();
    hidden.transparent = true;
    hidden.opacity = 0;
    hidden.depthWrite = false;
    hidden.depthTest = false;
    hidden.visible = false;
    return hidden;
  }

  // 2. Mouth interior (polygon-offset prevents black slits around lips)
  if (roleIdentity.includes("mouth") || roleIdentity.includes("interior")) {
    const mouthMat = (source.clone() as MeshPhysicalMaterial);
    mouthMat.name = `${source.name || meshName || "actor"}:realismus-mouth`;
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
    return mouthMat;
  }

  // 3. Teeth (wet enamel clearcoat)
  if (roleIdentity.includes("teeth")) {
    const teethMat = (source.clone() as MeshPhysicalMaterial);
    teethMat.name = `${source.name || meshName || "actor"}:realismus-teeth`;
    teethMat.side = FrontSide;
    teethMat.roughness = 0.35;
    teethMat.metalness = 0;
    teethMat.clearcoat = 0.6;
    teethMat.clearcoatRoughness = 0.1;
    teethMat.transmission = 0;
    teethMat.thickness = 0;
    teethMat.sheen = 0;
    teethMat.iridescence = 0;
    return teethMat;
  }

  const isHair = /hair|brow|lash|beard/.test(roleIdentity);
  const isEye = !isHair && /eye|cornea|iris/.test(roleIdentity);
  const isSkin = !isEye && !isHair && /skin|face|head|body|ear|lip/.test(roleIdentity);

  if (!isSkin) {
    const authored = source.clone() as MeshStandardMaterial & Partial<MeshPhysicalMaterial>;
    authored.name = `${source.name || meshName || "actor"}:realismus`;
    if (isEye) {
      authored.side = FrontSide;
      authored.roughness = Math.min(authored.roughness || 0.18, 0.18);
      authored.metalness = 0;
      authored.transparent = false;
      authored.depthWrite = true;
      authored.opacity = 1;
      if (authored.isMeshPhysicalMaterial) {
        authored.transmission = 0;
        authored.thickness = 0;
        authored.sheen = 0;
        authored.iridescence = 0;
        authored.clearcoat = Math.max(authored.clearcoat || 0, 0.28);
        authored.clearcoatRoughness = Math.min(authored.clearcoatRoughness || 0.08, 0.08);
        authored.specularIntensity = Math.max(authored.specularIntensity || 0, 0.72);
        authored.envMapIntensity = Math.max(authored.envMapIntensity || 0, 0.55);
        authored.ior = 1.38;
      }
    } else if (isHair) {
      authored.roughness = Math.max(0.48, authored.roughness || 0.48);
      authored.metalness = 0;
      if (/lash/.test(roleIdentity)) {
        authored.side = DoubleSide;
        authored.alphaHash = false;
        authored.alphaTest = Math.max(authored.alphaTest, 0.5);
        authored.transparent = false;
        authored.depthWrite = true;
      }
    }
    authored.userData = { ...source.userData, avatarLabsGeneratedMaterial: true, preset: "realismus" };
    authored.needsUpdate = true;
    return authored;
  }

  // Canonical Core-X skin: pure diffuse + GGX specular, SSS-extinction to prevent black cutouts
  const material = webgpu ? new MeshPhysicalNodeMaterial() : new MeshPhysicalMaterial();
  material.name = `${source.name || meshName || "actor"}:realismus`;
  material.color.copy(sourcePbr.color);
  material.emissive.copy(sourcePbr.emissive);
  material.emissiveIntensity = sourcePbr.emissiveIntensity;
  material.map = sourcePbr.map;
  material.alphaMap = sourcePbr.alphaMap;
  material.aoMap = sourcePbr.aoMap;
  material.aoMapIntensity = sourcePbr.aoMapIntensity;
  material.bumpMap = sourcePbr.bumpMap;
  material.bumpScale = sourcePbr.bumpScale;
  material.displacementMap = sourcePbr.displacementMap;
  material.displacementScale = sourcePbr.displacementScale;
  material.displacementBias = sourcePbr.displacementBias;
  material.emissiveMap = sourcePbr.emissiveMap;
  material.lightMap = sourcePbr.lightMap;
  material.lightMapIntensity = sourcePbr.lightMapIntensity;
  material.metalnessMap = sourcePbr.metalnessMap;
  material.normalMap = sourcePbr.normalMap;
  material.normalScale.copy(sourcePbr.normalScale);
  material.roughnessMap = sourcePbr.roughnessMap;
  material.roughness = 0.58;
  material.metalness = 0;
  material.envMapIntensity = 0.85;
  material.opacity = source.opacity;
  material.transparent = false;
  material.alphaTest = source.alphaTest;
  material.alphaHash = source.alphaHash;
  material.alphaToCoverage = source.alphaToCoverage;
  material.side = FrontSide;
  material.depthTest = true;
  material.depthWrite = true;
  material.colorWrite = source.colorWrite;
  material.vertexColors = sourcePbr.vertexColors;

  // SSS extinction — prevents black punchout holes
  material.clearcoat = 0;
  material.clearcoatRoughness = 0;
  material.sheen = 0;
  material.ior = 1.5;
  material.transmission = 0;
  material.thickness = 0;
  material.attenuationDistance = Infinity;
  material.userData = { ...source.userData, avatarLabsGeneratedMaterial: true, preset: "realismus" };
  material.needsUpdate = true;
  return material;
};

const roomColors = (room: PerformanceEnvironment["room"]) => {
  switch (room) {
    case "facial-lab": return { background: 0x141516, floor: 0x181a1c, wall: 0x121314, accent: 0x3d6e96 };
    case "black-box": return { background: 0x030303, floor: 0x09090b, wall: 0x111113, accent: 0x71717a };
    case "broadcast": return { background: 0x121416, floor: 0x202326, wall: 0x292d31, accent: 0x60a5fa };
    case "neon-grid": return { background: 0x070613, floor: 0x101026, wall: 0x17132e, accent: 0xc026d3 };
    default: return { background: 0x141516, floor: 0x181a1c, wall: 0x121314, accent: 0x60a5fa };
  }
};

const CAMERA_FLOOR_Y = 0.18;
const CAMERA_TARGET_FLOOR_Y = 0.04;
const MOTION_BLEND_SECONDS = 0.46;

const surfaceNoise = (x: number, y: number, seed: number): number => {
  const wave = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return wave - Math.floor(wave);
};

const createPbrSurfaceTextures = (
  baseHex: number,
  surface: "floor" | "wall",
  seed: number,
): { map: CanvasTexture; roughnessMap: CanvasTexture; bumpMap: CanvasTexture } => {
  const size = 192;
  const makeCanvas = (): HTMLCanvasElement => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    return canvas;
  };
  const colorCanvas = makeCanvas();
  const roughnessCanvas = makeCanvas();
  const bumpCanvas = makeCanvas();
  const colorContext = colorCanvas.getContext("2d")!;
  const roughnessContext = roughnessCanvas.getContext("2d")!;
  const bumpContext = bumpCanvas.getContext("2d")!;
  const colorImage = colorContext.createImageData(size, size);
  const roughnessImage = roughnessContext.createImageData(size, size);
  const bumpImage = bumpContext.createImageData(size, size);
  const base = new Color(baseHex);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const grain = surfaceNoise(x, y, seed) - 0.5;
      const broad = Math.sin((x + seed * 7) * 0.075) * Math.cos((y - seed * 11) * 0.052);
      const seam = surface === "floor" && (x % 64 < 2 || y % 64 < 2);
      const colorScale = seam ? 0.64 : 0.91 + grain * 0.12 + broad * 0.035;
      const height = seam ? 58 : 128 + grain * 58 + broad * 20;
      const roughness = seam
        ? 238
        : (surface === "floor" ? 166 : 202) + grain * 34 - broad * 12;
      colorImage.data[index] = Math.max(0, Math.min(255, base.r * 255 * colorScale));
      colorImage.data[index + 1] = Math.max(0, Math.min(255, base.g * 255 * colorScale));
      colorImage.data[index + 2] = Math.max(0, Math.min(255, base.b * 255 * colorScale));
      roughnessImage.data[index] = roughnessImage.data[index + 1] = roughnessImage.data[index + 2] = roughness;
      bumpImage.data[index] = bumpImage.data[index + 1] = bumpImage.data[index + 2] = height;
      colorImage.data[index + 3] = roughnessImage.data[index + 3] = bumpImage.data[index + 3] = 255;
    }
  }
  colorContext.putImageData(colorImage, 0, 0);
  roughnessContext.putImageData(roughnessImage, 0, 0);
  bumpContext.putImageData(bumpImage, 0, 0);

  const configure = (texture: CanvasTexture, repeatX: number, repeatY: number): CanvasTexture => {
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = 4;
    return texture;
  };
  const map = configure(new CanvasTexture(colorCanvas), surface === "floor" ? 5.5 : 4.5, surface === "floor" ? 5 : 2.5);
  map.colorSpace = SRGBColorSpace;
  return {
    map,
    roughnessMap: configure(new CanvasTexture(roughnessCanvas), map.repeat.x, map.repeat.y),
    bumpMap: configure(new CanvasTexture(bumpCanvas), map.repeat.x, map.repeat.y),
  };
};

const trackTargetName = (trackName: string): string => {
  const property = trackName.lastIndexOf(".");
  return property > 0 ? trackName.slice(0, property) : trackName;
};

const normalizeRigTargetName = (value: string): string => value
  .replace(/^mixamorig(?:\d+)?:?/i, "")
  .replace(/^armature[|/:]/i, "")
  .replace(/[^a-z0-9]/gi, "")
  .toLowerCase();

const createInPlaceClip = (clip: AnimationClip, targets: Set<string>): AnimationClip => {
  const targetNames = new Map([...targets].map((target) => [normalizeRigTargetName(target), target]));
  const tracks = clip.tracks.flatMap((track) => {
    if (track.name.endsWith(".position") || track.name.endsWith(".scale")) return [];
    const property = track.name.slice(track.name.lastIndexOf("."));
    const sourceTarget = trackTargetName(track.name);
    const target = targets.has(sourceTarget)
      ? sourceTarget
      : targetNames.get(normalizeRigTargetName(sourceTarget));
    if (!target) return [];
    const retargeted = track.clone();
    retargeted.name = `${target}${property}`;
    return [retargeted];
  });
  if (tracks.length < 8) {
    throw new Error(`Animation ${clip.name || "clip"} matched only ${tracks.length} rig tracks.`);
  }
  return new AnimationClip(`${clip.name || "performance"}:in-place`, clip.duration, tracks);
};

export class PerformanceRoom {
  readonly renderer: WebGPURenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(32, 1, 0.01, 100);
  readonly rendererLabel: string;

  private actors = new Map<string, ActorRuntime>();
  private actorLoadVersions = new Map<string, number>();
  private animationCache = new Map<string, AnimationClip>();
  private roomRoot = new Group();
  private currentRoom: PerformanceEnvironment["room"] | null = null;
  private keyLight = new DirectionalLight(0xffffff, 3.2);
  private fillLight = new DirectionalLight(0x9cc8ff, 1.4);
  private rimLight = new PointLight(0xffc48a, 18, 12);
  private resizeObserver: ResizeObserver;
  private frameHandler: ((deltaMs: number) => void) | null = null;
  private lastFrameAt = performance.now();
  private frameCount = 0;
  private averageFps = 0;
  private disposed = false;
  private environmentToken = 0;
  private environmentTexture: Texture | null = null;
  private environmentTextureUrl: string | null = null;
  private environmentFailures = new Map<string, number>();
  private stageEffects: StageEffectsController;
  private cameraControls: OrbitControls;
  private cameraAuthority: CameraAuthority = "director";
  private cameraMotion: CameraMotion | null = null;
  private cameraLookAt = new Vector3(0, 1.25, 0);
  private musicEnergy = 0;
  private lightingBase = { key: 3.2, fill: 1.4, rim: 18, pulseOnBeat: false };

  private constructor(private container: HTMLElement, renderer: WebGPURenderer, label: string) {
    this.renderer = renderer;
    this.rendererLabel = label;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    if ((this.renderer as unknown as { shadowMap?: { enabled: boolean; type: number } }).shadowMap) {
      const sm = (this.renderer as unknown as { shadowMap: { enabled: boolean; type: number } }).shadowMap;
      sm.enabled = true;
      sm.type = PCFShadowMap;
    }
    this.container.replaceChildren(this.renderer.domElement as HTMLCanvasElement);
    this.renderer.domElement.classList.add("performance-canvas");

    this.camera.position.set(0, 1.45, 5.8);
    this.camera.lookAt(0, 1.25, 0);
    this.cameraControls = new OrbitControls(this.camera, this.renderer.domElement as HTMLCanvasElement);
    this.cameraControls.enabled = false;
    this.cameraControls.enableDamping = true;
    this.cameraControls.dampingFactor = 0.08;
    this.cameraControls.enablePan = true;
    this.cameraControls.enableRotate = true;
    this.cameraControls.enableZoom = true;
    this.cameraControls.minDistance = 1.2;
    this.cameraControls.maxDistance = 14;
    this.cameraControls.minPolarAngle = 0.08;
    this.cameraControls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.cameraControls.target.copy(this.cameraLookAt);
    this.scene.add(this.roomRoot);
    this.scene.add(new AmbientLight(0xffffff, 0.38), this.keyLight, this.fillLight, this.rimLight);
    this.keyLight.position.set(2.4, 4.2, 3.4);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.near = 0.2;
    this.keyLight.shadow.camera.far = 14;
    this.keyLight.shadow.camera.left = -1.5;
    this.keyLight.shadow.camera.right = 1.5;
    this.keyLight.shadow.camera.top = 1.5;
    this.keyLight.shadow.camera.bottom = -1.5;
    this.keyLight.shadow.bias = -0.0008;
    this.keyLight.shadow.normalBias = 0.02;
    this.keyLight.shadow.radius = 2;
    this.fillLight.position.set(-2.8, 2.2, 1.8);
    this.rimLight.position.set(0, 3.0, -2.6);
    this.stageEffects = new StageEffectsController(this.scene);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.applyRoomGeometry("cyclorama");
    this.renderer.setAnimationLoop((now) => this.render(now));
  }

  static async create(container: HTMLElement): Promise<PerformanceRoom> {
    const requestedWebGl = new URLSearchParams(location.search).get("renderer") === "webgl";
    let renderer: WebGPURenderer;
    let label = "webgpu";
    try {
      renderer = new WebGPURenderer({ antialias: true, forceWebGL: requestedWebGl });
      await renderer.init();
      const backend = (renderer as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend;
      label = backend?.isWebGPUBackend ? "webgpu" : "webgl2-fallback";
    } catch {
      renderer = new WebGPURenderer({ antialias: true, forceWebGL: true });
      await renderer.init();
      label = "webgl2-fallback";
    }
    return new PerformanceRoom(container, renderer, label);
  }

  setFrameHandler(handler: (deltaMs: number) => void): void {
    this.frameHandler = handler;
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private render(now: number): void {
    if (this.disposed) return;
    const deltaMs = Math.min(100, now - this.lastFrameAt);
    this.lastFrameAt = now;
    this.frameCount += 1;
    if (deltaMs > 0) {
      const instantaneousFps = 1000 / deltaMs;
      this.averageFps = this.averageFps === 0
        ? instantaneousFps
        : this.averageFps * 0.92 + instantaneousFps * 0.08;
    }
    for (const runtime of this.actors.values()) {
      runtime.mixer?.update(deltaMs / 1000);
      if (runtime.definition.asset.kind === "head") {
        this.updateHeadPerformance(runtime, now, deltaMs);
      } else {
        this.updateExpressionTargets(runtime, now, deltaMs, 0);
      }
    }
    if (this.cameraAuthority === "operator") {
      this.cameraControls.update();
    } else {
      this.updateCamera(now);
    }
    this.constrainCameraToStage();
    const pulse = this.lightingBase.pulseOnBeat ? 1 + this.musicEnergy * 0.38 : 1;
    this.keyLight.intensity = this.lightingBase.key * pulse;
    this.fillLight.intensity = this.lightingBase.fill * (1 + this.musicEnergy * 0.16);
    this.rimLight.intensity = this.lightingBase.rim * (1 + this.musicEnergy * 0.5);
    this.stageEffects.setMusicEnergy(this.musicEnergy);
    this.stageEffects.update(deltaMs);
    this.frameHandler?.(deltaMs);
    this.renderer.render(this.scene, this.camera);
  }

  private updateHeadPerformance(runtime: ActorRuntime, now: number, deltaMs: number): void {
    const pose = runtime.headPoseCurrent;
    const target = runtime.headPoseTarget;
    pose.pitch = damp(pose.pitch, target.pitch, deltaMs, 180);
    pose.yaw = damp(pose.yaw, target.yaw, deltaMs, 180);
    pose.roll = damp(pose.roll, target.roll, deltaMs, 210);
    const idleYaw = Math.sin(now / 3600 + runtime.root.position.x) * 0.022;
    const idlePitch = Math.sin(now / 5100 + runtime.root.position.z) * 0.012;
    runtime.performanceRoot.rotation.set(
      pose.pitch + idlePitch,
      runtime.definition.rotationY + pose.yaw + idleYaw,
      pose.roll,
    );

    if (now >= runtime.saccade.nextAt) {
      runtime.saccade.x = (Math.random() - 0.5) * 0.008;
      runtime.saccade.y = (Math.random() - 0.5) * 0.006;
      runtime.saccade.nextAt = now + 650 + Math.random() * 1_250;
    }
    for (const eye of runtime.eyeNodes) {
      if (!eye.node.parent) continue;
      const localCamera = eye.node.parent.worldToLocal(this.camera.position.clone());
      const direction = localCamera.sub(eye.node.position).normalize();
      const yaw = Math.max(-0.3, Math.min(0.3, Math.atan2(direction.x, Math.max(0.05, direction.z)))) * 0.18 + runtime.saccade.x;
      const pitch = Math.max(-0.2, Math.min(0.2, -Math.atan2(direction.y, Math.hypot(direction.x, direction.z)))) * 0.18 + runtime.saccade.y;
      const gaze = new Quaternion().setFromEuler(new Euler(pitch, yaw, 0, "YXZ"));
      const desired = eye.neutral.clone().multiply(gaze);
      eye.node.quaternion.slerp(desired, 1 - Math.exp(-deltaMs / 85));
    }

    let blink = 0;
    if (runtime.blinkStartedAt == null && now >= runtime.nextBlinkAt) {
      runtime.blinkStartedAt = now;
      runtime.blinkDurationMs = 115 + Math.random() * 55;
    }
    if (runtime.blinkStartedAt != null) {
      const phase = (now - runtime.blinkStartedAt) / runtime.blinkDurationMs;
      if (phase >= 1) {
        runtime.blinkStartedAt = null;
        runtime.nextBlinkAt = now + 2_100 + Math.random() * 3_900;
      } else {
        blink = Math.sin(Math.PI * phase);
      }
    }
    this.updateExpressionTargets(runtime, now, deltaMs, blink);
  }

  private updateExpressionTargets(runtime: ActorRuntime, now: number, deltaMs: number, blink: number): void {
    const alpha = 1 - Math.exp(-deltaMs / 92);
    const microSmile = runtime.definition.asset.kind === "head"
      ? 0.025 + (Math.sin(now / 3_900 + runtime.root.position.x) + 1) * 0.008
      : 0;
    for (const mesh of runtime.morphMeshes) {
      const dictionary = mesh.morphTargetDictionary;
      const influences = mesh.morphTargetInfluences;
      if (!dictionary || !influences) continue;
      for (const [name, index] of Object.entries(dictionary)) {
        let desired = runtime.expressionTargets.get(name);
        if (desired === undefined && (name === "mouthSmileLeft" || name === "mouthSmileRight")) {
          desired = microSmile;
        }
        if (name === "eyeBlinkLeft" || name === "eyeBlinkRight") {
          desired = Math.max(desired || 0, blink);
        }
        if (desired === undefined) continue;
        influences[index] += (Math.max(0, Math.min(1, desired)) - influences[index]) * alpha;
      }
    }
  }

  private applyRoomGeometry(room: PerformanceEnvironment["room"]): void {
    const colors = roomColors(room);
    this.scene.background = new Color(colors.background);
    if (this.currentRoom === room) return;
    this.disposeObject(this.roomRoot);
    this.roomRoot.clear();
    this.currentRoom = room;

    const seed = ["cyclorama", "black-box", "broadcast", "neon-grid"].indexOf(room) + 1;
    const floorTextures = createPbrSurfaceTextures(colors.floor, "floor", seed);
    const wallTextures = room === "facial-lab"
      ? {}
      : createPbrSurfaceTextures(colors.wall, "wall", seed + 11);
    const floorMaterial = new MeshStandardMaterial({
      ...floorTextures,
      color: room === "facial-lab" ? colors.floor : 0xffffff,
      roughness: 0.78,
      metalness: room === "broadcast" ? 0.14 : 0.04,
      bumpScale: 0.045,
    });
    const wallMaterial = new MeshStandardMaterial({
      ...wallTextures,
      color: room === "facial-lab" ? colors.wall : 0xffffff,
      roughness: room === "facial-lab" ? 0.95 : 0.9,
      metalness: 0.01,
      bumpScale: room === "facial-lab" ? 0 : 0.028,
    });
    const floor = new Mesh(new PlaneGeometry(18, 16), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.roomRoot.add(floor);

    const back = new Mesh(new PlaneGeometry(18, 8), wallMaterial);
    back.position.set(0, 4, -4.2);
    this.roomRoot.add(back);
    const left = new Mesh(new PlaneGeometry(8, 8), wallMaterial.clone());
    left.rotation.y = Math.PI / 2;
    left.position.set(-9, 4, 0);
    this.roomRoot.add(left);
    const right = left.clone();
    right.rotation.y = -Math.PI / 2;
    right.position.x = 9;
    this.roomRoot.add(right);

    if (room === "neon-grid" || room === "broadcast") {
      const grid = new GridHelper(18, room === "neon-grid" ? 36 : 18, colors.accent, colors.wall);
      grid.position.y = 0.006;
      this.roomRoot.add(grid);
    }
    if (room === "broadcast") {
      for (const x of [-4.8, 4.8]) {
        const panel = new Mesh(
          new BoxGeometry(2.3, 3.2, 0.08),
          new MeshStandardMaterial({ color: 0x1e293b, emissive: 0x2563eb, emissiveIntensity: 0.32 })
        );
        panel.position.set(x, 2.4, -4.05);
        this.roomRoot.add(panel);
      }
    }
  }

  async setEnvironment(environment: PerformanceEnvironment): Promise<void> {
    const token = ++this.environmentToken;
    const hdriUrl = environment.hdriUrl || null;
    const reusableTexture = Boolean(
      hdriUrl && this.environmentTexture && this.environmentTextureUrl === hdriUrl,
    );
    if (!reusableTexture) {
      this.environmentTexture?.dispose();
      this.environmentTexture = null;
      this.environmentTextureUrl = null;
    }
    this.scene.environment = reusableTexture ? this.environmentTexture : null;
    this.applyRoomGeometry(environment.room);
    this.renderer.toneMappingExposure = environment.exposure;
    this.scene.environmentIntensity = environment.environmentIntensity;
    this.scene.backgroundIntensity = environment.backgroundIntensity;
    if (reusableTexture && this.environmentTexture) {
      this.scene.environment = this.environmentTexture;
      this.scene.background = this.environmentTexture;
      return;
    }
    if (!hdriUrl) {
      this.scene.environment = null;
      return;
    }
    const failedAt = this.environmentFailures.get(hdriUrl) || 0;
    if (Date.now() - failedAt < 5_000) return;
    try {
      const texture = await new HDRLoader().loadAsync(hdriUrl);
      if (token !== this.environmentToken) {
        texture.dispose();
        return;
      }
      texture.mapping = EquirectangularReflectionMapping;
      this.environmentTexture = texture;
      this.environmentTextureUrl = hdriUrl;
      this.environmentFailures.delete(hdriUrl);
      this.scene.environment = texture;
      this.scene.background = texture;
    } catch (error) {
      if (token !== this.environmentToken || this.disposed) return;
      this.environmentFailures.set(hdriUrl, Date.now());
      this.scene.environment = null;
      console.warn(
        `[Performance Room] ${environment.label} HDRI unavailable; using the ${environment.room} procedural room.`,
        error,
      );
    }
  }

  private async loadHeadPedestal(): Promise<Object3D> {
    return createStudioHeadPlinth();
  }

  async loadActor(definition: PerformanceActor): Promise<ActorRuntimeCapabilities | null> {
    const loadVersion = (this.actorLoadVersions.get(definition.id) || 0) + 1;
    this.actorLoadVersions.set(definition.id, loadVersion);
    this.detachActorRuntime(definition.id);
    const [gltf, pedestal] = await Promise.all([
      new GLTFLoader().loadAsync(definition.asset.url),
      definition.asset.kind === "head" ? this.loadHeadPedestal() : Promise.resolve(null),
    ]);
    if (this.disposed || this.actorLoadVersions.get(definition.id) !== loadVersion) {
      this.disposeObject(gltf.scene);
      if (pedestal) this.disposeObject(pedestal);
      return null;
    }
    if (this.rendererLabel === "webgpu") normalizeWebGpuActorGeometry(gltf.scene);
    if (definition.asset.kind === "head") normalizeHeadAssembly(gltf.scene);

    const root = new Group();
    const model = gltf.scene;
    const performanceRoot = definition.asset.kind === "head" ? new Group() : root;
    if (definition.asset.kind === "head") {
      performanceRoot.name = "avatar-labs-head-performance-pivot";
      performanceRoot.add(model);
      root.add(performanceRoot);
    } else {
      root.add(model);
    }
    if (pedestal) root.add(pedestal);
    this.scene.add(root);

    const box = new Box3().setFromObject(model);
    const size = box.getSize(new Vector3());
    const targetHeight = definition.asset.kind === "head" ? HEAD_MODEL_HEIGHT : 2.45;
    const scale = size.y > 0 ? targetHeight / size.y : 1;
    model.scale.setScalar(scale);
    model.updateMatrixWorld(true);
    const scaledBox = new Box3().setFromObject(model);
    const center = scaledBox.getCenter(new Vector3());
    if (definition.asset.kind === "head") {
      model.position.set(-center.x, -scaledBox.min.y, -center.z);
      performanceRoot.position.y = 0.60;
    } else {
      model.position.set(-center.x, -scaledBox.min.y, -center.z);
    }
    root.position.set(definition.position.x, definition.position.y, definition.position.z);
    root.rotation.y = definition.rotationY;
    root.scale.setScalar(definition.scale);
    root.visible = definition.visible;

    let skeletons = 0;
    let morphTargets = 0;
    const morphMeshes: Mesh[] = [];
    const animationTargets = new Set<string>();
    const originalMaterials = new Map<Mesh, Material | Material[]>();
    model.traverse((object) => {
      if (object.name) animationTargets.add(object.name);
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      if ((mesh as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) skeletons += 1;
      morphTargets += mesh.morphTargetInfluences?.length || 0;
      if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) morphMeshes.push(mesh);
      originalMaterials.set(mesh, mesh.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });

    const capabilities: ActorRuntimeCapabilities = {
      actorId: definition.id,
      assetId: definition.asset.id,
      kind: definition.asset.kind,
      skeletons,
      morphTargets,
      embeddedAnimations: gltf.animations.length,
      animationCompatible: skeletons > 0,
      performanceMode: definition.asset.kind === "head" ? "portrait-head" : "full-body",
      eyeContact: definition.asset.kind === "head" && ["eyeball_left", "eyeball_right"]
        .some((name) => Boolean(model.getObjectByName(name))),
      pedestal: definition.asset.kind === "head"
        ? "studio-plinth"
        : "none",
    };
    const runtime: ActorRuntime = {
      definition,
      root,
      performanceRoot,
      model,
      mixer: skeletons > 0 ? new AnimationMixer(model) : null,
      currentAction: null,
      currentClipId: null,
      originalMaterials,
      capabilities,
      animationTargets,
      animationClips: new Map(),
      morphMeshes,
      expressionTargets: new Map(),
      eyeNodes: definition.asset.kind === "head"
        ? ["eyeball_left", "eyeball_right"].flatMap((name) => {
            const node = model.getObjectByName(name);
            return node ? [{ node, neutral: node.quaternion.clone() }] : [];
          })
        : [],
      headPoseTarget: { pitch: 0, yaw: 0, roll: 0 },
      headPoseCurrent: { pitch: 0, yaw: 0, roll: 0 },
      nextBlinkAt: performance.now() + 1_600 + Math.random() * 2_200,
      blinkStartedAt: null,
      blinkDurationMs: 140,
      saccade: { x: 0, y: 0, nextAt: performance.now() + 500 + Math.random() * 900 },
    };
    this.actors.set(definition.id, runtime);
    this.setActorShader(definition.id, definition.shader);
    return capabilities;
  }

  updateActor(definition: PerformanceActor): void {
    const runtime = this.actors.get(definition.id);
    if (!runtime) return;
    runtime.definition = definition;
    runtime.root.position.set(definition.position.x, definition.position.y, definition.position.z);
    if (definition.asset.kind !== "head") runtime.root.rotation.y = definition.rotationY;
    runtime.root.scale.setScalar(definition.scale);
    runtime.root.visible = definition.visible;
  }

  removeActor(actorId: string): void {
    this.actorLoadVersions.set(actorId, (this.actorLoadVersions.get(actorId) || 0) + 1);
    this.detachActorRuntime(actorId);
  }

  private detachActorRuntime(actorId: string): void {
    const runtime = this.actors.get(actorId);
    if (!runtime) return;
    runtime.currentAction?.stop();
    runtime.mixer?.stopAllAction();
    runtime.mixer?.uncacheRoot(runtime.model);
    this.scene.remove(runtime.root);
    const originalMaterials = [...runtime.originalMaterials.values()]
      .flatMap((material) => Array.isArray(material) ? material : [material]);
    this.disposeObject(runtime.root, originalMaterials);
    this.actors.delete(actorId);
  }

  setActorShader(actorId: string, preset: ShaderPresetId): void {
    const runtime = this.actors.get(actorId);
    if (!runtime) return;
    runtime.definition.shader = preset;
    for (const [mesh, original] of runtime.originalMaterials) {
      const current = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of current) {
        if (material !== original && !(Array.isArray(original) && original.includes(material))) {
          material.dispose();
        }
      }
      if (preset === "original") {
        mesh.material = original;
      } else if (preset === "realismus") {
        mesh.material = Array.isArray(original)
          ? original.map((material) => createRealismusMaterial(material, mesh.name, this.rendererLabel === "webgpu"))
          : createRealismusMaterial(original, mesh.name, this.rendererLabel === "webgpu");
      } else {
        mesh.material = Array.isArray(original)
          ? original.map(() => createNodeMaterial(preset))
          : createNodeMaterial(preset);
      }
    }
  }

  async playAnimation(
    actorId: string,
    url: string,
    options: { loop?: boolean; speed?: number; offsetMs?: number; clipId?: string; blendSeconds?: number } = {},
  ): Promise<void> {
    const runtime = this.actors.get(actorId);
    if (!runtime?.mixer || !runtime.capabilities.animationCompatible) {
      throw new Error(`${runtime?.definition.label || actorId} does not have a compatible skeleton.`);
    }
    let clip = this.animationCache.get(url);
    if (!clip) {
      const loaded = await new FBXLoader().loadAsync(url);
      clip = loaded.animations[0];
      if (!clip) throw new Error(`Animation ${url} contains no clip.`);
      this.animationCache.set(url, clip);
    }
    const clipKey = `${url}#${options.clipId || "runtime"}`;
    let actorClip = runtime.animationClips.get(clipKey);
    if (!actorClip) {
      actorClip = createInPlaceClip(clip, runtime.animationTargets);
      actorClip.name = `${actorClip.name}:${options.clipId || "runtime"}`;
      runtime.animationClips.set(clipKey, actorClip);
    }
    const action = runtime.mixer.clipAction(actorClip);
    const previousAction = runtime.currentAction;
    const blendSeconds = Math.max(0.12, Math.min(1.2, options.blendSeconds || MOTION_BLEND_SECONDS));
    action.reset();
    action.enabled = true;
    action.setEffectiveTimeScale(options.speed || 1);
    action.setLoop(options.loop ? LoopRepeat : LoopOnce, options.loop ? Infinity : 1);
    action.clampWhenFinished = !options.loop;
    action.time = Math.max(0, options.offsetMs || 0) / 1000;
    action.play();
    if (previousAction && previousAction !== action) {
      previousAction.enabled = true;
      previousAction.crossFadeTo(action, blendSeconds, true);
    } else {
      action.fadeIn(blendSeconds);
    }
    runtime.currentAction = action;
    runtime.currentClipId = options.clipId || url;
  }

  stopAnimation(actorId: string, clipId?: string): void {
    const runtime = this.actors.get(actorId);
    if (!runtime || (clipId && runtime.currentClipId !== clipId)) return;
    runtime.currentAction?.fadeOut(0.32);
    runtime.currentAction = null;
    runtime.currentClipId = null;
  }

  setCameraPreset(preset: CameraPresetId): void {
    this.setCameraCue({ preset, transitionMs: 0 });
  }

  setCameraAuthority(authority: CameraAuthority): void {
    this.cameraAuthority = authority;
    this.cameraControls.enabled = authority === "operator";
    this.renderer.domElement.dataset.cameraAuthority = authority;
    if (authority === "operator") {
      this.cameraMotion = null;
      this.camera.rotation.z = 0;
      this.cameraControls.target.copy(this.cameraLookAt);
      this.cameraControls.update();
    }
  }

  getCameraAuthority(): CameraAuthority {
    return this.cameraAuthority;
  }

  getCameraPosition(): { x: number; y: number; z: number } {
    return { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z };
  }

  setCameraCue(cue: CinematicCameraCue, offsetMs = 0): void {
    if (this.cameraAuthority === "operator") return;
    const bodyPositions: Record<CameraPresetId, [number, number, number]> = {
      wide: [0, 1.45, 7.2],
      "two-shot": [0, 1.45, 5.7],
      portrait: [0, 1.55, 3.6],
      orbit: [3.8, 1.8, 5.4],
      profile: [3.2, 1.5, 3.7],
      "low-angle": [1.1, 0.72, 4.5],
      overhead: [0.2, 5.8, 3.8],
      dutch: [-2.8, 1.9, 4.4],
    };
    const actor = cue.targetActorId ? this.actors.get(cue.targetActorId) : undefined;
    const headPositions: Record<CameraPresetId, [number, number, number]> = {
      wide: [0, 1.55, 5.25],
      "two-shot": [0, 1.55, 4.5],
      portrait: [0.18, 1.25, 2.85],
      orbit: [2.55, 1.48, 3.55],
      profile: [2.45, 1.32, 3.55],
      "low-angle": [0.72, 1.02, 3.2],
      overhead: [0.15, 3.6, 3.1],
      dutch: [-1.85, 1.72, 3.1],
    };
    const positions = actor?.definition.asset.kind === "head" ? headPositions : bodyPositions;
    const target = actor
      ? actor.root.position.clone().add(new Vector3(
        0,
        (actor.definition.asset.kind === "head" ? HEAD_CENTER_Y : 1.35) * actor.definition.scale,
        0,
      ))
      : new Vector3(0, 1.25, 0);
    target.y = Math.max(CAMERA_TARGET_FLOOR_Y, target.y);
    const destination = new Vector3().fromArray(positions[cue.preset] || positions["two-shot"]);
    destination.x += target.x;
    destination.y += target.y - (actor?.definition.asset.kind === "head" ? HEAD_CENTER_Y : 1.25);
    const amount = Number(cue.amount) || 0;
    if (cue.movement === "dolly") destination.z += amount;
    if (cue.movement === "pan") destination.x += amount / 18;
    if (cue.movement === "tilt") destination.y += amount / 24;
    if (cue.movement === "orbit" || cue.movement === "sweep") {
      const angle = amount * Math.PI / 180;
      const relativeX = destination.x - target.x;
      const relativeZ = destination.z - target.z;
      destination.x = target.x + relativeX * Math.cos(angle) - relativeZ * Math.sin(angle);
      destination.z = target.z + relativeX * Math.sin(angle) + relativeZ * Math.cos(angle);
    }
    if (cue.lensMm) {
      this.camera.fov = Math.max(22, Math.min(58, 2 * Math.atan(18 / cue.lensMm) * 180 / Math.PI));
      this.camera.updateProjectionMatrix();
    }
    destination.y = Math.max(CAMERA_FLOOR_Y, destination.y);
    const durationMs = Math.max(0, Number(cue.transitionMs) || 0);
    this.cameraMotion = {
      startedAt: performance.now() - Math.max(0, offsetMs),
      durationMs,
      from: this.camera.position.clone(),
      to: destination,
      lookFrom: this.cameraLookAt.clone(),
      lookTo: target,
      movement: cue.movement || "cut",
      amount,
      handheld: Math.max(0, Math.min(0.35, Number(cue.handheld) || 0)),
      roll: cue.preset === "dutch" ? -0.075 : 0,
    };
    if (durationMs === 0) {
      this.camera.position.copy(destination);
      this.cameraLookAt.copy(target);
      this.camera.lookAt(target);
      this.camera.rotation.z = this.cameraMotion.roll;
    }
  }

  setPlanningShot(stage: "performance" | "stage" | "camera" | "postfx", actorId?: string, variation = 0): void {
    const cueSets: Record<typeof stage, CinematicCameraCue[]> = {
      performance: [
        { preset: "profile", movement: "orbit", amount: -12, transitionMs: 2_400, lensMm: 65 },
        { preset: "portrait", movement: "dolly", amount: -0.3, transitionMs: 2_200, lensMm: 85 },
        { preset: "two-shot", movement: "sweep", amount: 10, transitionMs: 2_600, lensMm: 50 },
      ],
      stage: [
        { preset: "wide", movement: "sweep", amount: 18, transitionMs: 2_800, lensMm: 35 },
        { preset: "low-angle", movement: "dolly", amount: 0.2, transitionMs: 2_600, lensMm: 40 },
        { preset: "overhead", movement: "orbit", amount: -8, transitionMs: 2_900, lensMm: 35 },
      ],
      camera: [
        { preset: "portrait", movement: "dolly", amount: -0.45, transitionMs: 2_200, lensMm: 85 },
        { preset: "profile", movement: "pan", amount: -8, transitionMs: 2_300, lensMm: 65 },
        { preset: "orbit", movement: "orbit", amount: 18, transitionMs: 2_700, lensMm: 50 },
      ],
      postfx: [
        { preset: "dutch", movement: "orbit", amount: 10, transitionMs: 2_600, lensMm: 50 },
        { preset: "low-angle", movement: "dolly", amount: -0.25, transitionMs: 2_500, lensMm: 55 },
        { preset: "wide", movement: "sweep", amount: -16, transitionMs: 2_900, lensMm: 35 },
      ],
    };
    const choices = cueSets[stage];
    this.setCameraCue({ ...choices[Math.abs(variation) % choices.length], targetActorId: actorId });
  }

  private updateCamera(now: number): void {
    const motion = this.cameraMotion;
    if (!motion) return;
    const linear = motion.durationMs > 0 ? Math.min(1, Math.max(0, (now - motion.startedAt) / motion.durationMs)) : 1;
    const eased = linear * linear * (3 - 2 * linear);
    this.camera.position.lerpVectors(motion.from, motion.to, eased);
    this.cameraLookAt.lerpVectors(motion.lookFrom, motion.lookTo, eased);
    if (motion.handheld > 0) {
      this.camera.position.x += Math.sin(now * 0.007) * motion.handheld * 0.025;
      this.camera.position.y += Math.cos(now * 0.011) * motion.handheld * 0.018;
    }
    this.camera.lookAt(this.cameraLookAt);
    this.camera.rotation.z = motion.roll;
  }

  private constrainCameraToStage(): void {
    const cameraWasBelowFloor = this.camera.position.y < CAMERA_FLOOR_Y;
    this.camera.position.y = Math.max(CAMERA_FLOOR_Y, this.camera.position.y);
    if (this.cameraAuthority === "operator") {
      this.cameraControls.target.y = Math.max(CAMERA_TARGET_FLOOR_Y, this.cameraControls.target.y);
      this.cameraLookAt.copy(this.cameraControls.target);
      if (cameraWasBelowFloor) this.camera.lookAt(this.cameraControls.target);
    } else {
      this.cameraLookAt.y = Math.max(CAMERA_TARGET_FLOOR_Y, this.cameraLookAt.y);
      if (cameraWasBelowFloor) {
        this.camera.lookAt(this.cameraLookAt);
        this.camera.rotation.z = this.cameraMotion?.roll || 0;
      }
    }
  }

  setLightingPreset(preset: LightingPresetId): void {
    const values: Record<LightingPresetId, {
      key: [number, number]; fill: [number, number]; rim: [number, number]
    }> = {
      studio: { key: [0xfff8ef, 1.35], fill: [0x90a4ff, 0.45], rim: [0xffe4cc, 1.8] },
      concert: { key: [0xff3cac, 4.4], fill: [0x2b86c5, 2.8], rim: [0x5ffbf1, 28] },
      noir: { key: [0xffffff, 4.8], fill: [0x334155, 0.25], rim: [0xffffff, 8] },
      sunset: { key: [0xffb36b, 3.8], fill: [0x7c3aed, 1.2], rim: [0xff6b35, 22] },
      chiaroscuro: { key: [0xfff2df, 5.4], fill: [0x111827, 0.08], rim: [0xc7d2fe, 12] },
      silhouette: { key: [0x334155, 0.18], fill: [0x0f172a, 0.06], rim: [0xffffff, 34] },
    };
    const value = values[preset];
    this.keyLight.color.setHex(value.key[0]);
    this.lightingBase.key = value.key[1];
    this.fillLight.color.setHex(value.fill[0]);
    this.lightingBase.fill = value.fill[1];
    this.rimLight.color.setHex(value.rim[0]);
    this.lightingBase.rim = value.rim[1];
  }

  setLightingCue(cue: { preset: LightingPresetId; pulseOnBeat?: boolean; energy?: number }): void {
    this.setLightingPreset(cue.preset);
    this.lightingBase.pulseOnBeat = cue.pulseOnBeat === true;
    this.musicEnergy = Math.max(this.musicEnergy, Math.max(0, Math.min(1, Number(cue.energy) || 0)) * 0.25);
  }

  async setStageEffects(cue: StageEffectCue): Promise<void> {
    await this.stageEffects.setCue(cue);
  }

  resetStageEffects(): void {
    this.stageEffects.reset();
  }

  setMusicEnergy(value: number): void {
    this.musicEnergy = Math.max(0, Math.min(1, value));
  }

  setExpression(actorId: string, values: Record<string, number>): void {
    const runtime = this.actors.get(actorId);
    if (!runtime) return;
    for (const [name, value] of Object.entries(values)) {
      runtime.expressionTargets.set(name, Math.max(0, Math.min(1, value)));
    }
  }

  resetExpression(actorId: string): void {
    const runtime = this.actors.get(actorId);
    runtime?.expressionTargets.clear();
  }

  setHeadPose(actorId: string, pose: { pitch?: number; yaw?: number; roll?: number }): void {
    const runtime = this.actors.get(actorId);
    if (!runtime || runtime.definition.asset.kind !== "head") return;
    if (pose.pitch !== undefined) runtime.headPoseTarget.pitch = Math.max(-0.32, Math.min(0.32, pose.pitch));
    if (pose.yaw !== undefined) runtime.headPoseTarget.yaw = Math.max(-0.55, Math.min(0.55, pose.yaw));
    if (pose.roll !== undefined) runtime.headPoseTarget.roll = Math.max(-0.28, Math.min(0.28, pose.roll));
  }

  resetHeadPose(actorId: string): void {
    const runtime = this.actors.get(actorId);
    if (!runtime) return;
    runtime.headPoseTarget = { pitch: 0, yaw: 0, roll: 0 };
  }

  setLipSync(actorId: string, amount: number): void {
    const open = Math.max(0, Math.min(0.82, amount));
    this.setExpression(actorId, {
      jawOpen: open,
      mouthOpen: open,
      viseme_aa: open,
      mouthFunnel: open * 0.16,
    });
  }

  resetLipSync(actorId: string): void {
    this.setExpression(actorId, { jawOpen: 0, mouthOpen: 0, viseme_aa: 0, mouthFunnel: 0 });
  }

  getStats(): RoomStats {
    return {
      renderer: this.rendererLabel,
      actors: this.actors.size,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      frameCount: this.frameCount,
      averageFps: this.averageFps
    };
  }

  getActorCapabilities(actorId: string): ActorRuntimeCapabilities | null {
    return this.actors.get(actorId)?.capabilities || null;
  }

  private disposeObject(root: Object3D, additionalMaterials: Material[] = []): void {
    const materials = new Set<Material>(additionalMaterials);
    const geometries = new Set<NonNullable<Mesh["geometry"]>>();
    root.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      if (mesh.geometry) geometries.add(mesh.geometry);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        materials.add(material);
      }
    });
    const textures = new Set<Texture>();
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof Texture) textures.add(value);
      }
    }
    for (const geometry of geometries) geometry.dispose();
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    for (const actorId of [...this.actors.keys()]) this.removeActor(actorId);
    this.disposeObject(this.roomRoot);
    this.currentRoom = null;
    this.environmentTexture?.dispose();
    this.environmentTexture = null;
    this.environmentTextureUrl = null;
    this.environmentFailures.clear();
    this.stageEffects.dispose();
    this.cameraControls.dispose();
    this.renderer.dispose();
  }
}
