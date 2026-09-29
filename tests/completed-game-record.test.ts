import { describe, expect, it } from "vitest";
import { encodeGame, LEGACY_TOKEN_TABLE, serializeGame } from "../src/codec";
import {
  createNewGame,
  pushActionSnapshot,
  updateLogNote,
  updateLogScore,
  type GameSnapshot,
} from "../src/game";
import { inventoryFrom } from "../src/domain/projection";
import {
  buildCompletedGameRecord,
  digestCompletedGameRecord,
  finalPosition,
  positionAt,
  readCompletedGame,
  readCompletedGameRecord,
  replayCompletedGame,
  validateCompletedGameRecord,
  validateCanonicalCompletedGameRecord,
} from "../src/completedGame/record";
import { COMPLETED_RULES_VERSION, historicRulesFor } from "../src/completedGame/historicRules";
import { createSurvivalTestGame } from "../src/features/survival/seededGame";
import { legalEquationGame, legalPassGame } from "./helpers/completedCorpus";
import { EMPTY_MULTIVERSE, positionOf, type Multiverse } from "../src/gameplay/multiverse";

function semantic(snapshot: GameSnapshot) {
  const normalized = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
  for (const log of normalized.logs as Record<string, unknown>[]) {
    delete log.note;
    delete log.stars;
  }
  for (const key of [
    "commitId",
    "revision",
    "timelineRef",
    "lobbyReadyBySide",
    "lobbyLaunchAt",
    "history",
    "historyIndex",
    "lastSavedAt",
  ]) {
    delete normalized[key];
  }
  return normalized;
}

