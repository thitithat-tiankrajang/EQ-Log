// node --test tools/study-puzzles/tests/observed-rack.test.mjs
//
// The "26 Sep" set accepted a puzzle whose rack, 1 4 6 7 x / x// ?, breaks the
// rack its admin asked for. The form sent the whole specification; a dev server
// still running the pre-guided API normalised it to the few fields that code
// knew, and the generator searched what was left. These tests pin every layer
// the specification crosses, on the real request and the real archived puzzle.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { analyzePlacement, categoryOf, rackDifficulty } from "../lib/analysis.mjs";
import { configDrift, configFrom } from "../lib/config.mjs";
import { bestPlayRejections } from "../lib/filters.mjs";
import { rackCanSatisfy } from "../lib/racks.mjs";
import { GROUPS, compositionFailures, countsOf } from "../lib/specification.mjs";
import { verifyPuzzle } from "../lib/verify.mjs";

const { request, archivedConfig, puzzle } = JSON.parse(
  readFileSync(
    new URL("../../../tests/fixtures/study-puzzles/v2-observed-rack-26sep.json", import.meta.url),
  ),
);
const OBSERVED = ["1", "4", "6", "7", "x", "/", "x//", "?"];
const exact = (n) => ({ min: n, max: n });
const RACK_REASONS = [
  "rack.group.digit",
  "rack.group.operator",
  "rack.group.blank",
  "rack.group.arithmetic",
  "rack.group.operatorLike",
];

/** The canonical final matcher on the archived rank-1 move, as the generator calls it. */
const finalMatcher = (config, rack = puzzle.canonical.position.rack) =>
  bestPlayRejections(config, {
    analysis: analyzePlacement(puzzle.canonical.position.board, puzzle.answer.best.placements),
    nearBest: puzzle.answer.nearBest,
    rackIndex: rackDifficulty(rack).index,
    rack,
  });

describe("the observed 26 Sep rack specification", () => {
  it("is normalised without losing a field: explicit zeros, ranges, overlapping groups, specific kinds", () => {
    const config = configFrom(JSON.parse(JSON.stringify(request)));
    assert.deepEqual(config.rack, {
      minDifficulty: null,
      size: exact(8),
      groups: {
        digit: { min: 5, max: 6 },
        heavy: { min: 0, max: 1 },
        operator: exact(1),
        choice: exact(1),
        equals: exact(0),
        blank: exact(0),
        arithmetic: exact(2),
        operatorLike: exact(2),
      },
      specific: { "/": exact(1), "x//": exact(1) },
    });
    // What the form sends is already the canonical form: nothing added, dropped or rewritten.
    assert.deepEqual(configDrift(request), []);
    assert.deepEqual(config, request);
  });

  it("never reads 0 as absent, at either end of any range", () => {
    for (const group of GROUPS) {
      const zero = configFrom({ seed: 1, rack: { groups: { [group]: exact(0) } } });
      assert.deepEqual(zero.rack.groups[group], exact(0), group);
      assert.deepEqual(configFrom({ seed: 1, rack: { groups: { [group]: { min: 0, max: null } } } }).rack.groups[group], { min: 0, max: null }, group);
    }
    assert.deepEqual(configFrom({ seed: 1, rack: { specific: { "?": exact(0), "=": exact(0) } } }).rack.specific, { "=": exact(0), "?": exact(0) });
    assert.deepEqual(configFrom({ seed: 1, bestPlay: { composition: { blank: exact(0) } } }).bestPlay.composition.blank, exact(0));
  });

  it("was filed by the dev server's stale API as its request minus every field that code did not know", () => {
    const intended = configFrom(request);
    for (const key of ["target", "label", "seed", "maxPerGame", "parallelGames", "position", "answer"])
      assert.deepEqual(archivedConfig[key], intended[key], key);
    for (const key of ["score", "tiles", "equations", "moveTypes", "content", "excludeTrivialZero"])
      assert.deepEqual(archivedConfig.bestPlay[key], intended.bestPlay[key], `bestPlay.${key}`);
    assert.deepEqual(archivedConfig.rack, { minDifficulty: null });
    assert.deepEqual(configDrift(archivedConfig).sort(), [
      "bestPlay.composition",
      "bestPlay.specific",
      "equation",
      "geometry",
      "mobility",
      "rack.groups",
      "rack.size",
      "rack.specific",
      "search",
    ]);
  });
});

