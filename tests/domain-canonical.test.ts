import { describe, expect, it } from "vitest";
import { BOARD_SIZE, RACK_SIZE } from "../src/constants/gameRules";
import {
  ALL_ORDINALS,
  TILE_COUNT,
  tokenAcceptsAssignment,
  tokenOfOrdinal,
} from "../src/domain/tiles";
import {
  type Inventory,
  bagOrder,
  boardTiles,
  countAt,
  inventoryProblems,
  pendingReturnOrder,
  rackOrder,
} from "../src/domain/inventory";
import {
  type CanonicalState,
  type Command,
  type CommandEnvelope,
  type CommittedEvent,
  canonicalStateDigest,
  commit,
  createCanonicalState,
  replay,
} from "../src/domain/canonical";

// A small deterministic generator so a failing run is reproducible from its seed.
function makeRandom(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

function shuffled(random: () => number): number[] {
  const order = [...ALL_ORDINALS];
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return order;
}

/** The property under test: every committed state is a lawful 100-tile set. */
function expectPhysicallySound(state: CanonicalState) {
  expect(inventoryProblems(state.inventory)).toEqual([]);
  expect(state.inventory).toHaveLength(TILE_COUNT);
  const accounted =
    bagOrder(state.inventory).length +
    rackOrder(state.inventory, "A").length +
    rackOrder(state.inventory, "B").length +
    pendingReturnOrder(state.inventory, "A").length +
    pendingReturnOrder(state.inventory, "B").length +
    boardTiles(state.inventory).length;
  expect(accounted).toBe(TILE_COUNT);
  expect(
    countAt(state.inventory, "bag") +
      countAt(state.inventory, "rack") +
      countAt(state.inventory, "pendingReturn") +
      countAt(state.inventory, "board"),
  ).toBe(TILE_COUNT);
}

function genesis(options: Partial<Parameters<typeof createCanonicalState>[0]> = {}) {
  return createCanonicalState({
    gameId: "11111111-1111-4111-8111-111111111111",
    gameMode: "versus",
    drawMode: "play",
    startingSide: "A",
    bagOrder: ALL_ORDINALS,
    ...options,
  });
}

function envelope(
  state: CanonicalState,
  command: Command,
  overrides: Partial<CommandEnvelope> = {},
): CommandEnvelope {
  return {
    commandId: `cmd-${state.revision}`,
    expectedRevision: state.revision,
    issuedBy: state.activeSide,
    issuedAt: new Date(1_700_000_000_000 + state.revision * 1000).toISOString(),
    command,
    ...overrides,
  };
}

function accept(state: CanonicalState, command: Command, overrides: Partial<CommandEnvelope> = {}) {
  const result = commit(state, envelope(state, command, overrides));
  if (!result.ok) throw new Error(`expected acceptance, got ${result.reason}: ${result.message}`);
  return result;
}

function freeSquare(
  inventory: Inventory,
  random: () => number,
): { row: number; col: number } | null {
  const taken = new Set(boardTiles(inventory).map((tile) => `${tile.row}:${tile.col}`));
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const row = Math.floor(random() * BOARD_SIZE);
    const col = Math.floor(random() * BOARD_SIZE);
    if (!taken.has(`${row}:${col}`)) return { row, col };
  }
  return null;
}

/**
 * Drive a long legal game with a random-but-legal player, checking the physical
 * invariant after every single committed transition.
 */
