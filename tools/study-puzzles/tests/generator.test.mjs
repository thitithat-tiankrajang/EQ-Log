// node --test tools/study-puzzles/tests/generator.test.mjs
//
// The generator end to end on the stand-in engine (fake-engine.mjs): real
// seeded self-play under the real rules, real filters, real archive writes.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createSet, newSetId, readJson } from "../lib/archive.mjs";
import { configFrom } from "../lib/config.mjs";
import { createEngine, engineStatus } from "../lib/engine.mjs";
import { gameSeed, generateSet } from "../lib/generate.mjs";
import { positionOf, replayStudyLog, studyLogProblems } from "../lib/provenance.mjs";
import {
  assertPlayerSafe,
  attemptRecord,
  gradeAttempt,
  judgeSubmission,
  playerProjection,
  positionHash,
} from "../lib/record.mjs";
import { createFakeEngine } from "./fake-engine.mjs";
import { verifyProvenance } from "../lib/verify.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const RUN = join(here, "../generator/run.mjs");
const FAKE = join(here, "fake-engine.mjs");
const temporary = [];
after(() => temporary.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const LENIENT = {
  search: { strategy: "AUTHENTIC_ONLY", rackBudget: 24 },
  seed: 5,
  target: 2,
  maxPerGame: 2,
  parallelGames: 1,
  position: { boardTiles: { min: 1, max: 100 } },
  answer: { maxNear: 12 },
};

async function newSet(overrides = {}) {
  const archiveDir = mkdtempSync(join(tmpdir(), "study-generate-"));
  temporary.push(archiveDir);
  const id = newSetId();
  await createSet({
    archiveDir,
    id,
    config: configFrom({ ...LENIENT, ...overrides }),
    engine: { analysis: "fake" },
  });
  return join(archiveDir, id);
}

const puzzlesOf = (dir, manifest) =>
  Promise.all(manifest.puzzles.map((entry) => readJson(join(dir, entry.file))));

const passFirst = (result) => ({
  ...result,
  candidates: [
    {
      type: "pass",
      placements: [],
      exchange: [],
      score: 0,
      value: 1000,
      chosen: true,
      components: [],
    },
    ...result.candidates.map((c) => ({ ...c, chosen: false })),
  ],
});

describe("guided generation through the engine boundary", () => {
  async function run({ failGuided = false, stopPhase = null } = {}) {
    const dir = await newSet({
      target: 1,
      maxPerGame: 1,
      parallelGames: 1,
      search: { strategy: "GUIDED", rackBudget: 4 },
      bestPlay: { excludeTrivialZero: false },
    });
    const controller = new AbortController();
    const base = createFakeEngine();
    let purpose = "source",
      guidedCalls = 0;
    const requested = new Set();
    const engine = {
      ...base,
      async analyze(request) {
        if (purpose === "guided") {
          const key = JSON.stringify(request);
          assert.equal(requested.has(key), false, "a guided rack must not be evaluated twice");
          requested.add(key);
          guidedCalls++;
        }
        const result = await base.analyze(request);
        return request.board.length && (purpose === "source" || failGuided)
          ? passFirst(result)
          : result;
      },
    };
    const timer = setTimeout(() => controller.abort(), 15_000);
    const manifest = await generateSet({
      dir,
      engine,
      signal: controller.signal,
      emit: (event) => {
        if (event.type === "search" && event.phase === "stage5b") purpose = event.purpose;
        if (event.type === "search" && event.phase === stopPhase) controller.abort();
        if (failGuided && event.type === "search" && event.phase === "rack" && guidedCalls >= 2)
          controller.abort();
      },
    });
    clearTimeout(timer);
    return { manifest, puzzles: await puzzlesOf(dir, manifest), guidedCalls };
  }
  it("accepts a constructed rack when the authentic best action does not match", async () => {
    const {
      manifest,
      puzzles: [p],
    } = await run();
    assert.equal(manifest.status, "complete");
    assert.equal(p.canonical.provenance.origin, "CONFIG_GUIDED_RACK");
    assert.equal(manifest.counters.acceptedGuided, 1);
    assert.equal(verifyProvenance(p).ok, true);
    assertPlayerSafe(playerProjection(p));
    assert.equal(
      gradeAttempt(
        p,
        attemptRecord({
          puzzle: p,
          id: "att-guided",
          judged: judgeSubmission(p, p.answer.best.placements),
        }),
      ).sameAsBest,
      true,
    );
  });
  it("never accepts a matching rank 2 when rank 1 is a pass", async () => {
    const { manifest, guidedCalls } = await run({ failGuided: true });
    assert.ok(guidedCalls >= 2);
    assert.equal(manifest.puzzles.length, 0);
    assert.ok(manifest.counters.rejections["bestPlay.notPlacement"] >= 2);
  });
  it("stops before starting engine work when stopped during rack generation", async () => {
    const { manifest, guidedCalls } = await run({ stopPhase: "rack" });
    assert.equal(manifest.status, "stopped");
    assert.equal(guidedCalls, 0);
  });
  for (const phase of ["stage5b", "position"])
    it(`Stop at ${phase} keeps completed guided puzzles and ends engine work`, async () => {
      const dir = await newSet({
        target: 3,
        maxPerGame: 2,
        parallelGames: 1,
        search: { strategy: "GUIDED", rackBudget: 4 },
        bestPlay: { excludeTrivialZero: false },
      });
      const controller = new AbortController();
      const base = createFakeEngine({ delayMs: 25 });
      let purpose = "source",
        guidedCompleted = 0,
        stopSent = false;
      const engine = {
        ...base,
        async analyze(request) {
          if (phase === "stage5b" && purpose === "guided" && guidedCompleted >= 1) {
            stopSent = true;
            setTimeout(() => controller.abort(), 1);
          }
          const result = await base.analyze(request);
          if (purpose === "guided") guidedCompleted++;
          return request.board.length && purpose === "source" ? passFirst(result) : result;
        },
      };
      const timer = setTimeout(() => controller.abort(), 15_000);
      const manifest = await generateSet({
        dir,
        engine,
        signal: controller.signal,
        emit: (event) => {
          if (event.type === "search" && event.phase === "stage5b") purpose = event.purpose;
          if (
            phase === "position" &&
            event.type === "search" &&
            event.phase === "position" &&
            guidedCompleted >= 1
          ) {
            stopSent = true;
            controller.abort();
          }
        },
      });
      clearTimeout(timer);
      assert.equal(stopSent, true);
      assert.equal(manifest.status, "stopped");
      assert.equal(base.active, 0);
      assert.equal(manifest.puzzles.length, 1);
      const [p] = await puzzlesOf(dir, manifest);
      assert.equal(p.canonical.provenance.origin, "CONFIG_GUIDED_RACK");
      assert.equal(verifyProvenance(p).ok, true);
      assert.equal((await readJson(join(dir, "set.json"))).puzzles.length, 1);
    });
});

describe("generating a set", () => {
  it("GUIDED prefers an authentic match before constructing any alternative rack", async () => {
    const dir = await newSet({
      target: 1,
      maxPerGame: 1,
      search: { strategy: "GUIDED", rackBudget: 8 },
      bestPlay: { excludeTrivialZero: false },
    });
    const manifest = await generateSet({ dir, engine: createFakeEngine() });
    const [puzzle] = await puzzlesOf(dir, manifest);
    assert.equal(puzzle.canonical.provenance.origin, "AUTHENTIC_SEEDED");
    assert.equal(manifest.counters.acceptedAuthentic, 1);
    assert.equal(manifest.counters.guidedRacksGenerated, 0);
  });
  it("fills the target, and every puzzle replays to exactly its position and rack", async () => {
    const dir = await newSet();
    const events = [];
    const manifest = await generateSet({
      dir,
      engine: createFakeEngine(),
      emit: (e) => events.push(e),
    });
    assert.equal(manifest.status, "complete");
    assert.equal(manifest.puzzles.length, 2);
    assert.equal(events.filter((event) => event.type === "accepted").length, 2);
    assert.deepEqual(events.at(-1), {
      type: "finished",
      status: "complete",
      matched: 2,
      target: 2,
      error: null,
    });
    for (const puzzle of await puzzlesOf(dir, manifest)) {
      const log = puzzle.canonical.source.log;
      assert.equal(log.sourceSeed, gameSeed(5, puzzle.canonical.source.game));
      for (const mode of ["seed", "log"]) {
        const state = replayStudyLog(log, mode);
        assert.deepEqual(studyLogProblems(log, state), []);
        // The whole position — the rack the game dealt, the hidden bag — is the replay's.
        assert.deepEqual(positionOf(state), puzzle.canonical.position, `${mode} replay`);
      }
      assert.equal(positionHash(puzzle.canonical.position), puzzle.hashes.position);
      assert.equal(
        puzzle.canonical.source.log.turns.length,
        puzzle.canonical.position.turnNumber - 1,
      );
      assert.deepEqual(puzzle.answer.checks, {
        stage5b: puzzle.answer.best.score,
        eqlab: puzzle.answer.best.score,
        amathCli: puzzle.answer.best.score,
      });
      assert.ok(puzzle.answer.moveTypes.length > 0);
      assert.equal(puzzle.answer.equations[0].role, "main");
    }
    const onDisk = await readJson(join(dir, "set.json"));
    assert.equal(onDisk.status, "complete");
    assert.deepEqual(onDisk.puzzles, manifest.puzzles);
  });

  it("keeps every puzzle already made when stopped", async () => {
    const dir = await newSet({ target: 50, maxPerGame: 5 });
    const controller = new AbortController();
    const manifest = await generateSet({
      dir,
      engine: createFakeEngine(),
      signal: controller.signal,
      emit: (event) => event.type === "accepted" && controller.abort(),
    });
    assert.equal(manifest.status, "stopped");
    assert.ok(manifest.puzzles.length >= 1 && manifest.puzzles.length < 50);
    for (const entry of manifest.puzzles) assert.ok(existsSync(join(dir, entry.file)));
    const onDisk = await readJson(join(dir, "set.json"));
    assert.equal(onDisk.status, "stopped");
    assert.deepEqual(onDisk.puzzles, manifest.puzzles);
  });

  it("makes the same set from the same seed, however many games run at once", async () => {
    const one = await generateSet({ dir: await newSet({ target: 3 }), engine: createFakeEngine() });
    const two = await generateSet({
      dir: await newSet({ target: 3, parallelGames: 2 }),
      engine: createFakeEngine(),
    });
    assert.equal(one.puzzles.length, 3);
    assert.deepEqual(
      two.puzzles.map((puzzle) => puzzle.id),
      one.puzzles.map((puzzle) => puzzle.id),
    );
  });

  it("searches until stopped when nothing matches, and counts why", async () => {
    const dir = await newSet({ target: 1, bestPlay: { score: { min: 999 } } });
    const controller = new AbortController();
    const manifest = await generateSet({
      dir,
      engine: createFakeEngine(),
      signal: controller.signal,
      emit: (event) =>
        event.type === "progress" && event.counters.positionsInspected >= 20 && controller.abort(),
    });
    assert.equal(manifest.status, "stopped");
    assert.equal(manifest.puzzles.length, 0);
    assert.ok(manifest.counters.positionsInspected >= 20);
    assert.ok(manifest.counters.rejections["bestPlay.score"] > 0);
    assert.equal(
      manifest.counters.rejectedPositions,
      manifest.counters.positionsInspected - manifest.counters.matchingPositions,
    );
  });

  it("fails the set, keeping it consistent, when the engine keeps failing", async () => {
    const dir = await newSet();
    const manifest = await generateSet({ dir, engine: createFakeEngine({ failAll: true }) });
    assert.equal(manifest.status, "failed");
    assert.match(manifest.error, /5 games in a row failed/);
    assert.equal(manifest.counters.gamesAbandoned, 5);
    assert.equal((await readJson(join(dir, "set.json"))).status, "failed");
  });
});

describe("one puzzle, as a player gets it", () => {
  let puzzle;
  it("is built", async () => {
    const dir = await newSet({ target: 1 });
    const manifest = await generateSet({ dir, engine: createFakeEngine() });
    [puzzle] = await puzzlesOf(dir, manifest);
    assert.ok(puzzle);
  });

  it("shows the position and nothing of the answer, the source game or the bag", () => {
    const projection = playerProjection(puzzle);
    assert.deepEqual(Object.keys(projection).sort(), [
      "format",
      "position",
      "positionHash",
      "puzzleId",
      "rules",
      "setId",
    ]);
    assert.deepEqual(projection.position.rack, puzzle.canonical.position.rack);
    const unseen = Object.values(projection.position.unseen).reduce((sum, n) => sum + n, 0);
    assert.equal(unseen, projection.position.bagCount + projection.position.oppRackCount);
    const text = JSON.stringify(projection);
    for (const leak of [
      '"answer"',
      '"best"',
      '"nearBest"',
      '"equations"',
      '"pattern',
      '"moveType',
      '"features"',
      '"hidden"',
      '"bag"',
      '"opponentRack"',
      '"seed"',
      '"log"',
      '"stateHash"',
    ]) {
      assert.ok(!text.includes(leak), `projection contains ${leak}`);
    }
    // Every placed tile of the answer is still off the board in what the player sees.
    for (const tile of puzzle.answer.best.placements) {
      assert.ok(!projection.position.board.some((cell) => cell.r === tile.r && cell.c === tile.c));
    }
    assert.throws(() => assertPlayerSafe({ ...projection, answer: {} }), /answer/);
  });

  it("judges a submission as the player's own move and records it without the answer", () => {
    const own = judgeSubmission(puzzle, puzzle.answer.best.placements);
    assert.equal(own.valid, true);
    assert.equal(own.score, puzzle.answer.best.score);
    const missing = puzzle.canonical.position.rack.includes("20") ? "19" : "20";
    const refused = judgeSubmission(puzzle, [{ r: 0, c: 0, kind: missing, face: missing }]);
    assert.equal(refused.valid, false);
    assert.match(refused.errors[0], /rack holds no/);

    const attempt = attemptRecord({
      puzzle,
      id: "att-20260925-000000-abcdef",
      submittedAt: "2026-09-25T00:00:00.000Z",
      by: { kind: "admin-preview" },
      judged: own,
    });
    assert.equal(attempt.puzzleHash, puzzle.hashes.puzzle);
    assert.ok(!JSON.stringify(attempt).includes('"best"'));
    assert.deepEqual(gradeAttempt(puzzle, attempt), {
      comparable: true,
      sameAsBest: true,
      withinNearBest: true,
      engineRank: 1,
      scoreRatio: 1,
    });
  });
});

/** Runs the generator process until `onEvent` asks for something; resolves with its exit. */
function runProcess(dir, onEvent) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [RUN, `--dir=${dir}`, `--engine=${FAKE}`], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const events = [];
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (!line) continue;
        const event = JSON.parse(line);
        events.push(event);
        onEvent(event, child);
      }
    });
    child.on("close", (code) => resolve({ code, events }));
  });
}

