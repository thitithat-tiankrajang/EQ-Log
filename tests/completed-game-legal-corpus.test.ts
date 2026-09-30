import { describe, expect, it } from "vitest";
import { encodeGame } from "../src/codec";
import {
  buildCompletedGameRecord,
  readCompletedGameRecord,
  replayCompletedGame,
} from "../src/completedGame/record";
import { inventoryFrom } from "../src/domain/projection";
import { frozenLegalGame, legalPlacementGame } from "./helpers/completedCorpus";

function facts(game: ReturnType<typeof frozenLegalGame>) {
  return {
    board: game.board,
    rackA: game.rackA,
    rackB: game.rackB,
    bag: game.tilebag,
    pending: game.pendingExchangeReturnBySide,
    scores: game.scores,
    side: game.activeSide,
    turn: game.turnNumber,
    status: game.status,
    phase: game.phase,
    timers: game.timers,
    players: game.players,
    logs: game.logs,
  };
}

describe("validator-legal completed corpus", () => {
  for (const [name, kind, turns, finish] of [
    ["legal-40", "long", 40, false],
    ["legal-60-finished", "long", 60, true],
    ["legal-65", "long", 65, false],
    ["natural-rackout", "rackout", 39, false],
  ] as const) {
    it(`${name}: preserves all physical and visible facts at every revision`, async () => {
      const game = frozenLegalGame(kind, turns, finish);
      const record = await buildCompletedGameRecord(game);
      const read = await readCompletedGameRecord(record);
      expect(facts(read.game)).toEqual(facts(game));
      expect(replayCompletedGame(record).map(facts)).toEqual(game.history.map(facts));
      expect(() => inventoryFrom(read.game)).not.toThrow();
      expect(JSON.stringify(record).length).toBeLessThan(JSON.stringify(encodeGame(game)).length);
      expect(record.events.length).toBe(game.history.length - 1);
    });
  }

  it("checks bounded seeded legal prefixes using the same production action path", async () => {
    let placements = 0;
    let turns = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const game = legalPlacementGame(seed, 18);
      placements += game.logs.filter((log) => log.action === "place_equation").length;
      turns += game.logs.filter((log) => log.action !== "end_game").length;
      const record = await buildCompletedGameRecord(game);
      const read = await readCompletedGameRecord(record);
      expect(facts(read.game)).toEqual(facts(game));
      expect(replayCompletedGame(record).map(facts)).toEqual(game.history.map(facts));
    }
    expect(placements).toBeGreaterThan(0);
    expect(turns).toBeGreaterThan(200);
    console.log(`LEGAL_PREFIXES seeds=24 turns=${turns} placements=${placements} failures=0`);
  }, 30_000);
});
