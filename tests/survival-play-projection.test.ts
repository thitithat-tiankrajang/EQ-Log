import { describe, expect, it } from "vitest";
import {
  AMATH_TOKENS,
  calculateTotals,
  type AmathToken,
  type EndGameDetail,
  type ExchangeDetail,
  type GameState,
  type PlaceEquationDetail,
  type TurnLog,
} from "../src/game";
import { summaryText, shortMove } from "../src/components/logs/turnSummary";
import type { SurvivalView } from "../src/features/survivalPlay/api";
import {
  survivalGameFromView,
  survivalMoveFromLog,
  survivalTilebagView,
  unseenPool,
} from "../src/features/survivalPlay/projection";
import {
  parseSurvivalRoomId,
  survivalAttemptRoomId,
  survivalLevelRoomId,
} from "../src/features/survivalPlay/route";
import takeover from "./fixtures/survival-play/takeover.json";
import afterExchange from "./fixtures/survival-play/after-exchange.json";
import finished from "./fixtures/survival-play/finished.json";
import finishedStreak from "./fixtures/survival-play/finished-streak.json";

// Real player views, captured from the playtest server: exactly what a browser receives.
const views = {
  takeover: takeover as SurvivalView,
  afterExchange: afterExchange as SurvivalView,
  finished: finished as SurvivalView,
  // Ended on six scoreless turns with the bag empty and Authur holding two tiles.
  finishedStreak: finishedStreak as SurvivalView,
};

const kinds = (tiles: { token: AmathToken }[]) => tiles.map((tile) => tile.token);
const boardKinds = (game: GameState) =>
  game.board.flatMap((row) => row.flatMap((cell) => (cell ? [cell.tile.token] : [])));
const countOf = (list: AmathToken[]) => {
  const counts = new Map<AmathToken, number>();
  for (const kind of list) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return counts;
};
const FULL_SET = new Map(
  (Object.keys(AMATH_TOKENS) as AmathToken[]).map((kind) => [kind, AMATH_TOKENS[kind].count]),
);

