/**
 * Core-X Head bust-mode case (Avatar Labs).
 *
 * Implements canonical Core-X ChatAvatar rendering with:
 *   - Three.js WebGPU / WebGL2 rendering matching Core-X UI VoiceScene
 *   - Centered floating bust framing (0, 0, 0) with camera (0, 0.08, 1.8) and FOV 55
 *   - Canonical physical materials: pure diffuse + GGX roughness, SSS extinction, wet cornea
 *   - Expressive SpeechArticulationEngine: full ARKit lip articulation (pucker, funnel, stretch, upper up, lower down, roll, shrug)
 *   - Pre-Speech Emotion Analysis: parses prompt emotion tags ([Happy], [Surprised], [Angry], [Thinking], [Empathic], [Excited])
 *   - DynamicEmotionEngine: real-time emotional state transitions synchronized with speech progress
 *   - Real-Time Talk Mode: live microphone streaming directly into HeadAudio neural viseme worklet
 */

import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  FrontSide,
  Group,
  Mesh,
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
import { WebGPURenderer } from "three/webgpu";
import { GLTFLoader } from "three-stdlib";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { PMREMGenerator } from "three";
import {
  createArchitecturalPlinth,
  applyStudioMaterialRealism,
  calibrateChatAvatarEyes,
  centerAndFrameCoreXHead,
} from "./scene/studio-scene-template";
import { HeadAudio } from "@met4citizen/headaudio/dist/headaudio.min.mjs";
import headWorkletUrl from "@met4citizen/headaudio/dist/headworklet.min.mjs?url";
import headModelUrl from "@met4citizen/headaudio/dist/model-en-mixed.bin?url";
import { streamSpeech } from "./runtime/audio-stream";
import { SpeechArticulationEngine } from "./facial/phoneme-articulation";
import {
  DynamicEmotionEngine,
  analyzeSpeechPrompt,
  type EmotionState,
} from "./facial/emotion-analyzer";

const els = {
  stage: document.getElementById("stage") as HTMLElement,
  status: document.getElementById("status") as HTMLElement,
  log: document.getElementById("log") as HTMLElement,
  text: document.getElementById("text") as HTMLTextAreaElement,
  voice: document.getElementById("voice") as HTMLInputElement,
  headSelect: document.getElementById("head-select") as HTMLSelectElement,
  headUrl: document.getElementById("head-url") as HTMLInputElement,
  service: document.getElementById("service") as HTMLInputElement,
  plinthMode: document.getElementById("plinth-mode") as HTMLSelectElement,
  lipGain: document.getElementById("lip-gain") as HTMLInputElement,
  lipGainVal: document.getElementById("lip-gain-val") as HTMLElement,
  speakStream: document.getElementById("speak-stream") as HTMLButtonElement,
  speakBlob: document.getElementById("speak-blob") as HTMLButtonElement,
  btnLiveMic: document.getElementById("btn-live-mic") as HTMLButtonElement,
  stop: document.getElementById("stop") as HTMLButtonElement,
  micMeterBox: document.getElementById("mic-meter-box") as HTMLElement,
  micVuBar: document.getElementById("mic-vu-bar") as HTMLElement,
  micLatencyVal: document.getElementById("mic-latency-val") as HTMLElement,
  timelineContainer: document.getElementById("timeline-container") as HTMLElement,
  timelineTrack: document.getElementById("timeline-track") as HTMLElement,
  promptTagPills: document.getElementById("prompt-tag-pills") as HTMLElement,
  liveEmotionPills: document.getElementById("live-emotion-pills") as HTMLElement,
  mEmotion: document.getElementById("m-emotion") as HTMLElement,
  mArticulation: document.getElementById("m-articulation") as HTMLElement,
  mTtfa: document.getElementById("m-ttfa") as HTMLElement,
  mTotal: document.getElementById("m-total") as HTMLElement,
  mAudio: document.getElementById("m-audio") as HTMLElement,
  mVisemes: document.getElementById("m-visemes") as HTMLElement,
  mQueue: document.getElementById("m-queue") as HTMLElement,
};

