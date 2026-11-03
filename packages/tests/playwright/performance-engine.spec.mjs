import { expect, test } from "@playwright/test";

const makeTestWav = (durationSeconds = 4, sampleRate = 8_000) => {
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
    const section = Math.floor(index / sampleRate);
    const amplitude = section % 2 === 0 ? 0.24 : 0.72;
    const sample = Math.sin(index / sampleRate * Math.PI * 2 * (220 + section * 55)) * amplitude;
    buffer.writeInt16LE(Math.round(sample * 32767), 44 + index * 2);
  }
  return buffer;
};

test("Fresh launches choose one random full-body actor and restore saved casts only on request", async ({ browser }) => {
  test.setTimeout(180_000);
  const openSeededPage = async (seed) => {
    const context = await browser.newContext();
    const seededPage = await context.newPage();
    const errors = [];
    seededPage.on("pageerror", (error) => errors.push(error.message));
    await seededPage.goto(`/engine-lab.html?actorSeed=${seed}`, { waitUntil: "domcontentloaded" });
    await seededPage.waitForFunction(() => window.__performanceEngineResult?.ready === true, null, { timeout: 150_000 });
    return { context, seededPage, errors };
  };

  const first = await openSeededPage(0.01);
  await expect(first.seededPage.locator("#actorList button")).toHaveCount(1);
  await expect(first.seededPage.locator("#actorList button small")).toHaveText("body");
  const firstAsset = await first.seededPage.locator("#actorAsset").inputValue();
  expect(firstAsset).toMatch(/^body:/);
  await first.seededPage.locator("#addActorButton").click();
  await expect(first.seededPage.locator("#actorList button")).toHaveCount(2, { timeout: 30_000 });
  await first.seededPage.locator("#saveLocalButton").click();
  await first.seededPage.reload({ waitUntil: "domcontentloaded" });
  await first.seededPage.waitForFunction(() => window.__performanceEngineResult?.ready === true, null, { timeout: 150_000 });
  await expect(first.seededPage.locator("#actorList button")).toHaveCount(1);
  await first.seededPage.locator("#restoreProjectButton").click();
  await expect(first.seededPage.locator("#actorList button")).toHaveCount(2, { timeout: 30_000 });
  expect(first.errors).toEqual([]);
  await first.context.close();

  const last = await openSeededPage(0.99);
  await expect(last.seededPage.locator("#actorList button")).toHaveCount(1);
  await expect(last.seededPage.locator("#actorList button small")).toHaveText("body");
  const lastAsset = await last.seededPage.locator("#actorAsset").inputValue();
  expect(lastAsset).toMatch(/^body:/);
  expect(lastAsset).not.toBe(firstAsset);
  expect(last.errors).toEqual([]);
  await last.context.close();

  const quantized = await openSeededPage(0.64);
  await expect(quantized.seededPage.locator("#actorAsset")).toHaveValue("body:lana");
  await quantized.seededPage.waitForTimeout(500);
  expect(quantized.errors).toEqual([]);
  await quantized.context.close();
});

