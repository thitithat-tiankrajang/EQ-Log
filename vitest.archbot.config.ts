import { defineConfig } from "vitest/config";

/**
 * The ArchBot parity gate: `npm run test:archbot-parity`.
 *
 * ArchBot must decide exactly as production Stage 5B does. These suites prove it
 * — the whole 89-position corpus against the production runtime's answers, and
 * the determinism layer against the production runtime's math and collation.
 * The corpus runs full-strength Stage 5B searches for about ninety seconds of
 * saturated CPU, so it is its own command rather than part of `npm test`, where
 * it made unrelated timing-sensitive UI tests flaky. Release checks run it after
 * the ordinary suite (`npm run check`, CI). The browser half of the gate is
 * `playwright.archbot.config.ts`.
 */
export const ARCHBOT_GATE_TESTS = [
  "tests/archbot-parity.test.ts",
  "tests/archbot-determinism.test.ts",
];

export default defineConfig({
  test: {
    environment: "node",
    include: ARCHBOT_GATE_TESTS,
    // One file at a time: the gate measures decisions, not contention.
    fileParallelism: false,
  },
});
