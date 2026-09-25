import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { configFrom } from "../lib/config.mjs";
import { candidateRacks, rackCanSatisfy } from "../lib/racks.mjs";
import { replayStudyLog } from "../lib/provenance.mjs";
import { readFileSync } from "node:fs";
import { availableKinds, constructBranch } from "../lib/branch.mjs";
import { analyzePlacement, contactCategory } from "../lib/analysis.mjs";
import { bestPlayRejections } from "../lib/filters.mjs";
import { equationFacts, hasEquationProperty } from "../lib/equation-facts.mjs";
import { legalPlacementCount } from "../lib/mobility.mjs";
import { geometryFeasibility } from "../lib/feasibility.mjs";
import { env } from "../lib/provenance.mjs";
import { playerProjection } from "../lib/record.mjs";
import { verifyProvenance } from "../lib/verify.mjs";
import { canonicalJson } from "../../survival-generator/lib/canonical.mjs";

const fixture = JSON.parse(readFileSync(new URL("../../../tests/fixtures/study-puzzles/v2-hook-set.json", import.meta.url)));
const source = () => replayStudyLog(fixture.admin.puzzle.canonical.source.log, "seed");
const crossProof = JSON.parse(readFileSync(new URL("../../../tests/fixtures/study-puzzles/v2-cross-4-7-3.json", import.meta.url)));
const rackProof = JSON.parse(readFileSync(new URL("../../../tests/fixtures/study-puzzles/v2-specific-rack.json", import.meta.url)));
const exact = (n) => ({ min: n, max: n });

describe("Study puzzle specification: physical rack constraints", () => {
  it("composes group ranges and canonical specific tile ranges", () => {
    const cfg = configFrom({ seed: 1, rack: { groups: { arithmetic: { min: 2, max: 4 } }, specific: { x: exact(1), "-": { min: 1, max: 2 } } } });
    assert.equal(rackCanSatisfy(["x", "-", "1", "2", "3", "4", "5", "6"], cfg), true);
    assert.equal(rackCanSatisfy(["x", "1", "2", "3", "4", "5", "6", "7"], cfg), false);
    assert.equal(rackCanSatisfy(["x", "-", "+", "/", "=", "1", "2", "3"], cfg), true);
    assert.equal(rackCanSatisfy(["x", "-", "+", "/", "+/-", "1", "2", "3"], cfg), false);
  });
  it("rejects contradictions and impossible physical multiplicity", () => {
    assert.throws(() => configFrom({ seed: 1, rack: { groups: { arithmetic: { max: 1 } }, specific: { x: exact(1), "-": exact(1) } } }), /เกิน|ขัด|เป็นไปไม่ได้/);
    assert.throws(() => configFrom({ seed: 1, rack: { specific: { "20": exact(8) } } }), /มีทั้งหมด|เป็นไปไม่ได้/);
    assert.throws(() => configFrom({ seed: 1, rack: { groups: { operatorLike: { max: 1 } }, specific: { "=": exact(1), "+": exact(1) } } }), /เป็นไปไม่ได้|ขัด/);
    assert.throws(() => configFrom({ seed: 1, rack: { specific: { invented: exact(1) } } }), /ชนิดเบี้ย/);
    assert.throws(() => configFrom({ seed: 1, rack: { groups: { arithmetic: { max: 0 } } }, bestPlay: { specific: { x: exact(1) } } }), /ในมือ.*ตาที่ดีที่สุด|ขัดกัน/);
    assert.throws(() => configFrom({ seed: 1, rack: { specific: { x: { max: 0 } } }, bestPlay: { specific: { x: exact(1) } } }), /ในมือ.*ตาที่ดีที่สุด|ขัดกัน/);
  });
  it("guided racks obey simultaneous group/specific limits and conserve tiles", () => {
    const state = source();
    const cfg = configFrom({ seed: 1, rack: { groups: { arithmetic: { min: 2, max: 4 } }, specific: { x: exact(1), "-": { min: 1, max: 2 } } } });
    const racks = [...candidateRacks(state, cfg, { budget: 8 })];
    assert.ok(racks.length > 0);
    const pool = availableKinds(state);
    for (const { rack } of racks) {
      assert.equal(rack.filter((kind) => kind === "x").length, 1);
      assert.ok(rack.filter((kind) => kind === "-").length >= 1);
      assert.equal(rackCanSatisfy(rack, cfg), true);
      for (const kind of new Set(rack)) assert.ok(rack.filter((k) => k === kind).length <= pool.filter((k) => k === kind).length);
      assert.doesNotThrow(() => constructBranch(state, rack));
    }
    const reordered = configFrom({ seed: 1, rack: { specific: { "-": { min: 1, max: 2 }, x: exact(1) }, groups: { arithmetic: { min: 2, max: 4 } } } });
    assert.deepEqual([...candidateRacks(state, reordered, { budget: 8 })], racks);
  });
  it("replays a generated rack-specific guided proof with exact physical conservation", () => {
    assert.equal(rackProof.canonical.provenance.origin, "CONFIG_GUIDED_RACK");
    assert.equal(verifyProvenance(rackProof).ok, true);
    const config = configFrom({ seed: 1, rack: { size: exact(8), groups: { arithmetic: { min: 2, max: 4 } }, specific: { x: exact(1), "-": { min: 1, max: 2 } } } });
    assert.equal(rackCanSatisfy(rackProof.canonical.position.rack, config), true);
    assert.doesNotMatch(JSON.stringify(playerProjection(rackProof)), /"(answer|geometry|semantics|opponentRack|bag|source)"/);
  });
});

