import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { constructBranch, availableKinds } from "../lib/branch.mjs";
import { env, positionOf, replayStudyLog, turnRecord } from "../lib/provenance.mjs";
import { canonicalJson } from "../../survival-generator/lib/canonical.mjs";
import { configFrom } from "../lib/config.mjs";
import { candidateRacks, rackCanSatisfy } from "../lib/racks.mjs";
import { categoryOf } from "../lib/analysis.mjs";
import { geometryFeasibility, legalRackFeasibility } from "../lib/feasibility.mjs";
import { playGame } from "../lib/selfplay.mjs";
import { createFakeEngine } from "./fake-engine.mjs";
import { verifyProvenance } from "../lib/verify.mjs";
import { playerProjection, positionHash } from "../lib/record.mjs";

const fixture = JSON.parse(
  readFileSync(new URL("../../../tests/fixtures/study-puzzles/v2-hook-set.json", import.meta.url)),
);
const puzzle = fixture.admin.puzzle;
const source = () => replayStudyLog(puzzle.canonical.source.log, "seed");
const inventory = (state) =>
  [
    ...state.racks.A,
    ...state.racks.B,
    ...state.bag,
    ...state.board.flatMap((cell) => (cell ? [cell.tileId] : [])),
  ].sort();

describe("isolated Study rack branches", () => {
  it("verifies source replay separately from rack reconstruction, and detects provenance tampering", () => {
    const state = source();
    const branch = constructBranch(state, ["0", "1", "2", "3", "4", "5", "6", "+/-"], {
      candidateSeed: 42,
    });
    const p = structuredClone(puzzle);
    p.canonical.position = positionOf(branch.state);
    p.canonical.provenance = branch.provenance;
    p.hashes.position = positionHash(p.canonical.position);
    const verified = verifyProvenance(p);
    assert.equal(verified.ok, true);
    for (const key of [
      "sourceReplay",
      "sourceState",
      "rackLegal",
      "tileConservation",
      "positionHash",
    ])
      assert.equal(verified.checks[key].ok, true, key);
    assert.equal(verifyProvenance(puzzle).ok, true, "old authentic fixture keeps exact replay");
    const projection = playerProjection(p);
    assert.deepEqual(projection.position.rack, branch.provenance.constructedRack);
    assert.doesNotMatch(
      JSON.stringify(projection),
      /"(provenance|origin|originalRack|opponentRack|bag|seed|answer|geometry|semantics|legalPlacementCount|placedKinds)"/,
    );
    p.canonical.provenance.originalRack[0] = "20";
    assert.equal(verifyProvenance(p).ok, false);
    p.canonical.provenance = branch.provenance;
    p.canonical.position.hidden.bag[0] = "20";
    assert.equal(verifyProvenance(p).ok, false);
  });
  it("continues the identical seeded game and log with or without temporary search branches", async () => {
    const run = async (guided) => {
      const logs = [];
      let visits = 0;
      await playGame({
        seed: 11,
        engine: createFakeEngine(),
        maxTurns: 5,
        onSourcePosition: guided
          ? async (context) => {
              visits++;
              const cfg = configFrom({ seed: 8 });
              for (const c of candidateRacks(context.state, cfg, { budget: 4 })) {
                const branch = constructBranch(context.state, c.rack, c);
                env.applyAction(branch.state, { type: "pass" });
              }
            }
          : undefined,
        onPosition: (context) => {
          logs.push(context.sourceLog());
        },
      });
      return { logs, visits };
    };
    const control = await run(false),
      guided = await run(true);
    assert.equal(guided.visits, 5);
    assert.deepEqual(guided.logs, control.logs);
  });
  it("conserves every physical tile and cannot mutate the source or its continuation", () => {
    const state = source();
    const before = canonicalJson(state);
    const original = positionOf(state);
    const rack = ["0", "1", "2", "3", "4", "5", "6", "+/-"];
    const branch = constructBranch(state, rack, { candidateSeed: 42, candidateIndex: 0 });
    assert.deepEqual(positionOf(branch.state).rack, rack);
    assert.deepEqual(inventory(branch.state), inventory(state));
    assert.equal(new Set(inventory(branch.state)).size, 100);
    assert.deepEqual(branch.state.board, state.board);
    assert.deepEqual(branch.state.scores, state.scores);
    assert.equal(branch.provenance.origin, "CONFIG_GUIDED_RACK");
    assert.deepEqual(branch.provenance.originalRack, original.rack);
    assert.deepEqual(branch.provenance.constructedRack, rack);
    assert.equal(canonicalJson(state), before);

    // Branch callers may change even nested objects without affecting the source.
    branch.state.board.find(Boolean).face = "999";
    branch.state.racks.A.reverse();
    branch.state.bag.reverse();
    branch.state.scores.A++;
    branch.state.rngStep++;
    branch.state.manifest.kindOf.clear();
    assert.equal(canonicalJson(state), before);
    const untouched = source();
    const action = {
      type: "exchange",
      kinds: [original.rack[0]],
      tileIds: [
        state.racks[state.activeSide].find(
          (id) => state.manifest.kindOf.get(id) === original.rack[0],
        ),
      ],
    };
    const next = env.applyAction(state, action);
    const control = env.applyAction(untouched, action);
    assert.deepEqual(next, control);
    assert.deepEqual(turnRecord(state, action, next), turnRecord(untouched, action, control));
    assert.deepEqual(puzzle.canonical.source.log, fixture.admin.puzzle.canonical.source.log);
  });

  it("refuses invented multiplicities and preserves rack size", () => {
    const state = source();
    assert.throws(() => constructBranch(state, Array(8).fill("20")), /inventory|available/);
    assert.throws(() => constructBranch(state, ["1"]), /rack size/);
    const available = availableKinds(state);
    assert.equal(available.length, 100 - positionOf(state).board.length);
  });
});

