import { test, expect } from "@playwright/test";

test("TalkingHead playback pipeline", async ({ page }) => {
  await page.goto("/e2e.html", { waitUntil: "domcontentloaded" });

  await page.waitForFunction(() => {
    const result = window.__talkingHeadResult;
    return result?.ready || result?.skipped || (result?.errors && result.errors.length > 0);
  }, { timeout: 25000 });

  const result = await page.evaluate(() => {
    const data = window.__talkingHeadResult || {};
    return {
      ready: data.ready,
      skipped: data.skipped,
      skipReason: data.skipReason,
      playbackStarted: data.playbackStarted,
      playbackEnded: data.playbackEnded,
      renderFrames: data.renderFrames,
      lipsyncActive: data.lipsyncActive,
      errors: data.errors || []
    };
  });

  test.skip(result.skipped, result.skipReason || "Skipped");

  expect(result.errors, `TalkingHead errors: ${result.errors.join(" | ")}`).toHaveLength(0);
  expect(result.ready).toBeTruthy();
  expect(result.playbackStarted).toBeTruthy();
  expect(result.playbackEnded).toBeTruthy();
  expect(result.renderFrames).toBeGreaterThanOrEqual(30);
});
