import {
  ACESFilmicToneMapping,
  AmbientLight,
  AnimationClip,
  AnimationMixer,
  Box3,
  BoxGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  EquirectangularReflectionMapping,
  FrontSide,
  GridHelper,
  Group,
  LoopOnce,
  LoopRepeat,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3
} from "three";
import { MeshStandardNodeMaterial, WebGPURenderer } from "three/webgpu";
import { color, mix, normalWorld, positionWorld, sin, time } from "three/tsl";
import { GLTFLoader } from "three-stdlib";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import type {
  ActorRuntimeCapabilities,
  CameraPresetId,
  LightingPresetId,
  PerformanceActor,
  PerformanceEnvironment,
  ShaderPresetId
} from "./types";
import { StageEffectsController, type StageEffectCue } from "./stage-effects";

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
  model: Object3D;
  mixer: AnimationMixer | null;
  currentAction: ReturnType<AnimationMixer["clipAction"]> | null;
  originalMaterials: Map<Mesh, Material | Material[]>;
  capabilities: ActorRuntimeCapabilities;
  animationTargets: Set<string>;
  animationClips: Map<string, AnimationClip>;
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

const createNodeMaterial = (preset: Exclude<ShaderPresetId, "original">): MeshStandardNodeMaterial => {
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

const roomColors = (room: PerformanceEnvironment["room"]) => {
  switch (room) {
    case "black-box": return { background: 0x030303, floor: 0x09090b, wall: 0x111113, accent: 0x71717a };
    case "broadcast": return { background: 0x121416, floor: 0x202326, wall: 0x292d31, accent: 0x60a5fa };
    case "neon-grid": return { background: 0x070613, floor: 0x101026, wall: 0x17132e, accent: 0xc026d3 };
    default: return { background: 0x17191b, floor: 0x34383c, wall: 0x4a4f54, accent: 0xf5f5f4 };
  }
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
  private animationCache = new Map<string, AnimationClip>();
  private roomRoot = new Group();
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
  private stageEffects: StageEffectsController;
  private cameraMotion: CameraMotion | null = null;
  private cameraLookAt = new Vector3(0, 1.25, 0);
  private musicEnergy = 0;
  private lightingBase = { key: 3.2, fill: 1.4, rim: 18, pulseOnBeat: false };

  private constructor(private container: HTMLElement, renderer: WebGPURenderer, label: string) {
    this.renderer = renderer;
    this.rendererLabel = label;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.replaceChildren(this.renderer.domElement as HTMLCanvasElement);
    this.renderer.domElement.classList.add("performance-canvas");

    this.camera.position.set(0, 1.45, 5.8);
    this.camera.lookAt(0, 1.25, 0);
    this.scene.add(this.roomRoot);
    this.scene.add(new AmbientLight(0xffffff, 0.42), this.keyLight, this.fillLight, this.rimLight);
    this.keyLight.position.set(3.6, 5.2, 4.2);
    this.fillLight.position.set(-4, 2.5, 3);
    this.rimLight.position.set(0, 3.5, -2.5);
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
        runtime.root.rotation.y = runtime.definition.rotationY + Math.sin(now / 3600 + runtime.root.position.x) * 0.025;
      }
    }
    this.updateCamera(now);
    const pulse = this.lightingBase.pulseOnBeat ? 1 + this.musicEnergy * 0.38 : 1;
    this.keyLight.intensity = this.lightingBase.key * pulse;
    this.fillLight.intensity = this.lightingBase.fill * (1 + this.musicEnergy * 0.16);
    this.rimLight.intensity = this.lightingBase.rim * (1 + this.musicEnergy * 0.5);
    this.stageEffects.setMusicEnergy(this.musicEnergy);
    this.stageEffects.update(deltaMs);
    this.frameHandler?.(deltaMs);
    this.renderer.render(this.scene, this.camera);
  }

  private applyRoomGeometry(room: PerformanceEnvironment["room"]): void {
    this.disposeObject(this.roomRoot);
    this.roomRoot.clear();
    const colors = roomColors(room);
    this.scene.background = new Color(colors.background);

    const floorMaterial = new MeshStandardMaterial({ color: colors.floor, roughness: 0.58, metalness: 0.12 });
    const wallMaterial = new MeshStandardMaterial({ color: colors.wall, roughness: 0.72, metalness: 0.02 });
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
    this.environmentTexture?.dispose();
    this.environmentTexture = null;
    this.scene.environment = null;
    this.applyRoomGeometry(environment.room);
    this.renderer.toneMappingExposure = environment.exposure;
    this.scene.environmentIntensity = environment.environmentIntensity;
    this.scene.backgroundIntensity = environment.backgroundIntensity;
    if (!environment.hdriUrl) {
      this.scene.environment = null;
      return;
    }
    try {
      const texture = await new HDRLoader().loadAsync(environment.hdriUrl);
      if (token !== this.environmentToken) {
        texture.dispose();
        return;
      }
      texture.mapping = EquirectangularReflectionMapping;
      this.environmentTexture = texture;
      this.scene.environment = texture;
      this.scene.background = texture;
    } catch (error) {
      if (token === this.environmentToken) this.scene.environment = null;
      throw new Error(`Environment ${environment.label} failed: ${String(error)}`);
    }
  }

  async loadActor(definition: PerformanceActor): Promise<ActorRuntimeCapabilities> {
    this.removeActor(definition.id);
    const gltf = await new GLTFLoader().loadAsync(definition.asset.url);
    if (definition.asset.kind === "head") normalizeHeadAssembly(gltf.scene);

    const root = new Group();
    const model = gltf.scene;
    root.add(model);
    this.scene.add(root);

    const box = new Box3().setFromObject(model);
    const size = box.getSize(new Vector3());
    const targetHeight = definition.asset.kind === "head" ? 1.7 : 2.45;
    const scale = size.y > 0 ? targetHeight / size.y : 1;
    model.scale.setScalar(scale);
    model.updateMatrixWorld(true);
    const scaledBox = new Box3().setFromObject(model);
    const center = scaledBox.getCenter(new Vector3());
    if (definition.asset.kind === "head") {
      model.position.set(-center.x, 1.25 - center.y, -center.z);
    } else {
      model.position.set(-center.x, -scaledBox.min.y, -center.z);
    }
    root.position.set(definition.position.x, definition.position.y, definition.position.z);
    root.rotation.y = definition.rotationY;
    root.scale.setScalar(definition.scale);
    root.visible = definition.visible;

    let skeletons = 0;
    let morphTargets = 0;
    const animationTargets = new Set<string>();
    const originalMaterials = new Map<Mesh, Material | Material[]>();
    model.traverse((object) => {
      if (object.name) animationTargets.add(object.name);
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      if ((mesh as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) skeletons += 1;
      morphTargets += mesh.morphTargetInfluences?.length || 0;
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
      animationCompatible: skeletons > 0
    };
    const runtime: ActorRuntime = {
      definition,
      root,
      model,
      mixer: skeletons > 0 ? new AnimationMixer(model) : null,
      currentAction: null,
      originalMaterials,
      capabilities,
      animationTargets,
      animationClips: new Map()
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
    runtime.root.rotation.y = definition.rotationY;
    runtime.root.scale.setScalar(definition.scale);
    runtime.root.visible = definition.visible;
  }

  removeActor(actorId: string): void {
    const runtime = this.actors.get(actorId);
    if (!runtime) return;
    runtime.currentAction?.stop();
    runtime.mixer?.stopAllAction();
    runtime.mixer?.uncacheRoot(runtime.model);
    this.scene.remove(runtime.root);
    this.disposeObject(runtime.root);
    for (const material of runtime.originalMaterials.values()) {
      for (const item of Array.isArray(material) ? material : [material]) this.disposeMaterial(item);
    }
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
    options: { loop?: boolean; speed?: number; offsetMs?: number } = {},
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
    runtime.currentAction?.fadeOut(0.18);
    let actorClip = runtime.animationClips.get(url);
    if (!actorClip) {
      actorClip = createInPlaceClip(clip, runtime.animationTargets);
      runtime.animationClips.set(url, actorClip);
    }
    const action = runtime.mixer.clipAction(actorClip);
    action.reset();
    action.enabled = true;
    action.setEffectiveTimeScale(options.speed || 1);
    action.setLoop(options.loop ? LoopRepeat : LoopOnce, options.loop ? Infinity : 1);
    action.clampWhenFinished = !options.loop;
    action.time = Math.max(0, options.offsetMs || 0) / 1000;
    action.fadeIn(0.18).play();
    runtime.currentAction = action;
  }

  stopAnimation(actorId: string): void {
    const runtime = this.actors.get(actorId);
    runtime?.currentAction?.fadeOut(0.16);
    if (runtime) runtime.currentAction = null;
  }

  setCameraPreset(preset: CameraPresetId): void {
    this.setCameraCue({ preset, transitionMs: 0 });
  }

  setCameraCue(cue: CinematicCameraCue, offsetMs = 0): void {
    const positions: Record<CameraPresetId, [number, number, number]> = {
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
    const target = actor
      ? actor.root.position.clone().add(new Vector3(0, actor.definition.asset.kind === "head" ? 1.25 : 1.35, 0))
      : new Vector3(0, 1.25, 0);
    const destination = new Vector3().fromArray(positions[cue.preset] || positions["two-shot"]);
    destination.x += target.x;
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

  setLightingPreset(preset: LightingPresetId): void {
    const values: Record<LightingPresetId, {
      key: [number, number]; fill: [number, number]; rim: [number, number]
    }> = {
      studio: { key: [0xffffff, 3.2], fill: [0x9cc8ff, 1.4], rim: [0xffc48a, 18] },
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
    runtime?.model.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh || !mesh.morphTargetDictionary || !mesh.morphTargetInfluences) return;
      for (const [name, value] of Object.entries(values)) {
        const index = mesh.morphTargetDictionary[name];
        if (index !== undefined) mesh.morphTargetInfluences[index] = Math.max(0, Math.min(1, value));
      }
    });
  }

  resetExpression(actorId: string): void {
    const runtime = this.actors.get(actorId);
    runtime?.model.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh || !mesh.morphTargetInfluences) return;
      mesh.morphTargetInfluences.fill(0);
    });
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

  private disposeObject(root: Object3D): void {
    const materials = new Set<Material>();
    root.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        materials.add(material);
      }
    });
    for (const material of materials) this.disposeMaterial(material);
  }

  private disposeMaterial(material: Material): void {
    for (const value of Object.values(material)) {
      if (value instanceof Texture) value.dispose();
    }
    material.dispose();
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    for (const actorId of [...this.actors.keys()]) this.removeActor(actorId);
    this.disposeObject(this.roomRoot);
    this.environmentTexture?.dispose();
    this.environmentTexture = null;
    this.stageEffects.dispose();
    this.renderer.dispose();
  }
}
