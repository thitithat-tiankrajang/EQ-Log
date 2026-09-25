// The archive: one folder per set (DESIGN.md §3).
//
//   v2  set.json (eqlab-study-puzzle-set-v2) + puzzles/<id>.json + attempts/<puzzle>/<attempt>.json
//   v1  puzzles.json (find-best-play-v1) + student.html + teacher.html [+ set.json]
//       — made by Codex's generator; read-only here.
//
// Every write is temp-file + rename, and a puzzle file is always written before
// the manifest that lists it, so a manifest on disk never names a puzzle that
// is not complete — whatever happens to the process writing them.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MOVE_TYPES } from "./config.mjs";

const EQLAB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const ARCHIVE_DIR = join(EQLAB_ROOT, "tools/study-puzzles/archive");
export const SET_SCHEMA_V2 = "eqlab-study-puzzle-set-v2";
const PUZZLES_V1 = "find-best-play-v1";
export const SET_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const PUZZLE_ID = /^pz-[0-9a-f]{12}$/;
export const ATTEMPT_ID = /^att-[0-9a-z-]{6,64}$/;
const V1_MODES = new Set([
  "any",
  "bingo",
  "cross",
  "arithmetic",
  "fraction",
  "fraction-sum",
  "large",
]);

export class ArchiveError extends Error {
  constructor(message, status = 404) {
    super(message);
    this.status = status;
  }
}

export function newSetId(now = new Date()) {
  const stamp = now
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  return `set-${stamp.slice(0, 8)}-${stamp.slice(8)}-${randomBytes(3).toString("hex")}`;
}

export function newAttemptId(now = new Date()) {
  const stamp = now
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14)
    .toLowerCase();
  return `att-${stamp}-${randomBytes(3).toString("hex")}`;
}

export function setDirOf(archiveDir, id) {
  if (typeof id !== "string" || !SET_ID.test(id)) throw new ArchiveError("ไม่พบชุดโจทย์นี้");
  return join(archiveDir, id);
}

function puzzleFileOf(archiveDir, setId, puzzleId) {
  if (typeof puzzleId !== "string" || !PUZZLE_ID.test(puzzleId))
    throw new ArchiveError("ไม่พบโจทย์นี้");
  return join(setDirOf(archiveDir, setId), "puzzles", `${puzzleId}.json`);
}

export async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path);
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function emptyCounters() {
  return {
    gamesStarted: 0,
    gamesFinished: 0,
    gamesAbandoned: 0,
    positionsInspected: 0,
    positionsAnalyzed: 0,
    positionsEligible: 0,
    candidatesEvaluated: 0,
    matched: 0,
    rejectedPositions: 0,
    rejections: {},
    positionsGeometryPruned: 0,
    authenticRacksCompositionPruned: 0,
    guidedRacksGenerated: 0,
    guidedRacksCheapPruned: 0,
    stage5bEvaluations: 0,
    sourceStage5bEvaluations: 0,
    guidedStage5bEvaluations: 0,
    stage5bMatches: 0,
    stage5bMs: 0,
    cheapCheckMs: 0,
    acceptedAuthentic: 0,
    acceptedGuided: 0,
    duplicateRacksSkipped: 0,
    engineErrors: 0,
  };
}

/** A new set's manifest, on disk before its generator starts. */
export async function createSet({ archiveDir, id, config, engine, now = new Date() }) {
  const manifest = {
    schema: SET_SCHEMA_V2,
    id,
    label: config.label,
    status: "running",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    finishedAt: null,
    target: config.target,
    config,
    engine,
    counters: emptyCounters(),
    error: null,
    puzzles: [],
  };
  await writeJsonAtomic(join(setDirOf(archiveDir, id), "set.json"), manifest);
  return manifest;
}

export const writeManifest = (dir, manifest) =>
  writeJsonAtomic(join(dir, "set.json"), { ...manifest, updatedAt: new Date().toISOString() });

/** The puzzle file first, then the manifest that lists it. */
export async function commitPuzzle(dir, manifest, puzzle, summary) {
  await writeJsonAtomic(join(dir, "puzzles", `${puzzle.id}.json`), puzzle);
  manifest.puzzles.push(summary);
  await writeManifest(dir, manifest);
}

// ── reading ──────────────────────────────────────────────────────────────────
const scoreRange = (scores) => {
  const finite = scores.filter(Number.isFinite);
  return finite.length ? [Math.min(...finite), Math.max(...finite)] : null;
};