describe("Survival view → Play-page game", () => {
  it.each(Object.entries(views))("%s: accounts for all 100 tiles, by kind", (_, view) => {
    const { game } = survivalGameFromView(view, { now: "2026-09-25T00:00:00.000Z" });
    const all = [
      ...boardKinds(game),
      ...kinds(game.rackA),
      ...kinds(game.rackB),
      ...kinds(game.tilebag),
    ];
    expect(all).toHaveLength(100);
    expect(countOf(all)).toEqual(FULL_SET);
  });

  it.each(Object.entries(views))("%s: shows exactly what the view says", (_, view) => {
    const { game, humanSide, authurSide } = survivalGameFromView(view);
    const own = humanSide === "A" ? game.rackA : game.rackB;
    expect(own.map((tile) => ({ id: tile.id, kind: tile.token }))).toEqual(view.rack);
    expect(game.tilebag).toHaveLength(view.bagCount);
    expect((authurSide === "A" ? game.rackA : game.rackB).length).toBe(view.authurRackCount);
    expect(game.scores[humanSide]).toBe(view.scores.player);
    expect(game.scores[authurSide]).toBe(view.scores.authur);
    expect(game.turnNumber).toBe(view.turnNumber);
    expect(game.status).toBe(view.status === "finished" ? "finished" : "playing");
  });

  it("the tile bag panel shows the unseen pool, never the bag alone, counted as the bag", () => {
    const view = views.afterExchange;
    const { game, authurSide } = survivalGameFromView(view);
    const panel = survivalTilebagView(game, authurSide, null);
    const expected = unseenPool(
      game.board,
      view.rack.map((tile) => tile.kind),
    );
    expect(kinds(panel.tiles).sort()).toEqual([...expected].sort());
    expect(panel.tiles).toHaveLength(view.bagCount + view.authurRackCount);
    expect(panel.remainingCount).toBe(view.bagCount);
    expect(panel.listKind).toBe("unseen");
    expect(panel.kind).toBe("bag");
  });

  it("once the bag cannot refill Authur, the panel counts the whole unseen pool", () => {
    const view = views.finishedStreak;
    expect(view.bagCount).toBe(0);
    expect(view.authurRackCount).toBeLessThan(8);
    const { game, authurSide } = survivalGameFromView(view);
    const panel = survivalTilebagView(game, authurSide, null);
    // With the bag empty the unseen pool IS Authur's rack: known by tile tracking, and
    // counted as what the list shows rather than as an empty bag.
    expect(panel.tiles).toHaveLength(view.authurRackCount);
    expect(panel.remainingCount).toBe(view.authurRackCount);
    expect(panel.kind).toBe("opponent-rack");
  });

  it("the turn log starts at turn 1 and never holds a rack the player did not hold", () => {
    for (const view of Object.values(views)) {
      const { game, humanSide, takeoverTurn } = survivalGameFromView(view);
      expect(game.logs[0].turnNumber).toBe(1);
      for (const log of game.logs) {
        const ownTurnAfterTakeover = log.side === humanSide && log.turnNumber >= takeoverTurn;
        if (!ownTurnAfterTakeover || log.action === "end_game") {
          expect(log.rackBefore, `turn ${log.turnNumber}`).toEqual([]);
          expect(log.rackAfter, `turn ${log.turnNumber}`).toEqual([]);
        }
      }
      // The player's own turns carry the player's own racks.
      const own = view.log.filter((turn) => turn.playedBy === "human");
      for (const turn of own) {
        const log = game.logs.find(
          (entry) => entry.turnNumber === turn.turn && entry.action !== "end_game",
        )!;
        expect(kinds(log.rackBefore).sort()).toEqual(
          turn.yourRackBefore!.map((tile) => tile.kind).sort(),
        );
      }
    }
  });

  it("names Authur on the player's seat before the takeover, and nobody after it", () => {
    for (const view of Object.values(views)) {
      const { game, humanSide, takeoverTurn } = survivalGameFromView(view);
      for (const log of game.logs) {
        const authurOnPlayerSeat = log.side === humanSide && log.turnNumber < takeoverTurn;
        expect(log.playedByName, `turn ${log.turnNumber}`).toBe(
          authurOnPlayerSeat ? "Authur" : undefined,
        );
      }
    }
  });

  it("an exchange the player never saw is only a count, in every summary", () => {
    const { game } = survivalGameFromView(views.takeover);
    const hidden = game.logs.filter((log) => log.action === "exchange");
    expect(hidden.length).toBeGreaterThan(0);
    for (const log of hidden) {
      const detail = log.actionDetail as ExchangeDetail;
      expect(detail.outgoingTiles).toEqual([]);
      expect(detail.concealedCount).toBeGreaterThan(0);
      expect(summaryText(log)).toMatch(new RegExp(`· ${detail.concealedCount} tiles$`));
      expect(shortMove(log)).toBe(`แลก ${detail.concealedCount}`);
    }
    // The player's own exchange shows the player's own tiles.
    const mine = survivalGameFromView(views.afterExchange).game.logs.find(
      (log) =>
        log.action === "exchange" && (log.actionDetail as ExchangeDetail).outgoingTiles.length > 0,
    );
    expect((mine!.actionDetail as ExchangeDetail).outgoingTiles).toHaveLength(3);
  });

  it("totals and the ending add up exactly as the server scored them", () => {
    const view = views.finished;
    const { game, humanSide, authurSide } = survivalGameFromView(view);
    const totals = calculateTotals(game.logs);
    expect(totals[humanSide]).toBe(view.result!.scores.player);
    expect(totals[authurSide]).toBe(view.result!.scores.authur);
    const end = game.logs.at(-1)!;
    expect(end.action).toBe("end_game");
    expect(end.finalScore).toBe(view.result!.bonusPoints);
    expect(end.side).toBe(humanSide);
    // Every placement is legal on the board before it, by EQ-Lab's own validator.
    for (const log of game.logs.filter((entry) => entry.action === "place_equation")) {
      expect((log.actionDetail as PlaceEquationDetail).isMoveValid, `turn ${log.turnNumber}`).toBe(
        true,
      );
    }
  });

  it("a scoreless-streak ending says how long the streak was", () => {
    const view = views.finishedStreak;
    const end = survivalGameFromView(view).game.logs.at(-1)!;
    const detail = end.actionDetail as EndGameDetail;
    expect(detail.reason).toBe("no_score_streak");
    expect(detail.noScoreStreak).toBe(view.log.at(-1)!.scorelessStreakAfter);
    expect(detail.description).toContain(`ไม่มีแต้มติดกัน ${detail.noScoreStreak} ตา`);
    expect(detail.bonusPoints).toBe(view.result!.bonusPoints);
  });

  it("refuses a view whose moves do not rebuild its board", () => {
    const view = structuredClone(views.afterExchange);
    view.board = view.board.slice(1);
    expect(() => survivalGameFromView(view)).toThrow(/rebuild the board/);
  });

  it("holds nothing the browser was not sent", () => {
    const { game } = survivalGameFromView(views.finished);
    const text = JSON.stringify(game);
    for (const field of ["levelKey", "sourceSeed", "stateHash", "bagAfter", "decision"]) {
      expect(text).not.toContain(`"${field}"`);
    }
  });
});

describe("a Play-page turn → the move the server takes", () => {
  const log = (partial: Partial<TurnLog>) => partial as TurnLog;
  it("places, with a value only on blanks and choice tiles", () => {
    const place = log({
      action: "place_equation",
      actionDetail: {
        placedTiles: [
          { tileId: "5#0", token: "5", displayToken: "5", row: 7, col: 7 },
          { tileId: "?#1", token: "?", displayToken: "=", assignedToken: "=", row: 7, col: 8 },
        ],
        equationsDetected: [],
        isMoveValid: true,
        errors: [],
      },
    });
    expect(survivalMoveFromLog(place)).toEqual({
      type: "place",
      placements: [
        { tileId: "5#0", cell: 112 },
        { tileId: "?#1", cell: 113, face: "=" },
      ],
    });
  });
  it("exchanges and passes", () => {
    expect(
      survivalMoveFromLog(
        log({
          action: "exchange",
          actionDetail: { outgoingTiles: [{ id: "x#0", token: "x" }], incomingTiles: [] },
        }),
      ),
    ).toEqual({ type: "exchange", tileIds: ["x#0"] });
    expect(survivalMoveFromLog(log({ action: "pass", actionDetail: {} }))).toEqual({
      type: "pass",
    });
  });
});

describe("Survival room ids", () => {
  it("round-trips levels and attempts and ignores ordinary rooms", () => {
    expect(parseSurvivalRoomId(survivalLevelRoomId("cand-abc"))).toEqual({
      kind: "level",
      levelId: "cand-abc",
    });
    expect(parseSurvivalRoomId(survivalAttemptRoomId("att-1"))).toEqual({
      kind: "attempt",
      attemptId: "att-1",
    });
    expect(parseSurvivalRoomId("0b6d2f7e-room")).toBeNull();
    expect(parseSurvivalRoomId("survival:")).toBeNull();
    expect(parseSurvivalRoomId(null)).toBeNull();
  });
});
