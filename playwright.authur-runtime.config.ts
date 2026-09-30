import { defineConfig, devices } from "@playwright/test";

// Opt-in, local servers only. See tests/authur-runtime-local/README.md.
export default defineConfig({
  testDir: "./tests/authur-runtime-local",
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4475",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
  ],
});
