// The two engines the generator calls, and the request Study itself would send.
//
//   Stage 5B   amath-engine/service/stage5b/runtime.mjs — one process per
//              position, exactly as the engine service runs it.
//   validator  amath-engine/build/amath_cli worker, mode "validate".
//
// Every child is tracked, so Stop can end all of them (`killAll`).
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EQLAB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const ENGINE_DIR = resolve(
  process.env.AMATH_ENGINE_DIR ?? join(EQLAB_ROOT, "../amath-engine"),
);
export const SURVIVAL_VENDOR = join(EQLAB_ROOT, "tools/survival-generator/.vendor");
export const ANALYSIS_LEVEL = "stage5b64";
// Returned candidates only: `keepCandidates` slices AFTER ranking, so the answer
// is the one Study's own request (topN 24) gets; 50 keeps more of the list.
export const TOP_N = 50;
const RACK_SIZE = 8;
const EXCHANGE_MIN_RESERVE = 5;
const CHOICE_KINDS = new Set(["?", "+/-", "x//"]);

const paths = (engineDir) => ({
  runtime: join(engineDir, "service/stage5b/runtime.mjs"),
  validator: join(engineDir, "build/amath_cli"),
});

/** What must exist before anything runs, as an admin should read it. */
export function engineStatus(engineDir = ENGINE_DIR) {
  const problems = [];
  const { runtime, validator } = paths(engineDir);
  if (!existsSync(engineDir)) {
    problems.push(`ไม่พบ amath-engine ที่ ${engineDir} (ตั้ง AMATH_ENGINE_DIR ให้ชี้ไปที่ repo)`);
  } else {
    if (!existsSync(runtime))
      problems.push("ไม่พบ Stage 5B runtime ที่ service/stage5b/runtime.mjs");
    if (!existsSync(validator))
      problems.push("ยังไม่ได้ build ตัวตรวจกติกา: รัน make cli ใน amath-engine");
  }
  for (const file of ["authur-rules.mjs", "eqlab-rules.mjs"]) {
    if (!existsSync(join(SURVIVAL_VENDOR, file))) {
      problems.push(
        `ไม่พบกติกาที่ bundle ไว้ (${file}) ของ survival-generator: รัน node tools/survival-generator/build-vendor.mjs`,
      );
    }
  }
  return { ready: problems.length === 0, dir: engineDir, problems };
}

const sha256File = (path) =>
  existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null;

/** Versions of everything a set's answers depend on. */
export function engineVersions(engineDir = ENGINE_DIR) {
  const { runtime, validator } = paths(engineDir);
  let rulesVendor = null;
  try {
    rulesVendor = JSON.parse(readFileSync(join(SURVIVAL_VENDOR, "PROVENANCE.json"), "utf8"));
  } catch {
    rulesVendor = null;
  }
  return {
    analysis: ANALYSIS_LEVEL,
    runtimeSha256: sha256File(runtime),
    validatorSha256: sha256File(validator),
    rulesVendor,
  };
}

/** The engine service's `seedFor`: FNV-1a of the key, reduced like the service does. */
export function seedFor(key, revision = 0) {
  const text = `${key}:${revision}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2147483647 || 1;
}

/**
 * The position as Study sends it, and the engine request the Study endpoint
 * builds from it (`toStudyEngineRequest`): opponent rack = min(8, unseen), no
 * scoreless history, the exchange gate from counts, and a seed keyed on the
 * position itself. A plain operator's token is its kind (`x`, `/`), as the
 * Study page writes it — the token is part of that key.
 */
export function studyRequestFor({ board, rack, scoreSelf, scoreOpponent }) {
  const cells = board.map((cell) => ({
    r: cell.r,
    c: cell.c,
    kind: cell.kind,
    token: CHOICE_KINDS.has(cell.kind) ? cell.face : cell.kind,
  }));
  const unseen = 100 - cells.length - rack.length;
  const oppRackCount = Math.min(RACK_SIZE, unseen);
  const bagCount = unseen - oppRackCount;
  const fingerprint = [
    cells
      .map((cell) => `${cell.r},${cell.c},${cell.kind},${cell.token}`)
      .sort()
      .join("|"),
    [...rack].sort().join(","),
    scoreSelf,
    scoreOpponent,
    oppRackCount,
    bagCount,
    ANALYSIS_LEVEL,
  ].join("#");
  return {
    studyPosition: {
      board: cells,
      rack: [...rack],
      scoreSelf,
      scoreOpponent,
      level: ANALYSIS_LEVEL,
    },
    request: {
      board: cells,
      rack: [...rack],
      bagCount,
      oppRackCount,
      myScore: scoreSelf,
      oppScore: scoreOpponent,
      noScoreStreak: 0,
      exchangeAllowed: bagCount + oppRackCount - RACK_SIZE >= EXCHANGE_MIN_RESERVE,
      seed: seedFor(fingerprint, 0),
      topN: TOP_N,
    },
  };
}

export class EngineStopped extends Error {
  constructor() {
    super("stopped");
    this.stopped = true;
  }
}

/** Calls into both engines, every child process accounted for. */
export function createEngine({ engineDir = ENGINE_DIR, timeoutMs = 120_000 } = {}) {
  const { runtime, validator } = paths(engineDir);
  const children = new Set();
  let stopped = false;

  function run(command, args, input, timeout) {
    if (stopped) return Promise.reject(new EngineStopped());
    return new Promise((resolveRun, reject) => {
      const child = spawn(command, args, { cwd: engineDir, stdio: ["pipe", "pipe", "pipe"] });
      children.add(child);
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeout);
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-2000);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        children.delete(child);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        children.delete(child);
        if (stopped) return reject(new EngineStopped());
        if (timedOut) return reject(new Error(`timed out after ${timeout} ms`));
        try {
          const result = JSON.parse(stdout.trim());
          if (code !== 0 || result.error) throw new Error(result.error ?? `exit ${code}`);
          resolveRun(result);
        } catch (error) {
          reject(new Error(`${error.message}${stderr ? `; ${stderr.slice(-300)}` : ""}`));
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify(input));
    });
  }

  return {
    /** Stage 5B on one position; the result the engine service would get. */
    analyze: (request) => run(process.execPath, [runtime], request, timeoutMs),
    /** The C++ rules on one move: `{ valid, score, reason? }`. */
    validate: (request, move) =>
      run(validator, ["worker"], { ...request, mode: "validate", move }, 20_000),
    get active() {
      return children.size;
    },
    /** End every running child; later calls reject with EngineStopped. */
    killAll() {
      stopped = true;
      for (const child of children) child.kill("SIGTERM");
      const stragglers = [...children];
      setTimeout(() => {
        for (const child of stragglers) {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        }
      }, 1000).unref();
    },
  };
}
