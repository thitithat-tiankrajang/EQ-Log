// Branching: what it must do, and the things it must never do.
//
// The claims worth testing are about EXACTNESS. Going back to turn N has to put the game where it
// really was before turn N — the same tiles in the same racks, the same bag in the same order —
// and returning to a line has to put back exactly the position it was left at. Anything less is a
// branch that quietly plays a different game. So these tests capture the real live state at every
// turn while playing, and compare what branching restores against it.
import { describe, expect, it } from "vitest";
import {
  buildTree,
  childrenOf,
  continueFrom,
  EMPTY_MULTIVERSE,
  equivalentParkedChild,
  lineCount,
  lineTipOf,
  MULTIVERSE_LIMITS,
  pathTo,
  positionOf,
  pruneLine,
  sameMove,
  siblingsOf,
  type ContinueResult,
  type Multiverse,
  type Position,
} from "../src/gameplay/multiverse";
import type { GameState, TurnLog } from "../src/game";
import { inventoryFrom } from "../src/domain/projection";
import { exchange, newGame, pass, place } from "./helpers/simulateGame";

/** Play `turns` turns, keeping the live game as it stood before each one. */
function record(mode: "play" | "manual", turns: number) {
  const states: GameState[] = [newGame(mode)];
  for (let turn = 0; turn < turns; turn += 1) {
    const current = states[states.length - 1]!;
    states.push(turn % 3 === 2 ? exchange(current, 2) : place(current, 2 + (turn % 2)));
  }
  return { states, game: states[states.length - 1]! };
}

/** The parts of a position that decide what is played next. Clocks and anchors aside. */
function essence(position: Position) {
  const ids = (tiles: { id: string }[]) => tiles.map((tile) => tile.id);
  return {
    board: JSON.stringify(position.board),
    rackA: [...ids(position.rackA)].sort(),
    rackB: [...ids(position.rackB)].sort(),
    tilebag: ids(position.tilebag),
    pendingA: ids(position.pendingExchangeReturnBySide.A),
    pendingB: ids(position.pendingExchangeReturnBySide.B),
    scores: position.scores,
    turnNumber: position.turnNumber,
    activeSide: position.activeSide,
    phase: position.phase,
  };
}

function ok(result: ContinueResult) {
  if (!result.ok) throw new Error(`expected success, got: ${result.reason}`);
  return result;
}

let lineSerial = 0;
const lineIds = () => `line-${(lineSerial += 1)}`;

function historyAgrees(game: GameState) {
  for (const snapshot of game.history) {
    snapshot.logs.forEach((log, index) => expect(log.id).toBe(game.logs[index]?.id));
  }
}

function physicallyWhole(game: GameState) {
  expect(() =>
    inventoryFrom({
      tilebag: game.tilebag,
      rackA: game.rackA,
      rackB: game.rackB,
      board: game.board,
      pendingReturnA: game.pendingExchangeReturnBySide?.A ?? [],
      pendingReturnB: game.pendingExchangeReturnBySide?.B ?? [],
    }),
  ).not.toThrow();
}

describe("a game that never branched", () => {
  const { game } = record("play", 5);

  it("is one line and nothing else", () => {
    const tree = buildTree(game.logs, EMPTY_MULTIVERSE);
    expect(lineCount(tree)).toBe(1);
    expect(tree.problems).toEqual([]);
    expect(pathTo(tree, game.logs[4]!.id).map((log) => log.id)).toEqual(
      game.logs.map((log) => log.id),
    );
  });

  it("does nothing when asked to continue from where it already is", () => {
    const result = ok(
      continueFrom(game, EMPTY_MULTIVERSE, { nodeId: game.logs[4]!.id, phase: "after" }),
    );
    expect(result.changed).toBe(false);
    expect(result.game).toBe(game);
    expect(result.multiverse).toBe(EMPTY_MULTIVERSE);
  });
});

