// node --test tools/study-puzzles/tests/classify.test.mjs
//
// EXTEND / CROSS / HOOK on hand-built positions (DESIGN.md §5). Every fixture
// move is first proved legal, with the same score, by each implementation of
// the rules the generator depends on — EQ-Lab's validateMove, the vendored
// environment's transition and its move generator, and amath_cli when it is
// built — and only then classified.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { analyzePlacement } from "../lib/analysis.mjs";
import { configFrom } from "../lib/config.mjs";
import { bestPlayRejections } from "../lib/filters.mjs";
import { ENGINE_DIR } from "../lib/engine.mjs";
import { env } from "../lib/provenance.mjs";
import { geometryFeasibility } from "../lib/feasibility.mjs";

const FACE = { x: "×", "/": "÷" };
const tile = (r, c, kind, face = FACE[kind] ?? kind) => ({ r, c, kind, face });
const row = (r, c, kinds) => kinds.map((kind, i) => tile(r, c + i, kind));
const column = (r, c, kinds) => kinds.map((kind, i) => tile(r + i, c, kind));

/** The environment's own state for this board, the mover holding `rack`. */
function stateFor(board, rack) {
  const manifest = env.createManifest();
  const free = new Map();
  for (const t of manifest.tiles) {
    if (!free.has(t.kind)) free.set(t.kind, []);
    free.get(t.kind).push(t.id);
  }
  const take = (kind) => free.get(kind).shift();
  const cells = Array(225).fill(null);
  for (const t of board)
    cells[t.r * 15 + t.c] = {
      tileId: take(t.kind),
      kind: t.kind,
      face: t.face,
      side: "B",
      turn: 1,
    };
  const racks = { A: rack.map(take), B: [] };
  const rest = [...free.values()].flat();
  racks.B = rest.slice(0, 8);
  return env.envStateFrom({
    manifest,
    board: cells,
    racks,
    bag: rest.slice(8),
    scores: { A: 100, B: 100 },
    activeSide: "A",
    turnNumber: 5,
    noScoreTail: [],
    hasPlacement: true,
    seed: 7,
  });
}