async function readV1(dir, id) {
  const data = await readJson(join(dir, "puzzles.json"));
  if (data?.schema !== PUZZLES_V1 || !Array.isArray(data.puzzles)) {
    throw new ArchiveError(`ชุดโจทย์ ${id} อ่านไม่ได้`, 500);
  }
  const meta = await readJson(join(dir, "set.json")).catch(() => null);
  const createdAt = meta?.createdAt ?? (await stat(join(dir, "puzzles.json"))).mtime.toISOString();
  const filters = data.filters ?? {};
  return {
    summary: {
      id,
      version: 1,
      label: meta?.config?.label || null,
      status: "complete",
      createdAt,
      count: data.puzzles.length,
      requested: Number(filters.count) || data.puzzles.length,
      mode: V1_MODES.has(filters.mode) ? filters.mode : "any",
      scoreRange: scoreRange(data.puzzles.map((puzzle) => puzzle?.answer?.score)),
    },
    data,
    meta,
  };
}

function summaryV2(manifest, liveId) {
  const status =
    manifest.status === "running" && manifest.id !== liveId ? "interrupted" : manifest.status;
  return {
    id: manifest.id,
    version: 2,
    label: manifest.label || null,
    status,
    createdAt: manifest.createdAt,
    finishedAt: manifest.finishedAt,
    count: manifest.puzzles.length,
    requested: manifest.target,
    mode: null,
    scoreRange: scoreRange(manifest.puzzles.map((puzzle) => puzzle.score)),
    // Every label any of its puzzles carries (a puzzle may carry several).
    moveTypes: MOVE_TYPES.filter((type) =>
      manifest.puzzles.some((puzzle) => puzzle.moveTypes?.includes(type)),
    ),
  };
}

/** Every set, newest first. `liveId` is the set a generator is writing right now. */
export async function listSets(archiveDir, liveId = null) {
  const entries = await readdir(archiveDir, { withFileTypes: true }).catch(() => []);
  const sets = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && SET_ID.test(entry.name))
      .map(async (entry) => {
        const dir = join(archiveDir, entry.name);
        try {
          const manifest = await readJson(join(dir, "set.json")).catch(() => null);
          if (manifest?.schema === SET_SCHEMA_V2) return summaryV2(manifest, liveId);
          return (await readV1(dir, entry.name)).summary;
        } catch {
          return null;
        }
      }),
  );
  return sets.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** One set for the admin: v2 manifest, or a v1 set as the v1 viewer reads it. */
export async function readSet(archiveDir, id, liveId = null) {
  const dir = setDirOf(archiveDir, id);
  const manifest = await readJson(join(dir, "set.json")).catch(() => null);
  if (manifest?.schema === SET_SCHEMA_V2) {
    return { ...summaryV2(manifest, liveId), manifest };
  }
  try {
    const { summary, data, meta } = await readV1(dir, id);
    return {
      ...summary,
      config: meta?.config ?? null,
      durationMs: meta?.durationMs ?? null,
      scanned: data.scanned ?? null,
      errors: data.errors ?? 0,
      puzzles: data.puzzles,
    };
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    throw new ArchiveError("ไม่พบชุดโจทย์นี้");
  }
}

export async function readPuzzle(archiveDir, setId, puzzleId) {
  try {
    return await readJson(puzzleFileOf(archiveDir, setId, puzzleId));
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    throw new ArchiveError("ไม่พบโจทย์นี้");
  }
}

/** A running set that lost its generator: say so on disk, keep what it made. */
export async function markInterrupted(archiveDir, id, error) {
  const dir = setDirOf(archiveDir, id);
  const manifest = await readJson(join(dir, "set.json")).catch(() => null);
  if (manifest?.schema !== SET_SCHEMA_V2 || manifest.status !== "running") return;
  await writeManifest(dir, {
    ...manifest,
    status: "interrupted",
    finishedAt: new Date().toISOString(),
    error: error ?? manifest.error,
  });
}

// ── attempts ─────────────────────────────────────────────────────────────────
export async function writeAttempt(archiveDir, attempt) {
  if (!ATTEMPT_ID.test(attempt.id)) throw new ArchiveError("bad attempt id", 400);
  const path = join(
    setDirOf(archiveDir, attempt.setId),
    "attempts",
    attempt.puzzleId,
    `${attempt.id}.json`,
  );
  puzzleFileOf(archiveDir, attempt.setId, attempt.puzzleId);
  await writeJsonAtomic(path, attempt);
}

export async function listAttempts(archiveDir, setId, puzzleId) {
  puzzleFileOf(archiveDir, setId, puzzleId);
  const dir = join(setDirOf(archiveDir, setId), "attempts", puzzleId);
  const files = await readdir(dir).catch(() => []);
  const attempts = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map((file) => readJson(join(dir, file)).catch(() => null)),
  );
  return attempts.filter(Boolean).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

/** A v1 set's own files, for the classroom pages Codex's generator wrote. */
export async function readV1File(archiveDir, setId, file) {
  if (!["student.html", "teacher.html", "puzzles.json"].includes(file))
    throw new ArchiveError("ไม่พบไฟล์นี้");
  try {
    return await readFile(join(setDirOf(archiveDir, setId), file));
  } catch {
    throw new ArchiveError("ไม่พบไฟล์นี้");
  }
}
