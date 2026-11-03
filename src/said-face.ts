import { AudioLines, Play, RotateCcw, Square, createIcons } from "lucide";
import { FacialPortraitRuntime } from "./facial/portrait-runtime";

interface SaidFrame extends Record<string, number> {
  frame: number;
}

interface SaidResponse {
  fps: number;
  num_frames: number;
  frames: SaidFrame[];
  timings_ms?: Record<string, number>;
}

const element = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing SAiD Face element: ${id}`);
  return node as T;
};

const els = {
  stage: element<HTMLElement>("portraitStage"),
  stageStatus: element<HTMLOutputElement>("stageStatus"),
  headSelect: element<HTMLSelectElement>("headSelect"),
  audioFile: element<HTMLInputElement>("audioFile"),
  generate: element<HTMLButtonElement>("generateButton"),
  play: element<HTMLButtonElement>("playButton"),
  stop: element<HTMLButtonElement>("stopButton"),
  reset: element<HTMLButtonElement>("resetButton"),
  steps: element<HTMLInputElement>("steps"),
  stepsValue: element<HTMLElement>("stepsValue"),
  guidance: element<HTMLInputElement>("guidance"),
  guidanceValue: element<HTMLElement>("guidanceValue"),
  renderer: element<HTMLElement>("rendererMetric"),
  pedestal: element<HTMLElement>("pedestalMetric"),
  service: element<HTMLElement>("serviceMetric"),
  frames: element<HTMLElement>("framesMetric"),
  fps: element<HTMLElement>("fpsMetric"),
  timing: element<HTMLElement>("timingMetric"),
  expressions: element<HTMLOListElement>("expressionList"),
};

createIcons({ icons: { AudioLines, Play, RotateCcw, Square }, attrs: { "stroke-width": 1.5 } });

const result = {
  ready: false,
  service: "checking",
  frames: 0,
  playing: false,
  errors: [] as string[],
};
(window as Window & { __saidFaceResult?: typeof result }).__saidFaceResult = result;

let runtime: FacialPortraitRuntime | null = null;
let audio: HTMLAudioElement | null = null;
let audioUrl: string | null = null;
let response: SaidResponse | null = null;
let playbackFrame = 0;
let requestAbort: AbortController | null = null;

const setStatus = (message: string, error = false): void => {
  els.stageStatus.textContent = message;
  els.stageStatus.classList.toggle("facial-error", error);
};

const renderDominantExpressions = (frames: SaidFrame[]): void => {
  const totals = new Map<string, number>();
  for (const frame of frames) {
    for (const [name, value] of Object.entries(frame)) {
      if (name === "frame" || !Number.isFinite(value)) continue;
      totals.set(name, (totals.get(name) || 0) + Math.abs(value));
    }
  }
  const dominant = [...totals.entries()]
    .map(([name, total]) => ({ name, value: total / Math.max(1, frames.length) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 7);
  els.expressions.replaceChildren(...dominant.map(({ name, value }) => {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = name;
    const score = document.createElement("span");
    score.textContent = value.toFixed(3);
    item.append(label, score);
    return item;
  }));
};

const stopPlayback = (): void => {
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
  cancelAnimationFrame(playbackFrame);
  playbackFrame = 0;
  result.playing = false;
  els.stop.disabled = true;
  runtime?.resetExpression();
};

const animatePlayback = (): void => {
  if (!runtime || !audio || !response || audio.paused || audio.ended) {
    if (audio?.ended) stopPlayback();
    return;
  }
  const index = Math.min(response.frames.length - 1, Math.floor(audio.currentTime * response.fps));
  const frame = response.frames[index];
  if (frame) runtime.setExpression(frame);
  playbackFrame = requestAnimationFrame(animatePlayback);
};

const selectedAudio = (): File | null => els.audioFile.files?.[0] || null;

const generate = async (): Promise<void> => {
  const file = selectedAudio();
  if (!runtime || !file) return;
  stopPlayback();
  requestAbort?.abort();
  requestAbort = new AbortController();
  els.generate.disabled = true;
  els.play.disabled = true;
  setStatus(`SAiD is generating ${file.name}`);
  const form = new FormData();
  form.append("audio", file, file.name);
  form.append("num_steps", els.steps.value);
  form.append("guidance_scale", els.guidance.value);
  const startedAt = performance.now();
  try {
    const httpResponse = await fetch("/api/said/v1/audio/blendshapes", {
      method: "POST",
      body: form,
      signal: requestAbort.signal,
    });
    if (!httpResponse.ok) {
      const detail = await httpResponse.text().catch(() => "");
      throw new Error(detail || `SAiD request failed (${httpResponse.status}).`);
    }
    const payload = await httpResponse.json() as SaidResponse;
    if (!Array.isArray(payload.frames) || payload.frames.length === 0 || !Number.isFinite(payload.fps)) {
      throw new Error("SAiD returned no usable facial frames.");
    }
    response = payload;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(file);
    audio = new Audio(audioUrl);
    audio.preload = "auto";
    els.frames.textContent = String(payload.frames.length);
    els.fps.textContent = `${payload.fps} fps`;
    els.timing.textContent = `${Math.round(payload.timings_ms?.total || performance.now() - startedAt)} ms`;
    renderDominantExpressions(payload.frames);
    result.frames = payload.frames.length;
    els.play.disabled = false;
    setStatus("Facial motion ready. Press Play.");
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(message);
    setStatus(message, true);
  } finally {
    els.generate.disabled = !selectedAudio();
  }
};

const play = async (): Promise<void> => {
  if (!audio || !response) return;
  stopPlayback();
  await audio.play();
  result.playing = true;
  els.stop.disabled = false;
  setStatus("Playing SAiD facial performance");
  animatePlayback();
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

const init = async (): Promise<void> => {
  runtime = await FacialPortraitRuntime.create(els.stage);
  populateHeads();
  updateRuntimeMetrics();
  try {
    const health = await fetch("/api/said/health");
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
    const payload = await health.json();
    const said = payload.services?.said;
    result.service = said?.status === "healthy" ? "healthy" : String(said?.status || "degraded");
  } catch {
    result.service = "offline";
  }
  els.service.textContent = result.service;
  result.ready = true;
  setStatus(`${runtime.snapshot().headLabel} ready / camera-aware portrait`);
};

els.audioFile.addEventListener("change", () => {
  response = null;
  els.generate.disabled = !selectedAudio() || !runtime;
  els.play.disabled = true;
  setStatus(selectedAudio() ? `${selectedAudio()!.name} selected` : "Choose an audio file");
});
els.generate.addEventListener("click", () => void generate());
els.play.addEventListener("click", () => void play());
els.stop.addEventListener("click", stopPlayback);
els.reset.addEventListener("click", () => runtime?.resetExpression());
els.steps.addEventListener("input", () => { els.stepsValue.textContent = els.steps.value; });
els.guidance.addEventListener("input", () => { els.guidanceValue.textContent = Number(els.guidance.value).toFixed(1); });
els.headSelect.addEventListener("change", async () => {
  if (!runtime) return;
  stopPlayback();
  els.headSelect.disabled = true;
  try {
    setStatus("Loading head performer");
    await runtime.loadHead(els.headSelect.value);
    updateRuntimeMetrics();
    setStatus(`${runtime.snapshot().headLabel} ready / camera-aware portrait`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    els.headSelect.disabled = false;
  }
});

window.addEventListener("beforeunload", () => {
  requestAbort?.abort();
  stopPlayback();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  runtime?.dispose();
});

init().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  result.errors.push(message);
  setStatus(message, true);
});
