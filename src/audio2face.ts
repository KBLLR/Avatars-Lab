import {
  Cpu,
  Play,
  RotateCcw,
  Square,
  createIcons,
} from "lucide";
import { FacialPortraitRuntime } from "./facial/portrait-runtime";

type EmotionPreset = "neutral" | "happy" | "surprised" | "angry" | "empathic";

interface PreviewFrame extends Record<string, number> {
  frame: number;
}

interface MotionPreview {
  fps: number;
  durationSeconds: number;
  frames: PreviewFrame[];
}

const MONITORED_CHANNELS = [
  { key: "jawOpen", label: "Jaw Open", class: "" },
  { key: "mouthUpperUpLeft", label: "Upper Lip Up L", class: "accent-green" },
  { key: "mouthLowerDownLeft", label: "Lower Lip Down L", class: "accent-green" },
  { key: "mouthStretchLeft", label: "Lip Stretch L", class: "accent-green" },
  { key: "mouthFunnel", label: "Mouth Funnel", class: "" },
  { key: "mouthPucker", label: "Mouth Pucker", class: "" },
  { key: "mouthSmileLeft", label: "Smile L", class: "accent-green" },
  { key: "eyeBlinkLeft", label: "Blink L", class: "accent-amber" },
  { key: "browInnerUp", label: "Brow Inner Up", class: "accent-amber" },
  { key: "eyeLookInLeft", label: "Gaze Focus L", class: "accent-amber" },
];

createIcons({
  icons: { Cpu, Play, RotateCcw, Square },
  attrs: { "stroke-width": 1.5 },
});

const byId = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing Audio2Face DOM element: #${id}`);
  return el as T;
};

const dom = {
  stage: byId<HTMLElement>("portraitStage"),
  stageStatus: byId<HTMLOutputElement>("stageStatus"),
  headSelect: byId<HTMLSelectElement>("headSelect"),
  rendererMetric: byId<HTMLElement>("rendererMetric"),
  pedestalMetric: byId<HTMLElement>("pedestalMetric"),
  emotionBtns: document.querySelectorAll<HTMLButtonElement>(".a2f-emotion-btn"),
  emotionIntensity: byId<HTMLInputElement>("emotionIntensity"),
  emotionIntensityVal: byId<HTMLElement>("emotionIntensityVal"),
  eyeballToggle: byId<HTMLInputElement>("eyeballToggle"),
  audioSampleSelect: byId<HTMLSelectElement>("audioSampleSelect"),
  customAudioContainer: byId<HTMLElement>("customAudioContainer"),
  audioFile: byId<HTMLInputElement>("audioFile"),
  generateButton: byId<HTMLButtonElement>("generateButton"),
  playButton: byId<HTMLButtonElement>("playButton"),
  stopButton: byId<HTMLButtonElement>("stopButton"),
  resetButton: byId<HTMLButtonElement>("resetButton"),
  framesMetric: byId<HTMLElement>("framesMetric"),
  durationMetric: byId<HTMLElement>("durationMetric"),
  channelsMetric: byId<HTMLElement>("channelsMetric"),
  fpsMetric: byId<HTMLElement>("fpsMetric"),
  channelMeters: byId<HTMLElement>("channelMeters"),
};

// Global state
let activeEmotion: EmotionPreset = "neutral";
let activeIntensity = 0.75;
let runtime: FacialPortraitRuntime | null = null;
let currentPreview: MotionPreview | null = null;
let previewRevision = 0;
let playbackRaf = 0;
let audioElement: HTMLAudioElement | null = null;
let audioUrl: string | null = null;
let audioContext: AudioContext | null = null;

const result = {
  ready: false,
  head: "",
  framesGenerated: 0,
  isPlaying: false,
  errors: [] as string[],
};
(window as Window & { __a2fLabResult?: typeof result }).__a2fLabResult = result;

const setStatus = (msg: string, isError = false): void => {
  dom.stageStatus.textContent = msg;
  dom.stageStatus.classList.toggle("facial-error", isError);
};

