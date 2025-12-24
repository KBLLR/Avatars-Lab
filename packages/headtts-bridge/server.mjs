import http from "node:http";
import { getConfig, assertNoOpenAIKey } from "../tests/lib/config.mjs";
import { parseWav } from "../tests/lib/wav.mjs";

const config = getConfig();
const port = Number(process.env.HEADTTS_BRIDGE_PORT || 6677);
const audioBaseUrl = process.env.MLX_AUDIO_BASE_URL || config.audioBaseUrl;
const ttsModel = process.env.MLX_DEFAULT_TTS_MODEL || config.defaultTtsModel;
const ttsVoice = process.env.MLX_DEFAULT_TTS_VOICE || config.defaultTtsVoice || "default";

const sendJson = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(payload));
};

const parseBody = (req) =>
  new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });

const wordsFromText = (text) =>
  text
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const buildTimings = (wordCount, durationMs) => {
  if (wordCount === 0) return { words: [], wtimes: [], wdurations: [] };
  const perWord = durationMs / wordCount;
  const words = [];
  const wtimes = [];
  const wdurations = [];
  for (let i = 0; i < wordCount; i += 1) {
    wtimes.push(Math.round(i * perWord));
    wdurations.push(Math.round(perWord));
    words.push(null);
  }
  return { words, wtimes, wdurations };
};

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }

  if (req.url === "/health" && req.method === "GET") {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (req.url === "/v1/hello" && req.method === "GET") {
    res.statusCode = 200;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.end("HeadTTS Bridge v0.1.0");
    return;
  }

  if (req.url === "/v1/synthesize" && req.method === "POST") {
    try {
      assertNoOpenAIKey();
      if (!audioBaseUrl) {
        throw new Error("MLX_AUDIO_BASE_URL missing.");
      }
      if (!ttsModel) {
        throw new Error("MLX_DEFAULT_TTS_MODEL missing.");
      }

      const raw = await parseBody(req);
      const payload = JSON.parse(raw || "{}");
      const input = Array.isArray(payload.input) ? payload.input.join(" ") : payload.input || "";
      const voice = payload.voice || ttsVoice;
      const speed = payload.speed ?? 1.0;
      const audioEncoding = payload.audioEncoding || "wav";

      const ttsResponse = await fetch(`${audioBaseUrl}/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ttsModel,
          input,
          voice,
          response_format: "wav",
          speed
        })
      });

      if (!ttsResponse.ok) {
        const detail = await ttsResponse.text();
        sendJson(res, 422, { error: `MLX TTS failed (${ttsResponse.status}): ${detail}` });
        return;
      }

      const wavBuffer = Buffer.from(await ttsResponse.arrayBuffer());
      const wavInfo = parseWav(wavBuffer.buffer.slice(wavBuffer.byteOffset, wavBuffer.byteOffset + wavBuffer.byteLength));
      const durationMs = Math.round((wavInfo.durationSec || 0) * 1000);

      const wordList = wordsFromText(input);
      const timings = buildTimings(wordList.length, durationMs);
      const words = wordList.length ? wordList : timings.words;
      const wtimes = timings.wtimes;
      const wdurations = timings.wdurations;

      let audioPayload = wavBuffer;
      if (audioEncoding === "pcm") {
        const start = wavInfo.dataOffset;
        const end = wavInfo.dataOffset + wavInfo.dataSize;
        audioPayload = wavBuffer.slice(start, end);
      }

      sendJson(res, 200, {
        audio: audioPayload.toString("base64"),
        audioEncoding: audioEncoding === "pcm" ? "pcm" : "wav",
        words,
        wtimes,
        wdurations,
        visemes: [],
        vtimes: [],
        vdurations: [],
        phonemes: []
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message || "Invalid request" });
    }
    return;
  }

  res.statusCode = 404;
  res.end("Not Found");
});

server.listen(port, () => {
  console.log(`HeadTTS bridge listening on http://127.0.0.1:${port}`);
});
