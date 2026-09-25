// Focused tests for the offline Survival playtest.
//   node --test tools/survival-generator/playtest/tests/playtest.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalJson } from "../../lib/canonical.mjs";
import { validateCandidate } from "../../lib/candidate.mjs";
import { KIND_ORDER, env, snapshotOf } from "../../lib/rules.mjs";
import { replaySourceLog, stateHash } from "../../lib/sourcelog.mjs";
import { createPlaytestApi } from "../server/api.mjs";
import {
  FIRST_RUN,
  LEVEL_IDS,
  assertPlayerSafe,
  createAttempt,
  humanMove,
  loadLevels,
  publicAttempt,
  replayAttempt,
} from "../server/engine.mjs";

const EQLAB = resolve(import.meta.dirname, "../../../..");
const VITE = resolve(EQLAB, "node_modules/vite/bin/vite.js");
const CONFIG = resolve(import.meta.dirname, "../vite.config.mjs");
const RANK = new Map(KIND_ORDER.map((kind, index) => [kind, index]));
const sortKinds = (kinds) => [...kinds].sort((a, b) => RANK.get(a) - RANK.get(b));
const kindsOf = (state, ids) => ids.map((id) => state.manifest.kindOf.get(id));

/** Board + racks + standing piles + bag: exactly the 100-tile set. */
function conserved(state) {
  const counts = new Map();
  const add = (kind) => counts.set(kind, (counts.get(kind) ?? 0) + 1);
  for (const cell of state.board) if (cell) add(cell.kind);
  for (const ids of [state.racks.A, state.racks.B, state.pendingReturn.A, state.pendingReturn.B, state.bag]) {
    for (const kind of kindsOf(state, ids)) add(kind);
  }
  const manifest = new Map();
  for (const tile of env.createManifest().tiles) manifest.set(tile.kind, (manifest.get(tile.kind) ?? 0) + 1);
  return canonicalJson([...counts.entries()].sort()) === canonicalJson([...manifest.entries()].sort());
}

// ── one API server for the HTTP tests, attempts written to a scratch folder ──
let api;
let server;
let base;
let outDir;
const scratch = [];
const responses = [];
async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  responses.push({ path, status: response.status, data });
  return { status: response.status, data };
}

