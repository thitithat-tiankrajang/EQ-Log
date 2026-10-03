import { describe, expect, it } from "vitest";
import { createFixtureSession } from "../src/liveGame/shell/dev/ShellFixture";
import {
  createRateLimiter,
  createSequence,
  parseTentativeProposal,
  receiveTentative,
  tentativeSyncAllowed,
  validateTentative,
  visibleTentative,
  type TentativeFacts,
  type TentativeMessage,
  type TentativeProposal,
} from "../src/liveGame/tentative";
import { handleTentativeRelay, type TentativeStore } from "../supabase/functions/live-game/handler";
import { encodeGame } from "../src/codec";
import { applyRankedAction } from "../src/features/ranked/rules";
import type { GameState } from "../src/game";

/**
 * Phase B trusted boundary, without a network: the validator and the relay
 * handler against real game states (the fixture's real reducers), and the
 * receiver's ordering reducer.
 */
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STRANGER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const GAME = "11111111-2222-4333-8444-555555555555";
const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
const facts = (revision = 10, extra: Partial<TentativeFacts> = {}): TentativeFacts => ({
  id: GAME,
  revision,
  mode: "online_versus",
  purpose: "normal",
  authorityProtocol: "server-v1",
  seats: { A, B },
  ...extra,
});
const seq = (offsetMs = 0) => (NOW + offsetMs) * 1000;
function active(): GameState {
  return createFixtureSession("active").game; // A to move: 7 5 + 2 0 14 × =
}
const proposal = (game: GameState, tiles: TentativeProposal["tiles"], revision = 10) => ({
  id: GAME,
  revision,
  seq: seq(),
  tiles,
});
const rackId = (game: GameState, token: string, side: "A" | "B" = "A") =>
  (side === "A" ? game.rackA : game.rackB).find((tile) => tile.token === token)!.id;

describe("capability: V1 only for Online Match", () => {
  it("is on for online_versus direct with two seats and off everywhere else", () => {
    const game = active();
    expect(tentativeSyncAllowed(facts(), game)).toBe(true);
    for (const mode of [
      "local_versus",
      "hosted_versus",
      "solo_practice",
      "authur_strong",
      "stage5b_standard",
      "stage",
    ])
      expect(tentativeSyncAllowed(facts(10, { mode }), game)).toBe(false);
    expect(tentativeSyncAllowed(facts(10, { purpose: "stage" }), game)).toBe(false);
    expect(tentativeSyncAllowed(facts(10, { authorityProtocol: "legacy" }), game)).toBe(false);
    expect(tentativeSyncAllowed(facts(), { ...game, botSide: "B" })).toBe(false);
    expect(tentativeSyncAllowed(facts(), { ...game, emailPlayMode: "hosted" })).toBe(false);
  });
});

