// Where the map puts things: the live line on top, forks below their parents, and short
// explorations sharing a lane instead of each growing the map by a row.
import { describe, expect, it } from "vitest";
import {
  buildTree,
  continueFrom,
  EMPTY_MULTIVERSE,
  type ContinueResult,
} from "../src/gameplay/multiverse";
import { layoutMultiverse, MAP_GEOMETRY } from "../src/components/logs/multiverseLayout";
import { newGame, pass, playTurns } from "./helpers/simulateGame";

function ok(result: ContinueResult) {
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe("the map's layout", () => {
  it("draws a game that never branched as one lane, left to right", () => {
    const game = playTurns(newGame("play"), 5);
    const layout = layoutMultiverse(buildTree(game.logs, EMPTY_MULTIVERSE));
    expect(layout.lanes).toBe(1);
    expect(layout.nodes.map((node) => node.lane)).toEqual([0, 0, 0, 0, 0]);
    const xs = game.logs.map((log) => layout.byId.get(log.id)!.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(layout.edges.every((edge) => edge.live)).toBe(true);
  });

  it("keeps the line being played on top and drops forks below", () => {
    const game = playTurns(newGame("play"), 8);
    const away = ok(
      continueFrom(game, EMPTY_MULTIVERSE, { nodeId: game.logs[2]!.id, phase: "after" }),
    );
    const explored = pass(away.game);
    const layout = layoutMultiverse(buildTree(explored.logs, away.multiverse));
    for (const log of explored.logs) expect(layout.byId.get(log.id)!.lane).toBe(0);
    for (const log of game.logs.slice(3)) expect(layout.byId.get(log.id)!.lane).toBeGreaterThan(0);
    // The fork edge bends; the lane edges run straight.
    const forkEdge = layout.edges.find((edge) => edge.toId === game.logs[3]!.id)!;
    expect(forkEdge.d).toContain("C");
    expect(forkEdge.live).toBe(false);
  });

  it("lets two short explorations at different points share one lane", () => {
    let game = playTurns(newGame("play"), 12);
    let multiverse = EMPTY_MULTIVERSE;
    // Explore one turn off turn 2, come back; explore one turn off turn 9, come back.
    const tip = game.logs[11]!.id;
    for (const at of [1, 8]) {
      const away = ok(
        continueFrom(game, multiverse, { nodeId: game.logs[at]!.id, phase: "after" }),
      );
      const explored = pass(away.game);
      const back = ok(continueFrom(explored, away.multiverse, { nodeId: tip, phase: "after" }));
      game = back.game;
      multiverse = back.multiverse;
    }
    const layout = layoutMultiverse(buildTree(game.logs, multiverse));
    expect(multiverse.lines).toHaveLength(2);
    expect(layout.lanes).toBe(2);
    expect(layout.width).toBeGreaterThan(MAP_GEOMETRY.padX * 2);
  });
});

describe("the top lane", () => {
  it("holds the line being played and nothing parked, even right after going back", () => {
    const game = playTurns(newGame("play"), 6);
    // Back to turn 2 and nothing played yet: the old turns 3-6 continue past "now".
    const away = ok(
      continueFrom(game, EMPTY_MULTIVERSE, { nodeId: game.logs[1]!.id, phase: "after" }),
    );
    const layout = layoutMultiverse(buildTree(away.game.logs, away.multiverse));
    const topLane = layout.nodes.filter((node) => node.lane === 0).map((node) => node.id);
    expect(topLane).toEqual(away.game.logs.map((log) => log.id));
    for (const log of game.logs.slice(2)) expect(layout.byId.get(log.id)!.lane).toBe(1);
  });

  it("stays empty of parked turns when the game went back to its very start", () => {
    const game = playTurns(newGame("play"), 3);
    const away = ok(
      continueFrom(game, EMPTY_MULTIVERSE, { nodeId: game.logs[0]!.id, phase: "before" }),
    );
    const layout = layoutMultiverse(buildTree(away.game.logs, away.multiverse));
    expect(layout.nodes.every((node) => node.lane > 0)).toBe(true);
  });
});
