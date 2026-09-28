#!/usr/bin/env node
// Build the ArchBot parity corpus: tests/fixtures/archbot/parity-corpus.json.
//
//   node tools/archbot/parity/generate-corpus.mjs
//
// 1. Positions: ArchBot self-play inside the PINNED Stage 5B environment
//    (amath-bot-lab pin/stage5b-reference, via git archive), plus synthetic racks
//    for the cases self-play rarely deals: blanks, two blanks, two blanks with
//    both choice tiles on an empty board (the known pathological opening).
// 2. Expected answers: the PRODUCTION runtime (engine-algo 7aafbfc,
//    service/stage5b/runtime.mjs, hash-checked), run once per case exactly as the
//    service runs it — a child process reading the request on stdin.
//
// The fixture records, per case, a digest of the runtime's whole answer (every
// candidate, value and component; only `stats.elapsedMs` is dropped, being wall
// time) plus the chosen move and top candidates in the clear for readable
// failures. tests/archbot-parity.test.ts holds ArchBot to it.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";
import {
  comparable,
  extractOracle,
  extractPinnedSource,
  pin,
  repo,
  runOracle,
  sha256,
} from "../pinned.mjs";

const OUT = join(repo, "tests/fixtures/archbot/parity-corpus.json");
const SEEDS = [11, 23, 37, 59];

const log = (message) => console.log(`[corpus] ${message}`);