function validator(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(join(ENGINE_DIR, "build/amath_cli"), ["worker"], { cwd: ENGINE_DIR });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("close", () => {
      try {
        resolve(JSON.parse(out));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
const hasValidator = existsSync(join(ENGINE_DIR, "build/amath_cli"));

/** Legal and equally scored everywhere; returns EQ-Lab's analysis. */
async function proved(board, move) {
  const rack = [...move.map((t) => t.kind), "4", "6", "7", "8", "9", "3", "2", "1"].slice(0, 8);
  const analysis = analyzePlacement(board, move);
  assert.equal(analysis.valid, true, `EQ-Lab refused: ${analysis.errors?.join("; ")}`);
  assert.deepEqual(
    geometryFeasibility(
      { board, rack },
      configFrom({
        seed: 1,
        bestPlay: {
          moveTypes: analysis.moveTypes,
          tiles: { min: move.length, max: move.length },
          equations: { min: analysis.equations.length, max: analysis.equations.length },
        },
      }),
    ).reasons,
    [],
    "necessary geometry must keep every proved move",
  );

  const state = stateFor(board, rack);
  const pool = [...state.racks.A];
  const placements = move.map((t) => {
    const index = pool.findIndex((id) => state.manifest.kindOf.get(id) === t.kind);
    return { cell: t.r * 15 + t.c, kind: t.kind, face: t.face, tileId: pool.splice(index, 1)[0] };
  });
  assert.equal(
    env.applyAction(state, { type: "place", placements }).scoreGained,
    analysis.score,
    "environment score",
  );

  const want = move
    .map((t) => `${t.r * 15 + t.c}:${t.kind}:${t.face}`)
    .sort()
    .join(",");
  const roots = await env.completeRootActions(state);
  const generated = roots.places.find(
    (place) =>
      place.action.placements
        .map((p) => `${p.cell}:${p.kind}:${p.face}`)
        .sort()
        .join(",") === want,
  );
  assert.ok(generated, "the move generator does not enumerate this move");
  assert.equal(generated.score, analysis.score, "generator score");

  if (hasValidator) {
    const token = (t) => (["?", "+/-", "x//"].includes(t.kind) ? t.face : t.kind);
    const verdict = await validator({
      board: board.map((t) => ({ r: t.r, c: t.c, kind: t.kind, token: token(t) })),
      rack,
      bagCount: 70,
      oppRackCount: 8,
      myScore: 100,
      oppScore: 100,
      noScoreStreak: 0,
      exchangeAllowed: true,
      seed: 1,
      mode: "validate",
      move: {
        type: "place",
        placements: move.map((t) => ({ r: t.r, c: t.c, kind: t.kind, token: t.face })),
      },
    });
    assert.deepEqual(
      verdict,
      { mode: "validate", valid: true, score: analysis.score },
      "amath_cli",
    );
  }
  return analysis;
}

const hook = (subtype, direction, before, after) => ({ subtype, direction, before, after });

describe("HOOK: the placement also completes something already on the board", () => {
  it("heads 5 × 0 = 0 into 15 × 0 = 0 with a line of its own (3 - 1 = 2)", async () => {
    const a = await proved(
      row(7, 5, ["5", "x", "0", "=", "0"]),
      column(5, 4, ["3", "-", "1", "=", "2"]),
    );
    assert.deepEqual(a.moveTypes, ["HOOK"]);
    assert.equal(a.primaryType, "HOOK");
    assert.equal(a.score, 14);
    assert.deepEqual(
      a.equations.map((e) => [e.role, e.hookSubtype ?? null, e.text, e.score, e.pattern]),
      [
        ["main", null, "3 - 1 = 2", 6, "N O N = N"],
        ["hook", "HEAD", "15 × 0 = 0", 8, "NN O N = N"],
      ],
    );
    assert.deepEqual(a.moveFacts, {
      equationCount: 2,
      main: { direction: "vertical", tiles: 5, placed: 5, reusedSegments: [] },
      hooks: [hook("HEAD", "horizontal", 0, 5)],
    });
    assert.deepEqual(a.patterns, { main: "N O N = N", hooks: ["NN O N = N"] });
  });

  it("heads -9 = -9 into 0 - 9 = -9 with 5 + 0 = 5 (the case as described)", async () => {
    const a = await proved(
      row(7, 5, ["-", "9", "=", "-", "9"]),
      column(5, 4, ["5", "+", "0", "=", "5"]),
    );
    assert.deepEqual(a.moveTypes, ["HOOK"]);
    assert.equal(a.score, 18);
    assert.deepEqual(
      a.equations.map((e) => [e.role, e.text]),
      [
        ["main", "5 + 0 = 5"],
        ["hook", "0 - 9 = - 9"],
      ],
    );
    assert.deepEqual(a.moveFacts.hooks, [hook("HEAD", "horizontal", 0, 5)]);
  });

  it("tails 0 = 0 × 5 into 0 = 0 × 51", async () => {
    const a = await proved(
      row(7, 5, ["0", "=", "0", "x", "5"]),
      column(5, 10, ["3", "-", "1", "=", "2"]),
    );
    assert.deepEqual(a.moveTypes, ["HOOK"]);
    assert.deepEqual(
      a.equations.map((e) => e.text),
      ["3 - 1 = 2", "0 = 0 × 51"],
    );
    assert.deepEqual(a.moveFacts.hooks, [hook("TAIL", "horizontal", 5, 0)]);
  });

  it("JOINs 0 = 0 × 1 and the 3 of 3 = 3 into 0 = 0 × 123", async () => {
    const board = [...column(2, 7, ["0", "=", "0", "x", "1"]), ...row(8, 7, ["3", "=", "3"])];
    const a = await proved(board, row(7, 5, ["2", "=", "2"]));
    assert.deepEqual(a.moveTypes, ["HOOK"]);
    assert.deepEqual(
      a.equations.map((e) => [e.role, e.hookSubtype ?? null, e.text]),
      [
        ["main", null, "2 = 2"],
        ["hook", "JOIN", "0 = 0 × 123"],
      ],
    );
    assert.deepEqual(a.moveFacts.hooks, [hook("JOIN", "vertical", 5, 1)]);
  });

  it("keeps every hook when one line completes two equations", async () => {
    const board = [
      ...row(7, 5, ["5", "x", "0", "=", "0"]),
      ...row(9, 5, ["5", "x", "0", "=", "0"]),
    ];
    const a = await proved(board, column(6, 4, ["4", "1", "=", "4", "1"]));
    assert.deepEqual(a.moveTypes, ["HOOK"]);
    assert.deepEqual(
      a.equations.map((e) => e.text),
      ["41 = 41", "15 × 0 = 0", "45 × 0 = 0"],
    );
    assert.deepEqual(a.moveFacts.hooks, [
      hook("HEAD", "horizontal", 0, 5),
      hook("HEAD", "horizontal", 0, 5),
    ]);
    assert.deepEqual(a.patterns.hooks, ["NN O N = N", "NN O N = N"]);
  });

  it("is CROSS and HOOK when its main line also runs through a lone board tile", async () => {
    const board = [...row(7, 5, ["5", "x", "0", "=", "0"]), ...row(9, 4, ["2", "=", "2"])];
    const a = await proved(board, column(5, 4, ["3", "-", "1", "="]));
    assert.deepEqual(a.moveTypes, ["CROSS", "HOOK"]);
    assert.equal(a.primaryType, "HOOK");
    assert.equal(a.equations[0].text, "3 - 1 = 2");
    assert.deepEqual(a.moveFacts.main.reusedSegments, [1]);
  });
});

describe("EXTEND and CROSS", () => {
  it("a lone tile on the head of an equation EXTENDS it — it is not a hook", async () => {
    const a = await proved(row(7, 5, ["5", "x", "0", "=", "0"]), [tile(7, 4, "1")]);
    assert.deepEqual(a.moveTypes, ["EXTEND"]);
    assert.deepEqual(
      a.equations.map((e) => [e.role, e.text]),
      [["main", "15 × 0 = 0"]],
    );
    assert.deepEqual(a.moveFacts, {
      equationCount: 1,
      main: { direction: "horizontal", tiles: 6, placed: 1, reusedSegments: [5] },
      hooks: [],
    });
  });

  it("new tiles on the tail of an equation EXTEND it", async () => {
    const a = await proved(row(7, 5, ["2", "=", "2"]), row(7, 8, ["+", "0"]));
    assert.deepEqual(a.moveTypes, ["EXTEND"]);
    assert.equal(a.equations[0].text, "2 = 2 + 0");
    assert.deepEqual(a.moveFacts.main.reusedSegments, [3]);
  });

  it("extends both sides of 9 = 9 into 0 + 9 = 9 × 1", async () => {
    const a = await proved(row(7, 6, ["9", "=", "9"]), [...row(7, 4, ["0", "+"]), ...row(7, 9, ["x", "1"])]);
    assert.deepEqual(a.moveTypes, ["EXTEND"]);
    assert.equal(a.geometry.extend.shape, "BOTH");
    assert.deepEqual(a.geometry.extend.headContact, ["DIGIT", "ARITHMETIC_OPERATOR"]);
    assert.deepEqual(a.geometry.extend.tailContact, ["DIGIT", "ARITHMETIC_OPERATOR"]);
  });

  it("CROSS places four into a seven-tile equation with three reused cells", async () => {
    const board = [
      ...[4, 6, 8].flatMap((c, i) => [tile(7, c, String(i + 1)), tile(8, c, "="), tile(9, c, String(i + 1))]),
      tile(9, 5, "+"), tile(9, 7, "="),
    ];
    const a = await proved(board, [tile(7, 5, "+"), tile(7, 7, "+"), tile(7, 9, "="), tile(7, 10, "6")]);
    assert.ok(a.moveTypes.includes("CROSS"));
    assert.equal(a.equations[0].tileCount, 7);
    assert.equal(a.equations[0].placedParticipating, 4);
    assert.equal(a.equations[0].reusedBoardTiles, 3);
  });

  it("a line through a single board tile CROSSES", async () => {
    const a = await proved(row(7, 5, ["5", "x", "0", "=", "0"]), column(8, 9, ["=", "0"]));
    assert.deepEqual(a.moveTypes, ["CROSS"]);
    assert.equal(a.equations[0].text, "0 = 0");
    assert.deepEqual(a.moveFacts.main.reusedSegments, [1]);
  });

  it("is EXTEND and CROSS when it lengthens one equation and passes through another", async () => {
    const board = [...row(7, 5, ["2", "=", "2"]), ...column(6, 10, ["0", "=", "0"])];
    const a = await proved(board, [tile(7, 8, "+"), tile(7, 9, "0"), tile(7, 11, "2")]);
    assert.deepEqual(a.moveTypes, ["EXTEND", "CROSS"]);
    assert.equal(a.primaryType, "EXTEND");
    assert.equal(a.equations[0].text, "2 = 2 + 0 = 2");
    assert.deepEqual(a.moveFacts.main.reusedSegments, [3, 1]);
  });
});

describe("the move-type filter", () => {
  it("is inclusive: any selected label on the move matches (OR)", async () => {
    const board = [...row(7, 5, ["5", "x", "0", "=", "0"]), ...row(9, 4, ["2", "=", "2"])];
    const analysis = await proved(board, column(5, 4, ["3", "-", "1", "="]));
    const config = (moveTypes) => configFrom({ seed: 1, bestPlay: { moveTypes } });
    const rejected = (moveTypes) =>
      bestPlayRejections(config(moveTypes), { analysis, nearBest: [], rackIndex: 5 }).includes(
        "bestPlay.moveType",
      );
    assert.equal(rejected([]), false);
    assert.equal(rejected(["CROSS"]), false);
    assert.equal(rejected(["HOOK"]), false);
    assert.equal(rejected(["EXTEND", "HOOK"]), false);
    assert.equal(rejected(["EXTEND"]), true);
  });

  it("refuses only the combination no move can meet", () => {
    assert.throws(
      () => configFrom({ seed: 1, bestPlay: { moveTypes: ["HOOK"], equations: { max: 1 } } }),
      /HOOK/,
    );
    // A CROSS + HOOK move scores two equations, so this can match.
    assert.doesNotThrow(() =>
      configFrom({ seed: 1, bestPlay: { moveTypes: ["CROSS"], equations: { min: 2 } } }),
    );
  });
});
