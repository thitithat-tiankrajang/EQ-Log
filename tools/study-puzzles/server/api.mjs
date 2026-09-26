// Study puzzle sets for the admin page and the one-turn preview: Connect-style
// middleware for the Vite dev server, equally usable on a bare node:http server
// (the tests). Local only (DESIGN.md §2, §7, §8).
//
//   GET  /api/status                              engine readiness + the running job (live counters)
//   POST /api/generate            {config}        start a set in its own process; one at a time
//   POST /api/cancel                              Stop: the set keeps every puzzle already made
//   GET  /api/sets                                the archive (v2 sets and Codex's v1 sets), newest first
//   GET  /api/sets/:id                            a set for the admin (v2 manifest | v1 puzzles)
//   GET  /api/sets/:id/:file                      a v1 set's own student.html | teacher.html | puzzles.json
//   GET  /api/sets/:id/puzzles/:pid               ADMIN: the whole puzzle + its attempts, graded
//   POST /api/sets/:id/puzzles/:pid/verify        ADMIN: replay the source log to the puzzle position
//   GET  /api/sets/:id/puzzles/:pid/play          PLAYER: the projection, nothing of the answer
//   POST /api/sets/:id/puzzles/:pid/attempts      PLAYER: submit one placement; the answer is not revealed
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ARCHIVE_DIR,
  ArchiveError,
  createSet,
  listAttempts,
  listSets,
  markInterrupted,
  newAttemptId,
  newSetId,
  readPuzzle,
  readSet,
  readV1File,
  setDirOf,
  writeAttempt,
} from "../lib/archive.mjs";
import { configFrom, StudyConfigError } from "../lib/config.mjs";
import { ENGINE_DIR, engineStatus, engineVersions, createEngine } from "../lib/engine.mjs";
import { verifyPuzzle } from "../lib/verify.mjs";
import {
  assertPlayerSafe,
  attemptRecord,
  gradeAttempt,
  judgeSubmission,
  playerProjection,
} from "../lib/record.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const TOOL_DIR = resolve(here, "..");
const GENERATOR = join(TOOL_DIR, "generator/run.mjs");
const LOG_LINES = 60;
const RECENT = 8;
const KILL_AFTER_MS = 5000;
const FILE_TYPES = new Map([
  ["student.html", "text/html; charset=utf-8"],
  ["teacher.html", "text/html; charset=utf-8"],
  ["puzzles.json", "application/json; charset=utf-8"],
]);

class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const libFiles = () =>
  readdirSync(join(TOOL_DIR, "lib"))
    .filter((name) => name.endsWith(".mjs"))
    .sort()
    .map((name) => join(TOOL_DIR, "lib", name));

function sha256Of(files) {
  const hash = createHash("sha256");
  for (const file of files) hash.update(readFileSync(file));
  return hash.digest("hex");
}

/** A hash of the generator's own code, recorded with every set it makes. */
const generatorSha256 = () => sha256Of([GENERATOR, ...libFiles()]);

/** Everything a request here runs: this server, the generator and lib/, as on disk now. */
const studyCodeSha256 = () => sha256Of([fileURLToPath(import.meta.url), GENERATOR, ...libFiles()]);

// The code this process imported. The dev server imports this module on its first
// request and keeps it until it exits, so an edit to server/ or lib/ after that
// never reaches it — while every generator it spawns runs the edited code.
const LOADED_CODE = studyCodeSha256();

async function readJsonBody(req, limit = 32 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError("request too large", 413);
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError("the request is not JSON");
  }
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

/**
 * @param {{ archiveDir?: string, engineDir?: string, generatorEngine?: string, now?: () => Date, codeFingerprint?: () => string }} [options]
 *   `generatorEngine` is a module path handed to the generator as `--engine=`
 *   (the tests' stand-in); with it the amath-engine checkout is not required.
 *   `codeFingerprint` hashes the Study code on disk now (the tests' stand-in for an edit).
 */
