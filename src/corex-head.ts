/**
 * Core-X Head bust-mode case (2026-07-17).
 *
 * Proves the gemma-avatar streaming pipeline on a Core-X ChatAvatar head,
 * which has a DIFFERENT structure than the Ready Player Me reference avatar:
 * no skeleton (0 skins), no Oculus viseme morphs, no animations — just 51
 * ARKit blendshapes on the face mesh plus separate eyeball meshes. That
 * rules TalkingHead out (it requires a Mixamo rig + Oculus visemes), so the
 * bust renders in a plain three.js stage and HeadAudio's Oculus viseme
 * events are mapped onto ARKit morph combinations at runtime:
 *
 *   text → POST /v1/audio/speech/stream (chunked PCM16, Qwen3-TTS clone)
 *        → Int16→Float32 + linear resample → pcm-player worklet
 *        → GainNode → speakers, tapped by HeadAudio
 *        → viseme events → VISEME_TO_ARKIT → morphTargetInfluences.
 *
 * This is the exact contract core-x's VoiceScene consumes (ARKit morphs
 * driven per-frame), so a pass here is a pass for the core-x integration.
 * No Blender rigging is needed for speech; bones only become relevant if
 * the heads should ever run inside TalkingHead's body-animation system.
 *
 * Kept self-contained like the gemma-avatar case — shared modules get
 * extracted during the Avatar Labs modernization, not here.
 */

import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  FrontSide,
  Group,
  HemisphereLight,
  Mesh,
  Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  Box3,
} from "three";
import { WebGPURenderer } from "three/webgpu";
import { GLTFLoader } from "three-stdlib";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { HeadAudio } from "@met4citizen/headaudio/dist/headaudio.min.mjs";
import headWorkletUrl from "@met4citizen/headaudio/dist/headworklet.min.mjs?url";
import headModelUrl from "@met4citizen/headaudio/dist/model-en-mixed.bin?url";
import { streamSpeech } from "./runtime/audio-stream";

const els = {
  stage: document.getElementById("stage") as HTMLElement,
  status: document.getElementById("status") as HTMLElement,
  log: document.getElementById("log") as HTMLElement,
  text: document.getElementById("text") as HTMLTextAreaElement,
  voice: document.getElementById("voice") as HTMLInputElement,
  headUrl: document.getElementById("head-url") as HTMLInputElement,
  service: document.getElementById("service") as HTMLInputElement,
  speakStream: document.getElementById("speak-stream") as HTMLButtonElement,
  speakBlob: document.getElementById("speak-blob") as HTMLButtonElement,
  stop: document.getElementById("stop") as HTMLButtonElement,
  mTtfa: document.getElementById("m-ttfa") as HTMLElement,
  mTotal: document.getElementById("m-total") as HTMLElement,
  mAudio: document.getElementById("m-audio") as HTMLElement,
  mVisemes: document.getElementById("m-visemes") as HTMLElement,
  mQueue: document.getElementById("m-queue") as HTMLElement,
};

const result = {
  ready: false,
  capability: "tts-arkit-viseme",
  renderer: "pending",
  visemeEvents: 0,
  lastTtfaMs: 0,
  morphMeshes: 0,
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

// ── HeadAudio Oculus visemes → ARKit blendshape combos ─────────────────────
// Weights tuned for ChatAvatar heads: each viseme contributes to a few ARKit
// morphs; concurrent visemes merge by max so shared morphs (jawOpen) never
// double-count.
const VISEME_TO_ARKIT: Record<string, Record<string, number>> = {
  viseme_sil: {},
  viseme_PP: { mouthClose: 0.9, mouthPressLeft: 0.5, mouthPressRight: 0.5 },
  viseme_FF: { jawOpen: 0.12, mouthShrugUpper: 0.35, mouthLowerDownLeft: 0.3, mouthLowerDownRight: 0.3 },
  viseme_TH: { jawOpen: 0.2, mouthStretchLeft: 0.2, mouthStretchRight: 0.2 },
  viseme_DD: { jawOpen: 0.25, mouthStretchLeft: 0.15, mouthStretchRight: 0.15 },
  viseme_kk: { jawOpen: 0.3 },
  viseme_CH: { jawOpen: 0.25, mouthFunnel: 0.4, mouthPucker: 0.2 },
  viseme_SS: { jawOpen: 0.15, mouthStretchLeft: 0.4, mouthStretchRight: 0.4, mouthSmileLeft: 0.15, mouthSmileRight: 0.15 },
  viseme_nn: { jawOpen: 0.15, mouthClose: 0.3 },
  viseme_RR: { jawOpen: 0.2, mouthPucker: 0.4 },
  viseme_aa: { jawOpen: 0.7, mouthLowerDownLeft: 0.2, mouthLowerDownRight: 0.2 },
  viseme_E: { jawOpen: 0.35, mouthStretchLeft: 0.35, mouthStretchRight: 0.35, mouthSmileLeft: 0.2, mouthSmileRight: 0.2 },
  viseme_I: { jawOpen: 0.25, mouthStretchLeft: 0.5, mouthStretchRight: 0.5 },
  viseme_O: { jawOpen: 0.45, mouthFunnel: 0.6, mouthPucker: 0.3 },
  viseme_U: { jawOpen: 0.25, mouthPucker: 0.8, mouthFunnel: 0.4 },
};

/**
 * Minimal port of core-x's head-assembly normalization for ChatAvatar v2
 * busts (the full version lives in core-x's avatar-loader-v2-bridge +
 * voice-scene "head assembly"):
 *
 *  - The face mesh node carries the normalization scale (e.g. 0.0263) while
 *    the split `eyeball_left/right` nodes stay in RAW units — without
 *    adopting the face scale the eyes render as ~1m spheres swallowing the
 *    bust. Adopt scale AND translation.
 *  - `occlusion_hidden` material groups are helper geometry and must not
 *    render (they read as a shell over the eye sockets).
 *  - `eyes` renders FrontSide only — DoubleSide shows backfaces through the
 *    eyelid line.
 */
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
    // Only adopt when the scales genuinely disagree (raw-unit eyeballs).
    if (ratio < 0.5 || ratio > 2) {
      node.scale.multiplyScalar(ratio);
      node.position.multiplyScalar(ratio);
    }
  }
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
  audioCtx: AudioContext;
  player: AudioWorkletNode;
  sink: GainNode;
  headaudio: HeadAudio;
  morphMeshes: Mesh[];
}