describe("completed-game record v1", () => {
  it("serializes deterministically and preserves an exact legal equation", async () => {
    const game = legalEquationGame();
    const first = await buildCompletedGameRecord(game);
    const second = await buildCompletedGameRecord(game);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.digest).toBe(await digestCompletedGameRecord(first));
    const restored = await readCompletedGameRecord(JSON.parse(JSON.stringify(first)));
    const storedString = await readCompletedGame(JSON.stringify(first));
    expect(storedString.kind).toBe("compact");
    expect(semantic(storedString.game)).toEqual(semantic(game));
    await expect(readCompletedGame(JSON.stringify({ ...first, format: 99 }))).rejects.toThrow(
      /Unknown completed-game format/,
    );
    expect(semantic(restored.game)).toEqual(semantic(game));
    expect(restored.game.history.map(semantic)).toEqual(game.history.map(semantic));
    expect(restored.game.logs[0]!.calculatedScore).toBeGreaterThan(0);
    expect(() => inventoryFrom(restored.game)).not.toThrow();
    expect(semantic(positionAt(first, 0))).toEqual(semantic(game.history[0]!));
    expect(semantic(finalPosition(first))).toEqual(semantic(game));
  });

  it("builds byte-identical legal turn-count fixtures independently", async () => {
    expect(JSON.stringify(await buildCompletedGameRecord(legalPassGame(40)))).toBe(
      JSON.stringify(await buildCompletedGameRecord(legalPassGame(40))),
    );
  });

  it("keeps an undo boundary even when its visible position is identical", async () => {
    const game = pushActionSnapshot(legalPassGame(0));
    const record = await buildCompletedGameRecord(game);
    expect(record.events).toHaveLength(1);
    expect((await readCompletedGameRecord(record)).game.history).toHaveLength(2);
  });

  it("replays every event and retains ordered rack/bag, clocks, side and score", async () => {
    const game = legalPassGame(20);
    const record = await buildCompletedGameRecord(game);
    const replay = replayCompletedGame(record);
    expect(replay).toHaveLength(21);
    expect(new Set(replay.map((snapshot) => snapshot.commitId)).size).toBe(21);
    expect(positionAt(record, 10).commitId).toBe(replay[10]!.commitId);
    expect(replay.map(semantic)).toEqual(game.history.map(semantic));
    expect(record.events.map((event) => event.sequence)).toEqual(
      Array.from({ length: 20 }, (_, index) => index + 1),
    );
    expect(JSON.stringify(record).length).toBeLessThan(JSON.stringify(encodeGame(game)).length);
  });

  it("preserves bot pins, Stage start, Hosted identity and manual score without new annotations", async () => {
    const stage = createSurvivalTestGame(5093, "Tester");
    stage.gameId = "stage-seed-5093";
    stage.superEngineVersion = "engine-4";
    stage.superWeightsVersion = "weights-2";
    stage.history = [
      {
        ...stage.history[0]!,
        gameId: stage.gameId,
        superEngineVersion: stage.superEngineVersion,
        superWeightsVersion: stage.superWeightsVersion,
      },
    ];
    const record = await buildCompletedGameRecord(stage, undefined, {
      mode: "stage",
      stage: { levelId: "draft-stage-5093", seed: 5093, sealedStartDigest: "sealed-example" },
      bot: { catalogId: "authur", catalogVersion: "catalog-1", engineVersion: "engine-4" },
    });
    const restored = (await readCompletedGameRecord(record)).game;
    expect(semantic(restored)).toEqual(semantic(stage));
    expect(record.provenance.stage?.seed).toBe(5093);
    expect(record.provenance.bot?.engineVersion).toBe("engine-4");
    expect(restored.board[7][7]?.tile.id).toBe(stage.board[7][7]?.tile.id);

    const hosted = legalEquationGame();
    hosted.emailPlayMode = "hosted";
    hosted.playerUserIds = { A: "owner", B: "guest" };
    hosted.logs = updateLogNote(
      updateLogScore(hosted.logs, hosted.logs[0]!.id, 42),
      hosted.logs[0]!.id,
      "Check this",
    );
    hosted.logs[0]!.stars = 4;
    hosted.scores.A = 42;
    const hostedRecord = await buildCompletedGameRecord(hosted);
    expect(semantic((await readCompletedGameRecord(hostedRecord)).game)).toEqual(semantic(hosted));
    expect(JSON.stringify(hostedRecord)).not.toContain("Check this");
    expect((await readCompletedGameRecord(hostedRecord)).game.logs[0]?.note).toBeUndefined();
    expect((await readCompletedGameRecord(hostedRecord)).game.logs[0]?.stars).toBeUndefined();
    expect(hostedRecord.events.at(-1)?.kind).toBe("edit");
  });

  it("requires a bot catalog pin rather than silently using a future engine", async () => {
    const game = legalPassGame(0);
    game.botSide = "B";
    game.botEngine = "authur";
    game.history[0]!.botSide = "B";
    game.history[0]!.botEngine = "authur";
    await expect(buildCompletedGameRecord(game)).rejects.toThrow(/Bot catalog/);
    const record = await buildCompletedGameRecord(game, undefined, {
      mode: "bot",
      bot: { catalogId: "authur", catalogVersion: "catalog-1" },
    });
    expect(record.provenance.bot?.catalogVersion).toBe("catalog-1");
  });

  it("records Host rack, score, side and clock corrections as explicit deltas", async () => {
    let game = createNewGame({
      name: "Host",
      playerA: "A",
      playerB: "B",
      startingSide: "A",
      tileDrawMode: "manual",
    });
    const tile = game.tilebag[0]!;
    game = pushActionSnapshot({
      ...game,
      rackA: [tile],
      tilebag: game.tilebag.slice(1),
      scores: { A: 17, B: 2 },
      activeSide: "B",
      turnNumber: 3,
      timers: { ...game.timers, A: 123 },
      faceDownCount: { B: 0 },
    });
    const record = await buildCompletedGameRecord(game);
    expect(record.events[0]!.kind).toBe("edit");
    const read = (await readCompletedGameRecord(record)).game;
    expect(semantic(read)).toEqual(semantic(game));
    expect(() => inventoryFrom(read)).not.toThrow();
  });

  it("rejects unknown format, corrupted ordering and corrupted physical outcomes", async () => {
    const record = await buildCompletedGameRecord(legalPassGame(2));
    await expect(validateCompletedGameRecord({ ...record, format: 99 })).rejects.toThrow(/Unknown/);
    const badOrder = structuredClone(record);
    badOrder.events[1]!.sequence = 7;
    badOrder.digest = await digestCompletedGameRecord(badOrder);
    await expect(validateCompletedGameRecord(badOrder)).rejects.toThrow(/order/);
    const badTile = structuredClone(record);
    badTile.genesis.physical.bag[0] = badTile.genesis.physical.rackA[0]!;
    badTile.digest = await digestCompletedGameRecord(badTile);
    await expect(validateCompletedGameRecord(badTile)).rejects.toThrow();
    const badScore = structuredClone(record);
    badScore.events[0]!.append![0]!.core.finalScore = Number.NaN;
    badScore.digest = await digestCompletedGameRecord(badScore);
    await expect(validateCompletedGameRecord(badScore)).rejects.toThrow(/Malformed completed turn/);
    const wrongManifest = structuredClone(record);
    wrongManifest.tileManifestDigest = "0".repeat(64);
    wrongManifest.digest = await digestCompletedGameRecord(wrongManifest);
    await expect(validateCompletedGameRecord(wrongManifest)).rejects.toThrow(/manifest/);
    const wrongRules = structuredClone(record);
    wrongRules.rules = "future-incompatible-rules";
    wrongRules.digest = await digestCompletedGameRecord(wrongRules);
    await expect(validateCompletedGameRecord(wrongRules)).rejects.toThrow(/Unknown rules version/);
    const futureEvent = structuredClone(record) as typeof record & {
      events: Array<{ unrecognizedOutcome?: string }>;
    };
    futureEvent.events[0]!.unrecognizedOutcome = "would otherwise be silently ignored";
    futureEvent.digest = await digestCompletedGameRecord(futureEvent);
    await expect(validateCompletedGameRecord(futureEvent)).rejects.toThrow(
      /Unknown completed event field/,
    );
    const misleadingBot = structuredClone(record);
    misleadingBot.provenance.bot = { catalogId: "authur", catalogVersion: "1" };
    misleadingBot.digest = await digestCompletedGameRecord(misleadingBot);
    await expect(validateCompletedGameRecord(misleadingBot)).rejects.toThrow(/inconsistent mode/);
  });

  it("requires an explicit completion authority and a genuine finished transition for canonical writes", async () => {
    const complete = await buildCompletedGameRecord({
      ...legalPassGame(2),
      status: "finished",
    });
    await expect(validateCanonicalCompletedGameRecord(complete)).resolves.toBe(complete);
    const unfinished = await buildCompletedGameRecord(legalPassGame(2));
    await expect(validateCanonicalCompletedGameRecord(unfinished)).rejects.toThrow(
      /finished transition/,
    );
    const missingAuthority = structuredClone(complete);
    delete missingAuthority.provenance.completionAuthority;
    missingAuthority.digest = await digestCompletedGameRecord(missingAuthority);
    await expect(validateCompletedGameRecord(missingAuthority)).rejects.toThrow(
      /completion authority/,
    );
    const invalidDelta = structuredClone(complete);
    invalidDelta.events[0]!.position = { rackA: [999, 1, []] };
    invalidDelta.digest = await digestCompletedGameRecord(invalidDelta);
    await expect(validateCompletedGameRecord(invalidDelta)).rejects.toThrow(/tile sequence change/);
    const wrongTerminal = structuredClone(complete);
    wrongTerminal.events.at(-1)!.meta = [["status", "playing"]];
    wrongTerminal.digest = await digestCompletedGameRecord(wrongTerminal);
    await expect(validateCanonicalCompletedGameRecord(wrongTerminal)).rejects.toThrow();
    await expect(readCompletedGame('{"format":1')).rejects.toThrow(
      /Unreadable stored game payload/,
    );
  });

  it("pins v1 to its named historic interpreter and disables a future active validator", () => {
    expect(COMPLETED_RULES_VERSION).toBe("eq-lab-840ef0e");
    expect(historicRulesFor(COMPLETED_RULES_VERSION).version).toBe(COMPLETED_RULES_VERSION);
    expect(historicRulesFor(COMPLETED_RULES_VERSION, "future-rules").mayUseActiveValidator).toBe(
      false,
    );
    expect(() => historicRulesFor("future-rules")).toThrow(/Unknown rules version/);
  });

  it("reads legacy c1 games, and flags missing genesis instead of fabricating history", async () => {
    const game = legalEquationGame();
    const read = await readCompletedGame(serializeGame(game));
    expect(semantic(read.game)).toEqual(semantic(game));
    expect(read.kind).toBe("compact");
    const plain = await readCompletedGame(JSON.stringify(encodeGame(game)));
    expect(plain.kind).toBe("compact");
    expect(semantic(plain.game)).toEqual(semantic(game));
    const withoutHistory = { ...game, history: [], historyIndex: 0 };
    const legacyBranches: Multiverse = {
      version: 1,
      lines: [
        {
          id: "legacy-fork",
          from: game.logs[0]!.id,
          logs: [{ ...game.logs[0]!, id: "legacy-alternative" }],
          after: [null],
          tip: positionOf(game),
          parkedAt: "2026-01-01T00:00:02.000Z",
        },
      ],
    };
    const fallback = await readCompletedGame(serializeGame(withoutHistory), legacyBranches);
    expect(fallback.kind).toBe("legacy");
    expect(fallback.fullyBranchable).toBe(false);
    expect(fallback.branches).toEqual(legacyBranches);
    expect(semantic(fallback.game)).toEqual(semantic(withoutHistory));
  });

  it("adapts face-only v1/v2 archives without claiming absent replay facts", async () => {
    const game = legalPassGame(0);
    const encoded = encodeGame(game);
    const face = (tiles: typeof game.tilebag) =>
      tiles.map((tile) => LEGACY_TOKEN_TABLE.indexOf(tile.token));
    for (const version of [1, 2]) {
      const payload = {
        ...encoded,
        v: version,
        tilebag: face(game.tilebag),
        rackA: face(game.rackA),
        rackB: face(game.rackB),
        history: [],
        historyLogs: [],
        logs: [],
        historyIndex: 0,
      };
      const read = await readCompletedGame(`c1:${JSON.stringify(payload)}`);
      expect(read.kind).toBe("legacy");
      expect(read.fullyBranchable).toBe(false);
      expect(() => inventoryFrom(read.game)).not.toThrow();
    }
    await expect(readCompletedGame('c1:{"v":99}')).rejects.toThrow(/Unknown/);
  });

  it("keeps branch suffix and null continuation facts without copying the trunk", async () => {
    const game = legalEquationGame();
    const log = game.logs[0]!;
    const multiverse: Multiverse = {
      ...EMPTY_MULTIVERSE,
      version: 1,
      lines: [
        {
          id: "fork-1",
          from: log.id,
          logs: [{ ...log, id: "alternative-one" }],
          after: [null],
          tip: {
            board: game.board,
            rackA: game.rackA,
            rackB: game.rackB,
            tilebag: game.tilebag,
            pendingExchangeReturnBySide: { A: [], B: [] },
            timers: { A: game.timers.A, B: game.timers.B },
            scores: game.scores,
            turnNumber: game.turnNumber,
            activeSide: game.activeSide,
            phase: game.phase,
            status: game.status,
          },
          parkedAt: "2026-01-01T00:00:02.000Z",
        },
        {
          id: "fork-2",
          from: log.id,
          logs: [{ ...log, id: "alternative-turn", note: "Branch note", stars: 5 }],
          after: [positionOf(game)],
          tip: positionOf(game),
          parkedAt: "2026-01-01T00:00:03.000Z",
        },
        {
          id: "nested-fork",
          from: "alternative-turn",
          logs: [{ ...log, id: "nested-turn", note: "Nested branch note" }],
          after: [positionOf(game)],
          tip: positionOf(game),
          parkedAt: "2026-01-01T00:00:04.000Z",
        },
      ],
    };
    const record = await buildCompletedGameRecord(game, multiverse);
    const read = await readCompletedGameRecord(record);
    const expected = structuredClone(multiverse);
    for (const line of expected.lines)
      for (const branchLog of line.logs) {
        delete branchLog.note;
        delete branchLog.stars;
      }
    expect(read.branches).toEqual(expected);
    expect(read.branches!.lines[0]!.after[0]).toBeNull();
    expect(read.branches!.lines[1]!.logs[0]!.note).toBeUndefined();
    expect(read.branches!.lines[2]!.from).toBe("alternative-turn");
    expect(read.branches!.lines[2]!.tip).toEqual(positionOf(game));
    const duplicated = structuredClone(record);
    duplicated.branches!.lines[2]!.logs[0]!.id = "alternative-turn";
    duplicated.digest = await digestCompletedGameRecord(duplicated);
    await expect(validateCompletedGameRecord(duplicated)).rejects.toThrow(/branch tree/i);
  });
});
