import { describe, expect, it } from "vitest";
import { decodeGame, encodeGame } from "../src/codec";
import { type GameState } from "../src/game";
import {
  handleLiveGame,
  type LiveSource,
  type LiveStore,
} from "../supabase/functions/live-game/handler";
import { frozenLegalGame } from "./helpers/completedCorpus";

function fixture(overrides: Partial<GameState> = {}, protocol = "server-v1") {
  let source: LiveSource = {
    id: "room",
    ownerId: "host",
    seats: { A: "a", B: "b" },
    revision: 5,
    mode: "hosted_versus",
    purpose: "normal",
    authorityProtocol: protocol,
    state: encodeGame({
      ...frozenLegalGame("long", 2),
      emailPlayMode: "hosted",
      roomStage: "playing",
      playerUserIds: { A: "a", B: "b" },
      status: "playing",
      ...overrides,
    }),
  };
  const commits = new Set<string>();
  const store: LiveStore = {
    authenticate: async (token) => token,
    read: async () => source,
    committed: async (_id, cmd) => commits.has(cmd),
    commit: async (_source, _actor, cmd, side, _action, game) => {
      expect(side).toBe("host");
      commits.add(cmd);
      source = { ...source, revision: game.revision!, state: encodeGame(game) };
      return true;
    },
  };
  const call = (
    actor: string,
    action?: unknown,
    revision = source.revision,
    commandId = crypto.randomUUID(),
  ) =>
    handleLiveGame(
      {
        authorization: `Bearer ${actor}`,
        body: { operation: action ? "admin" : "read", id: "room", action, revision, commandId },
      },
      store,
    );
  return { call, game: () => decodeGame(source.state), revision: () => source.revision };
}

describe("public Hosted administration", () => {
  it("lets the tournament owner pause, correct a public score, resume and finish without receiving either rack", async () => {
    const f = fixture();
    const original = f.game();
    const paused = await f.call("host", { kind: "pause" });
    expect(paused.status).toBe(200);
    expect(paused.body.match?.paused).toBe(true);
    expect(paused.body.match?.canAdminister).toBe(true);
    expect(paused.body.match?.yourRack).toEqual([]);
    const log = original.logs[0]!;
    const correction = { kind: "correct-score", logId: log.id, score: log.finalScore + 7 };
    const command = crypto.randomUUID(),
      revision = f.revision();
    expect((await f.call("host", correction, revision, command)).status).toBe(200);
    const correctedRevision = f.revision();
    expect((await f.call("host", correction, revision, command)).status).toBe(200);
    expect(f.revision()).toBe(correctedRevision);
    expect(f.game().scores[log.side]).toBe(original.scores[log.side] + 7);
    expect(f.game().rackA).toEqual(original.rackA);
    expect(f.game().rackB).toEqual(original.rackB);
    expect(f.game().tilebag).toEqual(original.tilebag);
    expect((await f.call("host", { kind: "resume" })).body.match?.paused).toBe(false);
    const result = await f.call("host", { kind: "finish" });
    expect(result.status).toBe(200);
    expect(f.game().status).toBe("finished");
    expect(JSON.stringify(result.body)).not.toMatch(
      /"(?:rackA|rackB|tilebag|canonical|history|rackBefore|rackAfter)"\s*:/,
    );
  });
  for (const actor of ["a", "b", "spectator"])
    it(`denies host powers to ${actor}`, async () => {
      const f = fixture();
      expect((await f.call(actor, { kind: "finish" })).status).toBe(403);
      expect(f.revision()).toBe(5);
    });
  for (const settings of [
    { emailPlayMode: "direct" as const },
    { botSide: "B" as const, botEngine: "authur" as const },
  ])
    it("never turns direct ownership or a bot opponent into tournament authority", async () => {
      const f = fixture(settings);
      expect((await f.call("host", { kind: "pause" })).status).toBe(403);
    });
  it("refuses stale, hidden-state and unpaused score edits", async () => {
    const f = fixture();
    expect((await f.call("host", { kind: "pause" }, 4)).status).toBe(409);
    expect(
      (await f.call("host", { kind: "correct-score", logId: f.game().logs[0]!.id, score: 7 }))
        .status,
    ).toBe(400);
    expect((await f.call("host", { kind: "rack-edit", rackB: [] })).status).toBe(400);
    expect((await f.call("host", { kind: "draw", token: "20" })).status).toBe(400);
    expect(f.revision()).toBe(5);
  });
  it("explicitly freezes legacy continuation while preserving authorized projections", async () => {
    const f = fixture({}, "legacy-client");
    const read = await f.call("host");
    expect(read.body.match?.continuationBlocked).toBe(true);
    expect(read.body.match?.yourRack).toEqual([]);
    expect(read.body.match?.canAdminister).toBe(false);
    expect((await f.call("host", { kind: "finish" })).status).toBe(409);
    expect(f.revision()).toBe(5);
  });
});
