import { defineConfig, devices } from "@playwright/test";

// Perf runs against a PRODUCTION build: the dev server ships React's development
// build, whose StrictMode double-invokes every render and whose warnings are not
// what a player runs. Measuring dev numbers would overstate every result and
// flatter every fix.
export default defineConfig({
  testDir: "./tests/perf",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 240_000,
  use: { baseURL: "http://127.0.0.1:4273", colorScheme: "light" },
  webServer: {
    command:
      "VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npm run build && npx vite preview --host 127.0.0.1 --port 4273",
    url: "http://127.0.0.1:4273/#/public",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
});