describe("validator: the sender browser is untrusted", () => {
  const ok = (game: GameState, tiles: TentativeProposal["tiles"]) =>
    validateTentative(A, facts(), game, proposal(game, tiles), NOW);

  it("accepts the active seat's own tiles and builds the public message itself", () => {
    const game = active();
    const verdict = ok(game, [
      { tileId: rackId(game, "7"), row: 10, col: 3 },
      { tileId: rackId(game, "x"), row: 10, col: 4 },
    ]);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.recipient).toBe(B);
    expect(verdict.message).toEqual({
      gameId: GAME,
      revision: 10,
      seq: seq(),
      side: "A",
      tiles: [
        { row: 10, col: 3, kind: "7" },
        { row: 10, col: 4, kind: "x" },
      ],
    });
    // No tile ids, no rack, nothing else.
    expect(JSON.stringify(verdict.message)).not.toMatch(/tileId|rack|bag|tilebag|rng/i);
  });

  const cases: [string, (game: GameState) => ReturnType<typeof validateTentative>, number][] = [
    ["non-participant", (g) => validateTentative(STRANGER, facts(), g, proposal(g, []), NOW), 403],
    [
      "opponent's turn (wrong seat)",
      (g) => validateTentative(B, facts(), g, proposal(g, []), NOW),
      409,
    ],
    ["stale revision", (g) => validateTentative(A, facts(11), g, proposal(g, []), NOW), 409],
    ["old turn epoch", (g) => validateTentative(A, facts(10), g, proposal(g, [], 9), NOW), 409],
    [
      "future sequence",
      (g) => validateTentative(A, facts(), g, { ...proposal(g, []), seq: seq(5 * 60_000) }, NOW),
      400,
    ],
    [
      "ancient sequence",
      (g) => validateTentative(A, facts(), g, { ...proposal(g, []), seq: seq(-60 * 60_000) }, NOW),
      400,
    ],
    [
      "tile not in sender rack",
      (g) => ok(g, [{ tileId: rackId(g, g.rackB[0]!.token, "B"), row: 7, col: 7 }]),
      400,
    ],
    ["invented tile id", (g) => ok(g, [{ tileId: "n9_99", row: 7, col: 7 }]), 400],
    [
      "duplicate tile",
      (g) =>
        ok(g, [
          { tileId: rackId(g, "7"), row: 7, col: 7 },
          { tileId: rackId(g, "7"), row: 7, col: 8 },
        ]),
      400,
    ],
    [
      "two tiles on one square",
      (g) =>
        ok(g, [
          { tileId: rackId(g, "7"), row: 7, col: 7 },
          { tileId: rackId(g, "5"), row: 7, col: 7 },
        ]),
      400,
    ],
    ["illegal coordinate", (g) => ok(g, [{ tileId: rackId(g, "7"), row: 15, col: 0 }]), 400],
    [
      "occupied (committed) square",
      (g) => ok(g, [{ tileId: rackId(g, "7"), row: 7, col: 5 }]),
      400,
    ],
    [
      "face on a plain tile",
      (g) => ok(g, [{ tileId: rackId(g, "7"), row: 7, col: 7, face: "8" }]),
      400,
    ],
    [
      "mode without tentative sync",
      (g) => validateTentative(A, facts(10, { mode: "hosted_versus" }), g, proposal(g, []), NOW),
      403,
    ],
    [
      "paused game",
      (g) =>
        validateTentative(
          A,
          facts(),
          { ...g, timers: { ...g.timers, paused: true } },
          proposal(g, []),
          NOW,
        ),
      409,
    ],
    [
      "finished game",
      (g) => validateTentative(A, facts(), { ...g, status: "finished" }, proposal(g, []), NOW),
      409,
    ],
  ];
  for (const [name, attempt, status] of cases)
    it(`rejects: ${name}`, () => {
      const verdict = attempt(active());
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.status).toBe(status);
    });

  it("an alternative tile: unassigned shows only its kind; a chosen face must be legal", () => {
    const game = createFixtureSession("alternatives").game;
    const choice = game.rackA.find((tile) => tile.token === "+/-")!.id;
    const blank = game.rackA.find((tile) => tile.token === "?")!.id;
    const unassigned = ok(game, [{ tileId: choice, row: 9, col: 9 }]);
    expect(unassigned.ok && unassigned.message.tiles).toEqual([{ row: 9, col: 9, kind: "+/-" }]);
    const chosen = ok(game, [{ tileId: blank, row: 9, col: 9, face: "20" }]);
    expect(chosen.ok && chosen.message.tiles).toEqual([{ row: 9, col: 9, kind: "?", face: "20" }]);
    const illegal = ok(game, [{ tileId: choice, row: 9, col: 9, face: "×" }]);
    expect(illegal.ok).toBe(false);
  });

  it("after Commit, Pass or Exchange the old epoch is refused (revision and turn moved on)", () => {
    const game = active();
    const tile = rackId(game, "7");
    for (const action of [
      { kind: "pass" as const },
      { kind: "exchange" as const, tileIds: [game.rackA[0]!.id] },
    ]) {
      const next = applyRankedAction(game, "A", action, new Date(NOW).toISOString(), "normal");
      // The relay reads the NEW row: revision 11, B to move.
      const stale = validateTentative(
        A,
        facts(11),
        next,
        proposal(next, [{ tileId: tile, row: 7, col: 7 }], 10),
        NOW,
      );
      expect(stale.ok).toBe(false);
      const sameRevision = validateTentative(A, facts(11), next, proposal(next, [], 11), NOW);
      expect(sameRevision.ok).toBe(false); // not A's turn any more
    }
  });
});

