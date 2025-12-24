import { fetchJson } from "./lib/http.mjs";
import { assertNoOpenAIKey } from "./lib/config.mjs";

const bridgeBaseUrl = process.env.HEADTTS_BRIDGE_URL || "http://127.0.0.1:6677";

const fail = (message) => {
  throw new Error(message);
};

const main = async () => {
  assertNoOpenAIKey();

  const payload = {
    input: "Avatar labs bridge smoke test.",
    voice: "default",
    language: "en-us",
    speed: 1.0,
    audioEncoding: "wav"
  };

  const { response, json, text } = await fetchJson(`${bridgeBaseUrl}/v1/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }, 10000);

  if (!response.ok) {
    fail(`Bridge response failed (${response.status}). Start it with node packages/headtts-bridge/server.mjs`);
  }

  if (!json || typeof json.audio !== "string") {
    fail(`Bridge response missing audio field: ${text}`);
  }

  if (!Array.isArray(json.words) || !Array.isArray(json.wtimes) || !Array.isArray(json.wdurations)) {
    fail("Bridge response missing word timing arrays.");
  }

  if (json.words.length !== json.wtimes.length || json.words.length !== json.wdurations.length) {
    fail("Bridge word timing arrays length mismatch.");
  }

  if (json.audioEncoding !== "wav") {
    fail(`Bridge audioEncoding mismatch: ${json.audioEncoding}`);
  }

  console.log("[bridge] Response shape validated.");
};

main().catch((error) => {
  console.error("Bridge spec test failed:", error.message || error);
  process.exit(1);
});