describe.each(["play", "manual"] as const)("going back, in %s mode", (mode) => {
  const { states, game } = record(mode, 7);

  it("puts the game exactly where it stood before the chosen turn", () => {
    for (let turn = 0; turn < 7; turn += 1) {
      const result = ok(
        continueFrom(
          game,
          EMPTY_MULTIVERSE,
          { nodeId: game.logs[turn]!.id, phase: "before" },
          { newLineId: lineIds },
        ),
      );
      expect(essence(positionOf(result.game))).toEqual(essence(positionOf(states[turn]!)));
      expect(result.game.logs.map((log) => log.id)).toEqual(
        game.logs.slice(0, turn).map((log) => log.id),
      );
      physicallyWhole(result.game);
      historyAgrees(result.game);
    }
  });

  it("puts the game where a turn left it, and keeps everything after it", () => {
    const result = ok(
      continueFrom(
        game,
        EMPTY_MULTIVERSE,
        { nodeId: game.logs[2]!.id, phase: "after" },
        { newLineId: lineIds },
      ),
    );
    // The board and the scores are the ones turn 3 made.
    expect(result.game.board).toEqual(game.logs[2]!.boardAfter);
    expect(result.game.scores).toEqual(states[3]!.scores);
    if (mode === "play") {
      // Play mode draws and hands over inside the commit, so "after" is the next turn's start.
      expect(essence(positionOf(result.game))).toEqual(essence(positionOf(states[3]!)));
    } else {
      // Manual mode commits first and refills after, by hand: "after" is that refill, pending.
      expect(result.game.phase).toBe("refill");
      expect(result.game.activeSide).toBe(game.logs[2]!.side);
    }
    const [line] = result.multiverse.lines;
    expect(line!.from).toBe(game.logs[2]!.id);
    expect(line!.logs.map((log) => log.id)).toEqual(game.logs.slice(3).map((log) => log.id));
    expect(essence(line!.tip)).toEqual(essence(positionOf(game)));
    expect(result.game.timelineRef).toEqual({ version: 1, lines: 1 });
    physicallyWhole(result.game);
    historyAgrees(result.game);
  });

  it("returns to a parked line exactly as it was left", () => {
    const away = ok(
      continueFrom(
        game,
        EMPTY_MULTIVERSE,
        { nodeId: game.logs[1]!.id, phase: "before" },
        { newLineId: lineIds },
      ),
    );
    const tipId = game.logs[6]!.id;
    const back = ok(continueFrom(away.game, away.multiverse, { nodeId: tipId, phase: "after" }));
    expect(back.game.logs.map((log) => log.id)).toEqual(game.logs.map((log) => log.id));
    expect(essence(positionOf(back.game))).toEqual(essence(positionOf(game)));
    // Nothing was played while away, so nothing was left behind: no empty branch.
    expect(back.multiverse.lines).toEqual([]);
    expect(back.game.timelineRef).toEqual({ version: 2, lines: 0 });
    historyAgrees(back.game);
  });
});

describe("a line played while away", () => {
  const { game } = record("play", 6);
  const fork = game.logs[2]!;
  const away = ok(
    continueFrom(
      game,
      EMPTY_MULTIVERSE,
      { nodeId: fork.id, phase: "after" },
      { newLineId: lineIds },
    ),
  );
  const explored = pass(place(away.game, 4));
  const back = ok(
    continueFrom(
      explored,
      away.multiverse,
      { nodeId: game.logs[5]!.id, phase: "after" },
      { newLineId: lineIds },
    ),
  );
  const tree = buildTree(back.game.logs, back.multiverse);

  it("is parked when going back, not lost", () => {
    expect(back.multiverse.lines).toHaveLength(1);
    const parked = back.multiverse.lines[0]!;
    expect(parked.from).toBe(fork.id);
    expect(parked.logs.map((log) => log.id)).toEqual(explored.logs.slice(3).map((log) => log.id));
  });

  it("shows as a fork with two ways on from the same turn", () => {
    expect(childrenOf(tree, fork.id)).toEqual([game.logs[3]!.id, explored.logs[3]!.id]);
    expect(siblingsOf(tree, game.logs[3]!.id)).toEqual([explored.logs[3]!.id]);
    expect(lineCount(tree)).toBe(2);
  });

  it("can be walked end to end from any of its turns", () => {
    const tip = lineTipOf(tree, explored.logs[3]!.id);
    expect(tip).toBe(explored.logs[4]!.id);
    expect(pathTo(tree, tip).map((log) => log.id)).toEqual(explored.logs.map((log) => log.id));
  });

  it("gives back the position it reached when it is resumed", () => {
    const resumed = ok(
      continueFrom(
        back.game,
        back.multiverse,
        { nodeId: explored.logs[4]!.id, phase: "after" },
        { newLineId: lineIds },
      ),
    );
    expect(essence(positionOf(resumed.game))).toEqual(essence(positionOf(explored)));
    // ...and the original line takes its place in the parked document.
    expect(resumed.multiverse.lines.map((line) => line.logs.map((log) => log.id))).toEqual([
      game.logs.slice(3).map((log) => log.id),
    ]);
  });

  it("splits a parked line when entered in the middle, keeping the rest parked", () => {
    const middle = explored.logs[3]!.id;
    const entered = ok(
      continueFrom(
        back.game,
        back.multiverse,
        { nodeId: middle, phase: "after" },
        { newLineId: lineIds },
      ),
    );
    expect(entered.game.logs.map((log) => log.id)).toEqual(
      explored.logs.slice(0, 4).map((log) => log.id),
    );
    const remainder = entered.multiverse.lines.find((line) => line.from === middle);
    expect(remainder?.logs.map((log) => log.id)).toEqual([explored.logs[4]!.id]);
    // Its tip is still the position that line was left at.
    expect(essence(remainder!.tip)).toEqual(essence(positionOf(explored)));
    physicallyWhole(entered.game);
    historyAgrees(entered.game);
    // Stored as three pieces now, but still the two lines anybody looking at the map would see.
    expect(entered.multiverse.lines).toHaveLength(2);
    expect(lineCount(buildTree(entered.game.logs, entered.multiverse))).toBe(2);
    // Every turn is in exactly one place.
    const all = [
      ...entered.game.logs.map((log) => log.id),
      ...entered.multiverse.lines.flatMap((line) => line.logs.map((log) => log.id)),
    ];
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(game.logs.length + 2);
  });
});

