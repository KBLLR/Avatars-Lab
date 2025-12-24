import { HeadAudio } from "@met4citizen/headaudio/dist/headaudio.min.mjs";
import workletUrl from "@met4citizen/headaudio/dist/headworklet.min.mjs?url";
import modelUrl from "@met4citizen/headaudio/dist/model-en-mixed.bin?url";
import audioUrl from "../fixtures/audio/hello.wav?url";

const statusEl = document.getElementById("status");
const metricsEl = document.getElementById("metrics");

const result = {
  ready: false,
  eventCount: 0,
  keys: new Set<string>(),
  errors: [] as string[]
};

window.__headaudioResult = result;

const updateStatus = (text: string) => {
  if (statusEl) statusEl.textContent = text;
};

const updateMetrics = (text: string) => {
  if (metricsEl) metricsEl.textContent = text;
};

const fail = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  result.errors.push(message);
  updateStatus(`Error: ${message}`);
  throw error instanceof Error ? error : new Error(message);
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

async function run() {
  updateStatus("Loading audio worklet...");

  if (!window.AudioContext) {
    fail("AudioContext unavailable in this browser.");
  }

  const audioCtx = new AudioContext({ sampleRate: 16000 });
  await audioCtx.audioWorklet.addModule(workletUrl);
  await audioCtx.resume();

  const headaudio = new HeadAudio(audioCtx, {
    processorOptions: {
      visemeEventsEnabled: true
    }
  });

  updateStatus("Loading HeadAudio model...");
  await headaudio.loadModel(modelUrl);

  const response = await fetch(audioUrl);
  if (!response.ok) {
    fail(`Failed to load audio fixture: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const audioBuffer = await audioCtx.decodeAudioData(buffer.slice(0));

  const source = audioCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(headaudio);
  source.connect(audioCtx.destination);

  let lastTime = performance.now();
  let running = true;

  headaudio.onvalue = (key: string, value: number) => {
    const clamped = clamp(value, 0, 1);
    if (clamped !== value) return;
    result.eventCount += 1;
    result.keys.add(key);
    updateMetrics(`Viseme events: ${result.eventCount} | Keys: ${result.keys.size}`);
  };

  const tick = () => {
    if (!running) return;
    const now = performance.now();
    const dt = now - lastTime;
    lastTime = now;
    headaudio.update(dt);
    requestAnimationFrame(tick);
  };

  source.onended = () => {
    running = false;
    const keyCount = result.keys.size;
    if (result.eventCount >= 6 && keyCount >= 2) {
      result.ready = true;
      updateStatus(`HeadAudio ready: ${result.eventCount} events, ${keyCount} keys`);
    } else {
      fail("HeadAudio produced insufficient viseme events.");
    }
  };

  updateStatus("Playing fixture audio...");
  requestAnimationFrame(tick);
  source.start();

  setTimeout(() => {
    if (!result.ready && running) {
      running = false;
      fail("HeadAudio timed out waiting for viseme events.");
    }
  }, 8000);
}

run().catch((error) => {
  console.error("HeadAudio harness failed:", error);
});
