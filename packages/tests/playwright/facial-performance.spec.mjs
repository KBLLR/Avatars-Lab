import { expect, test } from "@playwright/test";

const makeTestWav = (durationSeconds = 1, sampleRate = 8_000) => {
  const sampleCount = durationSeconds * sampleRate;
  const buffer = Buffer.alloc(44 + sampleCount * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + sampleCount * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) {
    buffer.writeInt16LE(Math.round(Math.sin(index / sampleRate * Math.PI * 2 * 220) * 9_000), 44 + index * 2);
  }
  return buffer;
};

test("SAiD Face generates and plays ARKit frames on a portrait head", async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors = [];
  let requestFields = null;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/said/health", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ services: { said: { status: "healthy" } } }),
  }));
  await page.route("**/api/said/v1/audio/blendshapes", async (route) => {
    const request = route.request();
    requestFields = await request.postDataBuffer();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        fps: 60,
        num_frames: 60,
        frames: Array.from({ length: 60 }, (_, frame) => ({
          frame,
          jawOpen: frame / 120,
          mouthSmileLeft: frame / 240,
          mouthSmileRight: frame / 240,
        })),
        timings_ms: { total: 420 },
      }),
    });
  });

  await page.goto("/said-face.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__saidFaceResult?.ready === true, null, { timeout: 60_000 });
  await expect(page.locator("#serviceMetric")).toHaveText("healthy");
  await expect(page.locator("#pedestalMetric")).toHaveText("studio plinth");
  await page.locator("#steps").fill("4");
  await page.locator("#audioFile").setInputFiles({
    name: "portrait-test.wav",
    mimeType: "audio/wav",
    buffer: makeTestWav(),
  });
  await page.locator("#generateButton").click();
  await expect(page.locator("#framesMetric")).toHaveText("60");
  await expect(page.locator("#fpsMetric")).toHaveText("60 fps");
  await expect(page.locator("#timingMetric")).toHaveText("420 ms");
  expect(requestFields?.length).toBeGreaterThan(0);
  await page.locator("#playButton").click();
  await expect.poll(() => page.evaluate(() => window.__saidFaceResult?.playing)).toBe(true);
  await expect(page.locator("#stageStatus")).toContainText("Playing SAiD facial performance");
  expect(pageErrors).toEqual([]);
});

test("Face Mirror loads the local Google model and keeps camera capture opt-in", async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const context = canvas.getContext("2d");
    context.fillStyle = "#188900";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const stream = canvas.captureStream(12);
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => stream,
    });
    window.__avatarLabsFakeCamera = { canvas, stream };
  });

  await page.goto("/face-mirror.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__faceMirrorResult?.ready === true, null, { timeout: 60_000 });
  await expect(page.locator("#modelMetric")).toHaveText("local / GPU");
  await expect(page.locator("#captureMetric")).toHaveText("off");
  await expect(page.locator("#pedestalMetric")).toHaveText("studio plinth");
  await page.locator("#startButton").click();
  await expect(page.locator("#captureMetric")).toHaveText("live / transient");
  await expect(page.locator("#stageStatus")).toContainText("Face Mirror live");
  await page.locator("#stopButton").click();
  await expect(page.locator("#captureMetric")).toHaveText("off");
  expect(pageErrors).toEqual([]);
});
