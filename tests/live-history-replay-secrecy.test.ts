import { describe, expect, it } from "vitest";
import { decodeGame, encodeGame } from "../src/codec";
import {
  createInitialTilebag,
  createNewGame,
  makeSnapshot,
  type GameState,
  type Side,
} from "../src/game";
import { resolveLiveCapabilities, type LiveAuthorityFacts } from "../src/liveGame/capabilities";
import { createSurvivalTestGame } from "../src/features/survival/seededGame";
import {
  handleLiveGame,
  type LiveSource,
  type LiveStore,
} from "../supabase/functions/live-game/handler";

// Undo/redo/continue restore stored positions, ordered bag included. Where that
// replay could reveal another party's hidden tiles or future draws, the control
// must be refused before anything is committed.
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VICTIM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PLAYER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type Setup = {
  mode: string;
  purpose?: string;
  emailPlayMode?: "hosted" | "direct";
  tileDrawMode?: "play" | "manual";
  seats: Partial<Record<Side, string>>;
  bot?: { side: Side; engine: "authur" | "stage5b"; difficulty: string };
};

/** App draws get a real CSPRNG deal: both racks dealt, the rest a hidden ordered queue. */
function dealt(setup: Setup): GameState {
  const tileDrawMode = setup.tileDrawMode ?? "play";
  const game = createNewGame({
    name: "Replay secrecy",
    playerA: "A",
    playerB: "B",
    startingSide: "A",
    tileDrawMode,
    untimed: true,
  });
  if (tileDrawMode === "play") {
    const bag = createInitialTilebag({ shuffleForPlay: true });
    game.rackA = bag.slice(0, 8);
    game.rackB = bag.slice(8, 16);
    game.tilebag = bag.slice(16);
  }
  game.emailPlayMode = setup.emailPlayMode;
  game.tileDrawMode = tileDrawMode;
  game.playerUserIds = setup.seats;
  if (setup.bot) {
    game.botSide = setup.bot.side;
    game.botEngine = setup.bot.engine;
    game.botDifficulty = setup.bot.difficulty;
  }
  game.history = [makeSnapshot(game)];
  game.historyIndex = 0;
  return game;
}