export function createStudyPuzzleApi({
  archiveDir = ARCHIVE_DIR,
  engineDir = ENGINE_DIR,
  generatorEngine = null,
  now = () => new Date(),
  codeFingerprint = studyCodeSha256,
} = {}) {
  let job = null;
  let child = null;
  let killTimer = null;

  // A set generated, or a puzzle verified, by code older than the disk would be
  // judged by rules nobody can see any more — refuse until the server restarts.
  function assertCurrentCode() {
    if (codeFingerprint() === LOADED_CODE) return;
    throw new HttpError(
      "โค้ดของ tools/study-puzzles เปลี่ยนหลังจาก npm run dev โหลด API นี้ไว้ เซิร์ฟเวอร์นี้ยังใช้โค้ดเดิมอยู่ ให้ปิดแล้วเปิด npm run dev ใหม่ก่อน",
      503,
    );
  }

  const publicJob = () => (job ? { ...job, logs: [...job.logs], recent: [...job.recent] } : null);
  const log = (line) => {
    job.logs.push(line);
    job.logs = job.logs.slice(-LOG_LINES);
  };

  function onEvent(event) {
    if (event.type === "progress") {
      job.counters = event.counters;
      job.elapsedMs = event.elapsedMs;
    } else if (event.type === "accepted") {
      job.matched = event.matched;
      job.recent = [...job.recent, event.puzzle].slice(-RECENT);
      log(
        `✓ ${event.matched}/${event.target} ${event.puzzle.id} ${event.puzzle.moveTypes.join("+")} ${event.puzzle.score} แต้ม`,
      );
    } else if (event.type === "log") {
      log(event.message);
    } else if (event.type === "finished") {
      job.state = event.status;
      job.matched = event.matched;
      job.error = event.error;
      job.finishedAt = now().toISOString();
    } else if (event.type === "fatal") {
      job.error = event.message;
      log(`fatal: ${event.message}`);
    }
  }

  async function start(body) {
    assertCurrentCode();
    if (job?.state === "running") throw new HttpError("กำลังสร้างชุดโจทย์อยู่", 409);
    const config = configFrom(body?.config ?? body);
    if (!generatorEngine) {
      const engine = engineStatus(engineDir);
      if (!engine.ready) throw new HttpError(engine.problems.join(" · "), 503);
    }
    const id = newSetId(now());
    await createSet({
      archiveDir,
      id,
      config,
      now: now(),
      engine: {
        ...(generatorEngine ? { analysis: "test-engine" } : engineVersions(engineDir)),
        generatorSha256: generatorSha256(),
      },
    });
    job = {
      id,
      state: "running",
      config,
      target: config.target,
      startedAt: now().toISOString(),
      finishedAt: null,
      elapsedMs: 0,
      matched: 0,
      counters: null,
      recent: [],
      logs: [],
      error: null,
      stopRequested: false,
    };
    const running = job;
    const args = [GENERATOR, `--dir=${join(archiveDir, id)}`];
    if (generatorEngine) args.push(`--engine=${generatorEngine}`);
    // Its own process group, so Stop can end the generator and every engine
    // process it started; its stdin stays open, so it stops if we go away.
    child = spawn(process.execPath, args, {
      cwd: TOOL_DIR,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: engineDir === ENGINE_DIR ? process.env : { ...process.env, AMATH_ENGINE_DIR: engineDir },
    });
    const current = child;
    let buffer = "";
    let stderr = "";
    current.stdout.on("data", (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (!line.trim() || job !== running) continue;
        try {
          onEvent(JSON.parse(line));
        } catch {
          log(line);
        }
      }
    });
    current.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    current.stdin.on("error", () => {});
    current.on("close", (code, signal) => {
      if (killTimer) clearTimeout(killTimer);
      killTimer = null;
      if (child === current) child = null;
      if (job !== running || job.state !== "running") return;
      // It ended without saying how: whatever it wrote stays; the set says it was cut short.
      const reason = `generator ended (${signal ?? `exit ${code}`})${stderr ? `: ${stderr.trim().split("\n").at(-1)}` : ""}`;
      job = {
        ...job,
        state: "interrupted",
        finishedAt: now().toISOString(),
        error: job.error ?? reason,
      };
      void markInterrupted(archiveDir, running.id, reason);
    });
    return id;
  }

  function stop() {
    if (job?.state !== "running" || !child) throw new HttpError("ไม่มีชุดที่กำลังสร้าง", 409);
    job.stopRequested = true;
    const current = child;
    current.kill("SIGTERM");
    killTimer = setTimeout(() => {
      try {
        process.kill(-current.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }, KILL_AFTER_MS);
    killTimer.unref?.();
  }

  const liveId = () => (job?.state === "running" ? job.id : null);

  async function puzzleFor(setId, puzzleId) {
    return readPuzzle(archiveDir, setId, puzzleId);
  }

  async function handle(req, res, next) {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] !== "api") return next?.();
    const [, resource, setId, sub, puzzleId, action] = parts;
    try {
      if (req.method === "GET" && resource === "status" && parts.length === 2) {
        return sendJson(res, 200, { engine: engineStatus(engineDir), job: publicJob() });
      }
      if (req.method === "POST" && resource === "generate" && parts.length === 2) {
        return sendJson(res, 202, { id: await start(await readJsonBody(req)) });
      }
      if (req.method === "POST" && resource === "cancel" && parts.length === 2) {
        stop();
        return sendJson(res, 202, { job: publicJob() });
      }
      if (resource !== "sets") throw new HttpError("ไม่พบหน้านี้", 404);

      if (req.method === "GET" && parts.length === 2) {
        return sendJson(res, 200, { sets: await listSets(archiveDir, liveId()) });
      }
      if (req.method === "GET" && parts.length === 3) {
        return sendJson(res, 200, await readSet(archiveDir, setId, liveId()));
      }
      if (req.method === "GET" && parts.length === 4 && FILE_TYPES.has(sub)) {
        const data = await readV1File(archiveDir, setId, sub);
        res.statusCode = 200;
        res.setHeader("content-type", FILE_TYPES.get(sub));
        res.setHeader("cache-control", "no-store");
        if (sub === "puzzles.json") {
          res.setHeader("content-disposition", `attachment; filename="${setId}.json"`);
        }
        return res.end(data);
      }
      if (sub !== "puzzles" || !puzzleId) throw new HttpError("ไม่พบหน้านี้", 404);

      if (req.method === "GET" && parts.length === 5) {
        const puzzle = await puzzleFor(setId, puzzleId);
        const attempts = await listAttempts(archiveDir, setId, puzzleId);
        return sendJson(res, 200, {
          puzzle,
          attempts: attempts.map((attempt) => ({
            ...attempt,
            grade: gradeAttempt(puzzle, attempt),
          })),
        });
      }
      if (req.method === "POST" && action === "verify" && parts.length === 6) {
        assertCurrentCode();
        const puzzle = await puzzleFor(setId, puzzleId);
        const set = await readSet(archiveDir, setId, liveId());
        const archivedConfig = set.manifest?.config;
        const expanded = archivedConfig && (archivedConfig.geometry || archivedConfig.equation || archivedConfig.mobility || archivedConfig.rack?.groups || archivedConfig.bestPlay?.specific);
        const engine = generatorEngine
          ? (await import(pathToFileURL(resolve(generatorEngine)).href)).createEngine()
          : createEngine({ engineDir });
        try {
          return sendJson(res, 200, await verifyPuzzle(puzzle, engine, expanded ? archivedConfig : null));
        } finally {
          engine.killAll();
        }
      }
      if (req.method === "GET" && action === "play" && parts.length === 6) {
        return sendJson(res, 200, playerProjection(await puzzleFor(setId, puzzleId)));
      }
      if (req.method === "POST" && action === "attempts" && parts.length === 6) {
        const puzzle = await puzzleFor(setId, puzzleId);
        const body = await readJsonBody(req);
        const judged = judgeSubmission(puzzle, body?.placements);
        if (!judged.valid) {
          return sendJson(res, 422, assertPlayerSafe({ valid: false, errors: judged.errors }));
        }
        const attempt = attemptRecord({
          puzzle,
          id: newAttemptId(now()),
          submittedAt: now().toISOString(),
          by: { kind: body?.by === "player" ? "player" : "admin-preview" },
          judged,
        });
        await writeAttempt(archiveDir, attempt);
        // The player's own move, scored — and nothing about the engine's answer.
        return sendJson(
          res,
          201,
          assertPlayerSafe({
            attemptId: attempt.id,
            valid: true,
            score: judged.score,
            yourEquations: judged.equations,
          }),
        );
      }
      throw new HttpError("ไม่พบหน้านี้", 404);
    } catch (error) {
      const status =
        error instanceof HttpError ||
        error instanceof ArchiveError ||
        error instanceof StudyConfigError
          ? error.status
          : 500;
      return sendJson(res, status, { error: error.message });
    }
  }

  return {
    middleware: (req, res, next) => void handle(req, res, next),
    close: async () => {
      if (child) {
        child.kill("SIGTERM");
        child.stdin.end();
      }
    },
    /** For tests: the set folder a set id lives in. */
    setDir: (id) => setDirOf(archiveDir, id),
  };
}
