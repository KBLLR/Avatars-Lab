import { expect, test } from "@playwright/test";

const workbenchRoutes = [
  "/engine-lab.html",
  "/mocap-lab.html",
  "/said-face.html",
  "/face-mirror.html",
  "/stage.html",
  "/dance-studio.html",
  "/gestures-lab.html",
  "/multi-modal.html",
];

const avatarRoutes = [
  { path: "/stage.html", ready: /Avatar ready/ },
  { path: "/dance-studio.html", ready: /Dance Studio ready/ },
  { path: "/gestures-lab.html", ready: /^Ready$/ },
  { path: "/multi-modal.html" },
];

test("all legacy cases expose the shared workbench shell", async ({ browser }) => {
  for (const path of workbenchRoutes) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route("**/avatars/*.glb", (route) => route.abort());
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".case-workbench-bar")).toBeVisible();
    await expect(page.locator(".case-workbench-bar__picker select")).toHaveValue(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
    await page.close();
  }
});

test("Stage Director adopts Gateway audio defaults without Vite model variables", async ({ page }) => {
  await page.route("**/v1/models", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      object: "list",
      data: [
        { id: "text/test-director", _service: "mlx-llm", loaded: true },
        { id: "stt/test-whisper", _service: "mlx-audio", _audio_lane: "stt", loaded: true, is_default: true },
        { id: "tts/test-voice", _service: "mlx-audio", _audio_lane: "tts", loaded: true, is_default: true }
      ]
    })
  }));

  await page.goto("/stage.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#sttModelSelect")).toHaveValue("stt/test-whisper");
  await expect(page.locator("#ttsModelSelect")).toHaveValue("tts/test-voice");
  await expect(page.locator("#sttChip")).toContainText("stt/test-whisper");
});

test("Stage Director exposes one direct, stateful workflow", async ({ page }) => {
  await page.route("**/v1/models", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      object: "list",
      data: [
        { id: "text/test-director", _service: "mlx-llm", loaded: true, is_default: true },
        { id: "stt/test-whisper", _service: "mlx-audio", _audio_lane: "stt", loaded: true, is_default: true },
        { id: "tts/test-voice", _service: "mlx-audio", _audio_lane: "tts", loaded: true, is_default: true }
      ]
    })
  }));
  await page.route("**/query?**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ items: [], total: 0, limit: 100, offset: 0 })
  }));

  await page.goto("/stage.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#cardAudio .card-header")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#cardAudio .card-body")).toBeVisible();
  await expect(page.locator("#transcribeBtn")).toBeDisabled();
  await expect(page.locator("#analyzeBtn")).toBeDisabled();
  await expect(page.locator("#stagePlayBtn")).toBeDisabled();
  await expect(page.locator("#stageLipsyncBtn")).toBeDisabled();
  await expect(page.locator("#playBtn, #lipsyncBtn, #stopBtn")).toHaveCount(0);

  await page.locator("#cardCamera .card-header").click();
  await expect(page.locator("#cardCamera .card-header")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#cardCamera .card-body")).toBeVisible();
  await expect(page.locator("#cardAudio .card-body")).toBeHidden();
});

test("GPT-OSS Harmony plans parse before generic JSON repair", async ({ page }) => {
  await page.goto("/stage.html", { waitUntil: "domcontentloaded" });
  const parsed = await page.evaluate(async () => {
    const { parseDirectorResponse } = await import("/src/llm/streaming-parser.ts");
    const raw = JSON.stringify({
      thoughts_summary: "Keep valid string punctuation such as camera: close.",
      plan: {
        title: "Valid Harmony Plan",
        sections: [{
          label: "Intro",
          start_ms: 0,
          end_ms: 1000,
          role: "solo",
          notes: "camera: close"
        }]
      }
    });
    return parseDirectorResponse(raw, 1000, { modelId: "text/gpt-oss-20b-mxfp4-q8" });
  });

  expect(parsed?.plan.title).toBe("Valid Harmony Plan");
  expect(parsed?.plan.sections).toHaveLength(1);
  expect(parsed?.plan.sections[0].notes).toBe("camera: close");
});