test("Unavailable optional HDRI and physics modules keep the performance room usable", async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors = [];
  let rapierRequests = 0;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/corex-assets/hdri/**", (route) => route.abort("failed"));
  await page.route("**/node_modules/.vite/deps/@dimforge_rapier3d-compat.js*", (route) => {
    rapierRequests += 1;
    return route.abort("failed");
  });

  await page.goto("/engine-lab.html?actorSeed=0.01&renderer=webgl", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__performanceEngineResult?.ready === true, null, {
    timeout: 150_000,
  });

  const result = await page.evaluate(() => window.__performanceEngineResult);
  expect(result.actorsReady).toBe(1);
  expect(result.errors).toEqual([]);
  expect(pageErrors).toEqual([]);
  await expect(page.locator("#performanceViewport canvas")).toBeVisible();
  await page.selectOption("#stageShaderSelect", "pulse");
  await page.selectOption("#stageParticlesSelect", "sparks");
  await page.selectOption("#stagePhysicsSelect", "confetti");
  await page.locator("#applyStageFxButton").click();
  await expect.poll(() => rapierRequests).toBeGreaterThan(0);
  await page.waitForTimeout(250);
  expect((await page.evaluate(() => window.__performanceEngineResult)).errors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("Performance Engine runs a threaded, editable multi-actor production", async ({ page }) => {
  test.setTimeout(180_000);
  const errors = [];
  const failedAssets = [];
  const publishes = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => {
    if (/\.(?:glb|fbx|hdr)(?:\?|$)/.test(request.url())) failedAssets.push(request.url());
  });
  await page.route("http://127.0.0.1:5202/health", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ status: "ok" }),
  }));
  await page.route("http://127.0.0.1:5202/query?**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ items: [], total: 0 }),
  }));
  await page.route("http://127.0.0.1:5202/publish", async (route) => {
    publishes.push(JSON.parse(route.request().postData() || "{}"));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ id: "avatar-performance-project-test" }),
    });
  });

  await page.goto("/engine-lab.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__performanceEngineResult?.ready === true, null, {
    timeout: 150_000,
  });

  const initial = await page.evaluate(() => window.__performanceEngineResult);
  expect(["webgpu", "webgl2-fallback"]).toContain(initial.renderer);
  expect(initial.scheduler).toBe("worker");
  expect(initial.actorsReady).toBe(1);
  expect(initial.errors).toEqual([]);
  await expect(page.locator(".case-workbench-bar__runtime")).toContainText("webgpu");
  await expect(page.locator("#performanceViewport canvas")).toBeVisible();
  await expect(page.locator("#actorList button")).toHaveCount(1);
  await expect(page.locator("#actorList button small")).toHaveText("body");
  await expect(page.locator(".timeline-clip")).toHaveCount(5);
  await expect(page.locator("#cameraModeDirector")).toHaveAttribute("data-active", "true");
  await expect(page.locator("#actorY")).toHaveValue("0");
  await expect(page.locator("#performanceBroadcast")).toBeHidden();

  const renderedStage = await page.locator("#performanceViewport").screenshot();
  const pixelStats = await page.evaluate(async (imageSource) => {
    const image = new Image();
    image.src = imageSource;
    await image.decode();
    const sample = document.createElement("canvas");
    sample.width = 64;
    sample.height = 64;
    const context = sample.getContext("2d");
    context.drawImage(image, 0, 0, 64, 64);
    const pixels = context.getImageData(0, 0, 64, 64).data;
    let minimum = 255;
    let maximum = 0;
    const colors = new Set();
    for (let index = 0; index < pixels.length; index += 16) {
      const luminance = (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
      minimum = Math.min(minimum, luminance);
      maximum = Math.max(maximum, luminance);
      colors.add(`${pixels[index] >> 4}:${pixels[index + 1] >> 4}:${pixels[index + 2] >> 4}`);
    }
    return { luminanceRange: maximum - minimum, colors: colors.size };
  }, `data:image/png;base64,${renderedStage.toString("base64")}`);
  expect(pixelStats.luminanceRange).toBeGreaterThan(28);
  expect(pixelStats.colors).toBeGreaterThan(18);

  await page.locator("#actorY").fill("0.6");
  await page.locator("#actorY").dispatchEvent("change");
  await page.locator("#saveLocalButton").click();
  const verticallyAdjusted = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("avatarLabs.performanceEngine.project.v1") || "null"));
  expect(verticallyAdjusted.actors[0].position.y).toBe(0.6);
  await page.locator("#actorY").fill("0");
  await page.locator("#actorY").dispatchEvent("change");

  const motion = page.locator(".timeline-clip", { hasText: /Standing Neutral|Neutral Idle/ });
  await motion.click();
  await expect(page.locator("#clipInspector")).toBeVisible();
  await expect(page.locator("#selectedClipName")).toContainText(/Standing Neutral|Neutral Idle/);
  await page.locator("#clipStart").fill("1");
  await page.locator("#clipStart").dispatchEvent("change");
  await expect(page.locator("#clipStart")).toHaveValue("1");

  await page.evaluate(() => {
    document.getElementById("addActorButton")?.click();
    document.getElementById("addActorButton")?.click();
  });
  await expect(page.locator("#actorList button")).toHaveCount(2, { timeout: 30_000 });
  await expect.poll(async () => (await page.evaluate(() => window.__performanceEngineResult)).actorsReady).toBe(2);
  await expect(page.locator("#actorList button small")).toHaveText(["body", "body"]);
  await page.selectOption("#actorAsset", "head:kbllr");
  await expect(page.locator("#actorCapability")).toContainText("physical studio plinth");
  await expect(page.locator("#actorCapability")).toContainText("portrait performance");
  await expect(page.locator("#addMotionButton")).toBeDisabled();
  await page.selectOption("#actorShader", "xray");
  await page.locator("#removeActorButton").click();
  await expect(page.locator("#actorList button")).toHaveCount(1);
  await expect(page.locator("#removeActorButton")).toBeDisabled();
  await page.locator("#addActorButton").click();
  await expect(page.locator("#actorList button")).toHaveCount(2, { timeout: 30_000 });
  await expect.poll(async () => (await page.evaluate(() => window.__performanceEngineResult)).actorsReady).toBe(2);
  await page.selectOption("#environmentSelect", "room:neon-grid");
  await expect(page.locator("#environmentSelect")).toHaveValue("room:neon-grid");

  await page.waitForTimeout(550);
  const cameraBefore = (await page.evaluate(() => window.__performanceEngineResult)).cameraPosition;
  await page.locator("#cameraModeOperator").click();
  const canvas = page.locator("#performanceViewport canvas");
  const canvasBounds = await canvas.boundingBox();
  expect(canvasBounds).not.toBeNull();
  await page.mouse.move(canvasBounds.x + canvasBounds.width * 0.62, canvasBounds.y + canvasBounds.height * 0.48);
  await page.mouse.down();
  await page.mouse.move(canvasBounds.x + canvasBounds.width * 0.42, canvasBounds.y + canvasBounds.height * 0.36, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(650);
  const cameraAfter = (await page.evaluate(() => window.__performanceEngineResult)).cameraPosition;
  expect((await page.evaluate(() => window.__performanceEngineResult)).cameraAuthority).toBe("operator");
  expect(Math.hypot(
    cameraAfter.x - cameraBefore.x,
    cameraAfter.y - cameraBefore.y,
    cameraAfter.z - cameraBefore.z,
  )).toBeGreaterThan(0.05);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.mouse.move(canvasBounds.x + canvasBounds.width * 0.5, canvasBounds.y + canvasBounds.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(canvasBounds.x + canvasBounds.width * 0.5, canvasBounds.y + canvasBounds.height * 0.96, { steps: 10 });
    await page.mouse.up();
  }
  await page.waitForTimeout(350);
  expect((await page.evaluate(() => window.__performanceEngineResult)).cameraPosition.y).toBeGreaterThanOrEqual(0.18);

  await page.locator("#playButton").click();
  await expect.poll(async () => Number(await page.locator("#transportScrub").inputValue())).toBeGreaterThan(200);
  await expect(page.locator("#performanceBroadcast")).toBeVisible();
  await expect(page.locator(".performance-broadcast__mark")).toHaveText("CX");
  await expect(page.locator("#performanceBroadcastTitle")).toHaveText("Untitled Performance");
  await expect(page.locator("#performanceBroadcastCast")).not.toHaveText("Cast pending");
  const playingCameraBefore = (await page.evaluate(() => window.__performanceEngineResult)).cameraPosition;
  await page.mouse.move(canvasBounds.x + canvasBounds.width * 0.44, canvasBounds.y + canvasBounds.height * 0.38);
  await page.mouse.down();
  await page.mouse.move(canvasBounds.x + canvasBounds.width * 0.58, canvasBounds.y + canvasBounds.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(650);
  const playingState = await page.evaluate(() => window.__performanceEngineResult);
  expect(playingState.cameraAuthority).toBe("operator");
  expect(Math.hypot(
    playingState.cameraPosition.x - playingCameraBefore.x,
    playingState.cameraPosition.y - playingCameraBefore.y,
    playingState.cameraPosition.z - playingCameraBefore.z,
  )).toBeGreaterThan(0.05);
  expect(Number(await page.locator("#transportScrub").inputValue())).toBeGreaterThan(500);
  await page.locator("#pauseButton").click();
  await expect(page.locator("#performanceBroadcast")).toBeHidden();

  const bounds = await page.evaluate(() => ({
    body: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    viewport: [innerWidth, innerHeight],
    stageBottom: document.getElementById("performanceViewport")?.getBoundingClientRect().bottom,
    timelineBottom: document.getElementById("performanceTimeline")?.getBoundingClientRect().bottom,
    inspectorBottom: document.getElementById("performanceInspector")?.getBoundingClientRect().bottom,
  }));
  expect(bounds.body).toEqual(bounds.viewport);
  expect(bounds.stageBottom).toBeLessThan(bounds.viewport[1]);
  expect(Math.round(bounds.timelineBottom)).toBe(bounds.viewport[1]);
  expect(Math.round(bounds.inspectorBottom)).toBe(bounds.viewport[1]);

  await page.locator("summary").filter({ hasText: "Warehouse" }).click();
  await page.locator("#publishWarehouseButton").click();
  await expect(page.locator("#projectState")).toHaveText("Published");
  expect(publishes).toHaveLength(1);
  expect(publishes[0]).toEqual(expect.objectContaining({
    kind: "performance-project",
    source: "performance-engine",
    house: "avatar-labs",
    enrich: false,
  }));
  expect(publishes[0].capabilities.performance_engine_project.schema)
    .toBe("avatar-labs.performance-project.v1");
  expect(publishes[0].capabilities.performance_engine_project.actors).toHaveLength(2);

  await page.setViewportSize({ width: 820, height: 900 });
  await page.locator("#inspectorToggle").click();
  await expect(page.locator("#performanceInspector")).toHaveClass(/is-open/);
  const mobileBounds = await page.evaluate(() => ({
    body: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    viewport: [innerWidth, innerHeight],
    timelineBottom: document.getElementById("performanceTimeline")?.getBoundingClientRect().bottom,
    inspectorBottom: document.getElementById("performanceInspector")?.getBoundingClientRect().bottom,
  }));
  expect(mobileBounds.body).toEqual(mobileBounds.viewport);
  expect(Math.round(mobileBounds.timelineBottom)).toBe(mobileBounds.viewport[1]);
  expect(Math.round(mobileBounds.inspectorBottom)).toBe(mobileBounds.viewport[1]);
  expect(failedAssets).toEqual([]);
  expect(errors).toEqual([]);
});

