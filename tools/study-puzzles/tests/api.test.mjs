// node --test tools/study-puzzles/tests/api.test.mjs
//
// The dev API over HTTP: generation in its own process (on the stand-in engine),
// Stop, the admin views, replay verification, the player projection and the
// one-turn submission. The last test runs the real engine when it is present.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { engineStatus } from "../lib/engine.mjs";
import { createStudyPuzzleApi } from "../server/api.mjs";
import { readJson, createSet, commitPuzzle } from "../lib/archive.mjs";
import { buildPuzzle, summaryOf } from "../lib/record.mjs";
import { constructBranch } from "../lib/branch.mjs";
import { replayStudyLog, positionOf } from "../lib/provenance.mjs";
import { configDrift, configFrom } from "../lib/config.mjs";
import { studyRequestFor } from "../lib/engine.mjs";
import { analyzePlacement, nearBestOf } from "../lib/analysis.mjs";
import { createFakeEngine } from "./fake-engine.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const FAKE = join(here, "fake-engine.mjs");
// The "26 Sep" incident: the admin's request, what a stale API filed, the puzzle it made.
const OBSERVED = await readJson(
  join(here, "../../../tests/fixtures/study-puzzles/v2-observed-rack-26sep.json"),
);
const LENIENT = {
  search: { strategy: "AUTHENTIC_ONLY", rackBudget: 24 },
  seed: 5,
  target: 2,
  maxPerGame: 2,
  parallelGames: 1,
  label: "ทดสอบ",
  position: { boardTiles: { min: 1, max: 100 } },
  answer: { maxNear: 12 },
};