const tiles = (text) => text.split(" ").map((face) => ({ face, kind: face, new: true }));
const cell = (r, c, kind) => ({ r, c, kind, face: kind === "x" ? "×" : kind });
const row = (r, c, kinds) => kinds.map((kind, i) => cell(r, c + i, kind));
const reasons = (input, analysis, rack = Array(8).fill("1")) =>
  bestPlayRejections(configFrom({ seed: 1, ...input }), { analysis, nearBest: [], rackIndex: 5, rack });

describe("Study puzzle specification: canonical best-play facts", () => {
  it("distinguishes EXTEND HEAD_ONLY, TAIL_ONLY, BOTH and ordered boundary contacts", () => {
    const head = analyzePlacement(row(7, 5, ["5", "x", "0", "=", "0"]), [cell(7, 4, "1")]);
    const tail = analyzePlacement(row(7, 5, ["2", "=", "2"]), row(7, 8, ["+", "0"]));
    const both = analyzePlacement(row(7, 6, ["9", "=", "9"]), [...row(7, 4, ["0", "+"]), ...row(7, 9, ["x", "1"])]);
    assert.equal(head.valid, true);
    assert.equal(tail.valid, true);
    assert.equal(both.valid, true);
    assert.deepEqual(head.geometry.extend, { shape: "HEAD_ONLY", headContact: ["DIGIT", "DIGIT"], tailContact: null, headContacts: [["DIGIT", "DIGIT"]], tailContacts: [] });
    assert.deepEqual(tail.geometry.extend, { shape: "TAIL_ONLY", headContact: null, tailContact: ["DIGIT", "ARITHMETIC_OPERATOR"], headContacts: [], tailContacts: [["DIGIT", "ARITHMETIC_OPERATOR"]] });
    assert.deepEqual(both.geometry.extend, { shape: "BOTH", headContact: ["DIGIT", "ARITHMETIC_OPERATOR"], tailContact: ["DIGIT", "ARITHMETIC_OPERATOR"], headContacts: [["DIGIT", "ARITHMETIC_OPERATOR"]], tailContacts: [["DIGIT", "ARITHMETIC_OPERATOR"]] });
    assert.deepEqual(reasons({ geometry: { extend: { shapes: ["BOTH"], headContacts: [["DIGIT", "ARITHMETIC_OPERATOR"]] } } }, both), []);
    assert.ok(reasons({ geometry: { extend: { shapes: ["HEAD_ONLY"] } } }, both).includes("geometry.extend.expected.HEAD_ONLY"));
    assert.ok(reasons({ geometry: { extend: { tailContacts: [["DIGIT", "EQUALS"]] } } }, both).includes("geometry.extend.tailContact"));
    assert.equal(contactCategory({ kind: "=", face: "=" }), "EQUALS");
    assert.equal(contactCategory({ kind: "+/-", face: "+" }), "ARITHMETIC_OPERATOR");
    assert.equal(contactCategory({ kind: "?", face: "=" }), "EQUALS");
  });
  it("counts only newly placed physical kinds, and per-equation reused tiles", () => {
    const a = analyzePlacement(row(7, 5, ["2", "=", "2"]), row(7, 8, ["+", "0"]));
    assert.equal(a.valid, true);
    assert.equal(a.equations[0].tileCount, 5);
    assert.equal(a.equations[0].placedParticipating, 2);
    assert.equal(a.equations[0].reusedBoardTiles, 3);
    assert.deepEqual(a.placedKinds, ["+", "0"]);
    assert.ok(reasons({ bestPlay: { specific: { "2": exact(1) } } }, a).includes("bestPlay.specific.2"));
    assert.deepEqual(reasons({ equation: { tiles: exact(5), reusedBoardTiles: exact(3), placedParticipating: exact(2) } }, a), []);
  });
  it("CROSS can place four new tiles into a seven-cell scored equation reusing three", () => {
    const board = [
      ...[4, 6, 8].flatMap((c, i) => [cell(7, c, String(i + 1)), cell(8, c, "="), cell(9, c, String(i + 1))]),
      cell(9, 5, "+"), cell(9, 7, "="),
    ];
    const a = analyzePlacement(board, [cell(7, 5, "+"), cell(7, 7, "+"), cell(7, 9, "="), cell(7, 10, "6")]);
    assert.equal(a.valid, true, a.errors?.join(" · "));
    assert.ok(a.moveTypes.includes("CROSS"));
    assert.equal(a.composition.total, 4);
    assert.equal(a.equations[0].tileCount, 7);
    assert.equal(a.equations[0].reusedBoardTiles, 3);
    const requested = { bestPlay: { moveTypes: ["CROSS"], tiles: exact(4) }, equation: { scope: "MAIN", tiles: exact(7), reusedBoardTiles: exact(3) } };
    assert.deepEqual(reasons(requested, a), []);
    assert.deepEqual(geometryFeasibility({ board, rack: ["+", "+", "=", "6"] }, configFrom({ seed: 1, ...requested })).reasons, []);
  });
  it("replays a guided 4/7/3 CROSS proof and conserves its source tiles", () => {
    const proven = verifyProvenance(crossProof);
    assert.equal(proven.ok, true);
    for (const key of ["sourceReplay", "sourceState", "rackLegal", "tileConservation", "positionHash"])
      assert.equal(proven.checks[key].ok, true, key);
    const a = analyzePlacement(crossProof.canonical.position.board, crossProof.answer.best.placements);
    assert.equal(a.valid, true);
    assert.equal(a.equations[0].tileCount, 7);
    assert.equal(a.equations[0].reusedBoardTiles, 3);
    assert.deepEqual(reasons({ bestPlay: { moveTypes: ["CROSS"], tiles: exact(4), excludeTrivialZero: false }, equation: { scope: "MAIN", tiles: exact(7), reusedBoardTiles: exact(3), placedParticipating: exact(4) } }, a, crossProof.canonical.position.rack), []);
    assert.doesNotMatch(JSON.stringify(playerProjection(crossProof)), /"(answer|geometry|semantics|opponentRack|bag|source)"/);
  });
  it("uses explicit MAIN/ANY/ALL scope and one matching equation for ANY", () => {
    const a = analyzePlacement(row(7, 5, ["5", "x", "0", "=", "0"]), [cell(7, 4, "1")]);
    assert.equal(a.valid, true);
    const second = { ...a.equations[0], tileCount: 7, reusedBoardTiles: 3, placedParticipating: 4 };
    const two = { ...a, equations: [a.equations[0], second] };
    assert.ok(reasons({ bestPlay: { excludeTrivialZero: false }, equation: { scope: "MAIN", tiles: exact(7) } }, two).includes("equation.tiles"));
    assert.deepEqual(reasons({ bestPlay: { excludeTrivialZero: false }, equation: { scope: "ANY", tiles: exact(7), reusedBoardTiles: exact(3) } }, two), []);
    assert.ok(reasons({ bestPlay: { excludeTrivialZero: false }, equation: { scope: "ALL", tiles: exact(7) } }, two).includes("equation.tiles"));
    const disjoint = { ...a, equations: [{ ...a.equations[0], tileCount: 7, reusedBoardTiles: 5 }, { ...second, tileCount: 5 }] };
    assert.ok(reasons({ bestPlay: { excludeTrivialZero: false }, equation: { scope: "ANY", tiles: exact(7), reusedBoardTiles: exact(3) } }, disjoint).includes("equation.scope"));
  });
});

