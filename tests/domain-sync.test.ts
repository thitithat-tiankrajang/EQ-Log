import { describe, expect, it } from "vitest";
import { ALL_ORDINALS } from "../src/domain/tiles";
import { bagOrder, rackOrder } from "../src/domain/inventory";
import {
  type CanonicalState,
  type Command,
  type CommittedEvent,
  canonicalStateDigest,
  commit,
  createCanonicalState,
} from "../src/domain/canonical";
import {
  MAX_BUFFERED_EVENTS,
  type SyncState,
  authorityApply,
  createSync,
  hydrate,
  receive,
  revisionOf,
} from "../src/domain/sync";

const GAME_ID = "11111111-1111-4111-8111-111111111111";

function genesis(): CanonicalState {
  return createCanonicalState({
    gameId: GAME_ID,
    gameMode: "versus",
    drawMode: "play",
    startingSide: "A",
    bagOrder: ALL_ORDINALS,
  });
}

/** An authority that behaves the way the database RPC is specified to. */
function makeAuthority() {
  let state = genesis();
  const log: CommittedEvent[] = [];
  return {
    snapshot: () => state,
    log: () => [...log],
    apply(command: Command, commandId: string, expectedRevision = state.revision) {
      const response = authorityApply(state, {
        gameId: GAME_ID,
        commandId,
        expectedRevision,
        issuedBy: state.activeSide,
        command,
        issuedAt: new Date(1_700_000_000_000 + log.length * 1000).toISOString(),
      });
      if (response.outcome === "committed") {
        state = response.state;
        log.push(response.event);
      } else if (response.outcome === "duplicate") {
        state = response.state;
      }
      return response;
    },
  };
}

/** A handful of committed moves to replay against clients. */
function scriptedEvents(count: number): { start: CanonicalState; events: CommittedEvent[] } {
  const authority = makeAuthority();
  const start = authority.snapshot();
  for (let step = 0; step < count; step += 1) {
    const state = authority.snapshot();
    const command: Command = state.phase === "refill" ? { kind: "refill" } : { kind: "pass" };
    authority.apply(command, `cmd-${step}`);
  }
  return { start, events: authority.log() };
}

function feed(sync: SyncState, events: readonly CommittedEvent[]): SyncState {
  return events.reduce((current, event) => receive(current, { kind: "event", event }).sync, sync);
}

describe("a client can never be moved backwards", () => {
  it("ignores a snapshot older than what it already holds", () => {
    const { start, events } = scriptedEvents(6);
    const ahead = hydrate(GAME_ID, start, events);
    const behind = receive(ahead, { kind: "snapshot", state: start });
    expect(behind.sync.state?.revision).toBe(ahead.state?.revision);
    expect(behind.effect).toEqual({ do: "none" });
  });

  it("ignores an event for a revision it has already applied", () => {
    const { start, events } = scriptedEvents(4);
    const current = hydrate(GAME_ID, start, events);
    const digest = canonicalStateDigest(current.state!);
    const replayed = feed(current, events);
    expect(canonicalStateDigest(replayed.state!)).toBe(digest);
    expect(replayed.status).toBe("live");
  });

  it("applies a duplicated delivery exactly once", () => {
    const { start, events } = scriptedEvents(3);
    const doubled = feed(hydrate(GAME_ID, start), [...events, ...events, ...events]);
    expect(doubled.state?.revision).toBe(events.length);
    expect(canonicalStateDigest(doubled.state!)).toBe(
      canonicalStateDigest(hydrate(GAME_ID, start, events).state!),
    );
  });

  it("ignores traffic belonging to a different game", () => {
    const { start, events } = scriptedEvents(2);
    const sync = hydrate(GAME_ID, start);
    const foreign = receive(sync, {
      kind: "event",
      event: { ...events[0], gameId: "22222222-2222-4222-8222-222222222222" },
    });
    expect(foreign.sync.state?.revision).toBe(0);
    expect(foreign.effect).toEqual({ do: "none" });
  });
});

