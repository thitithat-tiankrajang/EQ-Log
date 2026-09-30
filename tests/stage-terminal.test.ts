import { describe, expect, it } from "vitest";
import { encodeGame } from "../src/codec";
import { boardWithPending, pushActionSnapshot } from "../src/game";
import { createAutomaticEndGameLog, createSurrenderEndGameLog } from "../src/gameplay/endGame";
import { buildStageCompletedGameRecord } from "../src/completedGame/adapters";
import { projectCompletedGame } from "../src/completedGame/projection";
import { readCompletedGameRecord } from "../src/completedGame/record";
import { prepareStageTerminal } from "../src/completedGame/stageTerminal";
import { stageStartCanonical } from "../src/features/survival/repository";
import { createSurvivalTestGame } from "../src/features/survival/seededGame";

const owner = "00000000-0000-4000-8000-000000000971";
const levelId = "00000000-0000-4000-8000-000000000972";

function fixture() {
  const prior = createSurvivalTestGame(17, "Player", owner);
  prior.revision = 1;
  const final = pushActionSnapshot({
    ...prior,
    revision: 2,
    status: "finished" as const,
    timers: { ...prior.timers, paused: true },
  });
  const source = {
    roomId: prior.gameId,
    ownerId: owner,
    levelId,
    seed: 17,
    revision: 1,
    liveState: encodeGame(prior),
    sealedStart: stageStartCanonical(17),
    botKey: "authur_strong",
    botConfigVersion: 1,
    botDifficulty: "super",
  };
  return { prior, final, source };
}

describe("Stage terminal capture adapter", () => {
  it("preserves the nonzero sealed score, replays Compact and limits disclosure", async () => {
    const { prior, final, source } = fixture();
    expect(prior.scores.A + prior.scores.B).toBeGreaterThan(0);
    const prepared = await prepareStageTerminal(source, encodeGame(final));
    expect(prepared.completion).toMatchObject({ kind: "terminated", reason: "manual" });
    expect(prepared.outcome).toBe("loss");
    expect(prepared.record.provenance).toMatchObject({
      completionAuthority: "client-reported",
      stage: { levelId },
      bot: { catalogId: "authur_strong", catalogVersion: "1" },
    });
    const reconstructed = await readCompletedGameRecord(prepared.record);
    expect(reconstructed.game.scores).toEqual(final.scores);
    expect(reconstructed.game.board).toEqual(final.board);
    expect(reconstructed.game.rackA).toEqual(final.rackA);
    expect(reconstructed.game.rackB).toEqual(final.rackB);
    const access = {
      scope: "stage" as const,
      ownerId: owner,
      participantIds: [],
      published: false,
    };
    const viewer = { userId: owner, regionIds: [], approved: false, admin: false };
    const projected = await projectCompletedGame(prepared.record, access, viewer);
    expect(projected.finalScores).toEqual(final.scores);
    const json = JSON.stringify(projected);
    expect(json).not.toContain("tilebag");
    expect(json).not.toContain("physical");
    expect(json).not.toContain("sealedStartDigest");
    expect(json).not.toContain(final.rackA[0]!.id);
    await expect(
      projectCompletedGame(prepared.record, access, { ...viewer, userId: "other" }),
    ).rejects.toThrow("Replay access denied");
  });

  it("rejects an unfinished state and a rewritten committed prefix", async () => {
    const { prior, final, source } = fixture();
    await expect(prepareStageTerminal(source, encodeGame(prior))).rejects.toThrow(
      "terminal state or revision",
    );
    const forged = {
      ...final,
      history: [{ ...final.history[0]!, scores: { A: 9999, B: 0 } }, ...final.history.slice(1)],
    };
    await expect(prepareStageTerminal(source, encodeGame(forged))).rejects.toThrow(
      "rewrote committed play",
    );
  });

  it("rejects a terminal score change without an action", async () => {
    const { final, source } = fixture();
    const forged = { ...final, scores: { A: final.scores.A + 1, B: final.scores.B } };
    await expect(prepareStageTerminal(source, encodeGame(forged))).rejects.toThrow(
      "changed position without an action",
    );
  });

  it("rejects an unsealed opening even when the final game is well formed", async () => {
    const { final, source } = fixture();
    await expect(
      buildStageCompletedGameRecord(final, {
        levelId,
        seed: 17,
        sealedStart: { ...source.sealedStart, turnNumber: source.sealedStart.turnNumber + 1 },
        bot: { catalogId: "authur_strong", catalogVersion: "1" },
      }),
    ).rejects.toThrow("differs from the server-sealed start");
  });

  it("rejects a fabricated rack-out and score from a non-equation placement", async () => {
    const { prior, source } = fixture();
    const cells: { row: number; col: number }[] = [];
    for (let row = 0; row < prior.board.length && cells.length < prior.rackA.length; row++)
      for (let col = 0; col < prior.board[row]!.length && cells.length < prior.rackA.length; col++)
        if (!prior.board[row]![col]) cells.push({ row, col });
    const placements = prior.rackA.map((tile, index) => ({ tile, ...cells[index]! }));
    const boardAfter = boardWithPending(prior.board, placements, prior.turnNumber, "A");
    const base = createSurrenderEndGameLog(prior, "A");
    const normal = {
      ...base,
      action: "place_equation" as const,
      actionDetail: {
        placedTiles: placements.map((item) => ({
          tileId: item.tile.id,
          token: item.tile.token,
          displayToken: item.tile.token,
          row: item.row,
          col: item.col,
        })),
        equationsDetected: [],
        isMoveValid: true,
        errors: [],
      },
      boardAfter,
      rackAfter: [],
      calculatedScore: 100,
      finalScore: 100,
    };
    const end = createAutomaticEndGameLog({
      boardAfter,
      game: prior,
      logs: [normal],
      normalLog: normal,
      rackAfter: [],
      tilebagAfter: prior.tilebag,
    });
    expect(end?.actionDetail).toMatchObject({ reason: "rack_out" });
    const final = pushActionSnapshot({
      ...prior,
      board: boardAfter,
      rackA: [],
      logs: [normal, end!],
      scores: { A: prior.scores.A + 100 + end!.finalScore, B: prior.scores.B },
      status: "finished" as const,
      revision: 2,
      timers: { ...prior.timers, paused: true },
    });
    await expect(prepareStageTerminal(source, encodeGame(final))).rejects.toThrow(
      "placement or score is not rules-derived",
    );
  });
});