let stage: Stage | null = null;
let abort: AbortController | null = null;
let blobSource: AudioBufferSourceNode | null = null;
// Live viseme envelope state (HeadAudio writes, render loop applies).
const visemeState: Record<string, number> = {};

function applyVisemesToMorphs(meshes: Mesh[]) {
  // Merge all active visemes into ARKit values (max wins on shared morphs).
  const target: Record<string, number> = {};
  for (const [viseme, level] of Object.entries(visemeState)) {
    if (level <= 0.001) continue;
    const combo = VISEME_TO_ARKIT[viseme];
    if (!combo) continue;
    for (const [morph, weight] of Object.entries(combo)) {
      const value = level * weight;
      if (value > (target[morph] ?? 0)) target[morph] = value;
    }
  }
  for (const mesh of meshes) {
    const dict = mesh.morphTargetDictionary as Record<string, number> | undefined;
    const influences = mesh.morphTargetInfluences;
    if (!dict || !influences) continue;
    for (const [morph, index] of Object.entries(dict)) {
      if (!morph.startsWith("jaw") && !morph.startsWith("mouth")) continue;
      influences[index] = target[morph] ?? 0;
    }
    // Periodic blink rides on top of speech morphs.
    const blink = blinkLevel();
    if (dict.eyeBlinkLeft !== undefined) influences[dict.eyeBlinkLeft] = blink;
    if (dict.eyeBlinkRight !== undefined) influences[dict.eyeBlinkRight] = blink;
  }
}

// Simple blink envelope: every ~2.5–5s, 140ms down-up.
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