describe("out-of-order and missing delivery", () => {
  it("holds an early event until the missing one arrives, then applies both", () => {
    const { start, events } = scriptedEvents(3);
    let sync = hydrate(GAME_ID, start);
    sync = receive(sync, { kind: "event", event: events[1] }).sync;
    expect(sync.status).toBe("gap");
    expect(sync.state?.revision).toBe(0);

    const filled = receive(sync, { kind: "event", event: events[0] });
    expect(filled.sync.status).toBe("live");
    expect(filled.sync.state?.revision).toBe(2);
    expect(filled.effect).toEqual({ do: "advanced", from: 0, to: 2 });
  });

  it("converges to the same state no matter the arrival order", () => {
    const { start, events } = scriptedEvents(8);
    const inOrder = hydrate(GAME_ID, start, events);
    const shuffledOrders = [
      [3, 1, 0, 2, 5, 4, 7, 6],
      [7, 6, 5, 4, 3, 2, 1, 0],
      [0, 2, 4, 6, 1, 3, 5, 7],
    ];
    for (const order of shuffledOrders) {
      const scrambled = feed(
        hydrate(GAME_ID, start),
        order.map((index) => events[index]),
      );
      expect(scrambled.status).toBe("live");
      expect(canonicalStateDigest(scrambled.state!)).toBe(canonicalStateDigest(inOrder.state!));
    }
  });

  it("asks for a snapshot rather than guessing when a hole will not close", () => {
    const { start, events } = scriptedEvents(MAX_BUFFERED_EVENTS + 6);
    let sync = hydrate(GAME_ID, start);
    let asked = false;
    for (const event of events.slice(1)) {
      const outcome = receive(sync, { kind: "event", event });
      sync = outcome.sync;
      if (outcome.effect.do === "resync") asked = true;
    }
    expect(asked).toBe(true);
    expect(sync.status).toBe("resync_required");
    // It never advanced past the hole on its own.
    expect(sync.state?.revision).toBe(0);
  });

  it("recovers from a hole by adopting the authoritative snapshot", () => {
    const { start, events } = scriptedEvents(10);
    let sync = hydrate(GAME_ID, start);
    sync = feed(sync, events.slice(4)); // revisions 5..10, the first four lost
    expect(sync.state?.revision).toBe(0);

    const authoritative = hydrate(GAME_ID, start, events).state!;
    const recovered = receive(sync, { kind: "snapshot", state: authoritative });
    expect(recovered.sync.status).toBe("live");
    expect(canonicalStateDigest(recovered.sync.state!)).toBe(canonicalStateDigest(authoritative));
  });

  it("reports rather than repairs when two states claim one revision", () => {
    const { start, events } = scriptedEvents(4);
    const mine = hydrate(GAME_ID, start, events);
    const forged: CanonicalState = { ...mine.state!, scores: { A: 999, B: 0 } };
    const outcome = receive(mine, { kind: "snapshot", state: forged });
    expect(outcome.effect.do).toBe("resync");
    expect(outcome.sync.status).toBe("resync_required");
    // The client did not adopt the contradictory state.
    expect(outcome.sync.state?.scores.A).toBe(mine.state?.scores.A);
  });
});

describe("joining, refreshing and reconnecting", () => {
  it("brings a late observer to exactly the same state as an early one", () => {
    const { start, events } = scriptedEvents(12);
    const early = feed(hydrate(GAME_ID, start), events);

    // Joins after the fact: one snapshot at the current revision, no history.
    const late = hydrate(GAME_ID, early.state!);
    expect(canonicalStateDigest(late.state!)).toBe(canonicalStateDigest(early.state!));

    // Joins mid-game and follows along from there.
    const midpoint = hydrate(GAME_ID, start, events.slice(0, 5));
    const followed = feed(hydrate(GAME_ID, midpoint.state!), events.slice(5));
    expect(canonicalStateDigest(followed.state!)).toBe(canonicalStateDigest(early.state!));
  });

  it("survives a refresh with no memory at all", () => {
    const { start, events } = scriptedEvents(9);
    const live = feed(hydrate(GAME_ID, start), events);
    const refreshed = hydrate(GAME_ID, live.state!); // cold start from the authority
    expect(canonicalStateDigest(refreshed.state!)).toBe(canonicalStateDigest(live.state!));
    expect(refreshed.status).toBe("live");
  });

  it("catches up after a subscription restart that missed moves", () => {
    const { start, events } = scriptedEvents(10);
    const beforeOutage = hydrate(GAME_ID, start, events.slice(0, 3));
    // Socket was down for revisions 4..7, then resubscribed and pulled a snapshot.
    const authoritative = hydrate(GAME_ID, start, events).state!;
    const resubscribed = receive(beforeOutage, { kind: "snapshot", state: authoritative });
    expect(resubscribed.sync.status).toBe("live");
    expect(resubscribed.sync.state?.revision).toBe(events.length);
  });

  it("keeps deltas that arrive during a reconnect and applies them after the snapshot", () => {
    const { start, events } = scriptedEvents(8);
    let sync = hydrate(GAME_ID, start, events.slice(0, 2));
    // Deltas 7 and 8 arrive while the snapshot request is still in flight.
    sync = feed(sync, events.slice(6));
    const snapshotAt6 = hydrate(GAME_ID, start, events.slice(0, 6)).state!;
    const settled = receive(sync, { kind: "snapshot", state: snapshotAt6 });
    expect(settled.sync.state?.revision).toBe(8);
    expect(canonicalStateDigest(settled.sync.state!)).toBe(
      canonicalStateDigest(hydrate(GAME_ID, start, events).state!),
    );
  });

  it("asks for a snapshot when a delta arrives with nothing to apply it to", () => {
    const { events } = scriptedEvents(2);
    const outcome = receive(createSync(GAME_ID), { kind: "event", event: events[0] });
    expect(outcome.effect.do).toBe("resync");
    expect(revisionOf(outcome.sync)).toBe(-1);
  });
});