test("Performance Director council creates a verified editable show from the complete local library", async ({ page }) => {
  test.setTimeout(180_000);
  const directorRequests = [];
  let bodyActorId = "";
  let stageResponses = 0;

  await page.route("http://127.0.0.1:8090/v1/models", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      data: [{ id: "text/qwen2.5-coder-7b-instruct-4bit", _service: "mlx-llm", loaded: true, is_default: true }],
    }),
  }));
  await page.route("http://127.0.0.1:8090/v1/responses", async (route) => {
    const request = JSON.parse(route.request().postData() || "{}");
    directorRequests.push(request);
    const prompt = String(request.input || "");
    const sections = [0, 1, 2, 3].map((index) => ({
      label: ["Opening", "Development", "Peak", "Finale"][index],
      start_ms: index * 7_500,
      end_ms: (index + 1) * 7_500,
      role: index === 2 ? "ensemble" : "solo",
      mood: index === 2 ? "happy" : "neutral",
      actions: [],
    }));
    let thoughts = "Performance arc ready.";
    if (prompt.includes("PERFORMANCE DIRECTOR")) {
      sections[0].actions = [
        {
          time_ms: 0,
          action: "play_animation",
          args: { animation_id: "invented:unavailable", actor_id: bodyActorId },
        },
        {
          time_ms: 100,
          action: "play_animation",
          args: { animation_id: "rpm:f:arms-hip-hop-dance", actor_id: bodyActorId, loop: true },
        },
      ];
    } else if (prompt.includes("STAGE DIRECTOR")) {
      stageResponses += 1;
      thoughts = "Lighting arc ready.";
      sections.forEach((section, index) => { section.light = index === 2 ? "neon" : "frost"; });
    } else if (prompt.includes("CAMERA DIRECTOR")) {
      thoughts = "Camera coverage ready.";
      sections.forEach((section, index) => {
        section.camera = index === 2 ? "full" : "upper";
        section.notes = `Story beat ${index + 1}: the camera transfers point of view with motivated coverage.`;
        section.actions = index === 2 ? [
          { time_ms: section.start_ms, action: "camera_orbit", args: { angle: 18, duration_ms: 900 } },
          { time_ms: section.start_ms + 3_500, action: "camera_punch", args: { factor: 1.2, duration_ms: 500 } },
        ] : [];
      });
    } else if (prompt.includes("POST-PROCESSING DIRECTOR")) {
      thoughts = "PostFX look ready.";
      sections.forEach((section, index) => { section.effects = index === 2 ? "bloom" : "clean"; });
    }
    let content = JSON.stringify({
      thoughts_summary: thoughts,
      analysis: "A four-part performance.",
      selection_reason: "The brief calls for a clear build and peak.",
      plan: { title: "Verified Motion Show", sections },
    });
    const truncateStageResponse = prompt.includes("STAGE DIRECTOR") && stageResponses === 1;
    if (truncateStageResponse) content = content.slice(0, -90);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: `response-${directorRequests.length}`,
        status: truncateStageResponse ? "incomplete" : "completed",
        incomplete_details: truncateStageResponse ? { reason: "max_output_tokens" } : undefined,
        output: [{ type: "message", content: [{ type: "output_text", text: content }] }],
      }),
    });
  });

  await page.goto("/engine-lab.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__performanceEngineResult?.ready === true, null, { timeout: 150_000 });
  bodyActorId = await page.locator("#actorList button").first().getAttribute("data-actor-id") || "";
  expect(bodyActorId).not.toBe("");
  await expect(page.locator("#actorList button small").first()).toHaveText("body");

  await page.locator("#animationCompatibleOnly").uncheck();
  await expect(page.locator("#animationSelect option")).toHaveCount(39);
  await page.selectOption("#animationRig", "rpm");
  await expect(page.locator("#animationSelect option")).toHaveCount(24);
  await page.selectOption("#animationRig", "all");
  const assetProof = await page.evaluate(async () => {
    const catalog = await fetch("/performance-assets/catalog.json").then((response) => response.json());
    const results = await Promise.all(catalog.animations.map(async (animation) => {
      const response = await fetch(animation.url, { headers: { Range: "bytes=0-31" } });
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { id: animation.id, ok: response.ok && !response.headers.get("content-type")?.includes("text/html") && bytes[0] !== 0x3c };
    }));
    return { total: catalog.summary.total, failures: results.filter((result) => !result.ok) };
  });
  expect(assetProof.total).toBe(39);
  expect(assetProof.failures).toEqual([]);

  await page.fill("#directorBrief", "A kinetic two-character concert that builds from restraint into a jubilant dance peak.");
  await page.locator("#createShowButton").click();
  await expect(page.locator("#directorState")).toHaveText("Complete", { timeout: 120_000 });
  await expect(page.locator("#directorStatus")).toContainText("catalog warning");
  await expect(page.locator("#directorProvenance")).toContainText("Performance Director");
  await expect(page.locator("#directorProvenance")).toContainText("performance -> stage -> camera -> postfx");
  expect(directorRequests).toHaveLength(5);
  expect(directorRequests.every((request) => request.model === "text/qwen2.5-coder-7b-instruct-4bit")).toBe(true);
  const stageRequests = directorRequests.filter((request) => String(request.input || "").includes("STAGE DIRECTOR"));
  expect(stageRequests).toHaveLength(2);
  expect(stageRequests[0].max_output_tokens).toBeGreaterThanOrEqual(2_000);
  expect(stageRequests[1].max_output_tokens).toBeGreaterThan(stageRequests[0].max_output_tokens);
  expect(stageRequests[1].input).toContain("RETRY REQUIREMENT");

  await page.locator("#saveLocalButton").click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("avatarLabs.performanceEngine.project.v1") || "null"));
  expect(saved.title).toBe("Verified Motion Show");
  expect(saved.direction).toEqual(expect.objectContaining({
    createdBy: "performance-director",
    source: "llm",
    model: "text/qwen2.5-coder-7b-instruct-4bit",
    specialists: ["performance", "stage", "camera", "postfx"],
  }));
  expect(saved.tracks.some((track) => track.name === "Camera Director")).toBe(true);
  expect(saved.tracks.some((track) => track.name === "Stage Director / Lighting")).toBe(true);
  expect(saved.tracks.some((track) => track.kind === "stagefx")).toBe(true);
  expect(saved.direction.briefings).toHaveLength(4);
  const cameraStoryClips = saved.tracks.find((track) => track.kind === "camera").clips;
  expect(cameraStoryClips).toHaveLength(5);
  expect(cameraStoryClips.every((clip) => String(clip.data.storyPurpose).length > 0)).toBe(true);
  const materialClips = saved.tracks.filter((track) => track.kind === "shader").flatMap((track) => track.clips);
  expect(materialClips.every((clip) => clip.data.preset === "realismus")).toBe(true);
  const cameraRequest = directorRequests.find((request) => String(request.input || "").includes("CAMERA DIRECTOR"));
  expect(cameraRequest.input).toContain("OPERATOR STORY BRIEF");
  expect(cameraRequest.input).toContain("primary narrative system");
  const animationClips = saved.tracks.filter((track) => track.kind === "animation").flatMap((track) => track.clips);
  expect(animationClips.length).toBeGreaterThanOrEqual(4);
  expect(animationClips.every((clip) => !String(clip.data.animationId).includes("invented"))).toBe(true);
  expect(animationClips.every((clip) => /^\/performance-assets\//.test(clip.data.url))).toBe(true);
  await page.locator("#playButton").click();
  await expect.poll(async () => Number(await page.locator("#transportScrub").inputValue())).toBeGreaterThan(200);
  await page.locator("#pauseButton").click();
  expect((await page.evaluate(() => window.__performanceEngineResult)).errors).toEqual([]);
});

