// Reuses the existing disposable stack. Starts/stops only this run's processes.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, openSync, closeSync } from "node:fs";
import { frontendEnvironment, localEnvironment, stack, statusFile } from "./local.mjs";

const env = localEnvironment();
const out = "test-results/phase-a-gate";
mkdirSync(out, { recursive: true });
const children = [];
const worker = "eq-milestone-s-authur-trusted-bot-1";
const wasRunning =
  execFileSync("docker", ["inspect", "-f", "{{.State.Running}}", worker], {
    encoding: "utf8",
  }).trim() === "true";
function start(command, args, log, childEnv = process.env) {
  const fd = openSync(`${out}/${log}.log`, "w");
  const child = spawn(command, args, { stdio: ["ignore", fd, fd], env: childEnv, detached: true });
  closeSync(fd);
  children.push(child);
  return child;
}
function done(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Gate command exited ${code}; see ${out}.`)),
    );
  });
}
let stopped = false;
function cleanup() {
  if (stopped) return;
  stopped = true;
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* Already exited. */
    }
  }
  if (!wasRunning) execFileSync("docker", ["stop", "--time", "10", worker], { stdio: "ignore" });
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    cleanup();
    process.exit(130);
  });
try {
  console.log("Building local security frontend (disposable API only).");
  await done(
    start(
      process.execPath,
      ["node_modules/vite/bin/vite.js", "build", "--outDir", "test-results/phase-a-build"],
      "build",
      frontendEnvironment(env),
    ),
  );
  start(
    "supabase",
    ["functions", "serve", "--workdir", stack, "--env-file", `${stack}/private.env`],
    "functions",
  );
  execFileSync("docker", ["start", worker], { stdio: "ignore" });
  start(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--outDir",
      "test-results/phase-a-build",
      "--host",
      "127.0.0.1",
      "--port",
      "4478",
      "--strictPort",
    ],
    "preview",
  );
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const edge = await fetch(`${env.API_URL}/functions/v1/live-game`, { method: "OPTIONS" });
      const frontend = await fetch("http://127.0.0.1:4478/");
      if (edge.ok && frontend.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Wait until both local services are ready. */
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  if (!ready) throw new Error("Disposable Edge/frontend failed to become ready.");
  console.log("Running the real security browser gate; assertions unchanged.");
  await done(
    start(
      process.execPath,
      [
        "node_modules/@playwright/test/cli.js",
        "test",
        "-c",
        "playwright.live-security.config.ts",
        "--output=test-results/security",
        ...process.argv.slice(2),
      ],
      "security",
      { ...process.env, LIVE_SECURITY_STATUS_FILE: statusFile },
    ),
  );
  console.log(`PASS. Evidence: ${out}/security.log`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  cleanup();
}
