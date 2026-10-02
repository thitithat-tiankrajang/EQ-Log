import { it, vi } from "vitest";
import { encodeBoardCells, encodeGame, encodeTileCodes } from "../src/codec";
import {
  buildCompletedGameRecord,
  finalPosition,
  positionAt,
  readCompletedGameRecord,
  replayCompletedGame,
  validateCompletedGameRecord,
  type CompletedProvenance,
} from "../src/completedGame/record";
import {
  createInitialTilebag,
  createNewGame,
  getPendingExchangeReturnBySide,
  makeSnapshot,
  pushActionSnapshot,
  type GameState,
} from "../src/game";
import { createSurvivalTestGame } from "../src/features/survival/seededGame";
import { encodeMultiverse } from "../src/gameplay/multiverseCodec";
import { buildStageCompletedGameRecord } from "../src/completedGame/adapters";
import { stageStartCanonical } from "../src/features/survival/sealedStart";
import { positionOf, type Multiverse } from "../src/gameplay/multiverse";
import {
  finishedLegalPassGame,
  frozenLegalGame,
  legalEquationGame,
  legalPassGame,
} from "./helpers/completedCorpus";
import { newGame, pass, place } from "./helpers/simulateGame";

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const timed = async <T>(action: () => T | Promise<T>): Promise<[T, number]> => {
  const start = performance.now();
  const result = await action();
  return [result, Math.round((performance.now() - start) * 100) / 100];
};

/** Hypothetical complete position cache, including mutable game metadata. */
function checkpointBytes(
  record: Awaited<ReturnType<typeof buildCompletedGameRecord>>,
  at: number,
): number {
  const position = positionAt(record, at);
  const pending = getPendingExchangeReturnBySide(position);
  const meta = Object.fromEntries(
    Object.keys(record.genesis.meta).map((key) => [key, position[key as keyof typeof position]]),
  );
  return bytes({
    at,
    meta,
    board: encodeBoardCells(position.board),
    rackA: encodeTileCodes(position.rackA),
    rackB: encodeTileCodes(position.rackB),
    bag: encodeTileCodes(position.tilebag),
    pendingA: encodeTileCodes(pending.A),
    pendingB: encodeTileCodes(pending.B),
    digest: "0".repeat(64),
  });
}

function branchCorpus(game: GameState, count: number, suffix: number): Multiverse {
  const lines = Array.from({ length: count }, (_, lineIndex) => {
    const start = 2 + (lineIndex % Math.max(1, game.logs.length - suffix - 3));
    const logs = game.logs.slice(start + 1, start + 1 + suffix).map((log, index) => ({
      ...log,
      id: `branch-${lineIndex}-${index}`,
    }));
    const after = logs.map((_, index) => positionOf(game.history[start + 2 + index]!));
    return {
      id: `line-${lineIndex}`,
      from: game.logs[start]!.id,
      logs,
      after,
      tip: after.at(-1)!,
      parkedAt: "2026-01-01T00:10:00.000Z",
    };
  });
  return { version: count, lines };
}

function soloGame(): GameState {
  const game = createNewGame({
    name: "Solo",
    playerA: "Ann",
    playerB: "",
    startingSide: "A",
    gameMode: "solo",
    tileDrawMode: "play",
  });
  const inventory = createInitialTilebag();
  game.rackA = inventory.slice(0, 8);
  game.rackB = [];
  game.tilebag = inventory.slice(8);
  game.gameId = "corpus-solo";
  game.createdAt = "2026-01-01T00:00:00.000Z";
  game.currentTurnStartedAt = game.createdAt;
  game.history = [makeSnapshot(game)];
  return game;
}

/** Physical stress only: the helper does not validate equations. */
function physicalStress(turns: number): GameState {
  let game = newGame();
  const inventory = createInitialTilebag();
  game.gameId = "corpus-physical-stress";
  game.createdAt = "2026-01-01T00:00:00.000Z";
  game.currentTurnStartedAt = game.createdAt;
  game.rackA = inventory.slice(0, 8);
  game.rackB = inventory.slice(8, 16);
  game.tilebag = inventory.slice(16);
  game.history = [makeSnapshot(game)];
  let randomState = 0x12345678;
  const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
    const values = array as Uint32Array;
    for (let index = 0; index < values.length; index++) {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
      values[index] = randomState;
    }
    return array;
  });
  try {
    for (let index = 0; index < turns; index++) {
      game = index < 15 ? place(game, 2) : pass(game);
      const id = `physical-${index + 1}`;
      game.logs.at(-1)!.id = id;
      game.history.at(-1)!.logs.at(-1)!.id = id;
      game.history.at(-1)!.commitId = `snapshot-${index + 1}`;
      game.currentTurnStartedAt = new Date(
        Date.parse(game.createdAt) + (index + 1) * 1000,
      ).toISOString();
      game.history.at(-1)!.currentTurnStartedAt = game.currentTurnStartedAt;
    }
  } finally {
    random.mockRestore();
  }
  return game;
}