before(async () => {
  outDir = mkdtempSync(join(tmpdir(), "survival-playtest-"));
  scratch.push(outDir);
  api = await createPlaytestApi({ outDir });
  server = createServer((req, res) => api.middleware(req, res));
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((done) => server.close(done));
  await api.close();
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

// ── 1. startup ───────────────────────────────────────────────────────────────
test("startup: all 4 confirmed candidates load, validate and replay to their exact takeover", () => {
  const levels = loadLevels();
  assert.deepEqual([...levels.keys()], [...LEVEL_IDS]);
  for (const level of levels.values()) {
    const { candidate } = level;
    assert.equal(candidate.schema, "survival-candidate-v2");
    assert.equal(validateCandidate(candidate), true);
    assert.equal(candidate.admin.tactical.confirmation.category.category, "SKILL_SEPARATING", `${level.id} is a confirmed level`);
    const { snapshot, sourceLog } = candidate.gameplay;
    for (const mode of ["seed", "log"]) {
      assert.equal(stateHash(replaySourceLog(sourceLog, { mode })), sourceLog.takeover.stateHash, `${level.id} (${mode})`);
    }
    assert.deepEqual(snapshotOf(replaySourceLog(sourceLog, { mode: "seed" })), snapshot, `${level.id}: byte-identical snapshot`);
  }
});

// ── 2. retry ─────────────────────────────────────────────────────────────────
test("retry: every attempt starts from the identical takeover state, untouched by earlier attempts", () => {
  const level = loadLevels().get(LEVEL_IDS[2]);
  const first = createAttempt(level);
  const second = createAttempt(level);
  humanMove(first, { type: "pass" });
  const third = createAttempt(level);
  for (const attempt of [second, third]) {
    assert.equal(stateHash(attempt.state), level.takeoverHash);
    assert.deepEqual(snapshotOf(attempt.state), level.candidate.gameplay.snapshot);
    const { attemptId: _a, ...viewA } = publicAttempt(attempt);
    const { attemptId: _b, ...viewB } = publicAttempt(createAttempt(level));
    assert.deepEqual(viewA, viewB);
  }
  assert.notEqual(stateHash({ ...first.state }), level.takeoverHash, "the first attempt did move on");
});

// ── 3. the leak guard itself ─────────────────────────────────────────────────
test("leak guard: refuses hidden fields and hidden tile sequences", () => {
  const level = loadLevels().get(LEVEL_IDS[0]);
  const attempt = createAttempt(level);
  assert.throws(() => assertPlayerSafe({ nested: [{ bag: [] }] }), /bag/);
  assert.throws(() => assertPlayerSafe({ a: { rackBefore: [] } }), /rackBefore/);
  assert.throws(() => assertPlayerSafe({ levelKey: "x" }), /levelKey/);
  const bag = kindsOf(attempt.state, attempt.state.bag);
  assert.throws(() => assertPlayerSafe({ note: bag }, attempt), /hidden tile sequence/);
  const authurRack = kindsOf(attempt.state, attempt.state.racks[attempt.authur]);
  assert.throws(() => assertPlayerSafe({ note: sortKinds(authurRack) }, attempt), /hidden tile sequence/);
  assert.throws(() => assertPlayerSafe({ note: attempt.levelKey }, attempt), /hidden value/);
  assert.doesNotThrow(() => assertPlayerSafe(publicAttempt(attempt), attempt));
});

// ── 4. parity with the generator, through the browser's own API ─────────────
/** One clean recorded generator game per level: strong sim 0 if clean, else the next clean one. */
function recordedGames() {
  const lines = readFileSync(resolve(FIRST_RUN, "research/playouts.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  return LEVEL_IDS.map((id) => {
    const clean = lines.filter((g) => g.candidateId === id && !g.timingAffected && g.policy !== "authur");
    const order = (g) => ["strong", "medium", "weak"].indexOf(g.policy) * 1000 + g.sim;
    return clean.sort((a, b) => order(a) - order(b))[0];
  });
}

/** The recorded human move as the browser would send it: tiles picked from the rack it sees. */
function asRequest(view, move) {
  const free = [...view.rack];
  const take = (kind) => {
    const index = free.findIndex((t) => t.kind === kind);
    assert.ok(index >= 0, `the rack the browser sees holds a ${kind}`);
    return free.splice(index, 1)[0].id;
  };
  if (move.type === "place") return { type: "place", placements: move.placements.map((p) => ({ tileId: take(p.kind), cell: p.cell, face: p.face })) };
  if (move.type === "exchange") return { type: "exchange", tileIds: move.kinds.map(take) };
  return { type: "pass" };
}

const recordedMove = (record) =>
  record.type === "place"
    ? { type: "place", placements: record.action.placements.map(({ cell, kind, face }) => ({ cell, kind, face })) }
    : record.type === "exchange"
      ? { type: "exchange", kinds: record.action.kinds }
      : { type: "pass" };

test("parity: recorded generator games through the human side reproduce Authur, the states, the fixed bag and the result", async () => {
  const games = recordedGames();
  assert.equal(games.length, 4);
  for (const game of games) {
    assert.ok(game, "every level has a clean recorded game");
    const created = await call("POST", "/api/attempts", { levelId: game.candidateId });
    assert.equal(created.status, 201);
    let view = created.data;
    const attempt = api.attempts.get(view.attemptId);
    let turnsChecked = 0;
    for (const recorded of game.actions) {
      const before = attempt.state;
      const bagBefore = kindsOf(before, before.bag);
      const { status, data } = recorded.side === attempt.human
        ? await call("POST", `/api/attempts/${view.attemptId}/move`, { move: asRequest(view, recorded.move) })
        : await call("POST", `/api/attempts/${view.attemptId}/authur`);
      assert.equal(status, 200, JSON.stringify(data));
      view = data;
      const record = attempt.turns.at(-1);
      const at = `${game.candidateId} ${game.policy}#${game.sim} turn ${recorded.turn}`;
      assert.equal(record.turn, recorded.turn, at);
      assert.equal(record.actor, recorded.side === attempt.human ? "human" : "authur", at);
      if (record.actor === "authur") assert.equal(record.decision.id, recorded.id, `${at}: Authur's decision`);
      assert.deepEqual(recordedMove(record), recorded.move, `${at}: the move`);
      assert.equal(record.scoreGained, recorded.score, `${at}: the score`);
      // State progression: 100 tiles, and the Survival fixed bag.
      assert.ok(conserved(attempt.state), `${at}: tile conservation`);
      assert.deepEqual(record.drawn, bagBefore.slice(0, record.drawn.length), `${at}: draws from the front`);
      if (!attempt.state.terminal) {
        const expected = [...bagBefore.slice(record.drawn.length), ...sortKinds(record.returned)];
        assert.deepEqual(kindsOf(attempt.state, attempt.state.bag), expected, `${at}: fixed bag`);
        assert.equal(record.stateHashAfter, stateHash(attempt.state), `${at}: state hash`);
      }
      assert.deepEqual(view.scores, { player: attempt.state.scores[attempt.human], authur: attempt.state.scores[attempt.authur] });
      turnsChecked += 1;
    }
    assert.equal(turnsChecked, game.actions.length);
    assert.equal(view.status, "finished", `${game.candidateId}: the game ended where the generator's did`);
    assert.equal(attempt.state.terminal.reason, game.end);
    assert.equal(view.result.margin, game.margin);
    assert.equal(view.result.outcome, game.outcome);
    // The complete attempt file on disk replays, turn by turn, to the same end.
    const doc = JSON.parse(readFileSync(attempt.file, "utf8"));
    assert.equal(doc.status, "finished");
    assert.equal(doc.turns.length, game.actions.length);
    const replayed = replayAttempt(doc);
    assert.deepEqual(replayed.scores, attempt.state.scores);
    assert.ok(doc.turns.every((t) => t.eqlab === null || t.eqlab.agrees), "EQ-Lab's validateMove agrees with every placement");
  }
});

// ── 5. hidden information in every browser response ─────────────────────────
test("browser API: no response carries hidden information (all 4 levels, illegal moves, exchanges, Authur, results)", async () => {
  const levels = await call("GET", "/api/levels");
  assert.equal(levels.data.levels.length, 4);
  for (const id of LEVEL_IDS) {
    const { data: view } = await call("POST", "/api/attempts", { levelId: id });
    const attempt = api.attempts.get(view.attemptId);
    // An illegal placement: a tile onto an occupied square.
    const occupied = view.board[0].cell;
    const refused = await call("POST", `/api/attempts/${view.attemptId}/move`, {
      move: { type: "place", placements: [{ tileId: view.rack[0].id, cell: occupied, face: "=" }] },
    });
    assert.equal(refused.status, 400);
    assert.equal(stateHash(attempt.state), attempt.level.takeoverHash, "a refused move changes nothing");
    // Tiles that exist but are not the player's (they are on Authur's rack) are refused.
    const theirs = attempt.state.racks[attempt.authur].slice(0, 2);
    const foreign = await call("POST", `/api/attempts/${view.attemptId}/move`, { move: { type: "exchange", tileIds: theirs } });
    assert.equal(foreign.status, 400);
    assert.ok(!JSON.stringify(foreign.data).includes(theirs[0]), "the refusal does not echo the tile back");
    // A legal exchange: the pile goes to the BACK of the fixed bag, in kind order.
    const bagBefore = kindsOf(attempt.state, attempt.state.bag);
    const exchanged = await call("POST", `/api/attempts/${view.attemptId}/move`, { move: { type: "exchange", tileIds: view.rack.slice(0, 3).map((t) => t.id) } });
    assert.equal(exchanged.status, 200, JSON.stringify(exchanged.data));
    const swap = attempt.turns.at(-1);
    assert.equal(swap.type, "exchange");
    assert.deepEqual(swap.drawn, bagBefore.slice(0, 3));
    assert.deepEqual(kindsOf(attempt.state, attempt.state.bag), [...bagBefore.slice(3), ...sortKinds(swap.returned)]);
    assert.equal(exchanged.data.log.at(-1).tilesExchanged, 3);
    const answered = await call("POST", `/api/attempts/${view.attemptId}/authur`);
    assert.equal(answered.status, 200);
    assert.equal(answered.data.status, "your-turn");
    assert.equal(attempt.rejected.length, 2, "refused submissions are recorded server-side");
    assert.ok(conserved(attempt.state));
    const doc = JSON.parse(readFileSync(attempt.file, "utf8"));
    assert.equal(doc.status, "in-progress");
    assert.equal(doc.rejected.length, 2);
    assert.doesNotThrow(() => replayAttempt(doc), "the saved attempt replays, exchange included");
  }
  // Every response of this file's HTTP tests — including the four parity games played to the end.
  const kinds = {
    levels: responses.filter((r) => r.path === "/api/levels").length,
    created: responses.filter((r) => r.status === 201).length,
    humanMoves: responses.filter((r) => r.path.endsWith("/move") && r.status === 200).length,
    authurMoves: responses.filter((r) => r.path.endsWith("/authur") && r.status === 200).length,
    refused: responses.filter((r) => r.status >= 400).length,
    finished: responses.filter((r) => r.data.result).length,
  };
  for (const [kind, count] of Object.entries(kinds)) assert.ok(count > 0, `no ${kind} response was checked`);
  assert.ok(kinds.finished >= 4, "the finished games' results were checked");
  console.log(`checked ${responses.length} browser responses`, kinds);
  for (const { path, data } of responses) {
    const attempt = data.attemptId ? api.attempts.get(data.attemptId) : null;
    assert.doesNotThrow(() => assertPlayerSafe(data, attempt), path);
    const text = JSON.stringify(data);
    for (const key of ["levelKey", "sourceSeed", "bag", "bagAfter", "racks", "rackBefore", "drawn", "stateHash", "decision", "admin", "provenance", "tactical", "strategic"]) {
      assert.ok(!text.includes(`"${key}"`), `${path}: "${key}"`);
    }
    if (data.rack) assert.ok(data.rack.every((t) => Object.keys(t).sort().join() === "id,kind"));
  }
});

// ── 6. the page ──────────────────────────────────────────────────────────────
function run(args, { timeoutMs = 180_000 } = {}) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [VITE, ...args], { cwd: EQLAB, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      fail(new Error(`timed out\n${output}`));
    }, timeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      done({ code, output });
    });
  });
}

