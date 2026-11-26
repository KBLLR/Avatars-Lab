import { expect, test } from "@playwright/test";

test("launcher exposes the canonical harness roster and runtime state", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(page.locator(".wordmark")).toContainText("Avatar Labs");
  await expect(page.locator(".case-tile")).toHaveCount(13);
  await expect(page.locator('[data-case-id="gemma-avatar"]')).toBeVisible();
  await expect(page.locator('[data-case-id="corex-head"]')).toBeVisible();
  await expect(page.locator('[data-case-id="musetalk-chat"]')).toHaveAttribute("href", "/musetalk-chat.html");
  await expect(page.locator("#case-count")).toHaveText("13 harnesses");
  await page.waitForFunction(() => window.__avatarLabsLauncherResult?.ready === true);

  const result = await page.evaluate(() => window.__avatarLabsLauncherResult);
  expect(result.cases).toBe(13);
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

test("review galleries open from their parent cases", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-case-id="talking-portrait"], [data-case-id="character-gallery"]')).toHaveCount(0);
  await page.locator('[data-case-id="musetalk"]').click();
  await page.getByRole("link", { name: "Open Talking Portrait Gallery" }).click();
  await expect(page).toHaveURL(/\/talking-portrait\.html$/);
  await expect(page.getByRole("link", { name: "Back to MuseTalk MLX" })).toBeVisible();
  await page.getByRole("link", { name: "Back to MuseTalk MLX" }).click();
  await expect(page).toHaveURL(/\/musetalk\.html$/);
  await page.goto("/mocap-lab.html");
  await expect(page.getByRole("link", { name: "Open Rigged Character Gallery" })).toHaveAttribute("href", "/gallery.html");
});
