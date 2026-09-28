import { defineConfig, devices } from "@playwright/test";

// ArchBot in a real browser: exact parity with the production Stage 5B runtime on
// the whole corpus, failure handling, and the benchmark (tests/archbot-browser).
// Runs against a PRODUCTION build of tools/archbot/bench — the app's worker and
// model through the app's own build pipeline — never the dev server.
export default defineConfig({
  testDir: "./tests/archbot-browser",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 900_000,
  use: { baseURL: "http://127.0.0.1:4373" },
  webServer: {
    command:
      "npx vite build --config tools/archbot/bench/vite.config.ts && npx vite preview --config tools/archbot/bench/vite.config.ts",
    url: "http://127.0.0.1:4373/",
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