function withMetadata(game: GameState, changes: Partial<GameState>): GameState {
  return {
    ...game,
    ...changes,
    history: game.history.map((snapshot) => ({ ...snapshot, ...changes, logs: snapshot.logs })),
  };
}

// Opt in so normal test runs do not spend time benchmarking or emit tables.
const benchmark = process.env.BENCHMARK_COMPLETED === "1" ? it : it.skip;
benchmark(
  "reports reproducible compact-record measurements",
  async () => {
    const stressA = physicalStress(20);
    const stressB = physicalStress(20);
    const stressEncodedA = JSON.stringify(await buildCompletedGameRecord(stressA));
    const stressEncodedB = JSON.stringify(await buildCompletedGameRecord(stressB));
    if (stressEncodedA !== stressEncodedB) {
      const index = [...stressEncodedA].findIndex(
        (char, position) => char !== stressEncodedB[position],
      );
      throw new Error(
        `Physical stress fixture is nondeterministic at ${index}: ${stressEncodedA.slice(index - 60, index + 80)} / ${stressEncodedB.slice(index - 60, index + 80)}`,
      );
    }
    const base = legalPassGame(20);
    const manual = createNewGame({
      name: "Manual",
      playerA: "A",
      playerB: "B",
      startingSide: "A",
      tileDrawMode: "manual",
    });
    const edited = pushActionSnapshot({
      ...manual,
      rackA: [manual.tilebag[0]!],
      tilebag: manual.tilebag.slice(1),
      scores: { A: 12, B: 0 },
    });
    const stage = createSurvivalTestGame(5093, "Tester");
    stage.gameId = "corpus-stage-5093";
    stage.createdAt = "2026-01-01T00:00:00.000Z";
    stage.currentTurnStartedAt = stage.createdAt;
    stage.history = [makeSnapshot(stage)];
    const stageProvenance: CompletedProvenance = {
      mode: "stage",
      stage: { levelId: "draft-stage-5093", seed: 5093, sealedStartDigest: "sealed-example" },
      bot: { catalogId: "authur", catalogVersion: "catalog-1" },
    };
    const completedStage = pushActionSnapshot({
      ...stage,
      status: "finished",
      timers: { ...stage.timers, paused: true },
    });
    const completedStageRecord = await buildStageCompletedGameRecord(completedStage, {
      levelId: "draft-stage-5093",
      seed: 5093,
      sealedStart: stageStartCanonical(5093),
      bot: { catalogId: "authur", catalogVersion: "catalog-1" },
    });
    const corpus: {
      name: string;
      game: GameState;
      branches?: Multiverse;
      provenance?: CompletedProvenance;
      class: string;
    }[] = [
      {
        name: "legal-40-placement",
        game: frozenLegalGame("long", 40),
        class: "validator-legal representative",
      },
      {
        name: "legal-60-placement-finished",
        game: frozenLegalGame("long", 60, true),
        class: "validator-legal representative",
      },
      {
        name: "legal-65-placement",
        game: frozenLegalGame("long", 65),
        class: "validator-legal long",
      },
      {
        name: "legal-rackout-39",
        game: frozenLegalGame("rackout", 39),
        class: "validator-legal rackout",
      },
      { name: "new", game: legalPassGame(0), class: "legal" },
      { name: "early-equation", game: legalEquationGame(), class: "legal" },
      { name: "legal-20-pass-heavy", game: base, class: "legal atypical" },
      { name: "legal-40-pass-heavy", game: legalPassGame(40), class: "legal atypical" },
      { name: "legal-60-pass-heavy", game: legalPassGame(60), class: "legal atypical" },
      { name: "finished-61-resign", game: finishedLegalPassGame(60), class: "legal atypical" },
      { name: "solo-start", game: soloGame(), class: "legal" },
      { name: "friend", game: legalEquationGame(), class: "legal" },
      {
        name: "authur-bot",
        game: withMetadata(base, {
          botSide: "B",
          botEngine: "authur",
          botDifficulty: "super",
          superEngineVersion: "engine-4",
          superWeightsVersion: "weights-2",
        }),
        provenance: {
          mode: "bot",
          bot: { catalogId: "authur", catalogVersion: "catalog-1", engineVersion: "engine-4" },
        },
        class: "legal atypical",
      },
      {
        name: "hosted",
        game: withMetadata(base, {
          emailPlayMode: "hosted",
          playerUserIds: { A: "owner", B: "guest" },
        }),
        class: "legal atypical",
      },
      { name: "stage-start", game: stage, provenance: stageProvenance, class: "draft stage" },
      {
        name: "stage-manual-finished",
        game: completedStage,
        provenance: completedStageRecord.provenance,
        class: "sealed Stage terminal capture",
      },
      { name: "manual-edit", game: edited, class: "physical correction" },
      { name: "clocked", game: base, class: "legal atypical" },
      {
        name: "one-branch",
        game: base,
        branches: branchCorpus(base, 1, 2),
        class: "legal atypical",
      },
      {
        name: "several-branches",
        game: base,
        branches: branchCorpus(base, 4, 3),
        class: "legal atypical",
      },
      {
        name: "heavy-branches",
        game: legalPassGame(40),
        branches: branchCorpus(legalPassGame(40), 30, 12),
        class: "legal atypical",
      },
      {
        name: "physical-20-unvalidated",
        game: physicalStress(20),
        class: "physical only; equation legality unverified",
      },
      {
        name: "physical-40-unvalidated",
        game: physicalStress(40),
        class: "physical only; equation legality unverified",
      },
      {
        name: "physical-60-unvalidated",
        game: physicalStress(60),
        class: "physical only; equation legality unverified",
      },
    ];
    const results = [];
    for (const item of corpus) {
      const [current, currentEncodeMs] = await timed(() => encodeGame(item.game));
      const [record, encodeMs] = await timed(() =>
        buildCompletedGameRecord(item.game, item.branches, item.provenance),
      );
      const wire = JSON.stringify(record);
      const [parsed, parseMs] = await timed(() => JSON.parse(wire));
      const [, decodeMs] = await timed(() => readCompletedGameRecord(parsed));
      const [, replayMs] = await timed(() => replayCompletedGame(record));
      const [, initialMs] = await timed(() => positionAt(record, 0));
      const [, turn10Ms] = await timed(() =>
        positionAt(record, Math.min(10, record.events.length)),
      );
      const [, turn20Ms] = await timed(() =>
        positionAt(record, Math.min(20, record.events.length)),
      );
      const [, middleMs] = await timed(() =>
        positionAt(record, Math.floor(record.events.length / 2)),
      );
      const [, endMs] = await timed(() => positionAt(record, record.events.length));
      const currentBytes = bytes(current);
      const newBytes = bytes(record);
      results.push({
        name: item.name,
        class: item.class,
        turns: item.game.logs.length,
        currentBytes,
        newBytes,
        reductionBytes: currentBytes - newBytes,
        reductionPct: Math.round((1 - newBytes / currentBytes) * 1000) / 10,
        currentEncodeMs,
        encodeMs,
        parseMs,
        decodeMs,
        replayMs,
        initialMs,
        turn10Ms,
        turn20Ms,
        middleMs,
        endMs,
        eventCount: record.events.length,
        checkpointBytes: 0,
        finalCheckpointBytes: checkpointBytes(record, record.events.length),
        every10CheckpointBytes: Array.from(
          { length: Math.floor(record.events.length / 10) },
          (_, index) => checkpointBytes(record, (index + 1) * 10),
        ).reduce((a, b) => a + b, 0),
        every20CheckpointBytes: Array.from(
          { length: Math.floor(record.events.length / 20) },
          (_, index) => checkpointBytes(record, (index + 1) * 20),
        ).reduce((a, b) => a + b, 0),
        branchBytes: record.branches ? bytes(record.branches) : 0,
        existingTimelineBytes: item.branches ? bytes(encodeMultiverse(item.branches)) : 0,
        verboseMemoryProxyBytes: bytes(item.game),
        compactMemoryProxyBytes: bytes(record),
      });
    }
    console.log(`COMPLETED_GAME_BENCHMARK=${JSON.stringify(results)}`);
  },
  60_000,
);

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(fraction * sorted.length) - 1]! * 100) / 100;
}