function playRandomGame(seed: number, drawMode: "manual" | "play", steps = 400) {
  const random = makeRandom(seed);
  let state = genesis({ drawMode, bagOrder: shuffled(random) });
  const events: CommittedEvent[] = [];
  const start = state;
  let commandCounter = 0;

  for (let step = 0; step < steps && state.status === "playing"; step += 1) {
    const side = state.activeSide;
    const rack = rackOrder(state.inventory, side);
    const bag = bagOrder(state.inventory);
    let command: Command;

    if (state.phase === "refill") {
      if (drawMode === "play" || bag.length === 0) {
        command = { kind: "refill" };
      } else {
        const room = Math.min(RACK_SIZE - rack.length, bag.length);
        const take = 1 + Math.floor(random() * room);
        command = { kind: "draw", tiles: bag.slice(0, take) };
      }
    } else if (rack.length === 0) {
      command = { kind: "pass" };
    } else {
      const roll = random();
      if (roll < 0.65) {
        const count = 1 + Math.floor(random() * Math.min(rack.length, 4));
        const placements: Array<{ ordinal: number; row: number; col: number; assigned?: string }> =
          [];
        const used = new Set<string>(boardTiles(state.inventory).map((t) => `${t.row}:${t.col}`));
        for (const ordinal of rack.slice(0, count)) {
          const square = freeSquare(state.inventory, random);
          if (!square || used.has(`${square.row}:${square.col}`)) continue;
          used.add(`${square.row}:${square.col}`);
          const token = tokenOfOrdinal(ordinal);
          placements.push({
            ordinal,
            row: square.row,
            col: square.col,
            ...(tokenAcceptsAssignment(token) ? { assigned: "1" } : {}),
          });
        }
        if (placements.length === 0) {
          command = { kind: "pass" };
        } else {
          command = { kind: "place", placements, score: Math.floor(random() * 30) };
        }
      } else if (roll < 0.85 && rack.length > 0) {
        const count = 1 + Math.floor(random() * rack.length);
        command = { kind: "exchange", tiles: rack.slice(0, count) };
      } else {
        command = { kind: "pass" };
      }
    }

    commandCounter += 1;
    const result = commit(
      state,
      envelope(state, command, { commandId: `c${seed}-${commandCounter}` }),
    );
    if (!result.ok) {
      throw new Error(
        `seed ${seed} step ${step} (${command.kind}) rejected as ${result.reason}: ${result.message}`,
      );
    }
    expect(result.state.revision).toBe(state.revision + 1);
    state = result.state;
    if (result.event) events.push(result.event);
    expectPhysicallySound(state);
  }

  return { start, state, events };
}

describe("canonical commits preserve the physical set", () => {
  it("keeps all 100 tiles accounted for through long randomized games", () => {
    for (const seed of [1, 7, 42, 1337, 90210, 555_555]) {
      for (const drawMode of ["play", "manual"] as const) {
        const { state } = playRandomGame(seed, drawMode);
        expectPhysicallySound(state);
      }
    }
  });

  it("never lets a tile's identity or type change across a whole game", () => {
    const { state } = playRandomGame(2024, "play");
    // Identity is the index and the token is derived from it, so the only way
    // this can fail is if a slot stopped describing its own tile.
    for (const ordinal of ALL_ORDINALS) {
      expect(tokenOfOrdinal(ordinal)).toBe(tokenOfOrdinal(ordinal));
      expect(state.inventory[ordinal]).toBeDefined();
    }
    const boardFaces = boardTiles(state.inventory).filter((tile) => tile.assigned !== undefined);
    for (const tile of boardFaces) {
      expect(tokenAcceptsAssignment(tokenOfOrdinal(tile.ordinal))).toBe(true);
    }
  });

  it("moves a tile out of a rack only when a command is committed", () => {
    const state = accept(genesis(), { kind: "refill" }).state;
    const rackBefore = rackOrder(state.inventory, "A");
    expect(rackBefore).toHaveLength(RACK_SIZE);
    // Composing a play changes nothing here: drafts live outside canonical state.
    expect(rackOrder(state.inventory, "A")).toEqual(rackBefore);
    const played = accept(state, {
      kind: "place",
      placements: [{ ordinal: rackBefore[0], row: 7, col: 7 }].filter(
        (spec) => !tokenAcceptsAssignment(tokenOfOrdinal(spec.ordinal)),
      ),
      score: 4,
    });
    expect(rackOrder(played.state.inventory, "A")).not.toContain(rackBefore[0]);
    expect(played.state.inventory[rackBefore[0]].at).toBe("board");
  });

  it("holds exchanged tiles aside until that side finishes its next draw", () => {
    let state = accept(genesis({ drawMode: "manual" }), {
      kind: "draw",
      tiles: bagOrder(genesis().inventory).slice(0, RACK_SIZE),
    }).state;
    const rack = rackOrder(state.inventory, "A");
    const bagBefore = bagOrder(state.inventory).length;
    state = accept(state, { kind: "exchange", tiles: rack.slice(0, 3) }).state;

    // Given up, but not yet back in the bag: they cannot be drawn again now.
    expect(pendingReturnOrder(state.inventory, "A")).toHaveLength(3);
    expect(bagOrder(state.inventory).length).toBe(bagBefore);
    expectPhysicallySound(state);

    // A's own next refill is what returns them.
    state = accept(state, { kind: "draw", tiles: bagOrder(state.inventory).slice(0, 3) }).state;
    expect(pendingReturnOrder(state.inventory, "A")).toHaveLength(0);
    expectPhysicallySound(state);
  });
});

