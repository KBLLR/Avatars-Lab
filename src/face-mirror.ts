import { RotateCcw, Video, VideoOff, createIcons } from "lucide";
import { FacialPortraitRuntime } from "./facial/portrait-runtime";

interface Landmark { x: number; y: number; z?: number }
interface BlendshapeCategory { categoryName: string; score: number }
interface FaceLandmarkerResult {
  faceLandmarks?: Landmark[][];
  faceBlendshapes?: Array<{ categories: BlendshapeCategory[] }>;
}
interface FaceLandmarkerRuntime {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): FaceLandmarkerResult;
  close(): void;
}

const element = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing Face Mirror element: ${id}`);
  return node as T;
};

const els = {
  stage: element<HTMLElement>("portraitStage"),
  stageStatus: element<HTMLOutputElement>("stageStatus"),
  video: element<HTMLVideoElement>("webcam"),
  headSelect: element<HTMLSelectElement>("headSelect"),
  influence: element<HTMLInputElement>("influence"),
  influenceValue: element<HTMLElement>("influenceValue"),
  start: element<HTMLButtonElement>("startButton"),
  stop: element<HTMLButtonElement>("stopButton"),
  reset: element<HTMLButtonElement>("resetButton"),
  renderer: element<HTMLElement>("rendererMetric"),
  pedestal: element<HTMLElement>("pedestalMetric"),
  model: element<HTMLElement>("modelMetric"),
  capture: element<HTMLElement>("captureMetric"),
  faces: element<HTMLElement>("facesMetric"),
  fps: element<HTMLElement>("fpsMetric"),
  expressions: element<HTMLOListElement>("expressionList"),
};

createIcons({ icons: { RotateCcw, Video, VideoOff }, attrs: { "stroke-width": 1.5 } });

const result = {
  ready: false,
  model: "loading",
  capture: "off",
  faces: 0,
  fps: 0,
  errors: [] as string[],
};
(window as Window & { __faceMirrorResult?: typeof result }).__faceMirrorResult = result;

let runtime: FacialPortraitRuntime | null = null;
let landmarker: FaceLandmarkerRuntime | null = null;
let stream: MediaStream | null = null;
let animationFrame = 0;
let lastVideoTime = -1;
let lastInferenceAt = 0;
let frameCount = 0;
let fpsWindowAt = performance.now();
let lastFaceAt = 0;

const setStatus = (message: string, error = false): void => {
  els.stageStatus.textContent = message;
  els.stageStatus.classList.toggle("facial-error", error);
};

const populateHeads = (): void => {
  if (!runtime) return;
  els.headSelect.replaceChildren(...runtime.headOptions().map((head) => {
    const option = document.createElement("option");
    option.value = head.id;
    option.textContent = head.label.replace(/ \/ Head$/, "");
    return option;
  }));
  els.headSelect.value = runtime.snapshot().headId;
};

const updateRuntimeMetrics = (): void => {
  if (!runtime) return;
  const snapshot = runtime.snapshot();
  els.renderer.textContent = snapshot.renderer;
  els.pedestal.textContent = snapshot.capabilities.pedestal.replaceAll("-", " ");
};

const renderExpressions = (categories: BlendshapeCategory[]): void => {
  const dominant = categories
    .filter((category) => category.categoryName !== "_neutral")
    .sort((a, b) => b.score - a.score)
    .slice(0, 7);
  els.expressions.replaceChildren(...dominant.map((category) => {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = category.categoryName;
    const value = document.createElement("span");
    value.textContent = category.score.toFixed(3);
    item.append(label, value);
    return item;
  }));
};

const applyFace = (faceResult: FaceLandmarkerResult): void => {
  if (!runtime) return;
  const categories = faceResult.faceBlendshapes?.[0]?.categories || [];
  const influence = Number(els.influence.value);
  runtime.setExpression(Object.fromEntries(categories.map((category) => [
    category.categoryName,
    Math.max(0, Math.min(1, category.score * influence)),
  ])));
  const landmarks = faceResult.faceLandmarks?.[0];
  if (landmarks && landmarks.length > 263) {
    const leftEye = landmarks[33];
    const rightEye = landmarks[263];
    const nose = landmarks[1] || landmarks[4];
    const roll = Math.atan2(rightEye.y - leftEye.y, Math.max(0.001, rightEye.x - leftEye.x));
    runtime.setHeadPose({
      yaw: -(nose.x - 0.5) * 1.35,
      pitch: -(nose.y - 0.5) * 1.05,
      roll: -roll * 0.65,
    });
  }
  renderExpressions(categories);
};

const updateFps = (now: number): void => {
  frameCount += 1;
  if (now - fpsWindowAt < 1_000) return;
  result.fps = Math.round(frameCount * 1_000 / (now - fpsWindowAt));
  els.fps.textContent = `${result.fps} fps`;
  frameCount = 0;
  fpsWindowAt = now;
};

const predict = (now: number): void => {
  if (!stream || !landmarker) return;
  if (els.video.readyState >= 2 && els.video.currentTime !== lastVideoTime && now - lastInferenceAt >= 30) {
    lastVideoTime = els.video.currentTime;
    lastInferenceAt = now;
    const faceResult = landmarker.detectForVideo(els.video, now);
    const faces = faceResult.faceLandmarks?.length || 0;
    result.faces = faces;
    els.faces.textContent = String(faces);
    if (faces > 0) {
      lastFaceAt = now;
      applyFace(faceResult);
    } else if (now - lastFaceAt > 600) {
      runtime?.resetExpression();
      runtime?.resetHeadPose();
    }
    updateFps(now);
  }
  animationFrame = requestAnimationFrame(predict);
};

const startCapture = async (): Promise<void> => {
  if (!runtime || !landmarker || stream) return;
  setStatus("Requesting camera permission");
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 960 }, height: { ideal: 720 }, facingMode: "user" },
      audio: false,
    });
    els.video.srcObject = stream;
    await els.video.play();
    els.video.hidden = false;
    els.start.disabled = true;
    els.stop.disabled = false;
    result.capture = "live";
    els.capture.textContent = "live / transient";
    setStatus("Face Mirror live / look into the camera");
    animationFrame = requestAnimationFrame(predict);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(message);
    setStatus(message, true);
  }
};

const stopCapture = (): void => {
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  els.video.srcObject = null;
  els.video.hidden = true;
  els.start.disabled = !landmarker || !runtime;
  els.stop.disabled = true;
  result.capture = "off";
  result.faces = 0;
  result.fps = 0;
  els.capture.textContent = "off";
  els.faces.textContent = "0";
  els.fps.textContent = "0 fps";
  runtime?.resetExpression();
  runtime?.resetHeadPose();
  setStatus(runtime ? `${runtime.snapshot().headLabel} ready / camera off` : "Camera off");
};

const init = async (): Promise<void> => {
  runtime = await FacialPortraitRuntime.create(els.stage);
  populateHeads();
  updateRuntimeMetrics();
  setStatus("Loading local MediaPipe Face Landmarker");
  const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks("/facial-assets/mediapipe/wasm");
  landmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: "/facial-assets/mediapipe/face_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: false,
  }) as unknown as FaceLandmarkerRuntime;
  result.model = "local / GPU";
  els.model.textContent = result.model;
  result.ready = true;
  els.start.disabled = false;
  setStatus(`${runtime.snapshot().headLabel} ready / camera permission is off`);
};

els.start.addEventListener("click", () => void startCapture());
els.stop.addEventListener("click", stopCapture);
els.reset.addEventListener("click", () => {
  runtime?.resetExpression();
  runtime?.resetHeadPose();
});
els.influence.addEventListener("input", () => {
  els.influenceValue.textContent = `${Math.round(Number(els.influence.value) * 100)}%`;
});
els.headSelect.addEventListener("change", async () => {
  if (!runtime) return;
  const wasLive = Boolean(stream);
  if (wasLive) stopCapture();
  els.headSelect.disabled = true;
  try {
    setStatus("Loading head performer");
    await runtime.loadHead(els.headSelect.value);
    updateRuntimeMetrics();
    setStatus(`${runtime.snapshot().headLabel} ready / camera permission is off`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    els.headSelect.disabled = false;
  }
});

window.addEventListener("beforeunload", () => {
  stopCapture();
  landmarker?.close();
  runtime?.dispose();
});

init().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  result.errors.push(message);
  result.model = "unavailable";
  els.model.textContent = result.model;
  setStatus(`${message}. Run npm run assets:facial if the local model is missing.`, true);
});
