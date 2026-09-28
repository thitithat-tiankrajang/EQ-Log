import { defineConfig, devices } from "@playwright/test";

// ArchBot end to end, in the real app, against an ISOLATED LOCAL Supabase stack
// with ArchBot opened in that stack's catalog — and with NO engine service
// configured, so any server dependency or fallback would show. Opt-in: see
// tests/archbot-local/README.md. Never point it at a hosted project.
const api = process.env.ARCHBOT_LOCAL_API_URL ?? "http://127.0.0.1:54721";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(api)) {
  throw new Error(`refusing: ${api} is not a local Supabase`);
}

export default defineConfig({
  testDir: "./tests/archbot-local",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 300_000,
  use: {
    baseURL: "http://127.0.0.1:4473",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `VITE_SUPABASE_URL=${api} VITE_SUPABASE_ANON_KEY=${process.env.ARCHBOT_LOCAL_ANON_KEY ?? ""} VITE_ENGINE_API_URL= npx vite --host 127.0.0.1 --port 4473 --strictPort`,
    url: "http://127.0.0.1:4473/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
