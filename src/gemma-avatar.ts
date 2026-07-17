/**
 * Gemma Avatar reference case (2026-07-17).
 *
 * Local re-creation of the architecture in hf.co/spaces/victor/gemma-avatar,
 * with the cloud backend swapped for the local mlx-audio service:
 *
 *   text → POST /v1/audio/speech/stream (chunked PCM16, Qwen3-TTS voice clone)
 *        → main-thread Int16→Float32 + linear resample to the ctx rate
 *        → pcm-player AudioWorklet (ring buffer, barge-in via `clear`)
 *        → TalkingHead audio graph (audioAnalyzerNode → speech gain → out)
 *        → HeadAudio taps the speech gain node, classifies MFCC frames into
 *          Oculus visemes (~50 ms) and writes TalkingHead morph targets.
 *
 * The "Speak (blob)" button reproduces the current core-x path (full WAV,
 * then play) through the same graph, so first-audio latency is directly
 * comparable. This page is intentionally one self-contained case: the
 * reusable modules get extracted during the Avatar Labs modernization.
 */

import { TalkingHead } from "@met4citizen/talkinghead";
import { HeadAudio } from "@met4citizen/headaudio/dist/headaudio.min.mjs";
import headWorkletUrl from "@met4citizen/headaudio/dist/headworklet.min.mjs?url";
import headModelUrl from "@met4citizen/headaudio/dist/model-en-mixed.bin?url";
import avatarUrl from "../fixtures/avatars/brunette.glb?url";

const els = {
  avatar: document.getElementById("avatar") as HTMLElement,
  status: document.getElementById("status") as HTMLElement,
  log: document.getElementById("log") as HTMLElement,
  text: document.getElementById("text") as HTMLTextAreaElement,
  voice: document.getElementById("voice") as HTMLInputElement,
  voiceOptions: document.getElementById("voice-options") as HTMLDataListElement,
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
  visemeEvents: 0,
  lastTtfaMs: 0,
  errors: [] as string[],
};
(window as any).__gemmaAvatarResult = result;

const setStatus = (text: string) => {
  els.status.textContent = text;
};
const log = (text: string) => {
  const ts = new Date().toISOString().slice(11, 23);
  els.log.textContent += `[${ts}] ${text}\n`;
  els.log.scrollTop = els.log.scrollHeight;
};
const fail = (error: unknown): never => {
  const message = error instanceof Error ? error.message : String(error);
  result.errors.push(message);
  setStatus(`Error: ${message}`);
  log(`ERROR ${message}`);
  throw error instanceof Error ? error : new Error(message);
};

/** Chunk-continuous linear resampler (source rate → context rate). */
class LinearResampler {
  private phase = 0;
  private last = 0;
  private readonly ratio: number;
  constructor(srcRate: number, dstRate: number) {
    this.ratio = srcRate / dstRate;
  }
  push(src: Float32Array): Float32Array {
    if (src.length === 0) return src;
    if (this.ratio === 1) return src;
    const out: number[] = [];
    let pos = this.phase;
    while (pos < src.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const s0 = i >= 0 ? src[i] : this.last;
      const s1 = i + 1 < src.length ? src[i + 1] : src[src.length - 1];
      out.push(s0 + (s1 - s0) * frac);
      pos += this.ratio;
    }
    this.phase = pos - src.length;
    this.last = src[src.length - 1];
    return Float32Array.from(out);
  }
}

/** Int16LE byte stream → Float32, carrying odd bytes across reads. */
class PcmDecoder {
  private leftover: Uint8Array | null = null;
  push(bytes: Uint8Array): Float32Array {
    let data = bytes;
    if (this.leftover) {
      const merged = new Uint8Array(this.leftover.length + bytes.length);
      merged.set(this.leftover);
      merged.set(bytes, this.leftover.length);
      data = merged;
      this.leftover = null;
    }
    const even = data.length & ~1;
    if (even < data.length) this.leftover = data.slice(even);
    const aligned = data.slice(0, even);
    const i16 = new Int16Array(aligned.buffer);
    const out = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i += 1) out[i] = i16[i] / 32768;
    return out;
  }
}

