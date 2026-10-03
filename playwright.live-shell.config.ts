import { defineConfig, devices } from "@playwright/test";

/**
 * Unified Live Game Shell — browser gate against the development-only fixtures
 * (#/play/live-shell-fixture:<state>:<viewer>). The fixtures run the real
 * trusted reducers and recipient projection locally; no Supabase is involved.
 */
export default defineConfig({
  testDir: "./tests/live-shell-browser",
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4479",
    colorScheme: "light",
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npx vite --host 127.0.0.1 --port 4479 --strictPort",
    url: "http://127.0.0.1:4479/",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