describe("Study puzzle specification: exact equation semantics", () => {
  it("recognizes fractional add/subtract and excludes plus/minus from MUL_DIV_ONLY", () => {
    const facts = equationFacts(tiles("1 ÷ 2 + 1 ÷ 2 = 1"));
    assert.equal(facts.fractionAddSub, true);
    assert.equal(facts.mulDivOnly, false);
    assert.equal(facts.fractionResult, false);
  });
  it("composes multiplication/division-only with a fractional result exactly", () => {
    const facts = equationFacts(tiles("1 ÷ 3 = 2 ÷ 6"));
    assert.equal(facts.mulDivOnly, true);
    assert.equal(facts.fractionResult, true);
    assert.deepEqual(facts.result, { numerator: "1", denominator: "3" });
    assert.equal(hasEquationProperty(facts, "MUL_DIV_ONLY", 1000), true);
    assert.equal(hasEquationProperty(facts, "FRACTION_RESULT", 1000), true);
  });
  it("uses configurable strict integer threshold and negative exact values", () => {
    const large = equationFacts(tiles("9 × 20 = 1 8 0"));
    assert.equal(hasEquationProperty(large, "LARGE_INTEGER_RESULT", 100), true);
    assert.equal(hasEquationProperty(large, "LARGE_INTEGER_RESULT", 180), false);
    const negative = equationFacts(tiles("1 - 2 = - 1"));
    assert.equal(hasEquationProperty(negative, "NEGATIVE_RESULT", 1000), true);
    assert.throws(() => configFrom({ seed: 1, equation: { properties: ["MUL_DIV_ONLY", "FRACTION_ADD_SUB"] } }), /คูณ\/หาร/);
    assert.throws(() => configFrom({ seed: 1, equation: { properties: ["FRACTION_RESULT", "LARGE_INTEGER_RESULT"] } }), /เศษส่วน/);
  });
  it("filters a real scored CROSS equation with composable exact properties", () => {
    const p = JSON.parse(readFileSync(new URL("../archive/set-20260925-163949-243f4e/puzzles/pz-9ef59ee363c4.json", import.meta.url)));
    const a = analyzePlacement(p.canonical.position.board, p.answer.best.placements);
    assert.deepEqual(reasons({ bestPlay: { excludeTrivialZero: false }, equation: { scope: "MAIN", properties: ["MUL_DIV_ONLY", "FRACTION_RESULT", "NEGATIVE_RESULT"] } }, a, p.canonical.position.rack), []);
    assert.ok(reasons({ bestPlay: { excludeTrivialZero: false }, equation: { properties: ["FRACTION_ADD_SUB"] } }, a, p.canonical.position.rack).includes("equation.property.FRACTION_ADD_SUB"));
  });
});

