import { defineConfig } from "@playwright/test";

// Real dev app + existing disposable backend. No auth/session/route mocks.
export default defineConfig({
  testDir: "./tests/local-realplay",
  workers: 1,
  timeout: 120_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5192",
    viewport: { width: 1440, height: 1000 },
    actionTimeout: 10_000,
  },
});
