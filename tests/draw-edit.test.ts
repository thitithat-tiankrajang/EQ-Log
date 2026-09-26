// A host re-dealing an app-dealt rack.
//
// The invariant every test below is really about: whatever the host does, the position is one
// the bag could have dealt. Only the latest draw changes, a replaced tile goes back to the bag,
// and a replacement comes from the bag as it was at that draw — never from the opponent's rack,
// never a tile this side just exchanged away.
import { describe, expect, it } from "vitest";
import {
  advanceToOpponentTurn,
  createNewGame,
  getRack,
  setRack,
  type ActionType,
  type GameState,
  type Side,
  type TileInstance,
  type TurnLog,
} from "../src/game";
import { refillRackFromQueue } from "../src/gameplay/tilebag";
import { drawEditWindow, replaceDrawnTile, revertDrawnTile } from "../src/gameplay/drawEdit";
import { getRoomActorCapabilities } from "../src/roomAccess";
import type { AmathToken } from "../src/constants/tileDefinitions";

function playGame(): GameState {
  return createNewGame({
    name: "t",
    playerA: "A",
    playerB: "B",
    startingSide: "A",
    tileDrawMode: "play",
  });
}

const ids = (tiles: readonly TileInstance[]) => tiles.map((tile) => tile.id);

/** Every one of the 100 tiles is in exactly one place. */
function expectConserved(game: GameState) {
  const all = [
    ...ids(game.rackA),
    ...ids(game.rackB),
    ...ids(game.tilebag),
    ...game.board.flat().flatMap((cell) => (cell ? [cell.tile.id] : [])),
  ];
  expect(new Set(all).size).toBe(all.length);
  expect(all.length).toBe(100);
}

/**
 * Play one turn the way App does in play mode: log the action BEFORE the refill, then refill,
 * then hand over. `leaving` tiles are placed (onto a spare board cell) or, for an exchange,
 * floated back to the bag after the refill.
 */
function playTurn(game: GameState, action: ActionType, leaving: number): GameState {
  const side = game.activeSide;
  const rack = getRack(game, side);
  const out = rack.slice(0, leaving);
  const kept = rack.slice(leaving);
  const board = game.board.map((row) => row.slice());
  if (action === "place_equation") {
    out.forEach((tile, index) => {
      // Park placed tiles on distinct cells so conservation can see them.
      const row = Math.min(14, game.turnNumber);
      board[row]![index] = { tile, placedTurn: game.turnNumber, side } as never;
    });
  }
  const log = {
    id: `log-${game.turnNumber}`,
    turnNumber: game.turnNumber,
    side,
    action,
    rackBefore: rack,
    rackAfter: kept,
    tilebagBefore: game.tilebag,
    tilebagAfter: game.tilebag,
    boardBefore: game.board,
    boardAfter: board,
  } as unknown as TurnLog;
  const moved = setRack(
    {
      ...game,
      board,
      logs: [...game.logs, log],
      pendingExchangeReturnBySide: {
        ...game.pendingExchangeReturnBySide,
        [side]: action === "exchange" ? out : [],
      },
    },
    side,
    kept,
  );
  return advanceToOpponentTurn(refillRackFromQueue(moved));
}

function firstCandidateToken(game: GameState, exclude: AmathToken): AmathToken {
  const open = drawEditWindow(game)!;
  return open.candidates.find((tile) => tile.token !== exclude)!.token;
}

describe("what may be edited", () => {
  it("opens on the opening deal: all eight tiles, and only the bag as candidates", () => {
    const game = playGame();
    const open = drawEditWindow(game)!;
    expect(open.side).toBe("A");
    expect(open.drawnIds.size).toBe(8);
    expect(open.heldIds.size).toBe(0);
    expect(ids(open.candidates).sort()).toEqual(ids(game.tilebag).sort());
    const opponent = new Set(ids(game.rackB));
    expect(open.candidates.some((tile) => opponent.has(tile.id))).toBe(false);
  });

  it("is closed in a game whose tiles come off a real bag", () => {
    const game = createNewGame({
      name: "t",
      playerA: "A",
      playerB: "B",
      startingSide: "A",
      tileDrawMode: "manual",
    });
    expect(drawEditWindow(game)).toBeNull();
  });

  it("is closed once the side has started acting", () => {
    const game = { ...playGame(), phase: "perform_action" as const };
    expect(drawEditWindow(game)).toBeNull();
  });

  it("opens the second side's opening deal without offering the first side's draw", () => {
    const afterA = playTurn(playGame(), "place_equation", 3);
    expect(afterA.activeSide).toBe("B");
    const open = drawEditWindow(afterA)!;
    expect(open.drawnIds.size).toBe(8);
    const rackA = new Set(ids(afterA.rackA));
    expect(open.candidates.some((tile) => rackA.has(tile.id))).toBe(false);
    expect(ids(open.candidates).sort()).toEqual(ids(afterA.tilebag).sort());
  });

  it("offers only the tiles of the latest draw once a side has played", () => {
    const afterA = playTurn(playGame(), "place_equation", 3);
    const afterB = playTurn(afterA, "place_equation", 2);
    expect(afterB.activeSide).toBe("A");
    const open = drawEditWindow(afterB)!;
    expect(open.drawnIds.size).toBe(3);
    expect(open.heldIds.size).toBe(5);
    // B drew after A: those tiles are no longer in the bag, so not candidates.
    const rackB = new Set(ids(afterB.rackB));
    expect(open.candidates.some((tile) => rackB.has(tile.id))).toBe(false);
  });

  it("never offers back the tiles this side just exchanged away", () => {
    const start = playGame();
    const exchanged = new Set(ids(start.rackA.slice(0, 4)));
    const afterA = playTurn(start, "exchange", 4);
    // They are back in the bag…
    expect(afterA.tilebag.some((tile) => exchanged.has(tile.id))).toBe(true);
    const afterB = playTurn(afterA, "pass", 0);
    const open = drawEditWindow(afterB)!;
    expect(open.drawnIds.size).toBe(4);
    // …but the draw could not have produced them.
    expect(open.candidates.some((tile) => exchanged.has(tile.id))).toBe(false);
  });

  it("has nothing to offer after a pass, when nothing was drawn", () => {
    const afterA = playTurn(playGame(), "pass", 0);
    const afterB = playTurn(afterA, "pass", 0);
    expect(drawEditWindow(afterB)).toBeNull();
  });
});