async function initStage(): Promise<Stage> {
  setStatus("Creating three.js stage…");
  const forceWebGl = new URLSearchParams(window.location.search).get("renderer") === "webgl";
  let renderer: WebGLRenderer | WebGPURenderer;
  if ("gpu" in navigator && !forceWebGl) {
    try {
      const webgpu = new WebGPURenderer({ antialias: true });
      await webgpu.init();
      renderer = webgpu;
      result.renderer = "webgpu";
      log("renderer: WebGPU initialized");
    } catch (error) {
      log(`renderer: WebGPU unavailable (${String(error)}); using WebGL2`);
      renderer = new WebGLRenderer({ antialias: true });
      result.renderer = "webgl-fallback";
    }
  } else {
    renderer = new WebGLRenderer({ antialias: true });
    result.renderer = forceWebGl ? "webgl-forced" : "webgl-fallback";
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(els.stage.clientWidth, els.stage.clientHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  els.stage.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x101a2b);
  const isWebGpu = result.renderer === "webgpu";
  if (!isWebGpu && renderer instanceof WebGLRenderer) {
    const pmrem = new PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  }
  scene.add(new HemisphereLight(0xdfe8ff, 0x1a2233, isWebGpu ? 0.9 : 0.35));
  const key = new DirectionalLight(0xffffff, isWebGpu ? 2.2 : 1.1);
  key.position.set(0.6, 1.4, 1.2);
  scene.add(key);
  if (isWebGpu) {
    const fill = new DirectionalLight(0xb8d5ff, 0.8);
    fill.position.set(-1.4, 0.4, 0.8);
    scene.add(fill);
  }

  const camera = new PerspectiveCamera(28, els.stage.clientWidth / els.stage.clientHeight, 0.01, 50);

  setStatus(`Loading head GLB… (${els.headUrl.value})`);
  const gltf = await new GLTFLoader().loadAsync(els.headUrl.value);
  normalizeChatAvatarHead(gltf.scene);
  const root = new Group();
  root.add(gltf.scene);
  scene.add(root);

  // Frame the bust from its bounding box (heads are authored at real scale).
  const box = new Box3().setFromObject(gltf.scene);
  const center = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  camera.position.set(center.x, center.y + size.y * 0.06, center.z + size.y * 2.4);
  camera.lookAt(center.x, center.y + size.y * 0.04, center.z);

  const morphMeshes: Mesh[] = [];
  gltf.scene.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.isMesh && mesh.morphTargetDictionary && mesh.morphTargetInfluences) {
      morphMeshes.push(mesh);
    }
  });
  result.morphMeshes = morphMeshes.length;
  if (morphMeshes.length === 0) {
    log("WARNING: no morph-target meshes found — visemes will not move the face");
  } else {
    const dict = morphMeshes[0].morphTargetDictionary as Record<string, number>;
    log(`head loaded — ${morphMeshes.length} morph mesh(es), ${Object.keys(dict).length} blendshapes`);
  }

  setStatus("Wiring audio…");
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
  sink.connect(headaudio); // tap the audible path for viseme classification
  headaudio.onvalue = (key: string, value: number) => {
    result.visemeEvents += 1;
    els.mVisemes.textContent = String(result.visemeEvents);
    visemeState[key] = value;
  };

  // Render loop: subtle idle sway + viseme application. The rAF-stall
  // watchdog keeps HeadAudio pumped in occluded tabs (same as the gemma
  // case); rendering itself can freeze there without losing state.
  let lastRafAt = performance.now();
  let lastPumpAt = performance.now();
  const tick = (now: number) => {
    lastRafAt = now;
    headaudio.update(now - lastPumpAt);
    lastPumpAt = now;
    root.rotation.y = Math.sin(now / 4200) * 0.035;
    root.rotation.x = Math.sin(now / 5600) * 0.015;
    applyVisemesToMorphs(morphMeshes);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.setInterval(() => {
    const now = performance.now();
    if (now - lastRafAt > 500) {
      headaudio.update(now - lastPumpAt);
      lastPumpAt = now;
      applyVisemesToMorphs(morphMeshes);
    }
  }, 250);

  window.addEventListener("resize", () => {
    renderer.setSize(els.stage.clientWidth, els.stage.clientHeight);
    camera.aspect = els.stage.clientWidth / els.stage.clientHeight;
    camera.updateProjectionMatrix();
  });

  result.ready = true;
  setStatus(`Ready / ${result.renderer}`);
  log(`stage ready — ${result.renderer}, ctx ${audioCtx.sampleRate} Hz`);
  const stageObj = { audioCtx, player, sink, headaudio, morphMeshes };
  (window as any).__corexHeadStage = stageObj; // debug/Playwright handle
  return stageObj;
}

const stopPlayback = () => {
  abort?.abort();
  abort = null;
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

async function speakStreaming() {
  if (!stage) return;
  stopPlayback();
  setBusy(true);
  resetMetrics();
  try {
    await stage.audioCtx.resume();
    abort = new AbortController();
    const stream = await streamSpeech({
      baseUrl: els.service.value,
      input: els.text.value,
      voice: els.voice.value,
      destinationSampleRate: stage.audioCtx.sampleRate,
      signal: abort.signal,
      onFirstChunk: (firstAudioAt) => {
        result.lastTtfaMs = firstAudioAt;
        els.mTtfa.textContent = `${(firstAudioAt / 1000).toFixed(2)}s`;
        log(`streaming: first audio after ${(firstAudioAt / 1000).toFixed(2)}s`);
      },
      onChunk: (samples) => {
        stage!.player.port.postMessage({ type: "chunk", samples }, [samples.buffer]);
      },
    });
    els.mTotal.textContent = `${(stream.totalMs / 1000).toFixed(2)}s`;
    els.mAudio.textContent = `${(stream.sourceSamples / stream.sourceSampleRate).toFixed(2)}s`;
    log(
      `streaming: done — ${(stream.totalMs / 1000).toFixed(2)}s request for ${(stream.sourceSamples / stream.sourceSampleRate).toFixed(2)}s of audio`,
    );
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

async function speakBlob() {
  if (!stage) return;
  stopPlayback();
  setBusy(true);
  resetMetrics();
  try {
    await stage.audioCtx.resume();
    abort = new AbortController();
    const t0 = performance.now();
    const response = await fetch(`${els.service.value}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: els.text.value,
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
    els.mAudio.textContent = `${buffer.duration.toFixed(2)}s`;
    log(`blob: first audio after ${(ttfa / 1000).toFixed(2)}s (full WAV then play)`);
    blobSource = stage.audioCtx.createBufferSource();
    blobSource.buffer = buffer;
    blobSource.connect(stage.sink);
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
  els.stop.addEventListener("click", () => {
    stopPlayback();
    setBusy(false);
    setStatus("Stopped.");
  });
}

void run();