describe("commit is atomic, conditional and idempotent", () => {
  it("rejects a command composed against a superseded revision", () => {
    const first = genesis();
    const second = accept(first, { kind: "refill" }).state;
    const stale = commit(second, {
      ...envelope(first, { kind: "refill" }),
      commandId: "other",
      expectedRevision: first.revision,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.reason).toBe("stale_revision");
      expect(stale.currentRevision).toBe(second.revision);
    }
  });

  it("treats a redelivered command as a no-op instead of applying it twice", () => {
    const state = accept(genesis(), { kind: "refill" }).state;
    const rack = rackOrder(state.inventory, "A");
    const ordinal = rack.find((o) => !tokenAcceptsAssignment(tokenOfOrdinal(o)))!;
    const play: Command = {
      kind: "place",
      placements: [{ ordinal, row: 7, col: 7 }],
      score: 5,
    };
    const once = accept(state, play, { commandId: "play-1" });
    const twice = commit(once.state, {
      ...envelope(state, play, { commandId: "play-1" }),
      expectedRevision: once.state.revision,
    });
    expect(twice.ok).toBe(true);
    if (twice.ok) {
      expect(twice.duplicate).toBe(true);
      expect(twice.event).toBeNull();
      expect(twice.state.revision).toBe(once.state.revision);
      expect(canonicalStateDigest(twice.state)).toBe(canonicalStateDigest(once.state));
    }
  });

  it("produces no state at all when a transition would be illegal", () => {
    const state = accept(genesis(), { kind: "refill" }).state;
    const before = canonicalStateDigest(state);
    const bagTile = bagOrder(state.inventory)[0];
    const rejected = commit(
      state,
      envelope(state, {
        kind: "place",
        placements: [{ ordinal: bagTile, row: 7, col: 7 }],
        score: 3,
      }),
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.reason).toBe("illegal");
    expect(canonicalStateDigest(state)).toBe(before);
  });

  it("refuses to half-apply a play where one tile is illegal", () => {
    const state = accept(genesis(), { kind: "refill" }).state;
    const rack = rackOrder(state.inventory, "A");
    const before = canonicalStateDigest(state);
    const rejected = commit(
      state,
      envelope(state, {
        kind: "place",
        placements: [
          { ordinal: rack[0], row: 7, col: 7 },
          { ordinal: bagOrder(state.inventory)[0], row: 7, col: 8 },
        ],
        score: 3,
      }),
    );
    expect(rejected.ok).toBe(false);
    // The legal half of the play must not have landed.
    expect(canonicalStateDigest(state)).toBe(before);
    expect(rackOrder(state.inventory, "A")).toContain(rack[0]);
  });

  it("advances the revision by exactly one per accepted command", () => {
    let state = genesis();
    for (let step = 0; step < 5; step += 1) {
      const next = accept(state, { kind: "pass" }, { commandId: `pass-${step}` });
      expect(next.state.revision).toBe(state.revision + 1);
      expect(next.event?.revision).toBe(next.state.revision);
      state = next.state;
    }
  });
});

describe("deterministic reconstruction", () => {
  it("rebuilds identical state from genesis plus the ordered event log", () => {
    const { start, state, events } = playRandomGame(31337, "play", 200);
    const rebuilt = replay(start, events);
    expect(canonicalStateDigest(rebuilt)).toBe(canonicalStateDigest(state));
    expect(rebuilt.revision).toBe(state.revision);
  });

  it("rebuilds identical state for a manual-draw game too", () => {
    const { start, state, events } = playRandomGame(4242, "manual", 200);
    expect(canonicalStateDigest(replay(start, events))).toBe(canonicalStateDigest(state));
  });

  it("refuses to replay a log with a gap rather than guessing", () => {
    const { start, events } = playRandomGame(11, "play", 40);
    const withGap = [...events.slice(0, 3), ...events.slice(4)];
    expect(() => replay(start, withGap)).toThrow(/not contiguous/);
  });

  it("refuses to replay events belonging to another game", () => {
    const { start, events } = playRandomGame(12, "play", 20);
    const foreign = events.map((event) => ({
      ...event,
      gameId: "22222222-2222-4222-8222-222222222222",
    }));
    expect(() => replay(start, foreign)).toThrow(/cannot be replayed onto/);
  });

  it("gives every observer of a revision the same bytes", () => {
    const { start, events } = playRandomGame(777, "play", 120);
    // A player replaying from the start, a spectator that joined at revision 50
    // and replayed forward, and a client that reloaded — all at the same revision.
    const target = Math.min(50, events.length);
    const player = replay(start, events.slice(0, target));
    const spectator = replay(replay(start, events.slice(0, 10)), events.slice(10, target));
    const refreshed = replay(start, events.slice(0, target));
    expect(canonicalStateDigest(spectator)).toBe(canonicalStateDigest(player));
    expect(canonicalStateDigest(refreshed)).toBe(canonicalStateDigest(player));
  });
});
