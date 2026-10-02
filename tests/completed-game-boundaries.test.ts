import { describe, expect, it } from "vitest";
import {
  buildRankedCompletedGameRecord,
  buildStageCompletedGameRecord,
} from "../src/completedGame/adapters";
import {
  buildCompletedGameRecord,
  positionAtDisplayedTurn,
  readCompletedGameRecord,
} from "../src/completedGame/record";
import { projectCompletedGame } from "../src/completedGame/projection";
import { createSurvivalTestGame } from "../src/features/survival/seededGame";
import { stageStartCanonical } from "../src/features/survival/sealedStart";
import {
  calculateTotals,
  calculateGameTotals,
  makeSnapshot,
  pushActionSnapshot,
  updateLogNote,
  updateLogScore,
  type GameState,
} from "../src/game";
import { createSurrenderEndGameLog } from "../src/gameplay/endGame";
import { frozenLegalGame } from "./helpers/completedCorpus";
import { applyRankedAction, createRankedGame } from "../src/features/ranked/rules";

describe("completed-game source and disclosure boundaries", () => {
  it("accepts a finished Stage position only with its exact server seal", async () => {
    const game = createSurvivalTestGame(5093, "Stage player", "stage-private-user");
    game.gameId = "stage-completion";
    game.history = [makeSnapshot(game)];
    // Recreate the old total-from-zero defect, which the adapter must reject.
    const logs = [...game.logs, createSurrenderEndGameLog(game, "A")];
    const finished = pushActionSnapshot({
      ...game,
      logs,
      scores: calculateTotals(logs),
      status: "finished",
      timers: { ...game.timers, paused: true },
      matchControl: { surrenderedSide: "A" },
    });
    // calculateTotals has no opening-score input. The App now uses
    // calculateGameTotals, and the adapter still rejects malformed old output.
    expect(game.scores).toEqual({ A: 481, B: 500 });
    expect(finished.scores).toEqual({ A: 0, B: 0 });
    const corrected = pushActionSnapshot({
      ...game,
      logs,
      scores: calculateGameTotals(game, logs),
      status: "finished",
      timers: { ...game.timers, paused: true },
      matchControl: { surrenderedSide: "A" },
    });
    const source = {
      levelId: "level-5093",
      seed: 5093,
      sealedStart: stageStartCanonical(5093),
      bot: {
        catalogId: "authur_strong",
        catalogVersion: "1",
        executionType: "SERVER" as const,
        difficulty: "super",
        engineVersion: "authur-v1",
      },
    };
    await expect(buildStageCompletedGameRecord(finished, source)).rejects.toThrow(/score baseline/);
    const record = await buildStageCompletedGameRecord(corrected, source);
    const read = await readCompletedGameRecord(record);
    expect(record.provenance.mode).toBe("stage");
    expect(record.provenance.stage?.seed).toBe(5093);
    expect(read.provenance.stage).toEqual(record.provenance.stage);
    expect(read.game.board).toEqual(corrected.board);
    expect(read.game.rackA).toEqual(corrected.rackA);
    expect(read.game.rackB).toEqual(corrected.rackB);
    expect(read.game.scores).toEqual(corrected.scores);
    expect(read.game.logs).toEqual(corrected.logs);
    const reorderedSeal = {
      startingSide: source.sealedStart.startingSide,
      turnNumber: source.sealedStart.turnNumber,
      activeSide: source.sealedStart.activeSide,
      scores: { B: source.sealedStart.scores.B, A: source.sealedStart.scores.A },
      inventory: source.sealedStart.inventory,
    };
    expect(
      (
        await buildStageCompletedGameRecord(corrected, {
          ...source,
          sealedStart: reorderedSeal,
        })
      ).provenance.stage?.sealedStartDigest,
    ).toBe(record.provenance.stage?.sealedStartDigest);
    await expect(
      buildStageCompletedGameRecord(corrected, {
        ...source,
        sealedStart: { ...source.sealedStart, scores: { A: 999, B: 0 } },
      }),
    ).rejects.toThrow(/sealed start/);
  });

  it("uses captured private Ranked revisions and keeps rating outside the payload", async () => {
    const finished = frozenLegalGame("long", 40, true);
    const captured = finished.history.map((snapshot) => ({
      ...snapshot,
      history: [],
      historyIndex: 0,
      lastSavedAt: snapshot.createdAt,
    })) as GameState[];
    const record = await buildRankedCompletedGameRecord(captured);
    const read = await readCompletedGameRecord(record);
    expect(record.provenance.mode).toBe("ranked");
    expect(read.provenance.mode).toBe("ranked");
    expect(read.game.board).toEqual(finished.board);
    expect(read.game.rackA).toEqual(finished.rackA);
    expect(read.game.rackB).toEqual(finished.rackB);
    expect(read.game.tilebag).toEqual(finished.tilebag);
    expect(read.game.scores).toEqual(finished.scores);
    expect(read.game.logs).toEqual(finished.logs);
    expect(JSON.stringify(record)).not.toMatch(/ratingChange|rating_a_after|ranked_ratings/);
    await expect(buildRankedCompletedGameRecord([captured.at(-1)!])).rejects.toThrow(/zero-log/);
  });

  it("adapts the actual Ranked constructor, authoritative action and resignation path", async () => {
    const waiting = createRankedGame("ranked-player-a", "Ann", 10, 10, "A");
    const started: GameState = {
      ...waiting,
      playerUserIds: { A: "ranked-player-a", B: "ranked-player-b" },
      players: { A: "Ann", B: "Ben" },
      status: "playing",
      roomStage: "playing",
      timers: { ...waiting.timers, paused: false },
      currentTurnStartedAt: "2026-01-01T00:00:00.000Z",
    };
    const passed = applyRankedAction(started, "A", { kind: "pass" }, "2026-01-01T00:00:01.000Z");
    const finished = applyRankedAction(passed, "B", { kind: "resign" }, "2026-01-01T00:00:02.000Z");
    expect(started.history).toHaveLength(0);
    expect(passed.history).toHaveLength(0);
    const record = await buildRankedCompletedGameRecord([started, passed, finished]);
    const read = await readCompletedGameRecord(record);
    expect(read.game.board).toEqual(finished.board);
    expect(read.game.rackA).toEqual(finished.rackA);
    expect(read.game.rackB).toEqual(finished.rackB);
    expect(read.game.tilebag).toEqual(finished.tilebag);
    expect(read.game.timers).toEqual(finished.timers);
    expect(read.game.scores).toEqual(finished.scores);
    expect(read.game.logs).toEqual(finished.logs);
    expect(record.provenance.mode).toBe("ranked");
  });

  it("keeps Stage 5B as a bot pin distinct from Stage mode and drops live stop requests", async () => {
    const game = frozenLegalGame("long", 40, true);
    game.botSide = "B";
    game.botEngine = "authur";
    game.botDifficulty = "super";
    game.history[0]!.botSide = "B";
    game.history[0]!.botEngine = "authur";
    game.history[0]!.botDifficulty = "super";
    game.matchControl = {
      stoppedBy: "host",
      stopRequest: {
        id: "SECRET_STOP_REQUEST",
        requestedBy: "A",
        requestedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const record = await buildCompletedGameRecord(game, undefined, {
      mode: "bot",
      bot: {
        catalogId: "stage5b",
        catalogVersion: "1",
        executionType: "CLIENT",
        difficulty: "stage5b64",
        modelLevel: "stage5b64",
        runtimeVersion: "client-runtime-1",
        decisionSeed: 932,
      },
    });
    expect(record.provenance.mode).toBe("bot");
    expect(record.provenance.stage).toBeUndefined();
    expect(record.provenance.bot?.executionType).toBe("CLIENT");
    expect(JSON.stringify(record)).not.toContain("SECRET_STOP_REQUEST");
    expect(positionAtDisplayedTurn(record, 1).logs.length).toBe(1);
    expect(positionAtDisplayedTurn(record, game.logs.length).logs.length).toBe(game.logs.length);
  });

  it("preserves Hosted physical corrections and drops new user annotations", async () => {
    const base = frozenLegalGame("long", 20);
    const hosted: GameState = {
      ...base,
      emailPlayMode: "hosted",
      playerUserIds: { A: "hosted-a", B: "hosted-b" },
      history: base.history.map((snapshot) => ({
        ...snapshot,
        emailPlayMode: "hosted",
        playerUserIds: { A: "hosted-a", B: "hosted-b" },
      })),
    };
    const fromRack = hosted.rackA[0]!;
    const fromBag = hosted.tilebag[0]!;
    const logId = hosted.logs[0]!.id;
    const logs = updateLogNote(updateLogScore(hosted.logs, logId, 17), logId, "Host correction");
    logs[0]!.stars = 4;
    const corrected = pushActionSnapshot({
      ...hosted,
      rackA: [fromBag, ...hosted.rackA.slice(1)],
      tilebag: [fromRack, ...hosted.tilebag.slice(1)],
      scores: calculateTotals(logs),
      logs,
      activeSide: "B",
      turnNumber: hosted.turnNumber + 1,
      timers: { ...hosted.timers, A: 333 },
    });
    const record = await buildCompletedGameRecord(corrected);
    const read = await readCompletedGameRecord(record);
    expect(read.game.rackA).toEqual(corrected.rackA);
    expect(read.game.tilebag).toEqual(corrected.tilebag);
    expect(read.game.scores).toEqual(corrected.scores);
    expect(read.game.activeSide).toBe("B");
    expect(read.game.timers.A).toBe(333);
    const expectedLogs = corrected.logs.map((log) => {
      const clean = { ...log };
      delete clean.note;
      delete clean.stars;
      return clean;
    });
    expect(JSON.parse(JSON.stringify(read.game.logs))).toEqual(
      JSON.parse(JSON.stringify(expectedLogs)),
    );
    expect(JSON.stringify(record)).not.toContain("Host correction");
    expect(read.game.emailPlayMode).toBe("hosted");
    expect(record.events.at(-1)?.kind).toBe("edit");
  });

  it("excludes nested private facts from Public, Region and Ranked projections", async () => {
    const game = frozenLegalGame("long", 40, true);
    game.name = "SECRET_GAME_NAME";
    game.playerUserIds = { A: "SECRET_USER_A", B: "SECRET_USER_B" };
    game.playerEmails = { A: "SECRET_EMAIL_A", B: "SECRET_EMAIL_B" };
    game.botSide = "B";
    game.botEngine = "authur";
    game.history = game.history.map((snapshot) => ({
      ...snapshot,
      botSide: "B",
      botEngine: "authur",
    }));
    game.logs[0]!.note = "SECRET_PRIVATE_NOTE";
    game.logs[0]!.actionDetail = {
      ...game.logs[0]!.actionDetail,
      secret: "SECRET_NESTED",
    } as (typeof game.logs)[0]["actionDetail"];
    const hiddenRackId = game.rackA[0]!.id;
    const hiddenBagId = game.tilebag[0]!.id;
    const record = await buildCompletedGameRecord(game, undefined, {
      mode: "bot",
      bot: {
        catalogId: "SECRET_BOT_ID",
        catalogVersion: "public-version-1",
        runtimeVersion: "SECRET_BOT_RUNTIME",
        decisionSeed: 983471,
      },
    });
    for (const scope of ["public", "region"] as const) {
      const projection = await projectCompletedGame(
        record,
        {
          scope,
          ownerId: "owner",
          participantIds: [],
          regionId: "test-region",
          published: true,
        },
        { userId: "viewer", regionIds: ["test-region"], approved: true, admin: false },
      );
      const serialized = JSON.stringify(projection);
      for (const secret of [
        "SECRET_GAME_NAME",
        "SECRET_USER_A",
        "SECRET_USER_B",
        "SECRET_EMAIL_A",
        "SECRET_EMAIL_B",
        "SECRET_PRIVATE_NOTE",
        "SECRET_NESTED",
        "SECRET_BOT_ID",
        "SECRET_BOT_RUNTIME",
        hiddenRackId,
        hiddenBagId,
      ])
        expect(serialized).not.toContain(secret);
      expect(projection.finalBoard.length).toBe(game.board.flat().filter(Boolean).length);
      expect(projection.turns.length).toBe(game.logs.length);
    }
  });
});
