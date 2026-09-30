import { expect, it } from "vitest";
import { encodeGame } from "../src/codec";
import { projectFirstAuthorizedArchive } from "../src/completedGame/archiveRead";
import { buildCompletedGameRecord } from "../src/completedGame/record";
import { frozenLegalGame } from "./helpers/completedCorpus";

const benchmark = process.env.BENCHMARK_RECENT === "1" ? it : it.skip;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const percentile = (samples: number[], fraction: number) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return Number(sorted[Math.ceil(sorted.length * fraction) - 1]!.toFixed(2));
};

benchmark(
  "measures shared Compact retention and safe replay response",
  async () => {
    const rows = [];
    for (const turns of [40, 60]) {
      const game = frozenLegalGame("long", turns, true);
      const current = encodeGame(game);
      const compact = await buildCompletedGameRecord(game);
      const safe = await projectFirstAuthorizedArchive(
        [
          {
            scope: "recent",
            gameId: game.gameId,
            name: game.name,
            ownerId: "participant",
            finishedAt: "2026-01-01T00:00:00.000Z",
            snapshot: compact,
          },
        ],
        { userId: "participant", approved: false, admin: false, regionIds: [] },
      );
      expect(safe?.replay.status).toBe("finished");
      const safeWire = JSON.stringify(safe);
      expect(safeWire).not.toContain(compact.digest);
      expect(safeWire).not.toContain(game.tilebag[0]?.id ?? "SECRET_TILE_ID");
      const project = (snapshot: unknown, scope: "private" | "recent") =>
        projectFirstAuthorizedArchive(
          [
            {
              scope,
              gameId: game.gameId,
              name: game.name,
              ownerId: "participant",
              finishedAt: "2026-01-01T00:00:00.000Z",
              snapshot,
            },
          ],
          { userId: "participant", approved: false, admin: false, regionIds: [] },
        );
      async function sampleProjection(snapshot: unknown, scope: "private" | "recent") {
        await project(snapshot, scope);
        const timings = [];
        for (let n = 0; n < 7; n++) {
          const started = performance.now();
          await project(snapshot, scope);
          timings.push(performance.now() - started);
        }
        return { p50Ms: percentile(timings, 0.5), p90Ms: percentile(timings, 0.9) };
      }
      rows.push({
        actions: turns,
        actualTurns: game.logs.length,
        legacyBytes: bytes(current),
        compactBytes: bytes(compact),
        safeResponseBytes: bytes(safe),
        twentyPayloadBytes: 20 * bytes(compact),
        duplicatedTwoSeatBytes: 2 * bytes(compact),
        sharedTwoSeatBytes: bytes(compact),
        oldProjection: await sampleProjection(current, "private"),
        newProjection: await sampleProjection(compact, "recent"),
      });
    }
    console.log(`RECENT_STORAGE_BENCHMARK=${JSON.stringify(rows)}`);
  },
  60_000,
);
