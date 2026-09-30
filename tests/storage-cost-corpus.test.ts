// @vitest-environment node
/** Opt-in completed variants for the Milestone 12 size distribution. */
import { expect, it } from "vitest";
import { buildCompletedGameRecord, readCompletedGameRecord } from "../src/completedGame/record";
import { createNewGame, pushActionSnapshot, type GameState } from "../src/game";
import { positionOf, type Multiverse } from "../src/gameplay/multiverse";
import { frozenLegalGame } from "./helpers/completedCorpus";

const benchmark = process.env.BENCHMARK_STORAGE_CORPUS === "1" ? it : it.skip;
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

function withMetadata(game: GameState, changes: Partial<GameState>): GameState {
  return {
    ...game,
    ...changes,
    history: game.history.map((snapshot) => ({ ...snapshot, ...changes, logs: snapshot.logs })),
  };
}

function branches(game: GameState, count: number, suffix: number): Multiverse {
  return {
    version: count,
    lines: Array.from({ length: count }, (_, lineIndex) => {
      const start = 2 + (lineIndex % Math.max(1, game.logs.length - suffix - 3));
      const logs = game.logs.slice(start + 1, start + 1 + suffix).map((log, index) => ({
        ...log,
        id: `storage-branch-${lineIndex}-${index}`,
      }));
      const after = logs.map((_, index) => positionOf(game.history[start + 2 + index]!));
      return {
        id: `storage-line-${lineIndex}`,
        from: game.logs[start]!.id,
        logs,
        after,
        tip: after.at(-1)!,
        parkedAt: "2026-01-01T00:10:00.000Z",
      };
    }),
  };
}

benchmark("measures finished bot, edit, and branch records", async () => {
  const bot = withMetadata(frozenLegalGame("long", 20, true), {
    botSide: "B",
    botEngine: "authur",
    botDifficulty: "super",
    superEngineVersion: "engine-4",
    superWeightsVersion: "weights-2",
  });
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
  const finishedManual = pushActionSnapshot({ ...edited, status: "finished" });
  const trunk = frozenLegalGame("long", 40, true);
  const corpus = [
    {
      name: "finished-bot-20",
      game: bot,
      provenance: {
        mode: "bot" as const,
        bot: { catalogId: "authur", catalogVersion: "catalog-1", engineVersion: "engine-4" },
      },
    },
    { name: "finished-manual-edit", game: finishedManual },
    { name: "finished-one-branch-40", game: trunk, branches: branches(trunk, 1, 2) },
    { name: "finished-four-branches-40", game: trunk, branches: branches(trunk, 4, 3) },
    { name: "finished-heavy-branches-40", game: trunk, branches: branches(trunk, 30, 12) },
  ];
  const measurements = [];
  for (const fixture of corpus) {
    expect(fixture.game.status).toBe("finished");
    const record = await buildCompletedGameRecord(
      fixture.game,
      fixture.branches,
      fixture.provenance,
    );
    await readCompletedGameRecord(record);
    measurements.push({ name: fixture.name, rawJsonBytes: bytes(record) });
  }
  console.log(`STORAGE_COMPLETED_CORPUS=${JSON.stringify(measurements)}`);
});