describe("necessary-condition pruning", () => {
  it("keeps every real proof move, including overlapping labels", async () => {
    for (const [set, id] of [
      ["set-20260925-133247-7901da", "pz-e874fa2137d6"],
      ["set-20260925-133444-6670f3", "pz-595f246c72a3"],
      ["set-20260925-133523-ea3e0b", "pz-7392892028f3"],
    ]) {
      // The HOOK fixture ships with the repo; the other local proof sets are
      // covered when available. Hand-built fixtures also check geometry below.
      let p;
      try {
        p = JSON.parse(
          readFileSync(new URL(`../archive/${set}/puzzles/${id}.json`, import.meta.url)),
        );
      } catch {
        p = puzzle;
      }
      const cfg = configFrom({
        seed: 1,
        bestPlay: {
          moveTypes: p.answer.moveTypes,
          tiles: { min: p.answer.composition.total, max: p.answer.composition.total },
          equations: { min: p.answer.equations.length, max: p.answer.equations.length },
          composition: Object.fromEntries(
            Object.entries(p.answer.composition)
              .filter(([k]) => k !== "total")
              .map(([k, n]) => [k, { min: n, max: n }]),
          ),
          excludeTrivialZero: false,
        },
        answer: { maxNear: 12 },
      });
      assert.deepEqual(geometryFeasibility(p.canonical.position, cfg).reasons, []);
      const result = await legalRackFeasibility(replayStudyLog(p.canonical.source.log), cfg, {
        budgetMs: 2000,
      });
      assert.notEqual(result.possible, false);
    }
  });

  it("proves lack of space while retaining uncertainty after an interrupted canonical search", async () => {
    const cfg = configFrom({ seed: 1, bestPlay: { tiles: { min: 8 } } });
    const full = {
      ...puzzle.canonical.position,
      board: Array.from({ length: 225 }, (_, i) => ({
        r: Math.floor(i / 15),
        c: i % 15,
        kind: "1",
        face: "1",
      })),
    };
    assert.ok(geometryFeasibility(full, cfg).reasons.includes("geometry.noPlacement"));
    const controller = new AbortController();
    controller.abort();
    const result = await legalRackFeasibility(source(), cfg, { signal: controller.signal });
    assert.equal(result.possible, null);
  });
});

describe("config-guided racks", () => {
  const config = configFrom({
    seed: 17,
    bestPlay: {
      tiles: { min: 8 },
      composition: { digit: { min: 7 }, choice: { min: 1 } },
    },
  });
  it("orders diverse legal rack multisets deterministically and obeys the placed-tile minimums", () => {
    const state = source();
    const candidates = [...candidateRacks(state, config, { budget: 24 })];
    assert.equal(candidates.length, 24);
    assert.deepEqual([...candidateRacks(state, config, { budget: 24 })], candidates);
    assert.equal(new Set(candidates.map((c) => c.rack.join(","))).size, 24);
    assert.ok(new Set(candidates.map((c) => c.family)).size >= 3);
    for (const candidate of candidates) {
      assert.equal(candidate.rack.filter((k) => categoryOf(k) === "digit").length, 7);
      assert.equal(candidate.rack.filter((k) => categoryOf(k) === "choice").length, 1);
      assert.equal(candidate.rack.length, 8);
      assert.equal(rackCanSatisfy(candidate.rack, config), true);
      assert.doesNotThrow(() => constructBranch(state, candidate.rack, candidate));
    }
    assert.equal(rackCanSatisfy(["1", "2", "3", "4", "5", "6", "7", "8"], config), false);
  });

  it("handles heavy, operator, choice, equals and blank minima without counting their faces", () => {
    const cfg = configFrom({
      seed: 3,
      bestPlay: {
        tiles: { min: 8 },
        composition: {
          digit: { min: 2 },
          heavy: { min: 1 },
          operator: { min: 1 },
          choice: { min: 1 },
          equals: { min: 1 },
          blank: { min: 1 },
        },
      },
    });
    for (const c of candidateRacks(source(), cfg, { budget: 8 })) {
      assert.equal(rackCanSatisfy(c.rack, cfg), true);
      for (const [category, range] of Object.entries(cfg.bestPlay.composition))
        assert.ok(c.rack.filter((k) => categoryOf(k) === category).length >= range.min);
    }
    const restricted = configFrom({
      seed: 3,
      bestPlay: { tiles: { min: 8 }, composition: { digit: { max: 0 } } },
    });
    assert.equal(rackCanSatisfy(["1", "2", "3", "4", "5", "6", "7", "8"], restricted), false);
  });

  it("rejects impossible inventory/rack totals while retaining rare OR-label combinations", () => {
    assert.throws(
      () =>
        configFrom({
          seed: 1,
          bestPlay: { composition: { digit: { min: 8 }, choice: { min: 1 } } },
        }),
      /เกิน/,
    );
    assert.throws(
      () => configFrom({ seed: 1, bestPlay: { composition: { blank: { min: 5 } } } }),
      /เบี้ย|จำนวน/,
    );
    assert.throws(
      () => configFrom({ seed: 1, bestPlay: { tiles: { max: 1 }, equations: { min: 3 } } }),
      /สมการ/,
    );
    assert.doesNotThrow(() =>
      configFrom({ seed: 1, bestPlay: { moveTypes: ["CROSS", "HOOK"], equations: { max: 1 } } }),
    );
  });
});