benchmark(
  "profiles representative legal events and repeated local replay timings",
  async () => {
    const results = [];
    for (const [name, game] of [
      ["legal-40", frozenLegalGame("long", 40)],
      ["legal-60-finished", frozenLegalGame("long", 60, true)],
      ["rackout-39", frozenLegalGame("rackout", 39)],
    ] as const) {
      const record = await buildCompletedGameRecord(game);
      const eventBytes = record.events.map((event) => ({
        sequence: event.sequence,
        kind: event.kind,
        bytes: bytes(event),
        action: event.append?.map((turn) => turn.core.action).join("+") ?? "",
        parts: {
          meta: bytes(event.meta ?? []),
          position: bytes(event.position ?? {}),
          core: bytes(event.append?.map((turn) => turn.core) ?? []),
          before: bytes(event.append?.map((turn) => turn.before ?? {}) ?? []),
          after: bytes(event.append?.map((turn) => turn.after ?? {}) ?? []),
        },
      }));
      const sizes = eventBytes.map((event) => event.bytes);
      const timing: Record<string, number[]> = {
        build: [],
        validate: [],
        read: [],
        replay: [],
        final: [],
        middle: [],
        turn0: [],
        turn10: [],
        turn20: [],
        turn40: [],
        turn60: [],
      };
      const parsed = JSON.parse(JSON.stringify(record));
      const sample = async (key: string, run: () => unknown | Promise<unknown>) => {
        const start = performance.now();
        await run();
        timing[key]!.push(performance.now() - start);
      };
      for (let iteration = 0; iteration < 21; iteration++) {
        await sample("build", () => buildCompletedGameRecord(game));
        await sample("validate", () => validateCompletedGameRecord(parsed));
        await sample("read", () => readCompletedGameRecord(parsed));
        await sample("replay", () => replayCompletedGame(record));
        await sample("final", () => finalPosition(record));
        await sample("middle", () => positionAt(record, Math.floor(record.events.length / 2)));
        await sample("turn0", () => positionAt(record, 0));
        await sample("turn10", () => positionAt(record, Math.min(10, record.events.length)));
        await sample("turn20", () => positionAt(record, Math.min(20, record.events.length)));
        await sample("turn40", () => positionAt(record, Math.min(40, record.events.length)));
        await sample("turn60", () => positionAt(record, Math.min(60, record.events.length)));
      }
      const positions = game.board.flat().filter(Boolean).length;
      const placements = game.logs.filter((log) => log.action === "place_equation");
      const currentBytes = bytes(encodeGame(game));
      const compactBytes = bytes(record);
      results.push({
        name,
        actions: game.logs.filter((log) => log.action !== "end_game").length,
        placements: placements.length,
        passes: game.logs.filter((log) => log.action === "pass").length,
        exchanges: game.logs.filter((log) => log.action === "exchange").length,
        tilesPlaced: placements.reduce(
          (sum, log) => sum + (log.actionDetail as { placedTiles: unknown[] }).placedTiles.length,
          0,
        ),
        maxTilesPlaced: Math.max(
          ...placements.map(
            (log) => (log.actionDetail as { placedTiles: unknown[] }).placedTiles.length,
          ),
        ),
        positions,
        bag: game.tilebag.length,
        finished: game.status === "finished",
        currentBytes,
        compactBytes,
        reductionBytes: currentBytes - compactBytes,
        reductionPct: Math.round((1 - compactBytes / currentBytes) * 1000) / 10,
        bytesPerAction: Math.round(
          compactBytes / game.logs.filter((log) => log.action !== "end_game").length,
        ),
        bytesPerPlacement: Math.round(compactBytes / placements.length),
        eventBytes: {
          p50: percentile(sizes, 0.5),
          p90: percentile(sizes, 0.9),
          p95: percentile(sizes, 0.95),
          p99: percentile(sizes, 0.99),
          max: Math.max(...sizes),
          largest: [...eventBytes].sort((a, b) => b.bytes - a.bytes).slice(0, 5),
        },
        checkpoint: {
          none: 0,
          final: checkpointBytes(record, record.events.length),
          every10: Array.from({ length: Math.floor(record.events.length / 10) }, (_, index) =>
            checkpointBytes(record, (index + 1) * 10),
          ).reduce((a, b) => a + b, 0),
        },
        timing: Object.fromEntries(
          Object.entries(timing).map(([key, values]) => [
            key,
            {
              median: percentile(values, 0.5),
              p95: percentile(values, 0.95),
            },
          ]),
        ),
      });
    }
    console.log(`COMPLETED_LEGAL_PROFILE=${JSON.stringify(results)}`);
  },
  30_000,
);
