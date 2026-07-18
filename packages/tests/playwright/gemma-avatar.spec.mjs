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
  expect(errors).toEqual([]);
});