describe("strict proposal shape", () => {
  const base = { operation: "tentative", id: GAME, revision: 3, seq: seq(), tiles: [] };
  it("rejects unknown/private fields, malformed and oversized input", () => {
    expect(parseTentativeProposal(base)).not.toBeNull();
    expect(parseTentativeProposal({ ...base, rack: ["7"] })).toBeNull();
    expect(parseTentativeProposal({ ...base, tilebag: [] })).toBeNull();
    expect(
      parseTentativeProposal({ ...base, tiles: [{ tileId: "n7_1", row: 1, col: 1, token: "7" }] }),
    ).toBeNull();
    expect(parseTentativeProposal({ ...base, id: "not-a-uuid" })).toBeNull();
    expect(parseTentativeProposal({ ...base, revision: -1 })).toBeNull();
    expect(parseTentativeProposal({ ...base, seq: 0 })).toBeNull();
    expect(
      parseTentativeProposal({ ...base, tiles: Array(9).fill({ tileId: "x", row: 0, col: 0 }) }),
    ).toBeNull();
    expect(
      parseTentativeProposal({ ...base, tiles: [{ tileId: "x", row: 1.5, col: 0 }] }),
    ).toBeNull();
    expect(parseTentativeProposal("tentative")).toBeNull();
    expect(parseTentativeProposal([base])).toBeNull();
  });
});

describe("relay handler (store-abstracted Edge logic)", () => {
  function store(game: GameState, revision = 10, overrides: Partial<TentativeStore> = {}) {
    const sent: { recipient: string; message: TentativeMessage }[] = [];
    const limiter = createRateLimiter();
    const value: TentativeStore = {
      authenticate: async (token) =>
        token === "token-a" ? A : token === "token-x" ? STRANGER : null,
      readFacts: async (id) =>
        id === GAME ? { facts: facts(revision), state: encodeGame(game) } : null,
      broadcast: async (recipient, message) => void sent.push({ recipient, message }),
      allow: limiter,
      ...overrides,
    };
    return { value, sent };
  }
  const request = (body: unknown, authorization = "Bearer token-a") => ({
    authorization,
    body,
    bytes: JSON.stringify(body).length,
  });

  it("forwards only the server-built message, only to the opponent", async () => {
    const game = active();
    const { value, sent } = store(game);
    const body = {
      operation: "tentative",
      ...proposal(game, [{ tileId: rackId(game, "14"), row: 10, col: 3 }]),
    };
    const reply = await handleTentativeRelay(request(body), value, NOW);
    expect(reply).toEqual({ status: 200, body: { accepted: true } });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.recipient).toBe(B);
    expect(sent[0]!.message.tiles).toEqual([{ row: 10, col: 3, kind: "14" }]);
  });

  it("refuses unauthenticated, outsiders, oversized, malformed, unknown games and spam", async () => {
    const game = active();
    const body = { operation: "tentative", ...proposal(game, []) };
    expect((await handleTentativeRelay(request(body, ""), store(game).value, NOW)).status).toBe(
      401,
    );
    expect(
      (await handleTentativeRelay(request(body, "Bearer token-x"), store(game).value, NOW)).status,
    ).toBe(403);
    expect(
      (await handleTentativeRelay({ ...request(body), bytes: 5000 }, store(game).value, NOW))
        .status,
    ).toBe(413);
    expect(
      (await handleTentativeRelay(request({ ...body, secret: 1 }), store(game).value, NOW)).status,
    ).toBe(400);
    expect(
      (
        await handleTentativeRelay(
          request({ ...body, id: "99999999-2222-4333-8444-555555555555" }),
          store(game).value,
          NOW,
        )
      ).status,
    ).toBe(404);
    const spam = store(game);
    const statuses: number[] = [];
    for (let i = 0; i < 30; i += 1)
      statuses.push(
        (await handleTentativeRelay(request({ ...body, seq: seq(i) }), spam.value, NOW)).status,
      );
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
    expect(spam.sent.length).toBeLessThanOrEqual(20);
    // A finished game has no live row: refused, nothing broadcast.
    const gone = store(game, 10, { readFacts: async () => null });
    expect((await handleTentativeRelay(request(body), gone.value, NOW)).status).toBe(404);
    expect(gone.sent).toHaveLength(0);
  });
});