async function serve(options) {
  const api = createStudyPuzzleApi(options);
  const server = createServer((req, res) =>
    api.middleware(req, res, () => {
      res.statusCode = 404;
      res.end();
    }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const type = response.headers.get("content-type") ?? "";
    const json = type.includes("json") && !response.headers.get("content-disposition");
    return {
      status: response.status,
      headers: response.headers,
      text: json ? null : await response.text(),
      body: json ? await response.json() : null,
    };
  };
  const waitFor = async (predicate, timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { body } = await call("GET", "/api/status");
      if (predicate(body.job)) return body.job;
      if (Date.now() > deadline) throw new Error(`timed out; job: ${JSON.stringify(body.job)}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  return {
    call,
    waitFor,
    settle: (timeoutMs) => waitFor((job) => job && job.state !== "running", timeoutMs),
    close: async () => {
      await api.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

describe("the Study puzzle API", () => {
  let archiveDir;
  let server;
  let setId;
  let puzzleId;
  before(async () => {
    archiveDir = mkdtempSync(join(tmpdir(), "study-api-"));
    server = await serve({ archiveDir, generatorEngine: FAKE });
  });
  after(async () => {
    await server.close();
    rmSync(archiveDir, { recursive: true, force: true });
  });

  it("starts with no job and an empty archive", async () => {
    const status = await server.call("GET", "/api/status");
    assert.equal(status.status, 200);
    assert.equal(status.body.job, null);
    assert.ok("ready" in status.body.engine);
    assert.deepEqual((await server.call("GET", "/api/sets")).body, { sets: [] });
  });

  it("refuses a configuration that is malformed or can never match", async () => {
    const malformed = await server.call("POST", "/api/generate", {
      config: { ...LENIENT, target: 0 },
    });
    assert.equal(malformed.status, 400);
    const impossible = await server.call("POST", "/api/generate", {
      config: { ...LENIENT, bestPlay: { moveTypes: ["HOOK"], equations: { max: 1 } } },
    });
    assert.equal(impossible.status, 400);
    assert.match(impossible.body.error, /HOOK/);
    const physical = await server.call("POST", "/api/generate", {
      config: { ...LENIENT, rack: { groups: { arithmetic: { max: 1 } }, specific: { x: { min: 1 }, "-": { min: 1 } } } },
    });
    assert.equal(physical.status, 400);
    assert.match(physical.body.error, /เบี้ยในมือ|เป็นไปไม่ได้/);
    const semantic = await server.call("POST", "/api/generate", {
      config: { ...LENIENT, equation: { properties: ["MUL_DIV_ONLY", "FRACTION_ADD_SUB"] } },
    });
    assert.equal(semantic.status, 400);
    assert.match(semantic.body.error, /คูณ\/หาร/);
  });

  it("generates a set in its own process, with live counters, and files it", async () => {
    const started = await server.call("POST", "/api/generate", { config: LENIENT });
    assert.equal(started.status, 202);
    setId = started.body.id;
    assert.equal((await server.call("POST", "/api/generate", { config: LENIENT })).status, 409);
    const job = await server.settle();
    assert.equal(job.state, "complete");
    assert.equal(job.matched, 2);
    assert.equal(job.recent.length, 2);
    assert.ok(job.counters.positionsInspected > 0);
    assert.ok(job.counters.gamesStarted >= 1);

    const { sets } = (await server.call("GET", "/api/sets")).body;
    assert.equal(sets.length, 1);
    assert.equal(sets[0].id, setId);
    assert.equal(sets[0].version, 2);
    assert.equal(sets[0].status, "complete");
    assert.equal(sets[0].label, "ทดสอบ");
    assert.equal(sets[0].count, 2);
    const set = (await server.call("GET", `/api/sets/${setId}`)).body;
    assert.equal(set.manifest.puzzles.length, 2);
    // The archive line names every label its puzzles carry, in the canonical order.
    const labels = new Set(set.manifest.puzzles.flatMap((puzzle) => puzzle.moveTypes));
    assert.ok(labels.size > 0);
    assert.deepEqual(
      sets[0].moveTypes,
      ["EXTEND", "CROSS", "HOOK"].filter((type) => labels.has(type)),
    );
    assert.match(set.manifest.engine.generatorSha256, /^[0-9a-f]{64}$/);
    puzzleId = set.manifest.puzzles[0].id;
  });

  it("verifies a puzzle by replaying its source log to the exact position", async () => {
    const verified = await server.call("POST", `/api/sets/${setId}/puzzles/${puzzleId}/verify`);
    assert.equal(verified.status, 200);
    assert.equal(verified.body.ok, true);
    assert.equal(verified.body.modes.seed.ok, true);
    assert.equal(verified.body.modes.log.ok, true);
  });

  it("gives the player the position only, and the admin everything", async () => {
    const admin = (await server.call("GET", `/api/sets/${setId}/puzzles/${puzzleId}`)).body;
    assert.ok(admin.puzzle.answer.best.placements.length > 0);
    assert.ok(Array.isArray(admin.puzzle.canonical.position.hidden.bag));

    const play = await server.call("GET", `/api/sets/${setId}/puzzles/${puzzleId}/play`);
    assert.equal(play.status, 200);
    assert.deepEqual(Object.keys(play.body).sort(), [
      "format",
      "position",
      "positionHash",
      "puzzleId",
      "rules",
      "setId",
    ]);
    const text = JSON.stringify(play.body);
    for (const leak of [
      '"answer"',
      '"best"',
      '"equations"',
      '"moveTypes"',
      '"hidden"',
      '"bag"',
      '"seed"',
      '"log"',
      '"features"',
    ]) {
      assert.ok(!text.includes(leak), `the player projection contains ${leak}`);
    }
  });

  it("takes one submitted placement, saves it, and reveals nothing of the answer", async () => {
    const admin = (await server.call("GET", `/api/sets/${setId}/puzzles/${puzzleId}`)).body;
    const best = admin.puzzle.answer.best;
    const submitted = await server.call("POST", `/api/sets/${setId}/puzzles/${puzzleId}/attempts`, {
      placements: best.placements,
    });
    assert.equal(submitted.status, 201);
    assert.deepEqual(Object.keys(submitted.body).sort(), [
      "attemptId",
      "score",
      "valid",
      "yourEquations",
    ]);
    assert.equal(submitted.body.score, best.score);
    const text = JSON.stringify(submitted.body);
    for (const leak of ["best", "answer", "rank", "sameAsBest", "nearBest", "value"]) {
      assert.ok(!text.includes(leak), `the submission response contains ${leak}`);
    }
    const saved = join(archiveDir, setId, "attempts", puzzleId, `${submitted.body.attemptId}.json`);
    assert.ok(existsSync(saved));

    const missing = admin.puzzle.canonical.position.rack.includes("20") ? "19" : "20";
    const refused = await server.call("POST", `/api/sets/${setId}/puzzles/${puzzleId}/attempts`, {
      placements: [{ r: 0, c: 0, kind: missing, face: missing }],
    });
    assert.equal(refused.status, 422);
    assert.equal(readdirSync(join(archiveDir, setId, "attempts", puzzleId)).length, 1);

    const graded = (await server.call("GET", `/api/sets/${setId}/puzzles/${puzzleId}`)).body;
    assert.equal(graded.attempts.length, 1);
    assert.equal(graded.attempts[0].grade.sameAsBest, true);
    assert.equal(graded.attempts[0].by.kind, "admin-preview");
  });

  it("Stop keeps every puzzle made so far", async () => {
    const started = await server.call("POST", "/api/generate", {
      config: { ...LENIENT, target: 40, maxPerGame: 5, seed: 9 },
    });
    await server.waitFor((job) => job.matched >= 1);
    assert.equal((await server.call("POST", "/api/cancel")).status, 202);
    const job = await server.settle();
    assert.equal(job.state, "stopped");
    const set = (await server.call("GET", `/api/sets/${started.body.id}`)).body;
    assert.equal(set.status, "stopped");
    assert.ok(set.manifest.puzzles.length >= 1);
    for (const entry of set.manifest.puzzles) {
      assert.ok(existsSync(join(archiveDir, started.body.id, entry.file)));
    }
    assert.equal((await server.call("POST", "/api/cancel")).status, 409);
  });

  it("files exactly the configuration the admin form sent: zeros, ranges, overlapping groups, specific kinds", async () => {
    const { request } = OBSERVED;
    const started = await server.call("POST", "/api/generate", { config: request });
    assert.equal(started.status, 202);
    const stored = (await readJson(join(archiveDir, started.body.id, "set.json"))).config;
    assert.deepEqual(stored, request);
    assert.deepEqual(configDrift(stored), []);
    assert.deepEqual(stored.rack.groups.blank, { min: 0, max: 0 });
    assert.deepEqual(stored.rack.groups.equals, { min: 0, max: 0 });
    assert.deepEqual(stored.rack.specific, { "/": { min: 1, max: 1 }, "x//": { min: 1, max: 1 } });
    // The generator runs it rather than refusing it; then Stop.
    await server.waitFor((job) => job.counters?.positionsInspected > 0);
    assert.equal((await server.call("POST", "/api/cancel")).status, 202);
    const job = await server.settle();
    assert.equal(job.state, "stopped");
    assert.deepEqual(job.config, request);
  });

  it("will not generate or verify with code older than what is on disk, and still serves the archive", async () => {
    const before = readdirSync(archiveDir).length;
    const edited = await serve({
      archiveDir,
      generatorEngine: FAKE,
      codeFingerprint: () => "lib/ edited after this server loaded it",
    });
    try {
      const refused = await edited.call("POST", "/api/generate", { config: LENIENT });
      assert.equal(refused.status, 503);
      assert.match(refused.body.error, /npm run dev/);
      const verify = await edited.call("POST", `/api/sets/${setId}/puzzles/${puzzleId}/verify`);
      assert.equal(verify.status, 503);
      assert.match(verify.body.error, /npm run dev/);
      assert.equal(readdirSync(archiveDir).length, before);
      assert.equal((await edited.call("GET", "/api/status")).status, 200);
      assert.equal((await edited.call("GET", `/api/sets/${setId}`)).status, 200);
      assert.equal((await edited.call("GET", `/api/sets/${setId}/puzzles/${puzzleId}`)).status, 200);
      assert.equal((await edited.call("GET", `/api/sets/${setId}/puzzles/${puzzleId}/play`)).status, 200);
    } finally {
      await edited.close();
    }
  });

  it("keeps the 26 Sep set readable, playable and replayable exactly as it was filed", async () => {
    const { archivedConfig, puzzle } = OBSERVED;
    const manifest = await createSet({
      archiveDir,
      id: puzzle.setId,
      config: archivedConfig,
      engine: { analysis: "fake" },
    });
    await commitPuzzle(join(archiveDir, puzzle.setId), manifest, puzzle, summaryOf(puzzle));
    const listed = (await server.call("GET", "/api/sets")).body.sets.find((set) => set.id === puzzle.setId);
    assert.equal(listed.version, 2);
    const set = (await server.call("GET", `/api/sets/${puzzle.setId}`)).body;
    assert.deepEqual(set.manifest.config, archivedConfig);
    const base = `/api/sets/${puzzle.setId}/puzzles/${puzzle.id}`;
    assert.deepEqual((await server.call("GET", base)).body.puzzle.canonical.position.rack, puzzle.canonical.position.rack);
    const play = await server.call("GET", `${base}/play`);
    assert.equal(play.status, 200);
    assert.deepEqual(play.body.position.rack, ["1", "4", "6", "7", "x", "/", "x//", "?"]);
    const verified = await server.call("POST", `${base}/verify`);
    assert.equal(verified.status, 200);
    assert.equal(verified.body.modes.seed.ok, true);
    assert.equal(verified.body.modes.log.ok, true);
    assert.equal(verified.body.checks.puzzleHash.ok, true);
    // Its filed configuration carries no expanded field, so there is nothing to recheck it by.
    assert.equal(verified.body.checks.specification, undefined);
  });

  it("fails fresh verification of that puzzle against the specification the admin entered", async () => {
    const { request, puzzle } = OBSERVED;
    const id = "observed-as-entered";
    const manifest = await createSet({
      archiveDir,
      id,
      config: configFrom(request),
      engine: { analysis: "fake" },
    });
    await commitPuzzle(join(archiveDir, id), manifest, puzzle, summaryOf(puzzle));
    const verified = await server.call("POST", `/api/sets/${id}/puzzles/${puzzle.id}/verify`);
    assert.equal(verified.status, 200);
    assert.equal(verified.body.ok, false);
    assert.equal(verified.body.checks.sourceReplay.ok, true);
    assert.equal(verified.body.checks.specification.ok, false);
    for (const reason of [
      "rack.group.digit",
      "rack.group.operator",
      "rack.group.blank",
      "rack.group.arithmetic",
      "rack.group.operatorLike",
      "equation.property.LARGE_INTEGER_RESULT",
      "mobility.legalPlacements",
    ])
      assert.ok(verified.body.checks.specification.reasons.includes(reason), reason);
  });

  it("serves, verifies and grades a guided puzzle without leaking either hidden allocation", async () => {
    const fixture = await readJson(
      join(here, "../../../tests/fixtures/study-puzzles/v2-hook-set.json"),
    );
    const original = fixture.admin.puzzle;
    const branch = constructBranch(
      replayStudyLog(original.canonical.source.log),
      ["0", "1", "2", "3", "4", "5", "6", "+/-"],
      { candidateSeed: 42 },
    );
    const position = positionOf(branch.state);
    const input = studyRequestFor({
      board: position.board,
      rack: position.rack,
      scoreSelf: position.scores.self,
      scoreOpponent: position.scores.opponent,
    });
    const result = await createFakeEngine().analyze(input.request),
      best = result.candidates[0];
    const analysis = analyzePlacement(
      position.board,
      best.placements.map((t) => ({ ...t, face: t.token })),
    );
    const p = buildPuzzle({
      setId: "guided-fixture",
      gameIndex: original.canonical.source.game,
      sourceSeed: original.canonical.source.seed,
      log: original.canonical.source.log,
      position,
      ...input,
      result,
      best,
      analysis,
      nearBest: nearBestOf(result.candidates),
      checks: { stage5b: best.score, eqlab: analysis.score, amathCli: analysis.score },
      features: {},
      provenance: branch.provenance,
    });
    const manifest = await createSet({
      archiveDir,
      id: p.setId,
      config: configFrom({ seed: 1, target: 1 }),
      engine: { analysis: "fake" },
    });
    await commitPuzzle(join(archiveDir, p.setId), manifest, p, summaryOf(p));
    const base = `/api/sets/${p.setId}/puzzles/${p.id}`;
    const verification = await server.call("POST", `${base}/verify`);
    assert.equal(verification.body.ok, true);
    assert.equal(verification.body.origin, "CONFIG_GUIDED_RACK");
    assert.ok(Object.values(verification.body.checks).every((check) => check.ok));
    const play = await server.call("GET", `${base}/play`);
    assert.equal(play.status, 200);
    assert.deepEqual(play.body.position.rack, position.rack);
    assert.doesNotMatch(
      JSON.stringify(play.body),
      /"(provenance|originalRack|opponentRack|bag|seed|answer)"/,
    );
    const submission = await server.call("POST", `${base}/attempts`, {
      placements: p.answer.best.placements,
    });
    assert.equal(submission.status, 201);
    assert.doesNotMatch(JSON.stringify(submission.body), /sameAsBest|rank|origin/);
    assert.equal((await server.call("GET", base)).body.attempts[0].grade.sameAsBest, true);
  });

  it("still reads the sets Codex's generator made", async () => {
    const v1 = join(archiveDir, "class-set");
    mkdirSync(v1);
    writeFileSync(
      join(v1, "puzzles.json"),
      JSON.stringify({
        schema: "find-best-play-v1",
        filters: { count: 1, mode: "cross" },
        puzzles: [{ answer: { score: 70 } }],
      }),
    );
    writeFileSync(join(v1, "student.html"), "<!doctype html><title>student</title>");
    const listed = (await server.call("GET", "/api/sets")).body.sets.find(
      (set) => set.id === "class-set",
    );
    assert.equal(listed.version, 1);
    assert.equal(listed.mode, "cross");
    const set = (await server.call("GET", "/api/sets/class-set")).body;
    assert.equal(set.puzzles.length, 1);
    const page = await server.call("GET", "/api/sets/class-set/student.html");
    assert.equal(page.status, 200);
    assert.match(page.text, /student/);
  });

  it("refuses ids and paths outside the archive", async () => {
    for (const path of [
      "/api/sets/..%2F..%2Fetc",
      "/api/sets/Set-UPPER",
      "/api/sets/set-missing",
      `/api/sets/${setId}/puzzles/pz-000000000000`,
      `/api/sets/${setId}/puzzles/..%2F..%2Fx/play`,
      `/api/sets/${setId}/set.json`,
      "/api/nothing",
    ]) {
      assert.equal((await server.call("GET", path)).status, 404, path);
    }
  });

  it("will not start without an engine", async () => {
    const lonely = await serve({ archiveDir, engineDir: "/nonexistent/amath-engine" });
    const refused = await lonely.call("POST", "/api/generate", { config: LENIENT });
    assert.equal(refused.status, 503);
    assert.match(refused.body.error, /AMATH_ENGINE_DIR/);
    await lonely.close();
  });
});

describe("with the real engine", () => {
  const ready = engineStatus().ready;
  it(
    "generates, verifies and plays one real puzzle",
    { skip: !ready && "amath-engine is not beside EQ-Lab", timeout: 300_000 },
    async () => {
      const archiveDir = mkdtempSync(join(tmpdir(), "study-api-real-"));
      const server = await serve({ archiveDir });
      try {
        const started = await server.call("POST", "/api/generate", {
          config: {
            seed: 3,
            target: 1,
            parallelGames: 1,
            answer: { maxNear: 12 },
            search: { strategy: "AUTHENTIC_ONLY" },
          },
        });
        assert.equal(started.status, 202);
        const job = await server.settle(280_000);
        assert.equal(job.state, "complete", JSON.stringify(job));
        const set = (await server.call("GET", `/api/sets/${started.body.id}`)).body;
        const [entry] = set.manifest.puzzles;
        const verified = await server.call(
          "POST",
          `/api/sets/${set.id}/puzzles/${entry.id}/verify`,
        );
        assert.equal(verified.body.ok, true);
        const { puzzle } = (await server.call("GET", `/api/sets/${set.id}/puzzles/${entry.id}`))
          .body;
        assert.equal(puzzle.answer.checks.amathCli, puzzle.answer.best.score);
        assert.equal(puzzle.answer.checks.eqlab, puzzle.answer.best.score);
        const submitted = await server.call(
          "POST",
          `/api/sets/${set.id}/puzzles/${entry.id}/attempts`,
          { placements: puzzle.answer.best.placements },
        );
        assert.equal(submitted.status, 201);
      } finally {
        await server.close();
        rmSync(archiveDir, { recursive: true, force: true });
      }
    },
  );
});