function liveRoom(setup: Setup, game = dealt(setup)) {
  let source: LiveSource = {
    id: ID,
    ownerId: OWNER,
    seats: setup.seats,
    revision: 1,
    mode: setup.mode,
    purpose: setup.purpose ?? "normal",
    authorityProtocol: "server-v1",
    state: encodeGame(game),
    timeline: { version: 0, lines: [] },
  };
  const store: LiveStore = {
    authenticate: async (token) => ([OWNER, VICTIM, PLAYER].includes(token) ? token : null),
    read: async () => source,
    committed: async () => false,
    commit: async (_source, _actor, _command, _side, _action, next, timeline) => {
      source = {
        ...source,
        state: encodeGame(next),
        revision: next.revision!,
        ...(timeline ? { timeline } : {}),
      };
      return true;
    },
  };
  let counter = 0;
  const send = (actor: string, body: Record<string, unknown>, trustedBot = false) =>
    handleLiveGame(
      {
        authorization: `Bearer ${actor}`,
        body: {
          id: ID,
          revision: source.revision,
          commandId: `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
          ...body,
        },
      },
      store,
      trustedBot,
    );
  const ok = async (actor: string, body: Record<string, unknown>, trustedBot = false) => {
    const reply = await send(actor, body, trustedBot);
    expect(reply.status, JSON.stringify(reply.body)).toBe(200);
    return reply.body.match!;
  };
  return { send, ok, source: () => source, state: () => decodeGame(source.state) };
}

type Room = ReturnType<typeof liveRoom>;

/** Every history control the exploit could use, aimed at a real node. */
async function expectHistoryRefused(room: Room, actor: string) {
  const before = room.source();
  const nodeId = room.state().logs[0]?.id ?? null;
  for (const action of [
    { kind: "continue", target: { nodeId, phase: "before" } },
    { kind: "undo" },
    { kind: "redo" },
    { kind: "prune", lineId: "parked-line" },
    { kind: "annotate", logId: nodeId, note: "probe", stars: 1 },
  ]) {
    const reply = await room.send(actor, { operation: "control", action });
    expect(reply.status, `${actor} ${action.kind}`).toBe(403);
    expect(JSON.stringify(reply.body)).not.toMatch(/tilebag|rackA|rackB|canonical/);
  }
  expect(room.source(), "a refused control must not commit").toBe(before);
}

function expectNoTilesOf(view: unknown, tiles: { id: string }[]) {
  const text = JSON.stringify(view);
  for (const tile of tiles) expect(text).not.toContain(`"id":"${tile.id}"`);
}

/** Original line: A passes, then B swaps its whole rack for unseen draws. */
async function opponentDrawsHiddenTiles(room: Room, playerA: string, playerB: string) {
  await room.ok(playerA, { operation: "action", action: { kind: "pass" } });
  const b = await room.ok(playerB, { operation: "read" });
  await room.ok(playerB, {
    operation: "action",
    action: { kind: "exchange", tileIds: b.yourRack.map((tile) => tile.id) },
  });
  return room.state().rackB;
}

describe("app-drawn Hosted history cannot replay the ordered bag", () => {
  it("A: a seated Hosted owner cannot rewind and redraw to reconstruct the opponent's rack", async () => {
    const room = liveRoom({
      mode: "hosted_versus",
      emailPlayMode: "hosted",
      tileDrawMode: "play",
      seats: { A: OWNER, B: VICTIM },
    });
    const start = await room.ok(OWNER, { operation: "read" });
    expect(start.yourSide).toBe("A");
    expect([start.canEditHistory, start.canUndo, start.canRedo]).toEqual([false, false, false]);
    const victimRack = await opponentDrawsHiddenTiles(room, OWNER, VICTIM);
    await expectHistoryRefused(room, OWNER);
    expectNoTilesOf(await room.ok(OWNER, { operation: "read" }), victimRack);
  });

  it("B: an unseated Hosted host cannot rewind for a player", async () => {
    const room = liveRoom({
      mode: "hosted_versus",
      emailPlayMode: "hosted",
      tileDrawMode: "play",
      seats: { A: PLAYER, B: VICTIM },
    });
    const host = await room.ok(OWNER, { operation: "read" });
    expect([host.yourSide, host.canEditHistory, host.hostRacks]).toEqual([null, false, undefined]);
    expect(host.canAdminister).toBe(true);
    const victimRack = await opponentDrawsHiddenTiles(room, PLAYER, VICTIM);
    await expectHistoryRefused(room, OWNER);
    expectNoTilesOf(await room.ok(OWNER, { operation: "read" }), victimRack);
  });

  it("C: an ordinary player cannot obtain the opponent's rack through history controls", async () => {
    const room = liveRoom({
      mode: "hosted_versus",
      emailPlayMode: "hosted",
      tileDrawMode: "play",
      seats: { A: PLAYER, B: VICTIM },
    });
    const victimRack = await opponentDrawsHiddenTiles(room, PLAYER, VICTIM);
    for (const actor of [PLAYER, VICTIM]) await expectHistoryRefused(room, actor);
    const playerView = await room.ok(PLAYER, { operation: "read" });
    expect(playerView.rackCount.B).toBe(8);
    expectNoTilesOf(playerView, victimRack);
    expect(playerView.logs.filter((log) => log.side === "B").every((log) => !log.rackAfter)).toBe(
      true,
    );
    expectNoTilesOf(await room.ok(VICTIM, { operation: "read" }), room.state().rackA);
  });

  it("D: future authoritative draws cannot be learned by redrawing after a rewind", async () => {
    const room = liveRoom({
      mode: "hosted_versus",
      emailPlayMode: "hosted",
      tileDrawMode: "play",
      seats: { A: PLAYER, B: VICTIM },
    });
    const a = await room.ok(PLAYER, { operation: "read" });
    await room.ok(PLAYER, {
      operation: "action",
      action: { kind: "exchange", tileIds: a.yourRack.map((tile) => tile.id) },
    });
    const queue = room.state().tilebag.map((tile) => tile.id);
    for (const actor of [OWNER, PLAYER, VICTIM]) await expectHistoryRefused(room, actor);
    // The ordered queue was never restored, so nobody can draw it a second time.
    expect(room.state().tilebag.map((tile) => tile.id)).toEqual(queue);
    expect(room.state().historyIndex).toBe(1);
    for (const actor of [OWNER, PLAYER, VICTIM])
      expect(JSON.stringify(await room.ok(actor, { operation: "read" }))).not.toMatch(
        /"(tilebag|tilebagBefore|tilebagAfter|history|seed)":/,
      );
  });

  it("E: Direct remains without history editing for every role", async () => {
    const room = liveRoom({
      mode: "online_versus",
      emailPlayMode: "direct",
      tileDrawMode: "play",
      seats: { A: OWNER, B: VICTIM },
    });
    expect((await room.ok(OWNER, { operation: "read" })).canEditHistory).toBe(false);
    const victimRack = await opponentDrawsHiddenTiles(room, OWNER, VICTIM);
    for (const actor of [OWNER, VICTIM]) await expectHistoryRefused(room, actor);
    expectNoTilesOf(await room.ok(OWNER, { operation: "read" }), victimRack);
  });
});

describe("history workflows that remain authorized", () => {
  it("F: Physical Hosted manual draws keep record, undo/redo, notes and branches", async () => {
    const room = liveRoom({
      mode: "hosted_versus",
      emailPlayMode: "hosted",
      tileDrawMode: "manual",
      seats: { A: PLAYER, B: VICTIM },
    });
    expect((await room.ok(OWNER, { operation: "read" })).canEditHistory).toBe(true);
    let view = await room.ok(OWNER, { operation: "read" });
    for (const side of ["A", "B"])
      view = await room.ok(OWNER, {
        operation: "physical",
        action: { kind: "refill", side, tokens: ["1", "+", "2", "=", "3", "4", "5", "6"] },
      });
    const racks = view.hostRacks!;
    const ids = ["1", "+", "2", "=", "3"].map(
      (token) => racks.A.find((tile) => tile.token === token)!.id,
    );
    view = await room.ok(OWNER, {
      operation: "admin",
      action: {
        kind: "record",
        side: "A",
        move: {
          kind: "place",
          placements: ids.map((tileId, index) => ({ tileId, row: 7, col: 5 + index })),
        },
      },
    });
    expect(view.board[7]![5]).not.toBeNull();
    view = await room.ok(OWNER, {
      operation: "physical",
      action: { kind: "refill", side: "A", tokens: ["0", "7", "8", "9", "10"] },
    });
    const refilled = view.hostRacks;
    const logId = view.logs[0]!.id;
    view = await room.ok(OWNER, { operation: "control", action: { kind: "undo" } });
    expect(view.hostRacks!.A).toHaveLength(3);
    view = await room.ok(OWNER, { operation: "control", action: { kind: "undo" } });
    expect(view.logs).toHaveLength(0);
    expect(view.hostRacks).toEqual(racks);
    expect(view.canRedo).toBe(true);
    view = await room.ok(OWNER, { operation: "control", action: { kind: "redo" } });
    view = await room.ok(OWNER, { operation: "control", action: { kind: "redo" } });
    expect(view.hostRacks).toEqual(refilled);
    view = await room.ok(OWNER, {
      operation: "control",
      action: { kind: "annotate", logId, note: "Public review", stars: 4 },
    });
    expect(view.logs[0]!.note).toBe("Public review");
    view = await room.ok(OWNER, {
      operation: "control",
      action: { kind: "continue", target: { nodeId: logId, phase: "before" } },
    });
    expect(view.logs).toHaveLength(0);
    expect(view.timeline!.lines).toHaveLength(1);
    view = await room.ok(OWNER, {
      operation: "control",
      action: { kind: "continue", target: { nodeId: logId, phase: "after" } },
    });
    expect(view.logs[0]!.stars).toBe(4);
    view = await room.ok(OWNER, {
      operation: "control",
      action: { kind: "continue", target: { nodeId: logId, phase: "before" } },
    });
    view = await room.ok(OWNER, {
      operation: "control",
      action: { kind: "prune", lineId: view.timeline!.lines[0]!.id },
    });
    expect(view.timeline!.lines).toHaveLength(0);
    // Players keep only their own rack; the host role alone sees both current racks.
    for (const actor of [PLAYER, VICTIM]) {
      const seat = await room.ok(actor, { operation: "read" });
      expect(seat.hostRacks).toBeUndefined();
      expect(seat.canEditHistory).toBe(false);
      expect(
        (await room.send(actor, { operation: "control", action: { kind: "undo" } })).status,
      ).toBe(403);
    }
  });

  it("G: each supported mode keeps exactly its intended history capability", () => {
    const cases: Array<[string, Setup, boolean, GameState?]> = [
      [
        "Direct online",
        { mode: "online_versus", emailPlayMode: "direct", seats: { A: OWNER, B: VICTIM } },
        false,
      ],
      [
        "Hosted app draws",
        { mode: "hosted_versus", emailPlayMode: "hosted", seats: { A: PLAYER, B: VICTIM } },
        false,
      ],
      [
        "Hosted Solo app draws",
        { mode: "hosted_versus", emailPlayMode: "hosted", seats: { A: PLAYER } },
        false,
      ],
      [
        "Physical Hosted manual",
        {
          mode: "hosted_versus",
          emailPlayMode: "hosted",
          tileDrawMode: "manual",
          seats: { A: PLAYER, B: VICTIM },
        },
        true,
      ],
      ["Pass & Play", { mode: "local_versus", seats: { A: OWNER, B: OWNER } }, true],
      ["Solo practice", { mode: "solo_practice", seats: { A: OWNER } }, true],
      [
        "ArchBot practice",
        {
          mode: "stage5b_standard",
          seats: { A: OWNER },
          bot: { side: "B", engine: "stage5b", difficulty: "stage5b64" },
        },
        true,
      ],
      [
        "Authur",
        {
          mode: "authur_strong",
          emailPlayMode: "direct",
          seats: { A: OWNER },
          bot: { side: "B", engine: "authur", difficulty: "super" },
        },
        false,
      ],
      [
        "Stage endgame (Authur, empty bag)",
        { mode: "stage", purpose: "stage", seats: { A: OWNER } },
        true,
        createSurvivalTestGame(11, "Player", OWNER),
      ],
    ];
    for (const [label, setup, expected, game] of cases) {
      const state = game ?? dealt(setup);
      const facts: LiveAuthorityFacts = {
        ownerId: OWNER,
        seats: setup.seats,
        mode: setup.mode,
        purpose: setup.purpose ?? "normal",
        authorityProtocol: "server-v1",
        revision: 1,
      };
      expect(resolveLiveCapabilities(facts, state, OWNER).editHistory, label).toBe(expected);
      for (const other of [PLAYER, VICTIM])
        if (other !== OWNER)
          expect(resolveLiveCapabilities(facts, state, other).editHistory, label).toBe(false);
      expect(resolveLiveCapabilities(facts, state, OWNER, undefined, true).editHistory).toBe(false);
    }
  });
});

describe("Authur history cannot replay Authur's hidden tiles or the bag", () => {
  it("the human cannot rewind past Authur's hidden draw to reconstruct its rack", async () => {
    const room = liveRoom({
      mode: "authur_strong",
      emailPlayMode: "direct",
      seats: { A: OWNER },
      bot: { side: "B", engine: "authur", difficulty: "super" },
    });
    expect((await room.ok(OWNER, { operation: "read" })).canEditHistory).toBe(false);
    await room.ok(OWNER, { operation: "action", action: { kind: "pass" } });
    // The trusted worker's callback acts for Authur's seat on the owner's behalf.
    await room.ok(
      OWNER,
      {
        operation: "action",
        action: { kind: "exchange", tileIds: room.state().rackB.map((tile) => tile.id) },
      },
      true,
    );
    const authurRack = room.state().rackB;
    const queue = room.state().tilebag.map((tile) => tile.id);
    await expectHistoryRefused(room, OWNER);
    expect(room.state().tilebag.map((tile) => tile.id)).toEqual(queue);
    expectNoTilesOf(await room.ok(OWNER, { operation: "read" }), authurRack);
  });

  it("Stage keeps its history tools because its endgame bag is empty and every tile is countable", async () => {
    const game = createSurvivalTestGame(11, "Player", OWNER);
    const room = liveRoom({ mode: "stage", purpose: "stage", seats: { A: OWNER } }, game);
    const view = await room.ok(OWNER, { operation: "read" });
    expect(view.canEditHistory).toBe(true);
    expect(view.tilebagCount).toBe(0);
    // Public inference alone: the full set minus the board and the player's rack.
    const unseen = createInitialTilebag().map((tile) => tile.token);
    const remove = (token: string) => unseen.splice(unseen.indexOf(token), 1);
    for (const row of view.board) for (const cell of row) if (cell) remove(cell.tile.token);
    for (const tile of view.yourRack) remove(tile.token);
    expect(unseen.sort()).toEqual(
      room
        .state()
        .rackB.map((tile) => tile.token)
        .sort(),
    );
    await room.ok(OWNER, { operation: "action", action: { kind: "pass" } });
    const undone = await room.ok(OWNER, { operation: "control", action: { kind: "undo" } });
    expect(undone.logs).toHaveLength(0);
  });

  it("ArchBot keeps its practice history exception", async () => {
    const room = liveRoom({
      mode: "stage5b_standard",
      seats: { A: OWNER },
      bot: { side: "B", engine: "stage5b", difficulty: "stage5b64" },
    });
    expect((await room.ok(OWNER, { operation: "read" })).canEditHistory).toBe(true);
    await room.ok(OWNER, { operation: "action", action: { kind: "pass" } });
    const undone = await room.ok(OWNER, { operation: "control", action: { kind: "undo" } });
    expect(undone.logs).toHaveLength(0);
  });
});