describe("receiver ordering", () => {
  const message = (
    revision: number,
    seqValue: number,
    cols: number[],
    side: "A" | "B" = "A",
  ): TentativeMessage => ({
    gameId: GAME,
    revision,
    seq: seqValue,
    side,
    tiles: cols.map((col) => ({ row: 7, col, kind: "7" })),
  });
  it("keeps the newest seq within an epoch; ignores duplicates, older seqs and older epochs", () => {
    let held = receiveTentative(null, message(10, 11, [9]), 10); // J8 (seq 11) first
    held = receiveTentative(held, message(10, 10, [8]), 10); // I8 (seq 10) late
    held = receiveTentative(held, message(10, 11, [9]), 10); // duplicate
    expect(visibleTentative(held, 10, "B")).toEqual([{ row: 7, col: 9, kind: "7" }]);
    held = receiveTentative(held, message(9, 99, [3]), 10); // old epoch, huge seq
    expect(visibleTentative(held, 10, "B")).toEqual([{ row: 7, col: 9, kind: "7" }]);
    // The board advances (commit): nothing from epoch 10 is drawn on epoch 11.
    expect(visibleTentative(held, 11, "B")).toEqual([]);
    // A late epoch-10 packet after the commit is ignored.
    held = receiveTentative(held, message(10, 12, [4]), 11);
    expect(visibleTentative(held, 11, "B")).toEqual([]);
    // A message for an epoch the board has not reached yet waits for it.
    held = receiveTentative(held, message(12, 1, [6], "B"), 11);
    expect(visibleTentative(held, 11, "A")).toEqual([]);
    expect(visibleTentative(held, 12, "A")).toEqual([{ row: 7, col: 6, kind: "7" }]);
    // Never drawn for its own sender.
    expect(visibleTentative(held, 12, "B")).toEqual([]);
  });
  it("sequences strictly increase even on a frozen or backward clock", () => {
    let clock = NOW;
    const next = createSequence(() => clock);
    const a = next();
    const b = next();
    clock -= 5000;
    const c = next();
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});

describe("server-derived capability in the recipient projection", () => {
  it("seated Online players get tentativeSync; spectators, hosts and other modes do not", async () => {
    const online = createFixtureSession("active");
    const read = async (session: ReturnType<typeof createFixtureSession>, viewer: string) =>
      (await session.clientFor(viewer).read("x")).match as { tentativeSync?: boolean };
    expect((await read(online, "a")).tentativeSync).toBe(true);
    expect((await read(online, "b")).tentativeSync).toBe(true);
    expect((await read(online, "host")).tentativeSync).toBe(false); // spectator
    const physical = createFixtureSession("physical");
    expect((await read(physical, "host")).tentativeSync).toBe(false);
    expect((await read(physical, "a")).tentativeSync).toBe(false);
  });
});