const pinned = extractPinnedSource();
const oracle = extractOracle();
try {
  const entry = join(pinned, "entry.js");
  writeFileSync(
    entry,
    [
      `export { GameEnvironment, isExchangeAllowed } from "./amath-bot-lab/src/env";`,
      `export { createManifest } from "./amath-bot-lab/src/core/tiles";`,
      `export { decideArchBot } from ${JSON.stringify(join(repo, "src/bot/archbot/decide.ts"))};`,
      `export { loadValueModel, ValueHead } from ${JSON.stringify(join(repo, "src/bot/archbot/core/stage5b-core.mjs"))};`,
      `export * from ${JSON.stringify(join(repo, "tools/archbot/parity/selfplay.js"))};`,
    ].join("\n"),
  );
  const bundle = join(pinned, "bundle.mjs");
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: bundle,
    logLevel: "warning",
  });
  const lib = await import(pathToFileURL(bundle).href);

  const modelDir = join(repo, "public/models/archbot", pin.model.weightsSha256.slice(0, 8));
  const meta = readFileSync(join(modelDir, "model.json"));
  const weights = readFileSync(join(modelDir, "weights.bin"));
  if (sha256(meta) !== pin.model.modelJsonSha256 || sha256(weights) !== pin.model.weightsSha256) {
    throw new Error("vendored model does not match the pin");
  }
  const bytes = weights.buffer.slice(weights.byteOffset, weights.byteOffset + weights.byteLength);
  const value = new lib.ValueHead(lib.loadValueModel(JSON.parse(meta.toString("utf8")), bytes));
  const decide = (request) => lib.decideArchBot(request, value);

  const cases = lib.selfPlayCases({
    GameEnvironment: lib.GameEnvironment,
    isExchangeAllowed: lib.isExchangeAllowed,
    decide,
    seeds: SEEDS,
    log,
  });

  // ── Synthetic racks ──
  const kinds = lib.createManifest().tiles.map((tile) => tile.kind);
  const opening = cases.find((item) => item.request.board.length === 0).request;
  const synthetic = [
    ["opening-two-blanks-two-choices-a", opening, ["?", "?", "+/-", "x//", "=", "3", "7", "12"]],
    ["opening-two-blanks-two-choices-b", opening, ["?", "?", "+/-", "x//", "1", "4", "9", "="]],
    ["opening-one-blank", opening, ["?", "2", "5", "+", "=", "8", "x", "10"]],
  ];
  const byTag = (tag) => cases.filter((item) => item.tags.includes(tag));
  const mid = byTag("midgame");
  const late = byTag("late");
  // Two-blank racks later in the game: one base per game, from positions where
  // both of the swapped-in blanks are still unseen.
  const blanksUnseen = (request) =>
    kinds.filter((kind) => kind === "?").length -
      [...request.board, ...request.rack.map((kind) => ({ kind }))].filter((t) => t.kind === "?")
        .length >=
    2;
  const bases = [];
  for (const base of [...mid, ...late]) {
    const game = base.id.split("-")[1];
    if (bases.some((b) => b.id.split("-")[1] === game)) continue;
    if (base.request.board.length >= 12 && blanksUnseen(base.request)) bases.push(base);
  }
  for (const base of bases) {
    const rack = [...base.request.rack];
    // Two blanks in place of the first two non-blank tiles.
    let swapped = 0;
    for (let slot = 0; slot < rack.length && swapped < 2; slot += 1) {
      if (rack[slot] !== "?") {
        rack[slot] = "?";
        swapped += 1;
      }
    }
    synthetic.push([`${base.id}-two-blanks`, base.request, rack]);
  }
  for (const [id, base, rack] of synthetic) {
    try {
      const request = lib.withRack(base, rack, kinds, `archbot-corpus:${id}`);
      cases.push({
        id,
        source: "synthetic rack",
        tags: [...lib.tagsFor(request), "synthetic"],
        request,
      });
    } catch (error) {
      log(`skipped ${id}: ${error.message}`);
    }
  }

  // ── Expected answers from the production runtime ──
  const out = [];
  for (const [index, item] of cases.entries()) {
    const started = Date.now();
    const answer = runOracle(oracle.runtime, item.request);
    const ms = Date.now() - started;
    if (answer.error) throw new Error(`oracle failed on ${item.id}: ${answer.error}`);
    const expected = comparable(answer);
    const chosenIndex = expected.candidates.findIndex((candidate) => candidate.chosen);
    out.push({
      ...item,
      expected: {
        digest: sha256(JSON.stringify(expected)),
        move: {
          type: expected.type,
          placements: expected.placements,
          exchange: expected.exchange,
          score: expected.score,
        },
        equity: expected.equity,
        chosenIndex,
        top: expected.candidates
          .slice(0, 3)
          .map((c) => ({
            type: c.type,
            score: c.score,
            value: c.value,
            placements: c.placements,
            exchange: c.exchange,
          })),
        legalMoves: expected.stats.moves,
        oracleMs: ms,
      },
    });
    if ((index + 1) % 10 === 0) log(`${index + 1}/${cases.length} oracle answers`);
  }

  mkdirSync(join(repo, "tests/fixtures/archbot"), { recursive: true });
  // One case per line, so a regenerated corpus diffs case by case.
  const header = {
    comment:
      "Generated by tools/archbot/parity/generate-corpus.mjs. Expected answers are the production Stage 5B runtime's.",
    provenance: {
      amathBotLabCommit: pin.amathBotLab.commit,
      oracleCommit: pin.oracle.commit,
      oracleRuntimeSha256: pin.oracle.runtimeSha256,
      modelJsonSha256: pin.model.modelJsonSha256,
      weightsSha256: pin.model.weightsSha256,
    },
    digest: "sha256 of JSON.stringify(answer) with stats.elapsedMs removed",
  };
  const head = JSON.stringify(header, null, 1).replace(/\n}$/, "");
  writeFileSync(
    OUT,
    `${head},\n "cases": [\n${out.map((item) => JSON.stringify(item)).join(",\n")}\n ]\n}\n`,
  );
  const tally = {};
  for (const item of out) for (const tag of item.tags) tally[tag] = (tally[tag] ?? 0) + 1;
  log(`wrote ${out.length} cases to ${OUT.slice(repo.length + 1)}`);
  log(`tags: ${JSON.stringify(tally)}`);
} finally {
  rmSync(pinned, { recursive: true, force: true });
  rmSync(oracle.root, { recursive: true, force: true });
}
