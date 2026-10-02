import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/live-security-browser",
  workers: 1,
  fullyParallel: false,
  timeout: 240_000,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:4478", screenshot: "only-on-failure" },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
  ],
});