// Procedural audio synthesizer for built-in test speech signals
const synthesizeProceduralSpeech = (sampleId: string): AudioBuffer => {
  const ctx = audioContext || new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)({ sampleRate: 16000 });
  audioContext = ctx;

  let duration = 3.5;
  let baseFreq = 120;
  let modulationFreq = 4.2;

  if (sampleId === "builtin:dialogue") {
    duration = 4.2;
    baseFreq = 135;
    modulationFreq = 5.5;
  } else if (sampleId === "builtin:emotion") {
    duration = 4.8;
    baseFreq = 150;
    modulationFreq = 3.8;
  }

  const length = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const channelData = buffer.getChannelData(0);

  // Synthesize formant-filtered speech-like waveform (vowels, phoneme bursts)
  for (let i = 0; i < length; i++) {
    const t = i / ctx.sampleRate;
    // Envelope: speech cadence with pauses
    const envelope = Math.max(0, Math.sin(t * Math.PI * modulationFreq) * 0.85 + 0.15);
    // Glottal pulse fundamental
    const f0 = baseFreq + Math.sin(t * 3.0) * 15;
    const glottal = (Math.sin(2 * Math.PI * f0 * t) + 0.5 * Math.sin(4 * Math.PI * f0 * t) + 0.25 * Math.sin(6 * Math.PI * f0 * t));
    // Formant resonances (F1 ~700Hz, F2 ~1800Hz)
    const f1 = Math.sin(2 * Math.PI * 720 * t);
    const f2 = Math.sin(2 * Math.PI * 1850 * t);
    // Noise burst for consonants
    const noise = (Math.random() * 2 - 1) * (Math.sin(t * 12) > 0.7 ? 0.35 : 0.05);

    channelData[i] = (glottal * 0.5 + f1 * 0.3 + f2 * 0.2 + noise) * envelope * 0.45;
  }

  return buffer;
};

