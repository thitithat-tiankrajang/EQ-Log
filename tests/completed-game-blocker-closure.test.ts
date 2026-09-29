import { describe, expect, it } from "vitest";
import {
  advanceToOpponentTurn,
  calculateGameTotals,
  createNewGame,
  displayToken,
  makeSnapshot,
  pushActionSnapshot,
  type GameState,
  type TurnLog,
} from "../src/game";
import { createSurrenderEndGameLog } from "../src/gameplay/endGame";
import { createSurvivalTestGame } from "../src/features/survival/seededGame";
import { stageStartCanonical } from "../src/features/survival/repository";
import {
  buildCapturedRankedCompletedGameRecord,
  buildStageCompletedGameRecord,
} from "../src/completedGame/adapters";
import {
  buildCompletedGameRecord,
  finalPosition,
  positionAt,
  readCompletedGame,
  readCompletedGameRecord,
  validateCompletedGameRecord,
} from "../src/completedGame/record";
import {
  authorizeCompletedReplay,
  projectCompletedGame,
  type CompletedReplayAccess,
} from "../src/completedGame/projection";
import { frozenLegalGame } from "./helpers/completedCorpus";
import { historicRulesFor } from "../src/completedGame/historicRules";
import { serializeGame } from "../src/codec";

const viewer = { userId: "viewer", regionIds: ["region-1"], approved: true, admin: false };
const access: CompletedReplayAccess = {
  scope: "public",
  ownerId: "owner",
  participantIds: ["player-a", "player-b"],
  published: true,
};

function pass(game: GameState, id: string): GameState {
  const log: TurnLog = {
    id,
    turnNumber: game.turnNumber,
    side: game.activeSide,
    action: "pass",
    startedAt: game.currentTurnStartedAt,
    endedAt: "2026-01-01T00:00:01.000Z",
    timerBefore: { A: game.timers.A, B: game.timers.B },
    timerAfter: { A: game.timers.A, B: game.timers.B },
    rackBefore: game.activeSide === "A" ? game.rackA : game.rackB,
    rackAfter: game.activeSide === "A" ? game.rackA : game.rackB,
    boardBefore: game.board,
    boardAfter: game.board,
    tilebagBefore: game.tilebag,
    tilebagAfter: game.tilebag,
    actionDetail: {},
    calculatedScore: 0,
    finalScore: 0,
  };
  const logs = [...game.logs, log];
  return pushActionSnapshot(
    advanceToOpponentTurn({ ...game, logs, scores: calculateGameTotals(game, logs) }),
  );
}

