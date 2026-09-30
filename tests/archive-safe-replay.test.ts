import { describe, expect, it } from "vitest";
import { encodeGame, LEGACY_TOKEN_TABLE } from "../src/codec";
import {
  projectFirstAuthorizedArchive,
  type ArchiveCandidate,
} from "../src/completedGame/archiveRead";
import { buildCompletedGameRecord } from "../src/completedGame/record";
import { positionOf, type Multiverse } from "../src/gameplay/multiverse";
import { encodeMultiverse } from "../src/gameplay/multiverseCodec";
import { frozenLegalGame, legalPassGame } from "./helpers/completedCorpus";

const approved = {
  userId: "viewer",
  approved: true,
  admin: false,
  regionIds: ["region-a"],
};

function candidate(scope: ArchiveCandidate["scope"], snapshot: unknown): ArchiveCandidate {
  return {
    scope,
    gameId: "game-1",
    name: "Finished game",
    ownerId: "owner",
    regionId: "region-a",
    finishedAt: "2026-01-01T00:00:00.000Z",
    snapshot,
  };
}

describe("trusted archive replay projection", () => {
  it("projects legacy and Compact v1 through the same safe client contract", async () => {
    const game = frozenLegalGame("long", 20, true);
    game.logs[0]!.note = "PRIVATE_LEGACY_NOTE";
    const sources = [encodeGame(game), await buildCompletedGameRecord(game)];
    const views = await Promise.all(
      sources.map((snapshot) =>
        projectFirstAuthorizedArchive([candidate("public", snapshot)], approved),
      ),
    );
    for (const result of views) {
      expect(result?.replay.status).toBe("finished");
      expect(result?.replay.finalScores).toEqual(game.scores);
      expect(result?.replay.finalRacks.A).toHaveLength(game.rackA.length);
      expect(result?.replay.turns).toHaveLength(game.logs.length);
      const wire = JSON.stringify(result);
      expect(wire).not.toContain("PRIVATE_LEGACY_NOTE");
      expect(wire).not.toContain(game.tilebag[0]?.id ?? "SECRET_TILE_ID");
      expect(wire).not.toMatch(
        /tilebag|drawOrder|pendingExchangeReturn|finalStateDigest|decisionSeed/,
      );
    }
    expect(views[0]?.replay.finalBoard).toEqual(views[1]?.replay.finalBoard);
    expect(views[0]?.replay.finalRacks).toEqual(views[1]?.replay.finalRacks);
  });

  it("keeps face-only legacy v1/v2 readable without inventing private history", async () => {
    const started = legalPassGame(0);
    const game = {
      ...started,
      status: "finished" as const,
      timers: { ...started.timers, paused: true },
    };
    const encoded = encodeGame(game);
    const faces = (tiles: typeof game.tilebag) =>
      tiles.map((tile) => LEGACY_TOKEN_TABLE.indexOf(tile.token));
    for (const version of [1, 2]) {
      const legacy = {
        ...encoded,
        v: version,
        tilebag: faces(game.tilebag),
        rackA: faces(game.rackA),
        rackB: faces(game.rackB),
        history: [],
        historyLogs: [],
        logs: [],
        historyIndex: 0,
      };
      const result = await projectFirstAuthorizedArchive([candidate("private", legacy)], {
        ...approved,
        userId: "owner",
      });
      expect(result?.replay.status).toBe("finished");
      expect(result?.replay.finalRacks.A).toEqual(game.rackA.map((tile) => tile.token).sort());
      expect(result?.replay.positions).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain(game.tilebag[0]!.id);
    }
  });

  it("opens an old bot archive without inventing a missing catalog pin", async () => {
    const game = frozenLegalGame("long", 20, true);
    game.botSide = "B";
    game.botEngine = "authur";
    const result = await projectFirstAuthorizedArchive(
      [candidate("public", encodeGame(game))],
      approved,
    );
    expect(result?.replay.mode).toBe("bot");
    expect(result?.replay.bot).toBeUndefined();
    expect(result?.replay.finalScores).toEqual(game.scores);
  });

  it("preserves Public, Region and Private authorization, including a saved Region copy", async () => {
    const game = frozenLegalGame("long", 20, true);
    const compact = await buildCompletedGameRecord(game);
    const publicRow = candidate("public", compact);
    const regionRow = candidate("region", compact);
    const privateCopy = candidate("private", compact);
    expect(await projectFirstAuthorizedArchive([publicRow], approved)).not.toBeNull();
    expect(
      await projectFirstAuthorizedArchive([publicRow], { ...approved, approved: false }),
    ).toBeNull();
    expect(await projectFirstAuthorizedArchive([regionRow], approved)).not.toBeNull();
    expect(
      await projectFirstAuthorizedArchive([regionRow], { ...approved, regionIds: [] }),
    ).toBeNull();
    expect(await projectFirstAuthorizedArchive([privateCopy], approved)).toBeNull();
    expect(
      await projectFirstAuthorizedArchive([privateCopy], { ...approved, userId: "owner" }),
    ).not.toBeNull();
    const saved = await projectFirstAuthorizedArchive([regionRow, privateCopy], {
      ...approved,
      userId: "owner",
      regionIds: [],
    });
    expect(saved?.archive.scope).toBe("private");
    expect(JSON.stringify(saved)).not.toContain(compact.digest);
  });

  it("projects a retained Recent Compact through the private safe boundary", async () => {
    const game = frozenLegalGame("long", 20, true);
    const compact = await buildCompletedGameRecord(game);
    const recent = candidate("recent", compact);
    expect(await projectFirstAuthorizedArchive([recent], approved)).toBeNull();
    const own = await projectFirstAuthorizedArchive([recent], {
      ...approved,
      userId: "owner",
      approved: false,
    });
    expect(own?.archive.scope).toBe("recent");
    const wire = JSON.stringify(own);
    expect(wire).not.toContain(game.tilebag[0]!.id);
    expect(wire).not.toMatch(/tilebag|drawOrder|finalStateDigest|decisionSeed/);
  });

  it("never authorizes a browser-supplied owner assertion", async () => {
    const game = frozenLegalGame("long", 20, true);
    const row = candidate("private", await buildCompletedGameRecord(game));
    const attemptedRequest = { gameId: row.gameId, isOwner: true, canView: true };
    expect(attemptedRequest.isOwner).toBe(true);
    expect(await projectFirstAuthorizedArchive([row], approved)).toBeNull();
  });

  it("shows the exact fork position for Compact and legacy nested branches", async () => {
    const game = frozenLegalGame("long", 20, true);
    const first = { ...game.logs[1]!, id: "alternate-one" };
    const second = { ...game.logs[2]!, id: "nested-one" };
    const branches: Multiverse = {
      version: 2,
      lines: [
        {
          id: "alternate",
          from: game.logs[0]!.id,
          logs: [first],
          after: [positionOf(game.history[2]!)],
          tip: positionOf(game.history[2]!),
          parkedAt: "2026-01-01T00:01:00.000Z",
        },
        {
          id: "nested",
          from: first.id,
          logs: [second],
          after: [positionOf(game.history[3]!)],
          tip: positionOf(game.history[3]!),
          parkedAt: "2026-01-01T00:02:00.000Z",
        },
      ],
    };
    const compact = await buildCompletedGameRecord(game, branches);
    const legacy = { ...encodeGame(game), timeline: encodeMultiverse(branches) };
    for (const snapshot of [compact, legacy]) {
      const result = await projectFirstAuthorizedArchive([candidate("public", snapshot)], approved);
      expect(result?.replay.branches).toHaveLength(2);
      expect(result?.replay.branches?.[0]?.positions[0]?.board).toEqual(
        result?.replay.turns[0]?.board,
      );
      expect(result?.replay.branches?.[1]?.positions[0]?.board).toEqual(
        result?.replay.branches?.[0]?.positions[1]?.board,
      );
      expect(result?.replay.branches?.[1]?.fromTurn).toBe(first.turnNumber);
      expect(JSON.stringify(result)).not.toContain(game.tilebag[0]!.id);
    }
  });
});
