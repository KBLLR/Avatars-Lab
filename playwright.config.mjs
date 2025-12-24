const port = process.env.AVATAR_LABS_DEV_PORT || 5177;
const baseURL = process.env.AVATAR_LABS_BASE_URL || `http://127.0.0.1:${port}`;

export default {
  testDir: "packages/tests/playwright",
  timeout: 60000,
  retries: 0,
  use: {
    baseURL,
    headless: true,
    launchOptions: {
      args: ["--autoplay-policy=no-user-gesture-required"]
    }
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120000
  }
};