export interface HeadDefinition {
  id: string;
  label: string;
  url: string;
  hairUrl?: string;
  voice: string;
}

/**
 * Canonical Core-X head roster and voice assignments (avatar-config.ts contract).
 */
export const HEAD_ROSTER: Record<string, HeadDefinition> = {
  kbllr: {
    id: "kbllr",
    label: "KBLLR",
    url: "/corex-assets/avatars/heads/kbllr/kbllr.glb",
    hairUrl: "/corex-assets/avatars/heads/kbllr/kbllr-hair.glb",
    voice: "lullabot", // LOCKED
  },
  anja: {
    id: "anja",
    label: "Anja",
    url: "/corex-assets/avatars/heads/anja/anja.glb",
    hairUrl: "/corex-assets/avatars/heads/anja/anja-hair.glb",
    voice: "katanja",
  },
  "susi-q": {
    id: "susi-q",
    label: "Susi-Q",
    url: "/corex-assets/avatars/heads/susi-q/susi-q.glb",
    hairUrl: "/corex-assets/avatars/heads/susi-q/susi-q-hair.glb",
    voice: "katanja",
  },
  david: {
    id: "david",
    label: "David",
    url: "/corex-assets/avatars/heads/david/david.glb",
    voice: "davido",
  },
  eli: {
    id: "eli",
    label: "Eli",
    url: "/corex-assets/avatars/heads/eli/eli.glb",
    hairUrl: "/corex-assets/avatars/heads/eli/eli-hair.glb",
    voice: "eli_luma",
  },
  sofia: {
    id: "sofia",
    label: "Sofia",
    url: "/corex-assets/avatars/heads/sofia/sofia.glb",
    hairUrl: "/corex-assets/avatars/heads/sofia/sofia-hair.glb",
    voice: "sofi_v",
  },
  nyx: {
    id: "nyx",
    label: "Nyx",
    url: "/corex-assets/avatars/heads/nyx/nyx.glb",
    hairUrl: "/corex-assets/avatars/heads/nyx/nyx-hair.glb",
    voice: "vicky_spice",
  },
  vee: {
    id: "vee",
    label: "Vee",
    url: "/corex-assets/avatars/heads/vee/vee.glb",
    voice: "princess_leia",
  },
  nino: {
    id: "nino",
    label: "Nino",
    url: "/corex-assets/avatars/heads/nino/nino.glb",
    voice: "ninoo",
  },
};

export function resolveHeadDefinition(keyOrUrl: string): HeadDefinition {
  if (HEAD_ROSTER[keyOrUrl]) {
    return HEAD_ROSTER[keyOrUrl];
  }
  for (const def of Object.values(HEAD_ROSTER)) {
    if (def.url === keyOrUrl || def.id === keyOrUrl) return def;
  }
  const filename = keyOrUrl.split("/").pop()?.replace(/\.glb$/i, "") || "custom";
  return {
    id: filename,
    label: filename.charAt(0).toUpperCase() + filename.slice(1),
    url: keyOrUrl,
    voice: els.voice?.value || "lullabot",
  };
}

const result = {
  ready: false,
  renderer: "pending",
  visemeEvents: 0,
  lastTtfaMs: 0,
  morphMeshes: 0,
  activeEmotion: "neutral",
  errors: [] as string[],
};
(window as any).__corexHeadResult = result;

const setStatus = (text: string) => {
  els.status.textContent = text;
};
const log = (text: string) => {
  const ts = new Date().toISOString().slice(11, 23);
  els.log.textContent += `[${ts}] ${text}\n`;
  els.log.scrollTop = els.log.scrollHeight;
};

// ── Engines & State ────────────────────────────────────────────────────────
const articulationEngine = new SpeechArticulationEngine({ lipGain: 1.35, jawGain: 1.0 });
const emotionEngine = new DynamicEmotionEngine("neutral", 0.8);