test("Score analysis diarises singers and drives audible planning, lipsync, cinematic cues, and stage physics", async ({ page }) => {
  test.setTimeout(180_000);
  const ttsRequests = [];
  const directorRequests = [];
  await page.route("http://127.0.0.1:8090/v1/models", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      data: [
        { id: "text/director-test", _service: "mlx-llm", loaded: true, is_default: true },
        { id: "stt/whisper", _service: "mlx-audio", _audio_lane: "stt", loaded: true },
        { id: "tts/kokoro", _service: "mlx-audio", _audio_lane: "tts", loaded: true, is_default: true },
      ],
    }),
  }));
  await page.route("http://127.0.0.1:8090/voice-snip/transcribe-file", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      text: "We rise together then answer from the dark",
      language: "en",
      audio_path: "/tmp/avatar-labs-score.wav",
      segments: [
        { start: 0, end: 2, text: "We rise together" },
        { start: 2, end: 4, text: "Then answer from the dark" },
      ],
    }),
  }));
  await page.route("http://127.0.0.1:8090/voice-snip/diarise", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ segments: [
      { start: 0, end: 2, speaker_id: "SPEAKER_00" },
      { start: 2, end: 4, speaker_id: "SPEAKER_01" },
    ] }),
  }));
  await page.route("http://127.0.0.1:8090/v1/audio/speech", async (route) => {
    ttsRequests.push(JSON.parse(route.request().postData() || "{}"));
    await route.fulfill({ contentType: "audio/wav", body: makeTestWav(1) });
  });
  await page.route("http://127.0.0.1:8090/v1/responses", async (route) => {
    const request = JSON.parse(route.request().postData() || "{}");
    directorRequests.push(request);
    const prompt = String(request.input || "");
    await new Promise((resolve) => setTimeout(resolve, 180));
    const sections = [0, 1, 2, 3].map((index) => ({
      label: ["Invocation", "Reply", "Lift", "Resolve"][index],
      start_ms: index * 1_000,
      end_ms: (index + 1) * 1_000,
      role: index < 2 ? "solo" : "ensemble",
      mood: index === 2 ? "happy" : index === 1 ? "fear" : "neutral",
      actions: [],
    }));
    let thoughts = "The performers trade the vocal lead before joining at the lift.";
    if (prompt.includes("STAGE DIRECTOR")) {
      thoughts = "Negative fill opens into a kinetic concert atmosphere.";
      sections.forEach((section, index) => {
        section.light = index === 1 ? "noir" : index === 2 ? "neon" : "frost";
        section.actions = [{ time_ms: section.start_ms, action: "stage_particles", args: { preset: index === 2 ? "sparks" : "dust" } }];
      });
    } else if (prompt.includes("CAMERA DIRECTOR")) {
      thoughts = "Singer close-ups alternate with a moving ensemble master.";
      sections.forEach((section, index) => {
        section.camera = index === 2 ? "full" : "head";
        section.actions = [{
          time_ms: section.start_ms,
          action: index === 2 ? "camera_orbit" : "camera_dolly",
          args: index === 2 ? { angle: 24, duration_ms: 700 } : { distance: -0.35, duration_ms: 800 },
        }];
      });
    } else if (prompt.includes("POST-PROCESSING DIRECTOR")) {
      thoughts = "A restrained bloom marks only the emotional lift.";
      sections.forEach((section, index) => { section.effects = index === 2 ? "bloom" : "clean"; });
    }
    const content = JSON.stringify({
      thoughts_summary: thoughts,
      analysis: "Two singers exchange short phrases over a rising energy contour.",
      selection_reason: "Vocal handoff and signal energy determine framing and atmosphere.",
      plan: { title: "Diarised Duet", sections },
    });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: `analysis-response-${directorRequests.length}`,
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: content }] }],
      }),
    });
  });

  await page.goto("/engine-lab.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__performanceEngineResult?.ready === true, null, { timeout: 150_000 });
  await page.locator("#addActorButton").click();
  await expect(page.locator("#actorList button")).toHaveCount(2, { timeout: 30_000 });
  await expect.poll(async () => (await page.evaluate(() => window.__performanceEngineResult)).actorsReady).toBe(2);
  await page.setInputFiles("#audioInput", {
    name: "diarised-duet.wav",
    mimeType: "audio/wav",
    buffer: makeTestWav(),
  });
  await expect(page.locator("#scoreAnalysisStatus")).toContainText("2 singers", { timeout: 30_000 });
  await expect(page.locator(".speaker-assignment-row")).toHaveCount(2);
  expect((await page.evaluate(() => window.__performanceEngineResult)).analysisReady).toBe(true);

  await page.fill("#directorBrief", "A cinematic duet with dynamic singer coverage, practical light, and a physical celebration at the lift.");
  await page.locator("#createShowButton").click();
  await expect(page.locator("#directorPlanningOverlay")).toBeVisible();
  await expect(page.locator('[data-director-card="performance"]')).toHaveAttribute("data-state", /running|complete/);
  await expect(page.locator("#directorState")).toHaveText("Complete", { timeout: 120_000 });
  await expect(page.locator("#scoreBadge")).toHaveText("Score / ready");
  expect((await page.evaluate(() => window.__performanceEngineResult)).audioAttached).toBe(true);
  expect(directorRequests).toHaveLength(4);
  expect(ttsRequests).toHaveLength(4);
  expect(ttsRequests.every((request) => request.model === "tts/kokoro")).toBe(true);

  await page.locator("#saveLocalButton").click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("avatarLabs.performanceEngine.project.v1") || "null"));
  expect(saved.audio.analysis).toEqual(expect.objectContaining({
    schema: "avatar-labs.music-analysis.v1",
    source: expect.objectContaining({ diarisation: "pyannote-segmentation-3.0-mlx" }),
  }));
  expect(saved.audio.analysis.speakers).toHaveLength(2);
  expect(saved.tracks.filter((track) => track.kind === "lipsync")).toHaveLength(2);
  expect(saved.tracks.some((track) => track.kind === "stagefx")).toBe(true);
  const cameraClips = saved.tracks.find((track) => track.kind === "camera").clips;
  expect(cameraClips.some((clip) => clip.data.movement === "orbit")).toBe(true);
  expect(cameraClips.every((clip) => typeof clip.data.lensMm === "number")).toBe(true);
  expect(saved.direction.briefings).toHaveLength(4);

  await page.selectOption("#stageShaderSelect", "pulse");
  await page.selectOption("#stageParticlesSelect", "sparks");
  await page.selectOption("#stagePhysicsSelect", "confetti");
  await page.locator("#applyStageFxButton").click();
  await page.waitForTimeout(900);
  await page.locator("#playButton").click();
  await expect.poll(async () => Number(await page.locator("#transportScrub").inputValue())).toBeGreaterThan(250);
  await expect(page.locator("#scoreBadge")).toHaveText("Score / playing");
  await expect(page.locator("#performanceBroadcastTitle")).toHaveText("diarised-duet");
  await expect(page.locator("#performanceBroadcastCast")).not.toHaveText("Cast pending");
  expect(await page.evaluate(() => window.__performanceEngineResult)).toEqual(expect.objectContaining({
    audioAttached: true,
    audioPlaying: true,
    audioMuted: false,
    audioVolume: 1,
  }));
  await page.locator("#pauseButton").click();
  expect((await page.evaluate(() => window.__performanceEngineResult)).errors).toEqual([]);
});