describe("swapping a tile", () => {
  it("keeps the slot, returns the old tile to the bag and conserves the set", () => {
    const game = playGame();
    const target = game.rackA[2]!;
    const token = firstCandidateToken(game, target.token);
    const result = replaceDrawnTile(game, target.id, token);
    if (!result.ok) throw new Error(result.reason);
    const next = result.game;
    expect(next.rackA[2]!.token).toBe(token);
    expect(next.rackA).toHaveLength(8);
    expect(next.tilebag).toHaveLength(game.tilebag.length);
    expect(ids(next.tilebag)).toContain(target.id);
    expect(ids(next.tilebag)).not.toContain(result.incoming.id);
    expect(next.rackB).toBe(game.rackB);
    expectConserved(next);
    expect(next.drawEdits).toEqual([
      {
        turnNumber: 1,
        side: "A" as Side,
        fromId: target.id,
        from: target.token,
        toId: result.incoming.id,
        to: token,
      },
    ]);
  });

  it("refuses a tile the bag no longer holds", () => {
    const game = playGame();
    // Empty the bag of every tile of one face that is not already in A's hand.
    const face: AmathToken = "20";
    const drained = {
      ...game,
      tilebag: game.tilebag.filter((tile) => tile.token !== face),
      rackB: [...game.rackB],
    };
    const target = drained.rackA.find((tile) => tile.token !== face)!;
    const result = replaceDrawnTile(drained, target.id, face);
    expect(result.ok).toBe(false);
  });

  it("refuses to touch a tile held from before the draw", () => {
    const afterA = playTurn(playGame(), "place_equation", 3);
    const afterB = playTurn(afterA, "place_equation", 2);
    const open = drawEditWindow(afterB)!;
    const held = afterB.rackA.find((tile) => open.heldIds.has(tile.id))!;
    const result = replaceDrawnTile(afterB, held.id, firstCandidateToken(afterB, held.token));
    expect(result.ok).toBe(false);
  });

  it("folds a chain into one edit, and reverting leaves no trace", () => {
    const game = playGame();
    const target = game.rackA[0]!;
    const first = replaceDrawnTile(game, target.id, firstCandidateToken(game, target.token));
    if (!first.ok) throw new Error(first.reason);
    const secondToken = firstCandidateToken(first.game, first.incoming.token);
    const second = replaceDrawnTile(first.game, first.incoming.id, secondToken);
    if (!second.ok) throw new Error(second.reason);
    expect(second.game.drawEdits).toHaveLength(1);
    expect(second.game.drawEdits![0]!.fromId).toBe(target.id);
    expect(second.game.drawEdits![0]!.to).toBe(secondToken);

    const reverted = revertDrawnTile(second.game, second.incoming.id);
    if (!reverted?.ok) throw new Error("revert failed");
    expect(reverted.game.rackA[0]!.id).toBe(target.id);
    expect(reverted.game.drawEdits).toBeUndefined();
    expectConserved(reverted.game);
  });

  it("has nothing to revert on a slot the host never changed", () => {
    const game = playGame();
    expect(revertDrawnTile(game, game.rackA[0]!.id)).toBeNull();
  });
});

describe("who may re-deal", () => {
  const caps = (overrides: Partial<Parameters<typeof getRoomActorCapabilities>[0]>) =>
    getRoomActorCapabilities({
      game: playGame(),
      invitedSides: [],
      isAdmin: false,
      isOwner: false,
      remoteEnabled: true,
      ...overrides,
    }).canEditDraw;

  it("lets the device running a local game, the owner, and an admin", () => {
    expect(caps({ remoteEnabled: false })).toBe(true);
    expect(caps({ isOwner: true })).toBe(true);
    expect(caps({ isOwner: true, emailPlayMode: "hosted" })).toBe(true);
    expect(caps({ isAdmin: true, emailPlayMode: "hosted" })).toBe(true);
  });

  it("refuses a player who is not the host, and everyone in a direct room", () => {
    expect(caps({ invitedSides: ["A"], emailPlayMode: "hosted" })).toBe(false);
    expect(caps({ isOwner: true, emailPlayMode: "direct" })).toBe(false);
    expect(caps({ isAdmin: true, emailPlayMode: "direct" })).toBe(false);
  });

  it("refuses in a game whose tiles come off a real bag", () => {
    const manual = createNewGame({
      name: "t",
      playerA: "A",
      playerB: "B",
      startingSide: "A",
      tileDrawMode: "manual",
    });
    expect(caps({ game: manual, isOwner: true })).toBe(false);
    expect(caps({ game: manual, remoteEnabled: false })).toBe(false);
  });
});
