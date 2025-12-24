import { test, expect } from "@playwright/test";

test("HeadAudio emits viseme values", async ({ page }) => {
  await page.goto("/head-audio.html", { waitUntil: "domcontentloaded" });

  await page.waitForFunction(() => {
    const result = window.__headaudioResult;
    return result?.ready || (result?.errors && result.errors.length > 0);
  }, { timeout: 15000 });

  const result = await page.evaluate(() => {
    const data = window.__headaudioResult || {};
    return {
      ready: data.ready,
      eventCount: data.eventCount,
      keyCount: data.keys?.size || 0,
      errors: data.errors || []
    };
  });

  expect(result.errors, `HeadAudio errors: ${result.errors.join(" | ")}`).toHaveLength(0);
  expect(result.ready).toBeTruthy();
  expect(result.eventCount).toBeGreaterThan(0);
});