test("Singer review repairs an empty diarisation result and persists the corrected lipsync routing", async ({ page }) => {
  test.setTimeout(150_000);
  await page.route("http://127.0.0.1:8090/v1/models", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      data: [{ id: "stt/whisper", _service: "mlx-audio", _audio_lane: "stt", loaded: true, is_default: true }],
    }),
  }));
  await page.route("http://127.0.0.1:8090/voice-snip/transcribe-file", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      text: "We rise together then answer from the dark",
      language: "en",
      audio_path: "/tmp/avatar-labs-zero-speakers.wav",
      segments: [
        { start: 0, end: 2, text: "We rise together" },
        { start: 2, end: 4, text: "Then answer from the dark" },
      ],
    }),
  }));
  await page.route("http://127.0.0.1:8090/voice-snip/diarise", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ segments: [] }),
  }));

  await page.goto("/engine-lab.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__performanceEngineResult?.ready === true, null, { timeout: 120_000 });
  await page.setInputFiles("#audioInput", {
    name: "zero-speakers.wav",
    mimeType: "audio/wav",
    buffer: makeTestWav(),
  });

  await expect(page.locator("#scoreAnalysisStatus")).toContainText("0 singers", { timeout: 30_000 });
  await expect(page.locator("#speakerAssignments")).toBeVisible();
  await expect(page.locator("#speakerReviewStatus")).toContainText("No singer turns detected");
  await page.locator("#addManualSingerButton").click();
  await expect(page.locator("#scoreAnalysisStatus")).toContainText("1 singer");
  await expect(page.locator("#scoreAnalysisStatus")).toContainText("operator reviewed");
  await expect(page.locator(".speaker-assignment-row")).toHaveCount(1);
  await expect(page.locator(".singer-segment-row")).toHaveCount(2);

  await page.locator("#saveLocalButton").click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("avatarLabs.performanceEngine.project.v1") || "null"));
  expect(saved.audio.analysis.source.speakerReview).toBe("manual");
  expect(saved.audio.analysis.speakers).toEqual([
    expect.objectContaining({ id: "MANUAL_SINGER_01", confidence: "low", durationMs: 4_000 }),
  ]);
  expect(saved.audio.analysis.segments.every((segment) => segment.speakerId === "MANUAL_SINGER_01")).toBe(true);
  const lipsyncTracks = saved.tracks.filter((track) => track.kind === "lipsync");
  expect(lipsyncTracks).toHaveLength(1);
  expect(lipsyncTracks[0].clips).toHaveLength(2);
});

