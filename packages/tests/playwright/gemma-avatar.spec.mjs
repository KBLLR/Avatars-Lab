import { expect, test } from "@playwright/test";

test("Gemma Avatar boots the audio-viseme reference stage", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/gemma-avatar.html");
  await page.waitForFunction(() => window.__gemmaAvatarResult?.ready === true, null, {
    timeout: 45_000,
  });

  const result = await page.evaluate(() => window.__gemmaAvatarResult);
  expect(result.capability).toBe("tts-viseme-reference");
  expect(result.renderer).toBe("talkinghead-webgl");
  expect(result.errors).toEqual([]);
  await expect(page.locator("#avatar canvas")).toBeVisible();
  await expect(page.locator("#status")).toContainText("Ready");
  expect(errors).toEqual([]);
});

test("Core-X head exposes a deterministic WebGL fallback", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/corex-head.html?renderer=webgl");
  await page.waitForFunction(() => window.__corexHeadResult?.ready === true, null, {
    timeout: 45_000,
  });

  const result = await page.evaluate(() => window.__corexHeadResult);
  expect(result.renderer).toBe("webgl-forced");
  expect(result.morphMeshes).toBeGreaterThan(0);
  expect(result.errors).toEqual([]);
  await expect(page.locator("#stage canvas")).toBeVisible();
  await expect(page.locator("#renderer-status")).toHaveText("WebGL2");
  await expect(page.locator('#case-nav [aria-current="page"]')).toHaveText("CXH");
  await expect(page.locator('#case-nav a[href="/musetalk-chat.html"]')).toHaveText("MCH");

  let releaseHead;
  const headGate = new Promise((resolve) => { releaseHead = resolve; });
  await page.route("**/avatars/heads/rosalia/rosalia.glb", async (route) => {
    await headGate;
    await route.continue();
  });
  try {
    await page.locator("#head-select").selectOption("rosalia");
    for (const control of ["#speak-stream", "#speak-blob", "#btn-live-mic", "#voice"]) {
      await expect(page.locator(control)).toBeDisabled();
    }
  } finally {
    releaseHead();
  }
  await expect(page.locator("#status")).toHaveText("Performer Rosalia ready.", { timeout: 20_000 });
  await expect(page.locator("#voice")).toHaveValue("rosa_lia");
  await expect(page.locator("#speak-stream")).toBeEnabled();
  expect(errors).toEqual([]);
});