describe("Study puzzle specification: canonical mobility", () => {
  it("deduplicates placements and excludes Pass and Exchange", async () => {
    const generate = async () => ({ complete: true, truncated: false, places: [{ id: "a" }, { id: "a" }, { id: "b" }], exchanges: [{ id: "exchange" }], pass: { id: "pass" } });
    assert.deepEqual(await legalPlacementCount({}, { generate }), { exact: true, lowerBound: 2, count: 2, overMax: false });
  });
  it("uses a unique-count max+1 proof without an exact claim", async () => {
    const generate = async (_, options) => {
      options.onProgress(6);
      return { complete: false, truncated: false, places: Array.from({ length: 6 }, (_, id) => ({ id })) };
    };
    assert.deepEqual(await legalPlacementCount({}, { max: 5, generate }), { exact: false, lowerBound: 6, count: null, overMax: true });
    const exactlyFive = async (_, options) => {
      options.onProgress(5);
      return { complete: true, truncated: false, places: Array.from({ length: 5 }, (_, id) => ({ id })) };
    };
    assert.deepEqual(await legalPlacementCount({}, { max: 5, generate: exactlyFive }), { exact: true, lowerBound: 5, count: 5, overMax: false });
  });
  it("agrees with the complete canonical generator on a real position", async () => {
    const state = source();
    const before = canonicalJson(state);
    const root = await env.completeRootActions(state);
    const measured = await legalPlacementCount(state);
    assert.equal(measured.exact, true);
    assert.equal(measured.count, new Set(root.places.map((move) => move.id)).size);
    assert.equal(canonicalJson(state), before, "counting moves cannot consume RNG, tiles or source state");
  });
});

it("keeps expanded admin analysis out of the player projection", () => {
  const p = structuredClone(fixture.admin.puzzle);
  p.answer.geometry = { extend: { shape: "BOTH", headContact: ["DIGIT", "ARITHMETIC_OPERATOR"], tailContact: ["DIGIT", "EQUALS"] } };
  p.answer.equations[0].semantics = equationFacts(tiles("1 ÷ 3 = 2 ÷ 6"));
  p.features.legalPlacementCount = 3;
  const shown = JSON.stringify(playerProjection(p));
  assert.doesNotMatch(shown, /"(answer|geometry|semantics|legalPlacementCount|opponentRack|bag|source)"/);
});
