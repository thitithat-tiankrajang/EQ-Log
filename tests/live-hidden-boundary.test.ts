import { describe, expect, it, vi } from "vitest";
import { decodeGame, encodeGame } from "../src/codec";
import { deepClone, displayToken, type GameState, type Side } from "../src/game";
import { projectLiveGame } from "../src/liveGame/projection";
import { rankedPublicView } from "../src/features/ranked/publicView";
import { applyRankedAction } from "../src/features/ranked/rules";
import { createSurvivalTestGame } from "../src/features/survival/seededGame";
import {
  handleLiveGame,
  type LiveSource,
  type LiveStore,
} from "../supabase/functions/live-game/handler";
import { buildCompletedGameRecord, readCompletedGameRecord } from "../src/completedGame/record";
import { projectFirstAuthorizedArchive } from "../src/completedGame/archiveRead";
import {
  finishedLegalPassGame,
  frozenLegalGame,
  legalEquationGame,
  legalPassGame,
} from "./helpers/completedCorpus";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const commandId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function seated(game: GameState): GameState {
  return { ...game, playerUserIds: { A, B }, timers: { ...game.timers, untimed: true } };
}

/** Change hidden past, current, future, physical references and extension fields.
 * Keep all public actions, own observations and public counts exactly equal. */
function anotherHiddenWorld(game: GameState, hidden: Side): GameState {
  const next = deepClone(game);
  const rackKey = hidden === "A" ? "rackA" : "rackB";
  next[rackKey] = next[rackKey].map((tile, index) => ({
    ...tile,
    id: `hidden-${index}`,
    token: "20",
  }));
  next.tilebag.reverse();
  next.pendingExchangeReturn = next[rackKey];
  for (const log of next.logs) {
    log.tilebagBefore.reverse();
    log.tilebagAfter.reverse();
    if (log.side === hidden) {
      log.rackBefore = log.rackBefore.map((tile) => ({
        ...tile,
        id: `past:${tile.id}`,
        token: "19",
      }));
      log.rackAfter = log.rackAfter.map((tile) => ({
        ...tile,
        id: `past-after:${tile.id}`,
        token: "18",
      }));
      const outgoing = (log.actionDetail as { outgoingTiles?: unknown[] }).outgoingTiles;
      log.actionDetail = {
        outgoingTiles: outgoing?.map(() => ({ id: "hidden-exchange", token: "17" })),
        incomingTiles: next[rackKey],
        privateSeed: "private-seed",
      } as never;
    }
  }
  for (const position of next.history) {
    position[rackKey] = next[rackKey];
    position.tilebag.reverse();
  }
  Object.assign(next, {
    rngSeed: 123,
    futureDraws: next.tilebag,
    canonical: { secret: next[rackKey] },
    session: { privateExchange: next[rackKey] },
  });
  Object.assign(next.players, { privateRack: next[rackKey] });
  Object.assign(next.scores, { privateBag: next.tilebag });
  return next;
}

for (const mode of ["normal", "friend", "ranked", "authur", "stage"]) {
  describe(`${mode} live information boundary`, () => {
    for (const viewer of ["A", "B"] as Side[]) {
      it(`does not distinguish different opponent past/current/future secrets for ${viewer}`, () => {
        const game = seated(
          mode === "stage" ? createSurvivalTestGame(17, "Player", A) : frozenLegalGame("long", 12),
        );
        const other = anotherHiddenWorld(game, viewer === "A" ? "B" : "A");
        const project = (state: GameState) =>
          mode === "ranked"
            ? rankedPublicView(id, 12, state, viewer === "A" ? A : B)
            : projectLiveGame(id, 12, state, viewer, mode);
        expect(project(other)).toEqual(project(game));
        const view = project(game);
        expect(view.yourRack).toEqual(
          (viewer === "A" ? game.rackA : game.rackB).map(({ id, token }) => ({ id, token })),
        );
        for (const log of view.logs.filter((log) => log.side !== viewer)) {
          expect(Object.keys(log).sort()).toEqual(
            [
              "action",
              "boardAfter",
              "exchangedCount",
              "id",
              "score",
              "side",
              "turnNumber",
              ...(mode === "ranked" ? [] : ["boardBefore", "note", "stars"]),
            ].sort(),
          );
        }
        expect(JSON.stringify(view)).not.toMatch(
          /tilebagBefore|tilebagAfter|incomingTiles|outgoingTiles|privateSeed|canonical|futureDraws|pendingExchangeReturn|historyIndex/,
        );
      });
    }
    it("gives spectators neither rack nor any hidden history", () => {
      const game = seated(frozenLegalGame("long", 12));
      const other = anotherHiddenWorld(anotherHiddenWorld(game, "A"), "B");
      const project = (state: GameState) =>
        mode === "ranked"
          ? rankedPublicView(id, 12, state, "spectator")
          : projectLiveGame(id, 12, state, null, mode);
      expect(project(other)).toEqual(project(game));
      expect(project(game).yourRack).toEqual([]);
      expect(
        project(game).logs.every((log) => !("rackBefore" in log) && !("rackAfter" in log)),
      ).toBe(true);
    });
  });
}

