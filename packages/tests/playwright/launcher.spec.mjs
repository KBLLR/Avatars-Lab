import { expect, test } from "@playwright/test";

test("launcher exposes the canonical harness roster and runtime state", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(page.locator(".wordmark")).toContainText("Avatar Labs");
  await expect(page.locator(".case-tile")).toHaveCount(12);
  await expect(page.locator('[data-case-id="gemma-avatar"]')).toBeVisible();
  await expect(page.locator('[data-case-id="corex-head"]')).toBeVisible();
  await expect(page.locator("#case-count")).toHaveText("12 harnesses");
  await page.waitForFunction(() => window.__avatarLabsLauncherResult?.ready === true);

  const result = await page.evaluate(() => window.__avatarLabsLauncherResult);
  expect(result.cases).toBe(12);
  expect(["webgpu", "webgl-fallback"]).toContain(result.renderer);
  expect(errors).toEqual([]);
});

test("launcher remains contained at desktop and mobile widths", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".case-tile").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
