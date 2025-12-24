import fs from "node:fs";
import path from "node:path";
import { getConfig, assertNoOpenAIKey } from "./lib/config.mjs";
import { fetchJson, fetchWithTimeout } from "./lib/http.mjs";
import { parseWav } from "./lib/wav.mjs";
import { wordOverlapScore } from "./lib/text.mjs";
import { findLatestEventFile, readEventsSince } from "./lib/eventlog.mjs";

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const fail = (message) => {
  throw new Error(message);
};

const main = async () => {
  assertNoOpenAIKey();
  const config = getConfig();
  const startedAt = Date.now();

  if (!config.llmBaseUrl) {
    fail("LLM base URL missing. Set MLX_LLM_BASE_URL or update services.manifest.json.");
  }
  if (!config.audioBaseUrl) {
    fail("Audio base URL missing. Set MLX_AUDIO_BASE_URL or update services.manifest.json.");
  }
  if (!config.defaultTtsModel) {
    fail("TTS model missing. Set MLX_DEFAULT_TTS_MODEL or update model-zoo/registry.json.");
  }

  console.log("[contract] LLM base:", config.llmBaseUrl);
  console.log("[contract] Audio base:", config.audioBaseUrl);
  console.log("[contract] TTS model:", config.defaultTtsModel);
  console.log("[contract] STT model:", config.defaultSttModel || "(none)");

  const llmHealth = await fetchJson(`${config.llmBaseUrl}/health`);
  if (!llmHealth.response.ok) {
    fail(`LLM /health failed (${llmHealth.response.status}). Is mlx-services/llm running?`);
  }

  const llmModels = await fetchJson(`${config.llmBaseUrl}/v1/models`);
  if (!llmModels.response.ok) {
    fail(`LLM /v1/models failed (${llmModels.response.status}).`);
  }
  if (!Array.isArray(llmModels.json?.data) && !Array.isArray(llmModels.json)) {
    fail("LLM /v1/models returned unexpected payload.");
  }

  const audioHealth = await fetchJson(`${config.audioBaseUrl}/health`);
  if (!audioHealth.response.ok) {
    fail(`Audio /health failed (${audioHealth.response.status}). Is mlx-services/audio running?`);
  }

  const promptPath = path.join(config.repoRoot, "houses", "avatar-labs", "fixtures", "prompts", "tts_prompt.txt");
  const promptText = fs.readFileSync(promptPath, "utf-8").trim();

  const ttsResponse = await fetchWithTimeout(`${config.audioBaseUrl}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.defaultTtsModel,
      input: promptText,
      voice: config.defaultTtsVoice,
      response_format: "wav",
      speed: 1.0
    })
  });

  if (!ttsResponse.ok) {
    const detail = await ttsResponse.text();
    fail(`TTS failed (${ttsResponse.status}): ${detail}`);
  }

  const audioBytes = await ttsResponse.arrayBuffer();
  const wavInfo = parseWav(audioBytes);
  if (!wavInfo.sampleRate || wavInfo.dataSize <= 0) {
    fail("Generated WAV is invalid or empty.");
  }

  const resultsDir = path.join(config.repoRoot, "houses", "avatar-labs", "results", "contract");
  ensureDir(resultsDir);
  const wavPath = path.join(resultsDir, "tts.wav");
  fs.writeFileSync(wavPath, Buffer.from(audioBytes));
  console.log("[contract] Wrote TTS audio:", wavPath);

  const sttReady = audioHealth.json?.stt_ready !== false;
  if (sttReady && config.defaultSttModel) {
    const form = new FormData();
    const blob = new Blob([audioBytes], { type: "audio/wav" });
    form.append("file", blob, "tts.wav");
    form.append("model", config.defaultSttModel);

    const sttResponse = await fetchWithTimeout(`${config.audioBaseUrl}/v1/audio/transcriptions`, {
      method: "POST",
      body: form
    });

    if (!sttResponse.ok) {
      const detail = await sttResponse.text();
      fail(`STT failed (${sttResponse.status}): ${detail}`);
    }

    const sttPayload = await sttResponse.json();
    const transcript = sttPayload?.text || "";
    if (!transcript) {
      fail("STT returned empty transcript.");
    }

    const score = wordOverlapScore(promptText, transcript);
    if (score < 0.25) {
      fail(`STT similarity too low (${score.toFixed(2)}). Transcript: ${transcript}`);
    }
    console.log("[contract] STT similarity:", score.toFixed(2));
  } else {
    console.log("[contract] STT skipped (stt_ready=false or model missing)");
  }

  const audioEventsFile = findLatestEventFile(config.dataPoolRoot, "audio");
  const recentEvents = readEventsSince(audioEventsFile, startedAt);
  const hasSpeechEvent = recentEvents.some((event) => event.event_type === "gen_ai.speech");
  const hasTranscriptionEvent = recentEvents.some((event) => event.event_type === "gen_ai.transcription");

  if (!hasSpeechEvent) {
    fail("No gen_ai.speech events found in data-pool/events/audio. Verify data-pool logging.");
  }

  if (sttReady && config.defaultSttModel && !hasTranscriptionEvent) {
    fail("No gen_ai.transcription events found in data-pool/events/audio.");
  }

  console.log("[contract] Event logs verified:", audioEventsFile || "(none)");
  console.log("[contract] Success.");
};

main().catch((error) => {
  console.error("Contract tests failed:", error.message || error);
  process.exit(1);
});