function memoryStore(initial: GameState, failure = false) {
  let source: LiveSource = {
    id,
    ownerId: A,
    seats: { A, B },
    revision: 3,
    mode: "friend",
    purpose: "normal",
    authorityProtocol: "server-v1",
    state: encodeGame(seated(initial)),
  };
  const committed = vi.fn(async () => false);
  const commit = vi.fn(async (_source, _actor, _command, _side, _action, game: GameState) => {
    if (failure) throw new Error("secret storage failure");
    source = { ...source, state: encodeGame(game), revision: game.revision! };
    return true;
  });
  const store: LiveStore = {
    authenticate: async (token) => ([A, B, "spectator"].includes(token) ? token : null),
    read: async () => source,
    committed,
    commit,
  };
  return { store, commit, committed, source: () => source };
}
const request = (actor: string, body: Record<string, unknown>) => ({
  authorization: `Bearer ${actor}`,
  body: { id, ...body },
});

describe("authoritative typed live actions", () => {
  it("authenticates, ignores forged seats/full state and preserves private history", async () => {
    const { store, commit, source } = memoryStore(legalPassGame(0));
    expect((await handleLiveGame(request("bad", { operation: "read" }), store)).status).toBe(401);
    expect(
      (
        await handleLiveGame(
          request("spectator", {
            operation: "action",
            revision: 3,
            commandId,
            action: { kind: "pass" },
          }),
          store,
        )
      ).status,
    ).toBe(403);
    const result = await handleLiveGame(
      request(A, {
        operation: "action",
        revision: 3,
        commandId,
        side: "B",
        actorId: B,
        state: { rackA: [], rackB: [], status: "finished" },
        action: { kind: "pass" },
      }),
      store,
    );
    expect(result.status).toBe(200);
    expect(commit.mock.calls[0]![3]).toBe("A");
    const privateGame = decodeGame(source().state);
    expect(privateGame.status).toBe("playing");
    expect(privateGame.history).toHaveLength(2);
    expect(privateGame.history[0]!.rackB).toEqual(privateGame.rackB);
    expect(result.body.match!.yourSide).toBe("A");
    expect(result.body.match!.logs[0]!.rackBefore).toBeDefined();
    expect(
      (await handleLiveGame(request(B, { operation: "read" }), store)).body.match!.logs[0]!
        .rackBefore,
    ).toBeUndefined();
  });
  it("stale recovery, reload and a second tab all receive the same authorized projection", async () => {
    const { store, commit } = memoryStore(legalPassGame(2));
    const read = await handleLiveGame(
      request(A, { operation: "read", viewerId: B, side: "B" }),
      store,
    );
    const stale = await handleLiveGame(
      request(A, { operation: "action", revision: 2, commandId, action: { kind: "pass" } }),
      store,
    );
    expect(stale.status).toBe(409);
    expect(stale.body.match).toEqual(read.body.match);
    expect((await handleLiveGame(request(A, { operation: "read" }), store)).body).toEqual(
      read.body,
    );
    expect(commit).not.toHaveBeenCalled();
  });
  it("deduplicates before reducing, and refuses unavailable physical IDs without echoing secrets", async () => {
    const { store, commit, committed } = memoryStore(legalPassGame(0));
    committed.mockResolvedValueOnce(true);
    expect(
      (
        await handleLiveGame(
          request(A, {
            operation: "action",
            revision: 2,
            commandId,
            action: { kind: "exchange", tileIds: ["hidden-tile"] },
          }),
          store,
        )
      ).status,
    ).toBe(200);
    expect(commit).not.toHaveBeenCalled();
    const refused = await handleLiveGame(
      request(A, {
        operation: "action",
        revision: 3,
        commandId,
        action: { kind: "exchange", tileIds: ["hidden-tile"] },
      }),
      store,
    );
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused)).not.toContain("hidden-tile");
    expect(commit).not.toHaveBeenCalled();
  });
  it("does not release completion when persistence fails", async () => {
    const { store, source } = memoryStore(legalPassGame(0), true);
    const result = await handleLiveGame(
      request(A, { operation: "action", revision: 3, commandId, action: { kind: "resign" } }),
      store,
    );
    expect(result.status).toBe(400);
    expect(result.body.match).toBeUndefined();
    expect(decodeGame(source().state).status).toBe("playing");
    expect(JSON.stringify(result)).not.toContain("secret storage failure");
  });
  it("preserves Stage's seeded score floor and untimed clock", () => {
    const stage = createSurvivalTestGame(17, "Player", A);
    const next = applyRankedAction(stage, "A", { kind: "pass" }, "2099-01-01T00:00:00Z", "normal");
    expect(next.status).toBe("playing");
    expect(next.scores).toEqual(stage.scores);
    expect(next.timers.A).toBe(stage.timers.A);
  });
});

