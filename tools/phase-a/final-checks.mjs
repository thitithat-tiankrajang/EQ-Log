import { spawnSync } from "node:child_process";
import { mkdirSync, openSync, closeSync, writeFileSync } from "node:fs";

const out = "test-results/phase-a-gate";
mkdirSync(out, { recursive: true });
const focused = [
  "live-shell-screen.test.tsx",
  "live-shell-units.test.tsx",
  "live-shell-layout.test.ts",
  "live-play-layout.test.tsx",
  "ranked-play-ui.test.tsx",
  "live-hidden-boundary.test.ts",
  "live-hidden-information-repro.test.ts",
  "live-capabilities.test.ts",
  "live-milestone-s.test.ts",
  "live-projection-client.test.ts",
  "live-history-replay-secrecy.test.ts",
  "live-own-analysis.test.ts",
  "live-hosted-administration.test.ts",
  "live-offline-boundary.test.tsx",
].map((name) => `tests/${name}`);
const checks = [
  ["format", "npm", ["run", "format:check"]],
  [
    "shell-format",
    "npx",
    [
      "prettier",
      "--check",
      "src/liveGame/**/*.{ts,tsx,css}",
      "playwright.live-shell.config.ts",
      "tools/phase-a/*.mjs",
    ],
  ],
  ["lint", "npm", ["run", "lint"]],
  ["typecheck", "npm", ["run", "typecheck"]],
  ["focused-tests", "npx", ["vitest", "run", ...focused]],
  ["production-build", "npm", ["run", "build"]],
  ["build-scan", process.execPath, ["tools/phase-a/scan-build.mjs"]],
];
const results = [];
for (const [name, command, args] of checks) {
  const fd = openSync(`${out}/${name}.log`, "w");
  const run = spawnSync(command, args, { stdio: ["ignore", fd, fd] });
  closeSync(fd);
  results.push({
    name,
    command: [command, ...args].join(" "),
    exit: run.status,
    log: `${out}/${name}.log`,
  });
  console.log(`${name}: ${run.status === 0 ? "PASS" : "FAIL"}`);
  if (run.status !== 0) {
    process.exitCode = 1;
    break;
  }
}
writeFileSync("docs/evidence/phase-a-final/checks.json", JSON.stringify(results, null, 2) + "\n");
