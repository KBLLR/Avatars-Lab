/**
 * Gemma Avatar reference case (2026-07-17).
 *
 * Local re-creation of the architecture in hf.co/spaces/victor/gemma-avatar,
 * with the cloud backend narrowed to the local Core-X audio lane:
 *
 *   text → POST /v1/audio/speech/stream (chunked PCM16, Qwen3-TTS voice clone)
 *        → main-thread Int16→Float32 + linear resample to the ctx rate
 *        → pcm-player AudioWorklet (ring buffer, barge-in via `clear`)
 *        → TalkingHead audio graph (audioAnalyzerNode → speech gain → out)
 *        → HeadAudio taps the speech gain node, classifies MFCC frames into
 *          Oculus visemes (~50 ms) and writes TalkingHead morph targets.
 *
 * This is deliberately a TTS/viseme latency reference, not the hosted
 * microphone, STT, LLM, tool-call, and barge-in conversation pipeline.
 * The "Blob" button reproduces the full-WAV path,
 * then play) through the same graph, so first-audio latency is directly
 * comparable. This page is intentionally one self-contained case: the
 * reusable modules get extracted during the Avatar Labs modernization.
 */

import { TalkingHead } from "@met4citizen/talkinghead";
import { HeadAudio } from "@met4citizen/headaudio/dist/headaudio.min.mjs";
import headWorkletUrl from "@met4citizen/headaudio/dist/headworklet.min.mjs?url";
import headModelUrl from "@met4citizen/headaudio/dist/model-en-mixed.bin?url";
import avatarUrl from "../fixtures/avatars/brunette.glb?url";
import { streamSpeech } from "./runtime/audio-stream";
import { corexClient } from "./runtime/corex-client";
import { upgradeTalkingHeadScene } from "./scene/studio-scene-template";

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
  capability: "tts-viseme-reference",
  renderer: "talkinghead-webgl",
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
  upgradeTalkingHeadScene(head);

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
    const stream = await streamSpeech({
      baseUrl: els.service.value,
      input: els.text.value,
      voice: els.voice.value,
      destinationSampleRate: stage.ctxRate,
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
    const names = (await corexClient.voices()).map((voice) => voice.name);
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