describe("completed Replay lifecycle and full rack fidelity", () => {
  it.each(["compact", "legacy"])(
    "keeps every historical rack and exact public history (%s)",
    async (format) => {
      const game = finishedLegalPassGame(3);
      const compact = await buildCompletedGameRecord(game, undefined, {
        mode: "standard",
        completionAuthority: "server-reduced",
      });
      const restored = await readCompletedGameRecord(compact);
      expect(restored.game.history.map((s) => [s.rackA, s.rackB])).toEqual(
        game.history.map((s) => [s.rackA, s.rackB]),
      );
      const candidate = {
        scope: "public" as const,
        gameId: id,
        name: "Completed",
        ownerId: A,
        finishedAt: game.lastSavedAt,
        snapshot: format === "compact" ? compact : encodeGame(game),
      };
      const viewer = { userId: A, regionIds: [], approved: true, admin: false };
      expect(await projectFirstAuthorizedArchive([candidate], viewer, { live: true })).toBeNull();
      const result = await projectFirstAuthorizedArchive([candidate], viewer, { live: false });
      expect(result!.replay.positions.map((s) => s.racks)).toEqual(
        game.history.map((s) => ({
          A: s.rackA.map(displayToken).sort(),
          B: s.rackB.map(displayToken).sort(),
        })),
      );
      expect(result!.replay.finalScores).toEqual(game.scores);
      expect(result!.replay.turns.map((s) => s.score)).toEqual(game.logs.map((s) => s.finalScore));
    },
  );
  it("allows genuinely public placed tiles without revealing their private inventory references", () => {
    const game = seated(legalEquationGame());
    const view = projectLiveGame(id, 1, game, "B", "friend");
    expect(view.board[7]![5]!.tile.token).toBe("1");
    expect(view.board[7]![5]!.tile.id).toBe("board:7:5");
    expect(view.logs[0]!.rackBefore).toBeUndefined();
  });
  it("measures legal early/middle/late body sizes only as a secondary observation", () => {
    const results = [0, 12, 30].map((turns) => {
      const game = seated(frozenLegalGame("long", turns));
      return {
        turns,
        legacyBytes: new TextEncoder().encode(JSON.stringify(encodeGame(game))).length,
        liveABytes: new TextEncoder().encode(
          JSON.stringify(projectLiveGame(id, turns, game, "A", "friend")),
        ).length,
      };
    });
    console.info("LIVE_PROJECTION_BODY_BYTES", JSON.stringify(results));
    // Capability metadata is allowed to exceed the compact early-game state.
    // Size is an observation, not a security or compatibility release gate.
    expect(results.every((r) => r.liveABytes > 0 && r.legacyBytes > 0)).toBe(true);
  });
});
