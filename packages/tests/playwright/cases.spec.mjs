import { expect, test } from "@playwright/test";

const workbenchRoutes = [
  "/stage.html",
  "/engine-lab.html",
  "/dance-studio.html",
  "/gestures-lab.html",
  "/multi-modal.html",
  "/mlx-conversation.html",
  "/composition-layer.html",
  "/head-audio.html",
];

const avatarRoutes = [
  { path: "/stage.html", ready: /Avatar ready/ },
  { path: "/engine-lab.html", ready: /Avatar ready/ },
  { path: "/dance-studio.html", ready: /Dance Studio ready/ },
  { path: "/gestures-lab.html", ready: /^Ready$/ },
  { path: "/multi-modal.html" },
  { path: "/mlx-conversation.html", ready: /Avatar ready/ },
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