describe("not repeating what already exists", () => {
  const { game } = record("play", 5);
  const away = ok(
    continueFrom(
      game,
      EMPTY_MULTIVERSE,
      { nodeId: game.logs[2]!.id, phase: "after" },
      { newLineId: lineIds },
    ),
  );
  const tree = buildTree(away.game.logs, away.multiverse);
  const original = game.logs[3]!;

  it("recognizes the parked move when the same one is played again", () => {
    // The same faces on the same squares: turn 4 put three tiles down, and `place` takes rack
    // tiles in order from what is the same rack again.
    const again = place(away.game, 3).logs.at(-1)!;
    expect(sameMove(again, original)).toBe(true);
    expect(equivalentParkedChild(tree, game.logs[2]!.id, again)).toBe(original.id);
  });

  it("does not mistake a different move for it", () => {
    const different = pass(away.game).logs.at(-1)!;
    expect(sameMove(different, original)).toBe(false);
    expect(equivalentParkedChild(tree, game.logs[2]!.id, different)).toBeNull();
  });

  it("compares faces, not which physical copy of a face was used", () => {
    const swapped = {
      ...original,
      actionDetail: {
        ...(original.actionDetail as { placedTiles: { tileId: string }[] }),
        placedTiles: (
          original.actionDetail as { placedTiles: { tileId: string }[] }
        ).placedTiles.map((tile) => ({ ...tile, tileId: "another-copy" })),
      },
    } as TurnLog;
    expect(sameMove(swapped, original)).toBe(true);
  });
});

describe("pruning", () => {
  const { game } = record("play", 6);
  const first = ok(
    continueFrom(
      game,
      EMPTY_MULTIVERSE,
      { nodeId: game.logs[1]!.id, phase: "after" },
      { newLineId: () => "trunk" },
    ),
  );
  const played = place(first.game, 3);
  const second = ok(
    continueFrom(
      played,
      first.multiverse,
      { nodeId: game.logs[3]!.id, phase: "after" },
      { newLineId: () => "twig" },
    ),
  );

  it("removes a line together with every line continuing from it", () => {
    // Going back to the original line split it: its first two parked turns became live again,
    // the rest stayed parked, and the explored line was parked beside it.
    const onTrunk = second.multiverse.lines.find((line) => line.id === "trunk");
    expect(onTrunk).toBeDefined();
    const pruned = pruneLine(second.multiverse, "twig");
    expect(pruned.lines.map((line) => line.id)).toEqual(["trunk"]);
    expect(pruned.version).toBe(second.multiverse.version + 1);
  });

  it("takes descendants along", () => {
    const nested: Multiverse = {
      version: 1,
      lines: [
        { ...second.multiverse.lines[0]!, id: "parent" },
        {
          ...second.multiverse.lines[0]!,
          id: "child",
          from: second.multiverse.lines[0]!.logs[0]!.id,
          logs: [{ ...second.multiverse.lines[0]!.logs[0]!, id: "grandchild-turn" }],
        },
      ],
    };
    expect(pruneLine(nested, "parent").lines).toEqual([]);
  });
});

describe("refusals", () => {
  const { game } = record("play", 4);

  it("will not continue a finished game", () => {
    const finished = { ...game, status: "finished" as const };
    const result = continueFrom(finished, EMPTY_MULTIVERSE, {
      nodeId: game.logs[0]!.id,
      phase: "after",
    });
    expect(result.ok).toBe(false);
  });

  it("will not invent a position the game never recorded", () => {
    const amnesiac = { ...game, history: [] };
    const result = continueFrom(amnesiac, EMPTY_MULTIVERSE, {
      nodeId: game.logs[1]!.id,
      phase: "after",
    });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("ดูได้อย่างเดียว") });
  });

  it("stops growing at the limit instead of drawing an unreadable map", () => {
    const full: Multiverse = {
      version: 9,
      lines: Array.from({ length: MULTIVERSE_LIMITS.lines }, (_, index) => ({
        id: `full-${index}`,
        from: null,
        logs: [{ ...game.logs[0]!, id: `ghost-${index}` }],
        after: [null],
        tip: positionOf(game),
        parkedAt: game.createdAt,
      })),
    };
    const result = continueFrom(game, full, { nodeId: game.logs[1]!.id, phase: "after" });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("เต็มแล้ว") });
  });

  it("reports a parked line it cannot attach instead of dropping it silently", () => {
    const orphan: Multiverse = {
      version: 1,
      lines: [
        {
          id: "orphan",
          from: "no-such-turn",
          logs: [{ ...game.logs[0]!, id: "lost" }],
          after: [null],
          tip: positionOf(game),
          parkedAt: game.createdAt,
        },
      ],
    };
    const tree = buildTree(game.logs, orphan);
    expect(tree.nodes.has("lost")).toBe(false);
    expect(tree.problems).toEqual([expect.stringContaining("orphan")]);
  });
});