interface Stage {
  head: any;
  headaudio: HeadAudio;
  player: AudioWorkletNode;
  ctxRate: number;
}

let stage: Stage | null = null;
let abort: AbortController | null = null;
let blobSource: AudioBufferSourceNode | null = null;

async function initStage(): Promise<Stage> {
  setStatus("Creating TalkingHead…");
  // Same framing/lighting as the original Space's avatar.js: lights zeroed,
  // scene lit by TalkingHead's built-in RoomEnvironment IBL.
  const head: any = new TalkingHead(els.avatar, {
    ttsEndpoint: "N/A", // speech comes from mlx-audio, never TalkingHead TTS
    lipsyncModules: [], // HeadAudio drives the visemes
    cameraView: "upper",
    cameraDistance: -1.4,
    cameraY: -0.15,
    cameraX: -0.18,
    cameraRotateEnable: false,
    lightAmbientIntensity: 0,
    lightDirectIntensity: 0,
    lightSpotIntensity: 0,
    avatarIdleEyeContact: 0.3,
    avatarSpeakingEyeContact: 0.7,
  });

  setStatus("Loading avatar (brunette.glb)…");
  await head.showAvatar({ url: avatarUrl, body: "F", avatarMood: "neutral" });

  setStatus("Wiring HeadAudio…");
  await head.audioCtx.audioWorklet.addModule(headWorkletUrl);
  const headaudio = new HeadAudio(head.audioCtx);
  await headaudio.loadModel(headModelUrl);

  // Tap the speech path for viseme detection; audible path stays untouched.
  head.audioSpeechGainNode.connect(headaudio);
  headaudio.onvalue = (key: string, value: number) => {
    result.visemeEvents += 1;
    els.mVisemes.textContent = String(result.visemeEvents);
    const mt = head.mtAvatar?.[key];
    if (mt) Object.assign(mt, { newvalue: value, needsUpdate: true });
  };
  head.opt.update = headaudio.update.bind(headaudio);
  (headaudio as any).onstarted = () => {
    head.isSpeaking = true;
    head.lookAtCamera(500);
  };
  (headaudio as any).onended = () => {
    head.isSpeaking = false;
  };

  setStatus("Wiring PCM player…");
  await head.audioCtx.audioWorklet.addModule("/worklets/pcm-player.js");
  const player = new AudioWorkletNode(head.audioCtx, "pcm-player", {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  // Route through TalkingHead's graph so reverb/analyzer/HeadAudio all apply.
  player.connect(head.audioAnalyzerNode);
  player.port.onmessage = (event: MessageEvent) => {
    const data = event.data || {};
    if (data.type === "state") {
      els.mQueue.textContent = `${(data.queuedSamples / head.audioCtx.sampleRate).toFixed(1)}s`;
    }
  };

  head.start();

  // rAF watchdog: TalkingHead pumps HeadAudio from its requestAnimationFrame
  // loop, and an occluded/backgrounded tab freezes rAF entirely (the original
  // Space documents the same limitation). When frames stall, pump HeadAudio
  // from a timer so viseme state keeps flowing; when rAF resumes, the timer
  // steps aside.
  let lastRafAt = performance.now();
  let lastPumpAt = performance.now();
  const rafProbe = () => {
    lastRafAt = performance.now();
    requestAnimationFrame(rafProbe);
  };
  requestAnimationFrame(rafProbe);
  window.setInterval(() => {
    const now = performance.now();
    if (now - lastRafAt > 500) {
      headaudio.update(now - lastPumpAt);
    }
    lastPumpAt = now;
  }, 250);

  result.ready = true;
  setStatus("Ready. Type and speak.");
  log(`stage ready — ctx ${head.audioCtx.sampleRate} Hz`);
  const stageObj = { head, headaudio, player, ctxRate: head.audioCtx.sampleRate };
  (window as any).__gemmaStage = stageObj; // debug/Playwright handle
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
};

const setBusy = (busy: boolean) => {
  els.speakStream.disabled = busy;
  els.speakBlob.disabled = busy;
};

async function speakStreaming() {
  if (!stage) return;
  stopPlayback();
  setBusy(true);
  els.mTtfa.textContent = "…";
  els.mTotal.textContent = "…";
  els.mAudio.textContent = "…";
  try {
    await stage.head.audioCtx.resume();
    abort = new AbortController();
    const t0 = performance.now();
    const response = await fetch(`${els.service.value}/v1/audio/speech/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: els.text.value,
        voice: els.voice.value,
        model: "qwen",
        streaming_interval: 0.6,
      }),
      signal: abort.signal,
    });
    if (!response.ok || !response.body) {
      fail(`stream request failed (HTTP ${response.status})`);
    }
    const srcRate = Number(response.headers.get("X-Sample-Rate") || "24000");
    const decoder = new PcmDecoder();
    const resampler = new LinearResampler(srcRate, stage.ctxRate);
    const reader = response.body!.getReader();
    let firstAudioAt = 0;
    let srcSamples = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;
      if (!firstAudioAt) {
        firstAudioAt = performance.now() - t0;
        result.lastTtfaMs = firstAudioAt;
        els.mTtfa.textContent = `${(firstAudioAt / 1000).toFixed(2)}s`;
        log(`streaming: first audio after ${(firstAudioAt / 1000).toFixed(2)}s`);
      }
      const f32 = decoder.push(value);
      srcSamples += f32.length;
      const resampled = resampler.push(f32);
      stage.player.port.postMessage({ type: "chunk", samples: resampled }, [
        resampled.buffer,
      ]);
    }
    const total = (performance.now() - t0) / 1000;
    els.mTotal.textContent = `${total.toFixed(2)}s`;
    els.mAudio.textContent = `${(srcSamples / srcRate).toFixed(2)}s`;
    log(
      `streaming: done — ${total.toFixed(2)}s request for ${(srcSamples / srcRate).toFixed(2)}s of audio`,
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
  els.mTtfa.textContent = "…";
  els.mTotal.textContent = "…";
  els.mAudio.textContent = "…";
  try {
    await stage.head.audioCtx.resume();
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
    if (!response.ok) fail(`blob request failed (HTTP ${response.status})`);
    const bytes = await response.arrayBuffer();
    const buffer = await stage.head.audioCtx.decodeAudioData(bytes);
    const ttfa = performance.now() - t0;
    result.lastTtfaMs = ttfa;
    els.mTtfa.textContent = `${(ttfa / 1000).toFixed(2)}s`;
    els.mTotal.textContent = `${(ttfa / 1000).toFixed(2)}s`;
    els.mAudio.textContent = `${buffer.duration.toFixed(2)}s`;
    log(`blob: first audio after ${(ttfa / 1000).toFixed(2)}s (full WAV then play)`);
    // Same graph as the streaming path so visemes behave identically.
    blobSource = stage.head.audioCtx.createBufferSource();
    blobSource.buffer = buffer;
    blobSource.connect(stage.head.audioAnalyzerNode);
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

async function loadVoiceOptions() {
  try {
    const response = await fetch(`${els.service.value}/v1/audio/voices`);
    if (!response.ok) return;
    const data = await response.json();
    const names: string[] = (data?.voices ?? [])
      .map((voice: any) => (typeof voice === "string" ? voice : voice?.name))
      .filter(Boolean);
    els.voiceOptions.innerHTML = names
      .map((name) => `<option value="${name}"></option>`)
      .join("");
    log(`voices: ${names.length} available (${names.slice(0, 6).join(", ")}…)`);
  } catch {
    log("voices: listing unavailable (manifest names still work)");
  }
}

async function run() {
  try {
    stage = await initStage();
  } catch (error) {
    fail(error);
  }
  void loadVoiceOptions();
  els.speakStream.addEventListener("click", () => void speakStreaming());
  els.speakBlob.addEventListener("click", () => void speakBlob());
  els.stop.addEventListener("click", () => {
    stopPlayback();
    setBusy(false);
    setStatus("Stopped.");
  });
}

void run();