test("vite: the playtest page builds, and the dev server starts with the API", async () => {
  const outDirBuild = mkdtempSync(join(tmpdir(), "survival-playtest-build-"));
  scratch.push(outDirBuild);
  const build = await run(["build", "--config", CONFIG, "--outDir", outDirBuild, "--emptyOutDir", "--logLevel", "warn"]);
  assert.equal(build.code, 0, build.output);
  assert.ok(existsSync(join(outDirBuild, "index.html")));
  assert.match(readFileSync(join(outDirBuild, "index.html"), "utf8"), /<script type="module" crossorigin src="\/assets\/[^"]+\.js"><\/script>/);

  const port = 5190 + 100 + Math.floor(Math.random() * 400);
  const child = spawn(process.execPath, [VITE, "--config", CONFIG, "--port", String(port), "--strictPort"], {
    cwd: EQLAB,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  try {
    let levels = null;
    for (let tries = 0; tries < 120 && !levels; tries += 1) {
      await new Promise((wait) => setTimeout(wait, 500));
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/levels`);
        if (response.ok) levels = (await response.json()).levels;
      } catch {
        // not listening yet
      }
    }
    assert.ok(levels, `the dev server did not answer\n${output}`);
    assert.equal(levels.length, 4);
    const page = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<div id="root"><\/div>/);
    const entry = await fetch(`http://127.0.0.1:${port}/main.jsx`);
    assert.equal(entry.status, 200, "the page's entry module compiles");
    assert.match(output, /4 levels loaded and replay-verified/);
  } finally {
    child.kill("SIGTERM");
    await new Promise((done) => child.once("exit", done));
  }
});
