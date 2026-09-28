import { configDefaults, defineConfig } from "vitest/config";
import { ARCHBOT_GATE_TESTS } from "./vitest.archbot.config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    // The ArchBot parity gate has its own command (vitest.archbot.config.ts).
    exclude: [...configDefaults.exclude, ...ARCHBOT_GATE_TESTS],
  },
});
