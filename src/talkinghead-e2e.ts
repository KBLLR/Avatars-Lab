import { TalkingHead } from "@met4citizen/talkinghead";
import lipsyncEnUrl from "@met4citizen/talkinghead/modules/lipsync-en.mjs?url";
import avatarUrl from "../fixtures/avatars/brunette.glb?url";
import promptUrl from "../fixtures/prompts/tts_prompt.txt?url";

const statusEl = document.getElementById("status");
const metricsEl = document.getElementById("metrics");
const eventsEl = document.getElementById("events");

const result = {
  ready: false,
  skipped: false,
  skipReason: "",
  playbackStarted: false,
  playbackEnded: false,
  renderFrames: 0,
  lipsyncActive: false,
  errors: []
};

window.__talkingHeadResult = result;

const updateStatus = (text) => {
  if (statusEl) statusEl.textContent = text;
};

const updateMetrics = (text) => {
  if (metricsEl) metricsEl.textContent = text;
};

const updateEvents = () => {
  if (eventsEl) eventsEl.textContent = `Events: ${result.renderFrames}`;
};

const fail = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  result.errors.push(message);
  updateStatus(`Error: ${message}`);
  throw error instanceof Error ? error : new Error(message);
};

const getConfig = () => {
  const audioBaseUrl = import.meta.env.VITE_MLX_AUDIO_BASE_URL;
  const ttsModel = import.meta.env.VITE_MLX_DEFAULT_TTS_MODEL;
  const ttsVoice = import.meta.env.VITE_MLX_DEFAULT_TTS_VOICE || "default";

  if (!audioBaseUrl) {
    fail("VITE_MLX_AUDIO_BASE_URL is not set.");
  }
  if (!ttsModel) {
    fail("VITE_MLX_DEFAULT_TTS_MODEL is not set.");
  }

  return { audioBaseUrl, ttsModel, ttsVoice };
};

const audioBufferToPCM16 = (buffer) => {
  const channel = buffer.getChannelData(0);
  const pcm = new Int16Array(channel.length);
  for (let i = 0; i < channel.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, channel[i]));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return pcm.buffer;
};

const hasLipsync = (head) => {
  const queue = head?.animQueue || [];
  return queue.some((item) => item?.template?.name === "viseme" || item?.template?.name === "subtitles");
};

const ensureLipsync = async (head) => {
  const module = await import(/* @vite-ignore */ lipsyncEnUrl);
  if (!head.lipsync) {
    head.lipsync = {};
  }
  head.lipsync.en = new module.LipsyncEn();
};

async function run() {
  const webgl = document.createElement("canvas").getContext("webgl");
  if (!webgl) {
    result.skipped = true;
    result.skipReason = "WebGL unavailable";
    updateStatus("Skipping: WebGL unavailable.");
    return;
  }

  const config = getConfig();
  updateStatus("Loading prompt + avatar...");

  const promptResponse = await fetch(promptUrl);
  if (!promptResponse.ok) {
    fail(`Failed to load prompt: ${promptResponse.status}`);
  }
  const promptText = (await promptResponse.text()).trim();

  const avatarContainer = document.getElementById("avatar");
  if (!avatarContainer) {
    fail("Avatar container missing.");
  }

  const head = new TalkingHead(avatarContainer, {
    ttsEndpoint: "none",
    cameraView: "upper",
    lipsyncLang: "en",
    lipsyncModules: []
  });
  await ensureLipsync(head);

  await head.showAvatar({
    url: avatarUrl,
    body: "F",
    lipsyncLang: "en"
  });

  updateStatus("Avatar loaded. Requesting MLX TTS...");

  const ttsResponse = await fetch(`${config.audioBaseUrl}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.ttsModel,
      input: promptText,
      voice: config.ttsVoice,
      response_format: "wav",
      speed: 1.0
    })
  });

  if (!ttsResponse.ok) {
    fail(`MLX TTS failed: ${ttsResponse.status}`);
  }

  const wavBuffer = await ttsResponse.arrayBuffer();
  await head.audioCtx.resume();
  const audioBuffer = await head.audioCtx.decodeAudioData(wavBuffer.slice(0));

  const words = promptText.split(/\s+/).slice(0, 24);
  const durationMs = audioBuffer.duration * 1000;
  const perWord = durationMs / Math.max(words.length, 1);
  const wtimes = words.map((_, index) => Math.round(index * perWord));
  const wdurations = words.map(() => Math.round(perWord));

  const pcmBuffer = audioBufferToPCM16(audioBuffer);

  updateStatus("Streaming audio to TalkingHead...");

  await head.streamStart(
    {
      sampleRate: audioBuffer.sampleRate,
      lipsyncType: "words",
      gain: 0.6
    },
    () => {
      result.playbackStarted = true;
      updateStatus("Playback started");
    },
    () => {
      result.playbackEnded = true;
      updateStatus("Playback ended");
    },
    () => {},
    (metrics) => {
      if (!metrics?.data) return;
      updateMetrics(`Queued: ${metrics.data.queuedMs ?? "n/a"} ms | Underruns: ${metrics.data.underrunBlocks ?? 0}`);
    }
  );

  head.streamAudio({
    audio: pcmBuffer,
    words,
    wtimes,
    wdurations
  });

  head.streamNotifyEnd();

  const frameStart = performance.now();
  const frameLoop = () => {
    result.renderFrames += 1;
    updateEvents();
    if (performance.now() - frameStart < 3000) {
      requestAnimationFrame(frameLoop);
    }
  };
  requestAnimationFrame(frameLoop);

  const lipsyncCheckStart = performance.now();
  while (performance.now() - lipsyncCheckStart < 2500) {
    if (hasLipsync(head)) {
      result.lipsyncActive = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  updateStatus("Waiting for playback to finish...");
  const waitStart = performance.now();
  while (!result.playbackEnded && performance.now() - waitStart < 8000) {
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  if (!result.playbackStarted) {
    fail("Playback did not start.");
  }

  if (!result.playbackEnded) {
    fail("Playback did not finish in time.");
  }

  if (result.renderFrames < 30) {
    fail("Render loop did not advance.");
  }

  result.ready = true;
  updateStatus("E2E completed.");
}

run().catch((error) => {
  console.error("TalkingHead E2E failed:", error);
});