test("Performance Director failure preserves the current project without a heuristic show", async ({ page }) => {
  test.setTimeout(150_000);
  let responseAttempts = 0;
  await page.route("http://127.0.0.1:8090/v1/models", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      data: [{ id: "text/qwen2.5-coder-7b-instruct-4bit", _service: "mlx-llm", loaded: true, is_default: true }],
    }),
  }));
  await page.route("http://127.0.0.1:8090/v1/responses", (route) => {
    responseAttempts += 1;
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "director offline" }) });
  });

  await page.goto("/engine-lab.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__performanceEngineResult?.ready === true, null, { timeout: 120_000 });
  const before = {
    title: await page.locator("#projectTitle").inputValue(),
    clips: await page.locator(".timeline-clip").count(),
  };
  await page.fill("#directorBrief", "Create a show, but do not replace the current edit if the director is unavailable.");
  await page.locator("#createShowButton").click();
  await expect(page.locator("#directorState")).toHaveText("Failed", { timeout: 30_000 });
  await expect(page.locator("#directorStatus")).toContainText("503");
  expect(responseAttempts).toBe(2);
  expect(await page.locator("#projectTitle").inputValue()).toBe(before.title);
  expect(await page.locator(".timeline-clip").count()).toBe(before.clips);
  await expect(page.locator("#directorProvenance")).toBeHidden();
  await page.locator("#saveLocalButton").click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("avatarLabs.performanceEngine.project.v1") || "null"));
  expect(saved.direction).toBeUndefined();
});