// Convert AudioBuffer to WAV blob for playback in HTMLAudioElement
const bufferToWavBlob = (buffer: AudioBuffer): Blob => {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const out = new DataView(new ArrayBuffer(length));
  const channels: Float32Array[] = [];
  let sampleRate = buffer.sampleRate;
  let offset = 0;
  let pos = 0;

  const setUint16 = (data: number) => { out.setUint16(pos, data, true); pos += 2; };
  const setUint32 = (data: number) => { out.setUint32(pos, data, true); pos += 4; };

  // RIFF header
  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8);
  setUint32(0x45564157); // "WAVE"
  setUint32(0x20746d66); // "fmt "
  setUint32(16); // subchunk1size
  setUint16(1);  // PCM
  setUint16(numOfChan);
  setUint32(sampleRate);
  setUint32(sampleRate * 2 * numOfChan); // byte rate
  setUint16(numOfChan * 2); // block align
  setUint16(16); // bits per sample
  setUint32(0x61746164); // "data"
  setUint32(length - pos - 4);

  for (let i = 0; i < buffer.numberOfChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  while (offset < buffer.length) {
    for (let i = 0; i < numOfChan; i++) {
      const sample = Math.max(-1, Math.min(1, channels[i][offset]));
      out.setInt16(pos, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      pos += 2;
    }
    offset++;
  }

  return new Blob([out.buffer], { type: "audio/wav" });
};

// Approximate facial motion from audio energy and zero crossings.
const generatePreviewFrames = (
  buffer: AudioBuffer,
  emotion: EmotionPreset,
  intensity: number,
  eyeballGaze: boolean
): MotionPreview => {
  const fps = 60;
  const duration = buffer.duration;
  const numFrames = Math.max(1, Math.floor(duration * fps));
  const channelData = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const samplesPerFrame = Math.floor(sampleRate / fps);

  const frames: PreviewFrame[] = [];

  // Emotion vectors
  const emotionMap: Record<EmotionPreset, Record<string, number>> = {
    neutral: { browInnerUp: 0.05, mouthSmileLeft: 0.04, mouthSmileRight: 0.04 },
    happy: {
      mouthSmileLeft: 0.55 * intensity,
      mouthSmileRight: 0.55 * intensity,
      cheekSquintLeft: 0.35 * intensity,
      cheekSquintRight: 0.35 * intensity,
      browInnerUp: 0.15 * intensity,
    },
    surprised: {
      browInnerUp: 0.65 * intensity,
      eyeWideLeft: 0.45 * intensity,
      eyeWideRight: 0.45 * intensity,
      jawOpen: 0.25 * intensity,
    },
    angry: {
      browDownLeft: 0.65 * intensity,
      browDownRight: 0.65 * intensity,
      noseSneerLeft: 0.45 * intensity,
      noseSneerRight: 0.45 * intensity,
      mouthShrugLower: 0.25 * intensity,
    },
    empathic: {
      browInnerUp: 0.45 * intensity,
      mouthSmileLeft: 0.25 * intensity,
      mouthSmileRight: 0.25 * intensity,
      eyeSquintLeft: 0.15 * intensity,
      eyeSquintRight: 0.15 * intensity,
    },
  };

  const activeEmotionTargets = emotionMap[emotion];

  // Micro-saccade state for eyeball rotation
  let gazeX = 0;
  let gazeY = 0;

  for (let f = 0; f < numFrames; f++) {
    const startSample = f * samplesPerFrame;
    const endSample = Math.min(buffer.length, startSample + samplesPerFrame);

    // Compute RMS energy in current frame window
    let sumSq = 0;
    let zeroCrossings = 0;
    for (let s = startSample; s < endSample; s++) {
      const val = channelData[s] || 0;
      sumSq += val * val;
      if (s > startSample && ((channelData[s] >= 0 && channelData[s - 1] < 0) || (channelData[s] < 0 && channelData[s - 1] >= 0))) {
        zeroCrossings++;
      }
    }
    const rms = Math.sqrt(sumSq / Math.max(1, endSample - startSample));
    const zcr = zeroCrossings / Math.max(1, endSample - startSample);

    // Approximate mouth motion from the audio signal
    const speechOpen = Math.min(1, rms * 4.2);
    const isFricative = zcr > 0.18; // s, sh, f

    const frameData: PreviewFrame = {
      frame: f,
      jawOpen: speechOpen * 0.78 + (activeEmotionTargets.jawOpen || 0),
      mouthUpperUpLeft: speechOpen * 0.42,
      mouthUpperUpRight: speechOpen * 0.42,
      mouthLowerDownLeft: speechOpen * 0.52,
      mouthLowerDownRight: speechOpen * 0.52,
      mouthStretchLeft: isFricative ? 0.68 : speechOpen * 0.38,
      mouthStretchRight: isFricative ? 0.68 : speechOpen * 0.38,
      mouthRollLower: isFricative ? 0.48 : 0,
      mouthShrugUpper: isFricative ? 0.32 : 0,
      mouthFunnel: speechOpen > 0.32 && !isFricative ? speechOpen * 0.58 : 0.04,
      mouthPucker: speechOpen > 0.40 && !isFricative ? speechOpen * 0.46 : 0.02,
      mouthClose: 0,
      mouthPressLeft: speechOpen < 0.03 ? 0.08 : 0,
      mouthPressRight: speechOpen < 0.03 ? 0.08 : 0,
      mouthSmileLeft: (activeEmotionTargets.mouthSmileLeft || 0.02) + (speechOpen * 0.12),
      mouthSmileRight: (activeEmotionTargets.mouthSmileRight || 0.02) + (speechOpen * 0.12),
      browInnerUp: (activeEmotionTargets.browInnerUp || 0.02) + (speechOpen * 0.08),
      browDownLeft: activeEmotionTargets.browDownLeft || 0,
      browDownRight: activeEmotionTargets.browDownRight || 0,
      cheekSquintLeft: activeEmotionTargets.cheekSquintLeft || 0,
      cheekSquintRight: activeEmotionTargets.cheekSquintRight || 0,
      eyeWideLeft: activeEmotionTargets.eyeWideLeft || 0,
      eyeWideRight: activeEmotionTargets.eyeWideRight || 0,
      noseSneerLeft: activeEmotionTargets.noseSneerLeft || 0,
      noseSneerRight: activeEmotionTargets.noseSneerRight || 0,
    };

    // Procedural blinks and gaze
    if (eyeballGaze) {
      // Natural blink cycle (blink every ~150 frames with 8 frame duration)
      const blinkPhase = (f + 40) % 180;
      const isBlinking = blinkPhase < 8;
      const blinkWeight = isBlinking ? Math.sin((blinkPhase / 8) * Math.PI) * 0.95 : 0;

      frameData.eyeBlinkLeft = blinkWeight;
      frameData.eyeBlinkRight = blinkWeight;

      // Micro-saccades (smooth gaze shifting)
      if (f % 45 === 0) {
        gazeX = (Math.random() * 2 - 1) * 0.22;
        gazeY = (Math.random() * 2 - 1) * 0.15;
      }

      if (gazeX > 0) {
        frameData.eyeLookInLeft = gazeX;
        frameData.eyeLookOutRight = gazeX;
        frameData.eyeLookOutLeft = 0;
        frameData.eyeLookInRight = 0;
      } else {
        frameData.eyeLookOutLeft = -gazeX;
        frameData.eyeLookInRight = -gazeX;
        frameData.eyeLookInLeft = 0;
        frameData.eyeLookOutRight = 0;
      }

      if (gazeY > 0) {
        frameData.eyeLookUpLeft = gazeY;
        frameData.eyeLookUpRight = gazeY;
        frameData.eyeLookDownLeft = 0;
        frameData.eyeLookDownRight = 0;
      } else {
        frameData.eyeLookDownLeft = -gazeY;
        frameData.eyeLookDownRight = -gazeY;
        frameData.eyeLookUpLeft = 0;
        frameData.eyeLookUpRight = 0;
      }
    } else {
      frameData.eyeBlinkLeft = 0;
      frameData.eyeBlinkRight = 0;
    }

    frames.push(frameData);
  }

  return { fps, durationSeconds: duration, frames };
};

const renderMetersLayout = (): void => {
  dom.channelMeters.innerHTML = MONITORED_CHANNELS.map((ch) => `
    <div class="a2f-channel-row" data-channel="${ch.key}">
      <span class="name" title="${ch.label}">${ch.label}</span>
      <div class="a2f-channel-bar-bg">
        <div class="a2f-channel-bar-fill ${ch.class}" id="meter-${ch.key}"></div>
      </div>
      <span class="val" id="val-${ch.key}">0.00</span>
    </div>
  `).join("");
};

const updateMeters = (frame: PreviewFrame): void => {
  for (const ch of MONITORED_CHANNELS) {
    const rawVal = frame[ch.key] || 0;
    const clamped = Math.max(0, Math.min(1, rawVal));
    const fill = document.getElementById(`meter-${ch.key}`);
    const valEl = document.getElementById(`val-${ch.key}`);
    if (fill) fill.style.width = `${(clamped * 100).toFixed(0)}%`;
    if (valEl) valEl.textContent = clamped.toFixed(2);
  }
};

const stopPlayback = (): void => {
  if (audioElement) {
    audioElement.pause();
    audioElement.currentTime = 0;
  }
  cancelAnimationFrame(playbackRaf);
  playbackRaf = 0;
  result.isPlaying = false;
  dom.stopButton.disabled = true;
  dom.playButton.disabled = !currentPreview;
  runtime?.resetExpression();
  updateMeters({ frame: 0 });
};

const animatePlayback = (): void => {
  if (!runtime || !audioElement || !currentPreview || audioElement.paused || audioElement.ended) {
    if (audioElement?.ended) {
      stopPlayback();
      setStatus("Preview playback complete.");
    }
    return;
  }
  const frameIdx = Math.min(
    currentPreview.frames.length - 1,
    Math.floor(audioElement.currentTime * currentPreview.fps)
  );
  const frame = currentPreview.frames[frameIdx];
  if (frame) {
    runtime.setExpression(frame);
    updateMeters(frame);
  }
  playbackRaf = requestAnimationFrame(animatePlayback);
};

const clearPreview = (): void => {
  previewRevision++;
  currentPreview = null;
  stopPlayback();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = null;
  audioElement = null;
  result.framesGenerated = 0;
  for (const metric of [dom.framesMetric, dom.durationMetric, dom.channelsMetric, dom.fpsMetric]) {
    metric.textContent = "—";
  }
};

const generateMotion = async (): Promise<void> => {
  clearPreview();
  const revision = previewRevision;
  dom.generateButton.disabled = true;
  setStatus("Generating browser preview…");

  try {
    let buffer: AudioBuffer;
    if (dom.audioSampleSelect.value === "custom") {
      const file = dom.audioFile.files?.[0];
      if (!file) throw new Error("Choose a local audio file.");
      audioContext ??= new AudioContext();
      buffer = await audioContext.decodeAudioData(await file.arrayBuffer());
    } else {
      buffer = synthesizeProceduralSpeech(dom.audioSampleSelect.value);
    }
    if (revision !== previewRevision) return;

    const preview = generatePreviewFrames(buffer, activeEmotion, activeIntensity, dom.eyeballToggle.checked);
    audioUrl = URL.createObjectURL(bufferToWavBlob(buffer));
    audioElement = new Audio(audioUrl);
    audioElement.preload = "auto";

    currentPreview = preview;
    result.framesGenerated = preview.frames.length;
    dom.framesMetric.textContent = String(preview.frames.length);
    dom.durationMetric.textContent = `${preview.durationSeconds.toFixed(2)} s`;
    dom.channelsMetric.textContent = String(Object.keys(preview.frames[0]).length - 1);
    dom.fpsMetric.textContent = `${preview.fps} fps`;
    dom.playButton.disabled = false;
    setStatus("Browser preview ready. Press Play.");
  } catch (err) {
    if (revision !== previewRevision) return;
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push(message);
    setStatus(message, true);
  } finally {
    dom.generateButton.disabled = false;
  }
};

const playMotion = async (): Promise<void> => {
  const audio = audioElement;
  if (!audio || !currentPreview) return;
  stopPlayback();
  dom.playButton.disabled = true;
  try {
    await audio.play();
  } catch (err) {
    if (audio === audioElement) {
      dom.playButton.disabled = false;
      setStatus(`Preview playback failed: ${String(err)}`, true);
    }
    return;
  }
  if (audio !== audioElement) return;

  result.isPlaying = true;
  dom.stopButton.disabled = false;
  setStatus("Playing browser preview.");
  animatePlayback();
};

const populateHeads = (): void => {
  if (!runtime) return;
  dom.headSelect.replaceChildren(
    ...runtime.headOptions().map((head) => {
      const opt = document.createElement("option");
      opt.value = head.id;
      opt.textContent = head.label.replace(/ \/ Head$/, "");
      return opt;
    })
  );
  dom.headSelect.value = runtime.snapshot().headId;
  result.head = runtime.snapshot().headId;
};

const updateMetrics = (): void => {
  if (!runtime) return;
  const snap = runtime.snapshot();
  dom.rendererMetric.textContent = snap.renderer;
  dom.pedestalMetric.textContent = snap.capabilities.pedestal.replaceAll("-", " ");
};

const init = async (): Promise<void> => {
  renderMetersLayout();

  runtime = await FacialPortraitRuntime.create(dom.stage, "head:kbllr");
  populateHeads();
  updateMetrics();

  result.ready = true;
  dom.generateButton.disabled = false;
  setStatus(`${runtime.snapshot().headLabel} ready / browser preview`);
};

dom.emotionBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    dom.emotionBtns.forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    activeEmotion = btn.dataset.emotion as EmotionPreset;
    clearPreview();
    setStatus("Expression preset changed. Generate a new preview.");
  });
});