describe("the generator process", () => {
  it("stops on SIGTERM and keeps what it made", async () => {
    const dir = await newSet({ target: 50, maxPerGame: 5 });
    let sent = false;
    const { code, events } = await runProcess(dir, (event, child) => {
      if (event.type === "accepted" && !sent) {
        sent = true;
        child.kill("SIGTERM");
      }
    });
    assert.equal(code, 0);
    assert.equal(events.at(-1).type, "finished");
    assert.equal(events.at(-1).status, "stopped");
    const manifest = await readJson(join(dir, "set.json"));
    assert.equal(manifest.status, "stopped");
    assert.ok(manifest.puzzles.length >= 1);
    for (const entry of manifest.puzzles) assert.ok(existsSync(join(dir, entry.file)));
  });

  it("stops when whatever started it goes away (stdin closes)", async () => {
    const dir = await newSet({ target: 50, maxPerGame: 5 });
    let closed = false;
    const { code } = await runProcess(dir, (event, child) => {
      if (event.type === "accepted" && !closed) {
        closed = true;
        child.stdin.end();
      }
    });
    assert.equal(code, 0);
    assert.equal((await readJson(join(dir, "set.json"))).status, "stopped");
  });
});

describe("the real engine", () => {
  const ready = engineStatus().ready;
  it(
    "ends every child it started when stopped",
    { skip: !ready && "amath-engine not present" },
    async () => {
      const engine = createEngine();
      const request = {
        board: [],
        rack: ["1", "2", "3", "=", "+", "4", "5", "6"],
        bagCount: 84,
        oppRackCount: 8,
        myScore: 0,
        oppScore: 0,
        noScoreStreak: 0,
        exchangeAllowed: true,
        seed: 1,
        topN: 50,
      };
      const running = engine.analyze(request);
      assert.equal(engine.active, 1);
      engine.killAll();
      await assert.rejects(running, (error) => error.stopped === true);
      assert.equal(engine.active, 0);
      await assert.rejects(engine.analyze(request), (error) => error.stopped === true);
    },
  );
});
