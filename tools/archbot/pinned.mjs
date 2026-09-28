// Shared by the ArchBot tools: the pinned Stage 5B source and the production
// oracle, each taken from a COMMIT (never a working tree) and hash-checked.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const repo = resolve(here, "../..");
export const pin = JSON.parse(readFileSync(join(here, "pin.json"), "utf8"));
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function gitRepo(envName, fallback) {
  const dir = resolve(process.env[envName] ?? join(repo, "..", fallback));
  if (!existsSync(join(dir, ".git"))) {
    throw new Error(`no ${fallback} repository at ${dir} (set ${envName})`);
  }
  return dir;
}

/** Extract `commit` of `dir` into `target` with `git archive`. */
function extract(dir, commit, target) {
  execFileSync("git", ["-C", dir, "cat-file", "-e", `${commit}^{commit}`]);
  mkdirSync(target, { recursive: true });
  const archive = execFileSync("git", ["-C", dir, "archive", commit], { maxBuffer: 1 << 28 });
  const untar = spawnSync("tar", ["-x", "-C", target], { input: archive });
  if (untar.status !== 0) throw new Error(`tar failed: ${untar.stderr}`);
}

/** A temp dir holding `amath-bot-lab/` at the pinned commit. */
export function extractPinnedSource() {
  const root = mkdtempSync(join(tmpdir(), "archbot-pinned-"));
  extract(
    gitRepo("AMATH_BOT_LAB_DIR", "amath-bot-lab"),
    pin.amathBotLab.commit,
    join(root, "amath-bot-lab"),
  );
  return root;
}

/**
 * The production runtime and its model, from the engine-algo commit, in a temp
 * dir laid out as the service ships them. Refuses anything whose hash is not
 * the pinned one.
 */
export function extractOracle() {
  const engine = gitRepo("AMATH_ENGINE_DIR", "amath-engine");
  const root = mkdtempSync(join(tmpdir(), "archbot-oracle-"));
  const files = {
    "runtime.mjs": pin.oracle.runtimeSha256,
    "model.json": pin.model.modelJsonSha256,
    "weights.bin": pin.model.weightsSha256,
  };
  for (const [name, expected] of Object.entries(files)) {
    const bytes = execFileSync(
      "git",
      ["-C", engine, "show", `${pin.oracle.commit}:service/stage5b/${name}`],
      { maxBuffer: 1 << 28 },
    );
    if (sha256(bytes) !== expected) throw new Error(`oracle ${name} hash mismatch`);
    writeFileSync(join(root, name), bytes);
  }
  return { root, runtime: join(root, "runtime.mjs") };
}

/**
 * The runtime that answers as production does.
 *
 * Production is Node 22 on x86-64 Linux, with no locale set (node:22-bookworm-slim).
 * That matters: V8's Math.exp/log/log1p round differently in the last bit on
 * arm64 builds (fused multiply-add), and localeCompare follows the locale. So the
 * oracle must be x86-64 Node 22 run with no LANG/LC_* — on Apple Silicon, the
 * universal installer's binary under Rosetta. Override with
 * ARCHBOT_ORACLE_NODE="<command...>"; any other runtime is refused unless
 * ARCHBOT_ORACLE_ANY_RUNTIME=1, and is then recorded as such.
 */
export function oracleCommand() {
  const configured = process.env.ARCHBOT_ORACLE_NODE?.split(" ").filter(Boolean);
  const command =
    configured ??
    (process.platform === "darwin" && process.arch === "arm64"
      ? ["arch", "-x86_64", "/usr/local/bin/node"]
      : [process.execPath]);
  const probe = spawnSync(
    command[0],
    [
      ...command.slice(1),
      "-p",
      "JSON.stringify([process.version, process.arch, process.platform])",
    ],
    {
      env: oracleEnv(),
    },
  );
  if (probe.status !== 0)
    throw new Error(`oracle runtime ${command.join(" ")} is not runnable: ${probe.stderr}`);
  const [version, arch, platform] = JSON.parse(probe.stdout.toString());
  const faithful = version.startsWith("v22.") && arch === "x64";
  if (!faithful && process.env.ARCHBOT_ORACLE_ANY_RUNTIME !== "1") {
    throw new Error(
      `oracle runtime is ${version} ${arch}; production is Node 22 on x64 (see oracleCommand)`,
    );
  }
  return { command, runtime: { version, arch, platform, productionFaithful: faithful } };
}

function oracleEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key === "LANG" || key.startsWith("LC_")) delete env[key];
  return env;
}

/** Ask the production runtime one question, exactly as the service does. */
export function runOracle(runtime, request, command = [process.execPath]) {
  const run = spawnSync(command[0], [...command.slice(1), runtime], {
    input: JSON.stringify(request),
    maxBuffer: 1 << 26,
    env: oracleEnv(),
  });
  const line = run.stdout.toString().trim();
  const answer = JSON.parse(line);
  if (run.status !== 0 || answer.error) {
    return { error: answer.error ?? `exit ${run.status}: ${run.stderr}` };
  }
  return answer;
}

/** The decision with its one nondeterministic field removed. */
export function comparable(decision) {
  if (decision.error) return decision;
  const stats = { ...decision.stats };
  delete stats.elapsedMs;
  return { ...decision, stats };
}
