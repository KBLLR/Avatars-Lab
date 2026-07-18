import fs from "node:fs";
import { chromium } from "playwright";

const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const localUrl = option("--local-url", "http://127.0.0.1:5185/gemma-avatar.html");
const referenceUrl = option(
  "--reference-url",
  "https://victor-gemma-avatar.hf.space/?fakemic=1",
);
const outputPath = option("--output", "");
const includeReferenceTurn = process.argv.includes("--reference-turn");
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});

async function measureLocal() {
  const context = await browser.newContext();
  const page = await context.newPage();
  const startedAt = performance.now();
  await page.goto(localUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__gemmaAvatarResult?.ready === true, null, {
    timeout: 45_000,
  });
  const readyMs = performance.now() - startedAt;
  await page.locator("#text").fill("Hello operator.");
  await page.locator("#speak-stream").click();
  await page.waitForFunction(() => window.__gemmaAvatarResult?.lastTtfaMs > 0, null, {
    timeout: 45_000,
  });
  const result = await page.evaluate(() => window.__gemmaAvatarResult);
  await context.close();
  return {
    url: localUrl,
    visual_ready_ms: Number(readyMs.toFixed(1)),
    first_audio_ms: Number(result.lastTtfaMs.toFixed(1)),
    capability: result.capability,
    renderer: result.renderer,
    errors: result.errors,
  };
}

async function measureReference() {
  const context = await browser.newContext();
  const page = await context.newPage();
  const startedAt = performance.now();
  await page.goto(referenceUrl, { waitUntil: "domcontentloaded" });
  await page.locator("#stage canvas").waitFor({ state: "visible", timeout: 45_000 });
  await page.locator("#main-btn").waitFor({ state: "visible", timeout: 45_000 });
  await page.waitForFunction(() => !document.querySelector("#main-btn")?.disabled, null, {
    timeout: 45_000,
  });
  const result = {
    url: referenceUrl,
    visual_ready_ms: Number((performance.now() - startedAt).toFixed(1)),
    response_audio_ms: null,
    status: "visual-ready",
    error: null,
  };

  if (includeReferenceTurn) {
    try {
      await page.locator("#main-btn").click();
      await page.waitForFunction(
        () => ["connected", "user-speaking"].includes(window.getClient?.()?._status),
        null,
        { timeout: 90_000 },
      );
      const responseStartedAt = performance.now();
      await page.evaluate(() => window.getClient().requestResponse());
      await page.waitForFunction(() => window.getClient?.()?._status === "ai-speaking", null, {
        timeout: 90_000,
      });
      result.response_audio_ms = Number((performance.now() - responseStartedAt).toFixed(1));
      result.status = "response-observed";
    } catch (error) {
      result.status = "reference-turn-unavailable";
      result.error = error instanceof Error ? error.message : String(error);
    }
  }

  await context.close();
  return result;
}

try {
  const report = {
    schema: "avatar-labs.gemma-avatar-benchmark.v1",
    measured_at: new Date().toISOString(),
    comparison_scope: {
      equivalent: false,
      local: "text to local Qwen TTS stream to audio-driven visemes",
      reference: "microphone to STT to Gemma to Qwen TTS to audio-driven visemes",
    },
    local: await measureLocal(),
    reference: await measureReference(),
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) fs.writeFileSync(outputPath, json);
  process.stdout.write(json);
} finally {
  await browser.close();
}