test("Performance Engine forces WebGL2 and rejects foreign project schemas", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/engine-lab.html?renderer=webgl", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__performanceEngineResult?.ready === true, null, {
    timeout: 120_000,
  });
  expect((await page.evaluate(() => window.__performanceEngineResult)).renderer)
    .toBe("webgl2-fallback");
  const outcome = await page.evaluate(async () => {
    const { loadPerformanceCatalog } = await import("/src/performance-engine/catalog.ts");
    const { createDefaultProject, parsePerformanceProject } = await import("/src/performance-engine/project.ts");
    const { compilePerformanceProject } = await import("/src/performance-engine/schedule.ts");
    const { PerformanceScheduler } = await import("/src/performance-engine/scheduler.ts");
    const catalog = await loadPerformanceCatalog();
    const defaultProject = createDefaultProject(catalog);
    const schedule = compilePerformanceProject(defaultProject);
    const NativeWorker = window.Worker;
    class BrokenWorker {
      onmessage = null;
      onerror = null;
      postMessage() { throw new Error("worker unavailable"); }
      terminate() {}
    }
    window.Worker = BrokenWorker;
    const fallbackScheduler = new PerformanceScheduler();
    const fallbackSchedule = await fallbackScheduler.compile(defaultProject);
    const fallbackMode = fallbackScheduler.mode;
    fallbackScheduler.dispose();
    window.Worker = NativeWorker;
    try {
      parsePerformanceProject({ schema: "unknown" }, catalog);
      return { parser: "accepted", expressionResets: 0, fallbackMode, fallbackProject: fallbackSchedule.projectId };
    } catch (error) {
      return {
        parser: String(error),
        expressionResets: schedule.events.filter((event) => event.action === "expression:reset").length,
        fallbackMode,
        fallbackProject: fallbackSchedule.projectId,
      };
    }
  });
  expect(outcome.parser).toContain("avatar-labs.performance-project.v1");
  expect(outcome.expressionResets).toBe(0);
  expect(outcome.fallbackMode).toBe("main-thread");
  expect(outcome.fallbackProject).toContain("performance_");
});