describe("the observed rack, counted by physical kind", () => {
  it("is the Study rack the puzzle stores, shows, and asked Stage 5B about", () => {
    assert.deepEqual(puzzle.canonical.position.rack, OBSERVED);
    assert.deepEqual(puzzle.answer.engine.request.rack, OBSERVED);
    assert.deepEqual(puzzle.canonical.studyRequest.rack, OBSERVED);
    assert.equal(puzzle.canonical.provenance.origin, "AUTHENTIC_SEEDED");
  });

  it("puts ×/÷ in choice, arithmetic and operator-like at once, never among the plain operators", () => {
    assert.deepEqual(OBSERVED.map(categoryOf), [
      "digit",
      "digit",
      "digit",
      "digit",
      "operator",
      "operator",
      "choice",
      "blank",
    ]);
    const counts = countsOf(OBSERVED);
    assert.deepEqual(counts.groups, {
      digit: 4,
      heavy: 0,
      operator: 2,
      choice: 1,
      equals: 0,
      blank: 1,
      arithmetic: 3,
      operatorLike: 3,
    });
    assert.equal(counts.specific["/"], 1);
    assert.equal(counts.specific["x//"], 1);
    assert.equal(counts.specific.x, 1);
    assert.equal(counts.specific["?"], 1);
  });
});

describe("final acceptance of the observed puzzle", () => {
  it("refuses it for the specification the admin entered", () => {
    const config = configFrom(request);
    assert.deepEqual(finalMatcher(config), [...RACK_REASONS, "equation.property.LARGE_INTEGER_RESULT"]);
    // Guided search would not even have analysed it as a puzzle candidate.
    assert.equal(rackCanSatisfy(OBSERVED, config), false);
  });

  it("had nothing to refuse it with in what the stale API filed", () => {
    assert.deepEqual(finalMatcher(configFrom(archivedConfig)), []);
  });

  it("accepts racks that meet the rack specification, and names exactly the constraint each single deviation breaks", () => {
    const config = configFrom(request);
    const failures = (rack) => compositionFailures(rack, config.rack.groups, config.rack.specific);
    for (const rack of [
      ["1", "2", "3", "4", "5", "6", "/", "x//"],
      ["1", "2", "3", "4", "5", "12", "/", "x//"],
    ]) {
      assert.deepEqual(failures(rack), [], rack.join(" "));
      assert.equal(rackCanSatisfy(rack, config), true, rack.join(" "));
    }
    const base = ["1", "2", "3", "4", "5", "6", "/", "x//"];
    const swap = (from, to) => base.map((kind) => (kind === from ? to : kind));
    assert.deepEqual(failures(swap("6", "?")), ["rack.group.blank"]);
    assert.deepEqual(failures(swap("6", "=")), ["rack.group.equals", "rack.group.operatorLike"]);
    assert.deepEqual(failures(swap("6", "x")), [
      "rack.group.operator",
      "rack.group.arithmetic",
      "rack.group.operatorLike",
    ]);
    assert.deepEqual(failures(swap("/", "x")), ["rack.specific./"]);
    assert.deepEqual(failures(swap("x//", "+/-")), ["rack.specific.x//"]);
    assert.deepEqual(failures(swap("6", "13").map((k) => (k === "5" ? "14" : k))), [
      "rack.group.digit",
      "rack.group.heavy",
    ]);
  });
});

describe("fresh verification of the persisted observed puzzle", () => {
  // Stage 5B's own check is not what this is about; the stand-in only has to answer.
  const engine = {
    analyze: async () => ({ candidates: [] }),
    validate: async () => ({ valid: false, score: 0 }),
    killAll() {},
  };

  it("replays it, then fails it against the specification the admin entered", async () => {
    const verification = await verifyPuzzle(puzzle, engine, request);
    assert.equal(verification.checks.sourceReplay.ok, true);
    assert.equal(verification.checks.sourceState.ok, true);
    assert.equal(verification.checks.puzzleHash.ok, true);
    assert.equal(verification.checks.eqlab.ok, true);
    assert.deepEqual(verification.checks.specification, {
      ok: false,
      // 2 283 unique legal placements, where the admin allowed 1–30.
      reasons: [...RACK_REASONS, "equation.property.LARGE_INTEGER_RESULT", "mobility.legalPlacements"],
    });
    assert.equal(verification.ok, false);
  });
});