let liveMicActive = false;
let micStream: MediaStream | null = null;
let micSourceNode: MediaStreamAudioSourceNode | null = null;
let micAnalyser: AnalyserNode | null = null;
let micVuAnimId: number | null = null;

// Normalizes ChatAvatar heads: eye scales, occlusion mesh hiding, frontside eyes
function normalizeChatAvatarHead(headScene: Object3D) {
  headScene.updateMatrixWorld(true);

  let faceMesh: Mesh | null = null;
  headScene.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!faceMesh && mesh.isMesh && (mesh.morphTargetInfluences?.length ?? 0) > 0) {
      faceMesh = mesh;
    }
  });
  const faceWorldScale = faceMesh
    ? (faceMesh as Mesh).getWorldScale(new Vector3()).x
    : 1;

  for (const name of ["eyeball_left", "eyeball_right"]) {
    const node = headScene.getObjectByName(name);
    if (!node) continue;
    const eyeWorldScale = node.getWorldScale(new Vector3()).x;
    const ratio = faceWorldScale / eyeWorldScale;
    if (ratio < 0.5 || ratio > 2) {
      node.scale.multiplyScalar(ratio);
      node.position.multiplyScalar(ratio);
    }
  }
  calibrateChatAvatarEyes(headScene);
  headScene.updateMatrixWorld(true);

  headScene.traverse((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      const name = (mat.name || "").toLowerCase();
      if (name.includes("occlusion")) mat.visible = false;
      if (name === "eyes") (mat as any).side = FrontSide;
    }
  });
}

interface Stage {
  renderer: WebGLRenderer | WebGPURenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  audioCtx: AudioContext;
  player: AudioWorkletNode;
  sink: GainNode;
  headaudio: HeadAudio;
  morphMeshes: Mesh[];
  headGroup: Group;
  plinthGroup: Group;
}

let stage: Stage | null = null;
let abort: AbortController | null = null;
let blobSource: AudioBufferSourceNode | null = null;
let playbackStartTime = 0;
let playbackDurationSec = 0;
let isAudioPlaying = false;

const visemeState: Record<string, number> = {};

// Periodic blink envelope
let nextBlinkAt = performance.now() + 2200;
function blinkLevel(): number {
  const now = performance.now();
  if (now > nextBlinkAt + 140) {
    nextBlinkAt = now + 2400 + Math.random() * 2600;
    return 0;
  }
  if (now >= nextBlinkAt) {
    const t = (now - nextBlinkAt) / 140;
    return Math.sin(Math.PI * t);
  }
  return 0;
}

/**
 * Applies layered facial kinematics:
 *  1. Base emotional blendshapes (DynamicEmotionEngine)
 *  2. Speech lip & jaw articulation (SpeechArticulationEngine)
 *  3. Natural blink cycle
 */
function applyFaceKinematics(meshes: Mesh[], dtMs: number) {
  // 1. Advance speech articulation
  articulationEngine.updateTargets(visemeState);
  const speechMorphs = articulationEngine.step(dtMs);

  // 2. Advance emotion layer
  const emotionMorphs = emotionEngine.step(dtMs);
  const currentEmotion = emotionEngine.getActiveEmotion();
  if (result.activeEmotion !== currentEmotion) {
    result.activeEmotion = currentEmotion;
    els.mEmotion.textContent = currentEmotion;
  }

  // 3. Composite into ARKit dictionary
  const blink = blinkLevel();

  for (const mesh of meshes) {
    const dict = mesh.morphTargetDictionary as Record<string, number> | undefined;
    const influences = mesh.morphTargetInfluences;
    if (!dict || !influences) continue;

    for (const [morph, index] of Object.entries(dict)) {
      let value = 0;

      // Base emotional component
      if (emotionMorphs[morph] !== undefined) {
        value += emotionMorphs[morph];
      }

      // Speech viseme component (jaw & lips)
      if (speechMorphs[morph] !== undefined) {
        // Speech overrides or layers on top of emotion
        if (morph.startsWith("jaw") || morph.startsWith("mouth")) {
          value = Math.max(value, speechMorphs[morph]);
        } else {
          value += speechMorphs[morph];
        }
      }

      // Blink
      if ((morph === "eyeBlinkLeft" || morph === "eyeBlinkRight") && blink > 0) {
        value = Math.max(value, blink);
      }

      influences[index] = Math.min(1.0, Math.max(0, value));
    }
  }
}

