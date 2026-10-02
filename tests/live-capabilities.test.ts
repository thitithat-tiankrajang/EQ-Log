import { describe, expect, it } from "vitest";
import { createNewGame, makeSnapshot, type GameState } from "../src/game";
import { resolveLiveCapabilities, type LiveAuthorityFacts } from "../src/liveGame/capabilities";
import { projectLiveGame } from "../src/liveGame/projection";
import { applyPhysicalAction } from "../src/liveGame/physical";
import { applyRankedAction } from "../src/features/ranked/rules";
import { encodeGame, decodeGame } from "../src/codec";
import { handleLiveGame, type LiveSource } from "../supabase/functions/live-game/handler";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  H = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
function physical() {
  let game = createNewGame({
    name: "Physical",
    gameMode: "versus",
    playerA: "A",
    playerB: "B",
    playerAUserId: A,
    playerBUserId: B,
    emailPlayMode: "hosted",
    tileDrawMode: "manual",
    startingSide: "A",
    untimed: true,
  });
  game = applyPhysicalAction(game, {
    kind: "refill",
    side: "A",
    tokens: ["1", "2", "+", "=", "3", "4", "5", "6"],
  });
  game = applyPhysicalAction(game, {
    kind: "refill",
    side: "B",
    tokens: ["1", "2", "+", "=", "3", "4", "5", "6"],
  });
  return game;
}
const facts = (ownerId = H): LiveAuthorityFacts => ({
  ownerId,
  seats: { A, B },
  revision: 7,
  mode: "hosted_versus",
  purpose: "normal",
  authorityProtocol: "server-v1",
});
const view = (game: GameState, actor: string, owner = H) => {
  const caps = resolveLiveCapabilities(facts(owner), game, actor);
  return projectLiveGame("room", 7, game, caps.side, "hosted_versus", caps.administer, false, caps);
};
describe("additive Physical Host capability", () => {
  it.each([
    [A, H, "A"],
    [B, H, "B"],
  ] as const)("ordinary seat %s has only its own rack", (actor, owner, side) => {
    const game = physical(),
      projected = view(game, actor, owner);
    expect(projected.hostRacks).toBeUndefined();
    expect(projected.yourSide).toBe(side);
    expect(projected.yourRack).toEqual(game[side === "A" ? "rackA" : "rackB"]);
    expect(
      projected.logs
        .filter((log) => log.side !== side)
        .every((log) => !log.rackBefore && !log.rackAfter),
    ).toBe(true);
  });
  it.each([
    [H, H],
    [A, A],
    [B, B],
  ])("Host %s retains both current racks when owner %s", (actor, owner) => {
    const game = physical(),
      projected = view(game, actor, owner);
    expect(projected.hostRacks).toEqual({ A: game.rackA, B: game.rackB });
    expect(projected.canAdminister).toBe(true);
    expect(JSON.stringify(projected)).not.toMatch(
      /"(?:tilebag|canonical|history|seed|rngStep|futureDraws)"\s*:/,
    );
  });
  it("current-rack Host authority reveals no additional historical, ordered-bag or predictive state", () => {
    const game = physical(),
      changed = structuredClone(game);
    changed.tilebag.reverse();
    changed.history = [{ ...makeSnapshot(game), rackB: game.rackA }];
    Object.assign(changed, {
      seed: 123,
      futureDraws: changed.tilebag,
      canonical: { private: "secret" },
    });
    expect(view(changed, H)).toEqual(view(game, H));
    expect(view(game, "outsider").hostRacks).toBeUndefined();
    expect(view({ ...game, tileDrawMode: "play" }, H).hostRacks).toBeUndefined();
    expect(
      resolveLiveCapabilities({ ...facts(), authorityProtocol: "legacy-client" }, game, H)
        .physicalHost,
    ).toBe(false);
  });
  it("forged client role claims cannot read or invoke Physical Host authority", async () => {
    const source: LiveSource = { id: "room", ...facts(), state: encodeGame(physical()) };
    const store = {
      authenticate: async () => A,
      read: async () => source,
      committed: async () => false,
      commit: async () => {
        throw new Error("Unauthorized command reached commit");
      },
    };
    const read = await handleLiveGame(
      {
        authorization: "Bearer token",
        body: { operation: "read", id: "room", host: true, role: "host", ownerId: A },
      },
      store,
    );
    expect(read.body.match!.hostRacks).toBeUndefined();
    const refused = await handleLiveGame(
      {
        authorization: "Bearer token",
        body: {
          operation: "physical",
          id: "room",
          commandId: crypto.randomUUID(),
          revision: 7,
          host: true,
          action: { kind: "refill", side: "B", tokens: ["1"] },
        },
      },
      store,
    );
    expect(refused.status).toBe(403);
  });
  it("manual exchange waits for recorded refill and returns outgoing tiles only after replacement", () => {
    const game = physical(),
      outgoing = game.rackA[0];
    const exchanged = applyRankedAction(
      game,
      "A",
      { kind: "exchange", tileIds: [outgoing.id] },
      new Date().toISOString(),
      "normal",
    );
    expect(exchanged.activeSide).toBe("A");
    expect(exchanged.phase).toBe("refill");
    expect(exchanged.tilebag.some((t) => t.id === outgoing.id)).toBe(false);
    const filled = applyPhysicalAction(exchanged, { kind: "refill", side: "A", tokens: ["8"] });
    expect(filled.activeSide).toBe("B");
    expect(filled.tilebag.some((t) => t.id === outgoing.id)).toBe(true);
    expect(filled.pendingExchangeReturn).toEqual([]);
    expect(decodeGame(encodeGame(filled)).rackA).toHaveLength(8);
    expect(filled.logs[0].rackAfter).toHaveLength(8);
  });
});
describe("local handoff is distinct from online seats", () => {
  it("requires owner, active side, matching revision and rotating stored claim", () => {
    const game = { ...physical(), emailPlayMode: undefined, tileDrawMode: "play" as const };
    const local = {
      ...facts(A),
      mode: "local_versus",
      localClaim: { token: "private-claim", side: "B" as const, revision: 7 },
    };
    expect(resolveLiveCapabilities(local, game, A).side).toBeNull();
    expect(resolveLiveCapabilities(local, game, A, "private-claim").side).toBeNull();
    const next = { ...game, activeSide: "B" as const };
    expect(resolveLiveCapabilities(local, next, A, "private-claim").side).toBe("B");
    expect(
      resolveLiveCapabilities({ ...local, revision: 8 }, next, A, "private-claim").side,
    ).toBeNull();
    expect(resolveLiveCapabilities(local, next, B, "private-claim").side).toBeNull();
    expect(
      resolveLiveCapabilities({ ...local, mode: "online_versus" }, next, A, "private-claim").side,
    ).toBe("A");
  });
});