dom.emotionIntensity.addEventListener("input", () => {
  activeIntensity = parseFloat(dom.emotionIntensity.value);
  dom.emotionIntensityVal.textContent = activeIntensity.toFixed(2);
  clearPreview();
  setStatus("Intensity changed. Generate a new preview.");
});

dom.eyeballToggle.addEventListener("change", () => {
  clearPreview();
  setStatus("Gaze setting changed. Generate a new preview.");
});

dom.audioSampleSelect.addEventListener("change", () => {
  const isCustom = dom.audioSampleSelect.value === "custom";
  dom.customAudioContainer.style.display = isCustom ? "block" : "none";
  clearPreview();
  setStatus(isCustom ? "Select a local audio file" : `Selected: ${dom.audioSampleSelect.selectedOptions[0].text}`);
});

dom.audioFile.addEventListener("change", () => {
  clearPreview();
  const file = dom.audioFile.files?.[0];
  setStatus(file ? `${file.name} selected` : "Choose a local audio file");
});

dom.generateButton.addEventListener("click", () => void generateMotion());
dom.playButton.addEventListener("click", () => void playMotion());
dom.stopButton.addEventListener("click", () => {
  stopPlayback();
  setStatus("Browser preview ready. Press Play.");
});
dom.resetButton.addEventListener("click", () => {
  stopPlayback();
  setStatus("Face reset to resting state.");
});

dom.headSelect.addEventListener("change", async () => {
  if (!runtime) return;
  stopPlayback();
  dom.headSelect.disabled = true;
  try {
    setStatus("Loading head performer...");
    await runtime.loadHead(dom.headSelect.value);
    updateMetrics();
    result.head = dom.headSelect.value;
    setStatus(`${runtime.snapshot().headLabel} loaded and ready.`);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  } finally {
    dom.headSelect.disabled = false;
  }
});

window.addEventListener("beforeunload", () => {
  stopPlayback();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  runtime?.dispose();
});

init().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  result.errors.push(msg);
  setStatus(msg, true);
});