test("performance records use Warehouse query and publish contracts", async ({ page }) => {
  const published = [];
  await page.route("**/query?**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      items: [{
        id: "avatar-performance-existing",
        path: "houses/avatar-labs/performances/2026-07-18/existing.json",
        filename: "existing.json",
        display_name: "Existing Performance",
        modified_at: "2026-07-18T00:00:00Z"
      }],
      total: 1,
      limit: 100,
      offset: 0
    })
  }));
  await page.route("**/publish", async (route) => {
    published.push(JSON.parse(route.request().postData() || "{}"));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ id: "avatar-performance-test", kind: "performance", source: "stage-director", tier: "T0-local", operation_id: "op-test", enrichment: { status: "skipped", warnings: [], provider: "warehouse-local", model: null } })
    });
  });

  await page.goto("/stage.html", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(async () => {
    const { createPerformanceStore } = await import("/src/data-pool/store.ts");
    const store = createPerformanceStore({ baseUrl: "http://127.0.0.1:5202" });
    const items = await store.list();
    await store.save({
      id: "test",
      title: "Contract Test",
      createdAt: "2026-07-18T00:00:00Z",
      transcriptText: "Hello",
      wordTimings: null,
      plan: null,
      planSource: "none",
      directorNotes: "",
      analysisSeed: null,
      directorStyle: "cinematic",
      models: {},
      audio: null
    });
    return items;
  });

  expect(result).toEqual([expect.objectContaining({ id: "avatar-performance-existing", name: "Existing Performance" })]);
  expect(published).toHaveLength(1);
  expect(published[0]).toEqual(expect.objectContaining({
    kind: "performance",
    source: "stage-director",
    house: "avatar-labs",
    enrich: false
  }));
  expect(published[0].capabilities.stage_director_record.title).toBe("Contract Test");
});

test("Stage Director keeps the complete canvas inside desktop viewports", async ({ browser }) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
    { width: 1800, height: 1116 },
  ]) {
    const page = await browser.newPage({ viewport });
    await page.goto("/stage.html", { waitUntil: "domcontentloaded" });
    const stage = await page.locator("#stage").boundingBox();
    const panel = await page.locator("#panel").boundingBox();

    await expect(page.locator(".case-workbench-bar__identity strong")).toHaveText("Stage Director");
    await expect(page.locator(".stage-column h1, .stage-column h2, #panel > h1")).toHaveCount(0);
    expect(stage).not.toBeNull();
    expect(panel).not.toBeNull();
    expect(Math.round(stage.y)).toBe(60);
    expect(Math.round(stage.y + stage.height)).toBeLessThanOrEqual(viewport.height - 20);
    expect(Math.round(panel.y + panel.height)).toBeLessThanOrEqual(viewport.height - 20);
    await page.close();
  }
});

for (const route of avatarRoutes) {
  test(`${route.path} loads a real full-body avatar`, async ({ page }) => {
    const errors = [];
    const failedModels = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("requestfailed", (request) => {
      if (request.url().endsWith(".glb")) failedModels.push(request.url());
    });

    await page.goto(route.path, { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.locator("#avatarSelect option").count(), {
      timeout: 45_000,
    }).toBeGreaterThan(0);
    if (route.ready) {
      await expect(page.locator("#status")).toHaveText(route.ready, { timeout: 45_000 });
    }
    await expect(page.locator("#avatar canvas")).toBeVisible();

    const canvas = page.locator("#avatar canvas");
    const box = await canvas.boundingBox();
    expect(box?.width).toBeGreaterThan(120);
    expect(box?.height).toBeGreaterThan(120);
    expect(failedModels).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("workbench cases remain contained on mobile", async ({ browser }) => {
  for (const path of workbenchRoutes) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route("**/avatars/*.glb", (route) => route.abort());
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".case-workbench-bar")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(844);
    await page.close();
  }
});