async function initStage(): Promise<Stage> {
  setStatus("Creating Core-X Three.js stage…");
  const forceWebGl = new URLSearchParams(window.location.search).get("renderer") === "webgl";
  let renderer: WebGLRenderer | WebGPURenderer;

  if ("gpu" in navigator && !forceWebGl) {
    try {
      const webgpu = new WebGPURenderer({ antialias: true, alpha: true });
      await webgpu.init();
      renderer = webgpu;
      result.renderer = "webgpu";
      log("renderer: WebGPU initialized");
    } catch (error) {
      log(`renderer: WebGPU unavailable (${String(error)}); using WebGL2`);
      renderer = new WebGLRenderer({ antialias: true, alpha: true });
      result.renderer = "webgl-fallback";
    }
  } else {
    renderer = new WebGLRenderer({ antialias: true, alpha: true });
    result.renderer = forceWebGl ? "webgl-forced" : "webgl-fallback";
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(els.stage.clientWidth, els.stage.clientHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  if ((renderer as unknown as { shadowMap?: { enabled: boolean; type: number } }).shadowMap) {
    const sm = (renderer as unknown as { shadowMap: { enabled: boolean; type: number } }).shadowMap;
    sm.enabled = true;
    sm.type = PCFSoftShadowMap;
  }
  els.stage.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x141516);
  const isWebGpu = result.renderer === "webgpu";
  if (!isWebGpu && renderer instanceof WebGLRenderer) {
    const pmrem = new PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  }

  // Canonical Core-X VoiceScene 3-point lighting
  const amb = new AmbientLight(0xffffff, 0.42);
  const key = new DirectionalLight(0xfff8ef, 1.15);
  key.position.set(1.1, 1.95, 2.6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0008;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 2;

  const fill = new DirectionalLight(0x90a4ff, 0.35);
  fill.position.set(-1.2, 1.6, -2.4);

  const rim = new PointLight(0xffe4cc, 0.85, 8);
  rim.position.set(0, 2.2, -2.2);

  scene.add(amb, key, fill, rim);

  // Soft shadow catcher floor placed at canonical y = -0.78
  const floorGeo = new PlaneGeometry(12, 12);
  const floorMat = new ShadowMaterial({ transparent: true, opacity: 0.32 });
  const floor = new Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.78;
  floor.receiveShadow = true;
  scene.add(floor);

  // Architectural plinth (hidden by default in canonical floating mode)
  const plinthGroup = createArchitecturalPlinth(-0.52);
  plinthGroup.visible = els.plinthMode.value === "plinth";
  scene.add(plinthGroup);

  // Canonical VoiceScene portrait camera: FOV 55, pos (0, 0.08, 1.8) looking at (0, 0, 0)
  const camera = new PerspectiveCamera(55, els.stage.clientWidth / els.stage.clientHeight, 0.01, 50);
  camera.position.set(0, 0.08, 1.8);
  camera.lookAt(0, 0, 0);
  (window as any).__camera = camera;

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 0.6;
  controls.maxDistance = 4.0;
  controls.target.set(0, 0, 0);
  controls.update();

  const headGroup = new Group();
  headGroup.name = "corex-performer-head-root";
  scene.add(headGroup);

  // Load initial GLTF head
  const initialHeadKey = els.headSelect.value || "kbllr";
  const initialHeadDef = resolveHeadDefinition(initialHeadKey);
  els.voice.value = initialHeadDef.voice;
  els.headUrl.value = initialHeadDef.url;
  setStatus(`Loading head GLB… (${initialHeadDef.label})`);
  const morphMeshes = await loadHeadModel(initialHeadDef, headGroup, isWebGpu, camera, controls);

  setStatus("Wiring audio worklets…");
  const audioCtx = new AudioContext();
  await audioCtx.audioWorklet.addModule(headWorkletUrl);
  await audioCtx.audioWorklet.addModule("/worklets/pcm-player.js");

  const sink = audioCtx.createGain();
  sink.gain.value = 1;
  sink.connect(audioCtx.destination);

  const player = new AudioWorkletNode(audioCtx, "pcm-player", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  player.connect(sink);
  player.port.onmessage = (event: MessageEvent) => {
    const data = event.data || {};
    if (data.type === "state") {
      els.mQueue.textContent = `${(data.queuedSamples / audioCtx.sampleRate).toFixed(1)}s`;
    }
  };

  const headaudio = new HeadAudio(audioCtx);
  await headaudio.loadModel(headModelUrl);
  sink.connect(headaudio);

  headaudio.onvalue = (key: string, value: number) => {
    result.visemeEvents += 1;
    els.mVisemes.textContent = String(result.visemeEvents);
    visemeState[key] = value;
  };

  // Render loop
  let lastTime = performance.now();
  let lastPumpAt = performance.now();

  const tick = (now: number) => {
    const dt = now - lastTime;
    lastTime = now;

    headaudio.update(now - lastPumpAt);
    lastPumpAt = now;

    // Advance emotion progress if speech is playing
    if (isAudioPlaying && playbackDurationSec > 0) {
      const elapsed = (performance.now() - playbackStartTime) / 1000;
      const progress = Math.min(1.0, elapsed / playbackDurationSec);
      emotionEngine.updateProgress(progress);
    }

    // Subtle breathing / idle sway
    headGroup.rotation.y = Math.sin(now / 4200) * 0.025;
    headGroup.rotation.x = Math.sin(now / 5600) * 0.012;

    const currentMeshes = stage ? stage.morphMeshes : morphMeshes;
    applyFaceKinematics(currentMeshes, dt);
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  window.addEventListener("resize", () => {
    renderer.setSize(els.stage.clientWidth, els.stage.clientHeight);
    camera.aspect = els.stage.clientWidth / els.stage.clientHeight;
    camera.updateProjectionMatrix();
  });

  result.ready = true;
  setStatus(`Ready / ${result.renderer}`);
  log(`Core-X Head ready — ${result.renderer}, ${audioCtx.sampleRate} Hz`);

  const stageObj: Stage = {
    renderer,
    scene,
    camera,
    controls,
    audioCtx,
    player,
    sink,
    headaudio,
    morphMeshes,
    headGroup,
    plinthGroup,
  };
  stage = stageObj;
  (window as any).__corexHeadStage = stageObj;
  return stageObj;
}

/**
 * Loads and frames a head GLTF model and optional companion hair into headGroup.
 */
async function loadHeadModel(
  headDefOrUrl: HeadDefinition | string,
  headGroup: Group,
  isWebGpu: boolean,
  camera: PerspectiveCamera,
  controls: OrbitControls
): Promise<Mesh[]> {
  const headDef = typeof headDefOrUrl === "string" ? resolveHeadDefinition(headDefOrUrl) : headDefOrUrl;
  headGroup.clear();

  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(headDef.url);
  (window as any).__headScene = gltf.scene;

  normalizeChatAvatarHead(gltf.scene);
  applyStudioMaterialRealism(gltf.scene, isWebGpu);

  headGroup.add(gltf.scene);

  // Load companion hair if available
  if (headDef.hairUrl) {
    try {
      const hairGltf = await loader.loadAsync(headDef.hairUrl);
      hairGltf.scene.userData.corexHairFor = headDef.id;
      applyStudioMaterialRealism(hairGltf.scene, isWebGpu);
      gltf.scene.add(hairGltf.scene);
      log(`Companion hair attached: ${headDef.hairUrl.split("/").pop()}`);
    } catch (hairErr) {
      log(`Companion hair note for ${headDef.label}: ${String(hairErr)}`);
    }
  }

  // Canonical VoiceScene centering
  centerAndFrameCoreXHead(headGroup, camera, controls);

  const morphMeshes: Mesh[] = [];
  headGroup.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.isMesh && mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
      morphMeshes.push(mesh);
    }
  });

  result.morphMeshes = morphMeshes.length;
  if (morphMeshes.length === 0) {
    log(`WARNING: no morph targets found in ${headDef.url}`);
  } else {
    const count = Object.keys(morphMeshes[0].morphTargetDictionary || {}).length;
    log(`Loaded head: ${headDef.label} (${morphMeshes.length} morph mesh, ${count} ARKit shapes, voice: "${headDef.voice}")`);
  }

  return morphMeshes;
}

// ── Real-Time Live Mic Mode ────────────────────────────────────────────────
async function toggleLiveMic() {
  if (!stage) return;
  stopPlayback();

  if (liveMicActive) {
    // Stop live mic
    liveMicActive = false;
    els.btnLiveMic.classList.remove("is-recording");
    els.btnLiveMic.textContent = "🎤 Live Mic";
    els.micMeterBox.style.display = "none";
    if (micVuAnimId) cancelAnimationFrame(micVuAnimId);

    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
    if (micSourceNode) {
      micSourceNode.disconnect();
      micSourceNode = null;
    }
    setStatus("Live mic stopped.");
    log("Live mic disabled");
    return;
  }

  try {
    setStatus("Requesting microphone…");
    await stage.audioCtx.resume();

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    micSourceNode = stage.audioCtx.createMediaStreamSource(micStream);

    // VU meter analyser
    micAnalyser = stage.audioCtx.createAnalyser();
    micAnalyser.fftSize = 256;
    micSourceNode.connect(micAnalyser);

    // Tap mic directly into HeadAudio worklet!
    micSourceNode.connect(stage.headaudio);

    liveMicActive = true;
    els.btnLiveMic.classList.add("is-recording");
    els.btnLiveMic.textContent = "🔴 Mic Active";
    els.micMeterBox.style.display = "block";
    setStatus("Live Mic Active — speak into your microphone!");
    log("Real-time Live Mic connected to HeadAudio neural worklet (< 15ms latency)");

    // Update VU meter loop
    const dataArray = new Uint8Array(micAnalyser.frequencyBinCount);
    const updateVu = () => {
      if (!liveMicActive || !micAnalyser) return;
      micAnalyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      const avg = sum / dataArray.length;
      const pct = Math.min(100, Math.round((avg / 128) * 100));
      els.micVuBar.style.width = `${pct}%`;
      micVuAnimId = requestAnimationFrame(updateVu);
    };
    updateVu();
  } catch (err) {
    liveMicActive = false;
    els.btnLiveMic.classList.remove("is-recording");
    els.btnLiveMic.textContent = "🎤 Live Mic";
    setStatus(`Mic error: ${String(err)}`);
    log(`ERROR opening mic: ${String(err)}`);
  }
}

// ── Pre-Speech Emotion Analysis & Timeline Display ─────────────────────────
function renderEmotionTimeline(analysis: ReturnType<typeof analyzeSpeechPrompt>) {
  if (analysis.timeline.length <= 1) {
    els.timelineContainer.style.display = "none";
    return;
  }

  els.timelineContainer.style.display = "block";
  els.timelineTrack.innerHTML = "";

  const total = analysis.timeline.length;
  for (let i = 0; i < total; i++) {
    const kf = analysis.timeline[i];
    const nextRatio = i < total - 1 ? analysis.timeline[i + 1].timeRatio : 1.0;
    const widthPct = Math.max(8, Math.round((nextRatio - kf.timeRatio) * 100));

    const seg = document.createElement("div");
    seg.className = `timeline-segment timeline-segment--${kf.emotion}`;
    seg.style.width = `${widthPct}%`;
    seg.title = `${kf.label}: "${kf.textSnippet}"`;
    seg.textContent = kf.emotion.slice(0, 4);
    els.timelineTrack.appendChild(seg);
  }
}

const stopPlayback = () => {
  abort?.abort();
  abort = null;
  isAudioPlaying = false;
  if (stage) stage.player.port.postMessage({ type: "clear" });
  if (blobSource) {
    try {
      blobSource.stop();
    } catch {
      /* already stopped */
    }
    blobSource = null;
  }
  for (const key of Object.keys(visemeState)) visemeState[key] = 0;
  articulationEngine.reset();
  emotionEngine.reset();
};

const setBusy = (busy: boolean) => {
  els.speakStream.disabled = busy;
  els.speakBlob.disabled = busy;
};

const resetMetrics = () => {
  els.mTtfa.textContent = "…";
  els.mTotal.textContent = "…";
  els.mAudio.textContent = "…";
};

// ── Streaming Speech (Text -> Analyze Emotion -> TTS -> Worklet) ───────────
async function speakStreaming() {
  if (!stage) return;
  if (liveMicActive) await toggleLiveMic();
  stopPlayback();
  setBusy(true);
  resetMetrics();

  // 1. Analyze prompt emotions before speech
  const promptAnalysis = analyzeSpeechPrompt(els.text.value);
  log(`Pre-speech emotion analysis: dominant=[${promptAnalysis.dominantEmotion}], keyframes=${promptAnalysis.timeline.length}`);
  renderEmotionTimeline(promptAnalysis);
  emotionEngine.loadTimeline(promptAnalysis.timeline);

  try {
    await stage.audioCtx.resume();
    abort = new AbortController();

    const stream = await streamSpeech({
      baseUrl: els.service.value,
      input: promptAnalysis.cleanText,
      voice: els.voice.value,
      destinationSampleRate: stage.audioCtx.sampleRate,
      signal: abort.signal,
      onFirstChunk: (firstAudioAt) => {
        result.lastTtfaMs = firstAudioAt;
        els.mTtfa.textContent = `${(firstAudioAt / 1000).toFixed(2)}s`;
        log(`streaming: first audio after ${(firstAudioAt / 1000).toFixed(2)}s`);
        playbackStartTime = performance.now();
        isAudioPlaying = true;
      },
      onChunk: (samples) => {
        stage!.player.port.postMessage({ type: "chunk", samples }, [samples.buffer]);
      },
    });

    playbackDurationSec = stream.sourceSamples / stream.sourceSampleRate;
    els.mTotal.textContent = `${(stream.totalMs / 1000).toFixed(2)}s`;
    els.mAudio.textContent = `${playbackDurationSec.toFixed(2)}s`;
    log(`streaming: done — ${(stream.totalMs / 1000).toFixed(2)}s request for ${playbackDurationSec.toFixed(2)}s audio`);
  } catch (error) {
    if ((error as Error)?.name !== "AbortError") {
      result.errors.push(String(error));
      log(`ERROR ${String(error)}`);
      setStatus(`Error: ${String(error)}`);
    }
  } finally {
    setBusy(false);
  }
}

// ── Full WAV Blob Speech ───────────────────────────────────────────────────
async function speakBlob() {
  if (!stage) return;
  if (liveMicActive) await toggleLiveMic();
  stopPlayback();
  setBusy(true);
  resetMetrics();

  const promptAnalysis = analyzeSpeechPrompt(els.text.value);
  log(`Pre-speech emotion analysis: dominant=[${promptAnalysis.dominantEmotion}], keyframes=${promptAnalysis.timeline.length}`);
  renderEmotionTimeline(promptAnalysis);
  emotionEngine.loadTimeline(promptAnalysis.timeline);

  try {
    await stage.audioCtx.resume();
    abort = new AbortController();
    const t0 = performance.now();

    const response = await fetch(`${els.service.value}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: promptAnalysis.cleanText,
        voice: els.voice.value,
        model: "qwen",
      }),
      signal: abort.signal,
    });
    if (!response.ok) throw new Error(`blob request failed (HTTP ${response.status})`);

    const bytes = await response.arrayBuffer();
    const buffer = await stage.audioCtx.decodeAudioData(bytes);
    const ttfa = performance.now() - t0;

    result.lastTtfaMs = ttfa;
    els.mTtfa.textContent = `${(ttfa / 1000).toFixed(2)}s`;
    els.mTotal.textContent = `${(ttfa / 1000).toFixed(2)}s`;
    playbackDurationSec = buffer.duration;
    els.mAudio.textContent = `${playbackDurationSec.toFixed(2)}s`;
    log(`blob: audio decoded after ${(ttfa / 1000).toFixed(2)}s`);

    playbackStartTime = performance.now();
    isAudioPlaying = true;

    blobSource = stage.audioCtx.createBufferSource();
    blobSource.buffer = buffer;
    blobSource.connect(stage.sink);
    blobSource.onended = () => {
      isAudioPlaying = false;
    };
    blobSource.start();
  } catch (error) {
    if ((error as Error)?.name !== "AbortError") {
      result.errors.push(String(error));
      log(`ERROR ${String(error)}`);
      setStatus(`Error: ${String(error)}`);
    }
  } finally {
    setBusy(false);
  }
}

// ── Main UI Event Listeners ────────────────────────────────────────────────
async function run() {
  try {
    stage = await initStage();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(message);
    setStatus(`Error: ${message}`);
    log(`ERROR ${message}`);
    return;
  }

  els.speakStream.addEventListener("click", () => void speakStreaming());
  els.speakBlob.addEventListener("click", () => void speakBlob());
  els.btnLiveMic.addEventListener("click", () => void toggleLiveMic());
  els.stop.addEventListener("click", () => {
    stopPlayback();
    if (liveMicActive) void toggleLiveMic();
    setBusy(false);
    setStatus("Stopped.");
  });

  // Plinth display toggle
  els.plinthMode.addEventListener("change", () => {
    if (stage) {
      stage.plinthGroup.visible = els.plinthMode.value === "plinth";
      log(`Plinth mode: ${els.plinthMode.value}`);
    }
  });

  // Lip gain slider
  els.lipGain.addEventListener("input", () => {
    const gain = Number(els.lipGain.value);
    articulationEngine.lipGain = gain;
    els.lipGainVal.textContent = `${gain.toFixed(2)}x`;
    els.mArticulation.textContent = `${gain.toFixed(2)}x (Active)`;
  });

  // Head selection dropdown
  els.headSelect.addEventListener("change", async () => {
    if (!stage) return;
    const headKey = els.headSelect.value;
    const headDef = resolveHeadDefinition(headKey);

    // 1. Update canonical voice for this character
    els.voice.value = headDef.voice;
    els.headUrl.value = headDef.url;

    setStatus(`Switching performer head: ${headDef.label} (voice: ${headDef.voice})…`);
    log(`Performer switched to ${headDef.label} — voice assigned to "${headDef.voice}"`);

    try {
      const isWebGpu = result.renderer === "webgpu";
      stage.morphMeshes = await loadHeadModel(headDef, stage.headGroup, isWebGpu, stage.camera, stage.controls);
      setStatus(`Performer ${headDef.label} ready.`);
      log(`Performer ${headDef.label} active (${stage.morphMeshes.length} morph mesh, voice: "${headDef.voice}")`);
    } catch (err) {
      log(`ERROR loading head ${headDef.label}: ${String(err)}`);
      setStatus(`Head load failed: ${String(err)}`);
    }
  });

  // Prompt tag insert pills
  els.promptTagPills.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tag = btn.dataset.tag;
      if (!tag) return;
      const cur = els.text.value;
      els.text.value = `${tag} ${cur}`;
      els.text.focus();
    });
  });

  // Live emotion override pills
  els.liveEmotionPills.querySelectorAll<HTMLButtonElement>("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const em = btn.dataset.emotion as EmotionState;
      if (!em) return;
      els.liveEmotionPills.querySelectorAll("button").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      emotionEngine.setEmotion(em, 0.85);
      log(`Live emotion overridden to: [${em}]`);
    });
  });
}

void run();