describe("the authority arbitrates concurrent play", () => {
  it("lets exactly one of two commands composed on the same revision win", () => {
    const authority = makeAuthority();
    const shared = authority.snapshot().revision;
    const first = authority.apply({ kind: "refill" }, "player-a", shared);
    const second = authority.apply({ kind: "refill" }, "player-b", shared);
    expect(first.outcome).toBe("committed");
    expect(second.outcome).toBe("conflict");
    expect(authority.snapshot().revision).toBe(shared + 1);
    expect(authority.log()).toHaveLength(1);
  });

  it("absorbs a retried command without applying it twice", () => {
    const authority = makeAuthority();
    const base = authority.snapshot().revision;
    const sent = authority.apply({ kind: "refill" }, "retry-me", base);
    expect(sent.outcome).toBe("committed");
    // The client never saw the response and sent the identical command again.
    const retry = authority.apply({ kind: "refill" }, "retry-me", base);
    expect(retry.outcome).toBe("duplicate");
    expect(authority.snapshot().revision).toBe(base + 1);
    expect(authority.log()).toHaveLength(1);
  });

  it("rejects an illegal command without changing the authoritative state", () => {
    const authority = makeAuthority();
    authority.apply({ kind: "refill" }, "fill");
    const before = canonicalStateDigest(authority.snapshot());
    const bagTile = bagOrder(authority.snapshot().inventory)[0];
    const response = authority.apply(
      { kind: "place", placements: [{ ordinal: bagTile, row: 7, col: 7 }], score: 3 },
      "bad-play",
    );
    expect(response.outcome).toBe("rejected");
    expect(canonicalStateDigest(authority.snapshot())).toBe(before);
  });

  it("gives players, a bot and spectators the same state at the same revision", () => {
    const authority = makeAuthority();
    authority.apply({ kind: "refill" }, "c0");
    const rack = rackOrder(authority.snapshot().inventory, "A");
    const plain = rack.find((ordinal) => authority.snapshot().inventory[ordinal].at === "rack")!;
    authority.apply({ kind: "pass" }, "c1");
    authority.apply({ kind: "pass" }, "c2");
    void plain;

    const start = genesis();
    const events = authority.log();
    const player = hydrate(GAME_ID, start, events);
    const bot = feed(hydrate(GAME_ID, start), [...events].reverse());
    const spectator = hydrate(GAME_ID, authority.snapshot());
    const reconnected = feed(hydrate(GAME_ID, start, events.slice(0, 1)), events.slice(1));

    const truth = canonicalStateDigest(authority.snapshot());
    for (const observer of [player, bot, spectator, reconnected]) {
      expect(observer.state?.revision).toBe(authority.snapshot().revision);
      expect(canonicalStateDigest(observer.state!)).toBe(truth);
    }
  });
});

describe("a rejected commit leaves nothing behind", () => {
  it("does not advance the revision when a command is refused", () => {
    const state = genesis();
    const rejected = commit(state, {
      commandId: "nope",
      expectedRevision: state.revision,
      issuedBy: "A",
      command: { kind: "draw", tiles: [0] },
      issuedAt: new Date().toISOString(),
    });
    expect(rejected.ok).toBe(false);
    expect(state.revision).toBe(0);
  });
});
