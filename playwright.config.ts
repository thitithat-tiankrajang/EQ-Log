import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    colorScheme: "light",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    // Local-only mode (no Supabase), but with an engine origin configured, as
    // on every real deployment: without one the bot and Study entry points are
    // disabled and the setup screens under test never render. Port 9 refuses
    // connections, so nothing here reaches a real engine. Set explicitly so a
    // developer's ignored .env cannot make CI and a laptop test different apps.
    command:
      "VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= VITE_ENGINE_API_URL=http://127.0.0.1:9 npm run dev -- --port 4173",
    url: "http://127.0.0.1:4173/#/public/rooms",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    {
      name: "compact",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 320, height: 740 },
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
});
