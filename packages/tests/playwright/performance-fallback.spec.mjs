import { expect, test } from '@playwright/test';

test('performance room uses the bundled sample when catalogs are missing', async ({ page, baseURL }) => {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(baseURL).origin) return route.abort();
    if (url.pathname === '/avatars/runtime-manifest.json' || url.pathname === '/performance-assets/catalog.json') {
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>SPA fallback</html>' });
    }
    return route.continue();
  });
  await page.goto('/engine-lab.html');
  await expect.poll(() => page.evaluate(() => window.__performanceEngineResult?.ready), { timeout: 30000 }).toBe(true);
  const result = await page.evaluate(() => window.__performanceEngineResult);
  expect(result.actorsReady).toBeGreaterThan(0);
  expect(result.errors.some((error) => error.includes('using the bundled sample avatar'))).toBe(true);
  expect(result.errors.some((error) => error.includes('motion clips are not loaded'))).toBe(true);
});
