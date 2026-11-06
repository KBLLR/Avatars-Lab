import { expect, test } from "@playwright/test";

const cases = [
  ["launcher", "/"],
  ["performance", "/engine-lab.html"],
  ["mocap", "/mocap-lab.html"],
  ["gemma", "/gemma-avatar.html"],
  ["corex-head", "/corex-head.html?renderer=webgl"],
  ["said", "/said-face.html"],
  ["face-mirror", "/face-mirror.html?renderer=webgl"],
  ["stage", "/stage.html"],
  ["dance", "/dance-studio.html"],
  ["gestures", "/gestures-lab.html"],
  ["multimodal", "/multi-modal.html"],
];

test.beforeEach(async ({ page, baseURL }) => {
  // Exercise the shell without issuing requests to real local or remote services.
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseURL).origin) return route.continue();
    return route.abort();
  });
});

for (const [name, path] of cases) {
  test(`${name} exposes the Core-X foundation at desktop and mobile widths`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--corex-canvas").trim(),
    )).toBe("#d1d1d0");
    await expect(page.locator("body")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
}
