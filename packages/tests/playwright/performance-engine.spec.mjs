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
  expect(initial.actorsReady).toBe(2);
  expect(initial.errors).toEqual([]);
  await expect(page.locator(".case-workbench-bar__runtime")).toContainText("webgpu");
  await expect(page.locator("#performanceViewport canvas")).toBeVisible();
  await expect(page.locator("#actorList button")).toHaveCount(2);
  await expect(page.locator(".timeline-clip")).toHaveCount(6);

  await page.locator(".timeline-clip", { hasText: /Standing Neutral|Neutral Idle/ }).click();
  await expect(page.locator("#clipInspector")).toBeVisible();
  await expect(page.locator("#selectedClipName")).toContainText(/Standing Neutral|Neutral Idle/);
  const smile = page.locator(".timeline-clip", { hasText: "Smile" });
  await smile.scrollIntoViewIfNeeded();
  const initialSmileBounds = await smile.boundingBox();
  expect(initialSmileBounds).not.toBeNull();
  await smile.hover({ position: { x: 12, y: initialSmileBounds.height / 2 } });
  const smileBounds = await smile.boundingBox();
  expect(smileBounds).not.toBeNull();
  await page.mouse.down();
  await page.mouse.move(smileBounds.x + 56, smileBounds.y + smileBounds.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator("#selectedClipName")).toContainText("Smile");
  await expect(page.locator("#clipStart")).toHaveValue("3");

  await page.locator("#actorList button", { hasText: "Kbllr" }).click();
  await expect(page.locator("#actorCapability")).toContainText("rig-less head");
  await expect(page.locator("#addMotionButton")).toBeDisabled();
  await page.selectOption("#actorShader", "xray");
  await page.selectOption("#environmentSelect", "room:neon-grid");
  await expect(page.locator("#environmentSelect")).toHaveValue("room:neon-grid");

  await page.locator("#playButton").click();
  await expect.poll(async () => Number(await page.locator("#transportScrub").inputValue())).toBeGreaterThan(200);
  await page.locator("#pauseButton").click();

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
      thoughts = "Lighting arc ready.";
      sections.forEach((section, index) => { section.light = index === 2 ? "neon" : "frost"; });
    } else if (prompt.includes("CAMERA DIRECTOR")) {
      thoughts = "Camera coverage ready.";
      sections.forEach((section, index) => { section.camera = index === 2 ? "full" : "upper"; });
    } else if (prompt.includes("POST-PROCESSING DIRECTOR")) {
      thoughts = "PostFX look ready.";
      sections.forEach((section, index) => { section.effects = index === 2 ? "bloom" : "clean"; });
    }
    const content = JSON.stringify({
      thoughts_summary: thoughts,
      analysis: "A four-part performance.",
      selection_reason: "The brief calls for a clear build and peak.",
      plan: { title: "Verified Motion Show", sections },
    });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: `response-${directorRequests.length}`,
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: content }] }],
      }),
    });
  });

  await page.goto("/engine-lab.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__performanceEngineResult?.ready === true, null, { timeout: 150_000 });
  bodyActorId = await page.locator("#actorList button", { hasText: "Sandri" }).getAttribute("data-actor-id") || "";
  expect(bodyActorId).not.toBe("");

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
  expect(directorRequests).toHaveLength(4);
  expect(directorRequests.every((request) => request.model === "text/qwen2.5-coder-7b-instruct-4bit")).toBe(true);

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
  await page.locator("#pauseButton").click();
  expect((await page.evaluate(() => window.__performanceEngineResult)).errors).toEqual([]);
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
  expect(outcome.expressionResets).toBe(1);
  expect(outcome.fallbackMode).toBe("main-thread");
  expect(outcome.fallbackProject).toContain("performance_");
});