describe("completed-game blocker closure", () => {
  it("preserves a real Stage seeded baseline through turns, surrender and projection", async () => {
    let stage = createSurvivalTestGame(5093, "Player", "owner");
    stage.gameId = "stage-score-regression";
    stage.history = [makeSnapshot(stage)];
    stage = pass(stage, "stage-pass-a");
    stage = pass(stage, "stage-pass-b");
    const logs = [...stage.logs, createSurrenderEndGameLog(stage, "A")];
    stage = pushActionSnapshot({
      ...stage,
      logs,
      scores: calculateGameTotals(stage, logs),
      status: "finished",
      timers: { ...stage.timers, paused: true },
    });
    expect(stage.scores).toEqual({ A: 481, B: 500 });
    const record = await buildStageCompletedGameRecord(stage, {
      levelId: "stage-level",
      seed: 5093,
      sealedStart: stageStartCanonical(5093),
      bot: { catalogId: "authur", catalogVersion: "1", difficulty: "super" },
    });
    await validateCompletedGameRecord(record);
    expect((await readCompletedGameRecord(record)).game.scores).toEqual(stage.scores);
    const projection = await projectCompletedGame(record, { ...access, scope: "stage" }, viewer);
    expect(projection.finalScores).toEqual(stage.scores);
    expect(projection.stage).toEqual({ levelId: "stage-level" });
    expect(JSON.stringify(projection)).not.toContain(record.provenance.stage!.sealedStartDigest);
  });

  it("adds both sides' legal earned scores to an opening baseline", () => {
    const legal = frozenLegalGame("long", 40);
    const opening = legal.history[0]!;
    const seeded = {
      ...legal,
      history: [{ ...opening, scores: { A: 481, B: 500 } }, ...legal.history.slice(1)],
    };
    expect(calculateGameTotals(seeded, legal.logs)).toEqual({
      A: 481 + legal.scores.A,
      B: 500 + legal.scores.B,
    });
    const ordinary = createNewGame({
      name: "ordinary",
      playerA: "A",
      playerB: "B",
      startingSide: "A",
      tileDrawMode: "play",
    });
    expect(calculateGameTotals(ordinary, [])).toEqual({ A: 0, B: 0 });
  });

  it("requires contiguous, same-match private Ranked revisions", async () => {
    const game = frozenLegalGame("long", 20, true);
    const rows = game.history.map((state, index) => ({
      match_id: "ranked-match",
      revision: 7 + index,
      state: { ...state, history: [], historyIndex: 0 } as GameState,
    }));
    const record = await buildCapturedRankedCompletedGameRecord(rows);
    expect(record.provenance.completionAuthority).toBe("server-reduced");
    expect((await readCompletedGameRecord(record)).game.logs).toEqual(game.logs);
    await expect(
      buildCapturedRankedCompletedGameRecord(rows.filter((_, index) => index !== 3)),
    ).rejects.toThrow(/missing/);
    await expect(
      buildCapturedRankedCompletedGameRecord([
        rows[0]!,
        { ...rows[1]!, match_id: "other-match" },
        ...rows.slice(2),
      ]),
    ).rejects.toThrow(/cross-match/);
  });

  it("authorizes before disclosure for every current replay scope", () => {
    expect(
      authorizeCompletedReplay(access, {
        userId: null,
        regionIds: [],
        approved: false,
        admin: false,
      }),
    ).toBe(false);
    expect(authorizeCompletedReplay(access, { ...viewer, approved: false })).toBe(false);
    expect(authorizeCompletedReplay(access, viewer)).toBe(true);
    expect(
      authorizeCompletedReplay({ ...access, scope: "region", regionId: "region-1" }, viewer),
    ).toBe(true);
    expect(
      authorizeCompletedReplay({ ...access, scope: "region", regionId: "region-2" }, viewer),
    ).toBe(false);
    expect(
      authorizeCompletedReplay(
        { ...access, scope: "region", regionId: "region-2" },
        { ...viewer, approved: false, admin: true },
      ),
    ).toBe(true);
    expect(authorizeCompletedReplay({ ...access, scope: "private" }, viewer)).toBe(false);
    expect(
      authorizeCompletedReplay(
        { ...access, scope: "private" },
        { userId: "owner", regionIds: [], approved: false, admin: false },
      ),
    ).toBe(true);
    expect(authorizeCompletedReplay({ ...access, scope: "ranked", published: false }, viewer)).toBe(
      false,
    );
    expect(
      authorizeCompletedReplay(
        { ...access, scope: "ranked", published: false },
        { userId: "player-a", regionIds: [], approved: false, admin: false },
      ),
    ).toBe(true);
    expect(authorizeCompletedReplay({ ...access, scope: "stage" }, viewer)).toBe(true);
    expect(
      authorizeCompletedReplay({ ...access, scope: "stage" }, { ...viewer, approved: false }),
    ).toBe(false);
    expect(authorizeCompletedReplay({ ...access, scope: "stage", published: false }, viewer)).toBe(
      false,
    );
  });

  it("reveals sorted final faces and exact clocks, never physical identities or draw order", async () => {
    const game = frozenLegalGame("long", 40, true);
    game.logs[0]!.note = "SECRET_NOTE";
    const record = await buildCompletedGameRecord(game);
    const projection = await projectCompletedGame(record, access, viewer);
    expect(projection.finalRacks.A).toEqual(game.rackA.map(displayToken).sort());
    expect(projection.finalRacks.B).toEqual(game.rackB.map(displayToken).sort());
    expect(projection.clocks.final).toEqual({ A: game.timers.A, B: game.timers.B });
    expect(projection.turns.map((turn) => turn.clockAfter)).toEqual(
      game.logs.map((log) => log.timerAfter),
    );
    expect(finalPosition(record).timers).toEqual(game.timers);
    expect(positionAt(record, 10).timers).toEqual(game.history[10]!.timers);
    const serialized = JSON.stringify(projection);
    for (const secret of [
      record.digest,
      "SECRET_NOTE",
      game.rackA[0]?.id,
      game.rackB[0]?.id,
      game.tilebag[0]?.id,
    ].filter(Boolean)) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toMatch(
      /tilebag|drawOrder|decisionSeed|sealedStartDigest|runtimeVersion/,
    );
    const privateReordering = pushActionSnapshot({
      ...game,
      rackA: [...game.rackA].reverse(),
      rackB: [...game.rackB].reverse(),
      tilebag: [...game.tilebag].reverse(),
    });
    const reorderedRecord = await buildCompletedGameRecord(privateReordering);
    expect(reorderedRecord.digest).not.toBe(record.digest);
    expect(JSON.stringify(await projectCompletedGame(reorderedRecord, access, viewer))).toBe(
      serialized,
    );
    await expect(
      projectCompletedGame(record, { ...access, scope: "private" }, viewer),
    ).rejects.toThrow(/access denied/);
  });

  it("dispatches historic interpretation and refuses future rules or manifest drift", async () => {
    const game = frozenLegalGame("long", 20, true);
    const record = await buildCompletedGameRecord(game);
    const known = historicRulesFor(record.rules);
    expect(known.mayUseActiveValidator).toBe(true);
    expect(known.observedScore(game.logs[0]!)).toBe(game.logs[0]!.finalScore);
    expect(historicRulesFor(record.rules, "future-scoring-v2").mayUseActiveValidator).toBe(false);
    expect(() => historicRulesFor("future-scoring-v2")).toThrow(/Unknown rules version/);
    const changedRules = { ...record, rules: "future-scoring-v2" };
    await expect(validateCompletedGameRecord(changedRules)).rejects.toThrow(
      /Unknown rules version/,
    );
    const changedManifest = { ...record, tileManifestDigest: "different-tile-manifest" };
    await expect(validateCompletedGameRecord(changedManifest)).rejects.toThrow(/tile manifest/);
  });

  it("keeps old annotation data readable but emits none in new v1", async () => {
    const game = frozenLegalGame("long", 20, true);
    game.logs[0]!.note = "historic private annotation";
    game.logs[0]!.stars = 5;
    const old = await readCompletedGame(serializeGame(game));
    expect(old.kind).toBe("legacy");
    expect(old.game.logs[0]!.note).toBe("historic private annotation");
    const current = await buildCompletedGameRecord(game);
    expect(JSON.stringify(current)).not.toContain("historic private annotation");
    expect((await readCompletedGameRecord(current)).game.logs[0]!.stars).toBeUndefined();
  });
});
