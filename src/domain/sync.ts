// ── Revision synchronization ─────────────────────────────────────────────────
//
// The receiving half of the protocol, as a pure function of (what I know,
// what just arrived). No timers, no sockets, no React — so every delivery
// hazard can be written down as a test instead of reproduced against a network.
//
// A client learns about the game two ways:
//
//   • SNAPSHOT — the whole canonical state at some revision. Sent on join, on
//     reconnect, and whenever the client asks to be resynchronized.
//   • DELTA — one committed event, carrying the revision it produced.
//
// Everything is ordered by revision, and the rules are deliberately blunt:
//
//   revision ≤ mine     → already known. Discard. This single rule covers late
//                         delivery, duplicate delivery, and a stale snapshot
//                         racing a newer one; none of them can move the client
//                         backwards.
//   revision = mine + 1 → apply it.
//   revision > mine + 1 → something was missed. Hold it, and if the hole does
//                         not fill, ask the authority for a snapshot.
//
// The client never invents state to bridge a gap and never repairs a mismatch
// locally. When its own view cannot be advanced — a gap that will not close, an
// event that will not apply, a game it does not recognize — it says so and
// recovers by refetching authoritative data.

import {
  type CanonicalState,
  type CommittedEvent,
  canonicalStateDigest,
  commit,
  replay,
} from "./canonical";

/** How many out-of-order events are held before giving up and resynchronizing.
 *  A hole this deep is a lost subscription, not a reordering. */
export const MAX_BUFFERED_EVENTS = 32;

export type SyncStatus =
  /** Nothing known yet; waiting for a first snapshot. */
  | "empty"
  /** Current with the authority as far as this client knows. */
  | "live"
  /** A gap is open; buffered events are waiting for the missing ones. */
  | "gap"
  /** Cannot proceed from local state. A canonical snapshot is required. */
  | "resync_required";

export type SyncState = {
  readonly gameId: string;
  readonly status: SyncStatus;
  readonly state: CanonicalState | null;
  /** Events received ahead of `state.revision`, keyed by the revision they
   *  produce. Never contains a revision at or below the current one. */
  readonly buffered: ReadonlyMap<number, CommittedEvent>;
  /** Why a resync is needed, for diagnostics. Never used to repair. */
  readonly problem: string | null;
};

export type Incoming =
  | { kind: "snapshot"; state: CanonicalState }
  | { kind: "event"; event: CommittedEvent };

/** What the caller should do next. `resync` is the only recovery path. */
export type SyncEffect =
  | { do: "none" }
  | { do: "resync"; reason: string }
  | { do: "advanced"; from: number; to: number };

export type SyncOutcome = { sync: SyncState; effect: SyncEffect };

export function createSync(gameId: string): SyncState {
  return { gameId, status: "empty", state: null, buffered: new Map(), problem: null };
}

export function revisionOf(sync: SyncState): number {
  return sync.state?.revision ?? -1;
}

/**
 * Fold one delivery into what the client knows.
 *
 * Total: every malformed, foreign, stale, duplicate or premature message has a
 * defined outcome, and none of them can corrupt `sync.state`.
 */
export function receive(sync: SyncState, incoming: Incoming): SyncOutcome {
  if (incoming.kind === "snapshot") return receiveSnapshot(sync, incoming.state);
  return receiveEvent(sync, incoming.event);
}

function receiveSnapshot(sync: SyncState, snapshot: CanonicalState): SyncOutcome {
  if (snapshot.gameId !== sync.gameId) {
    return { sync, effect: { do: "none" } };
  }
  const current = revisionOf(sync);
  if (sync.state && snapshot.revision < current) {
    // A snapshot older than what this client already holds is a delayed read,
    // not a correction. Adopting it would undo a committed turn.
    return { sync, effect: { do: "none" } };
  }
  if (sync.state && snapshot.revision === current && sync.status !== "resync_required") {
    // Same revision: by construction the same state. Nothing to do, but a
    // disagreement here is a genuine divergence and must be reported.
    if (canonicalStateDigest(snapshot) !== canonicalStateDigest(sync.state)) {
      return {
        sync: {
          ...sync,
          status: "resync_required",
          problem: `Two different states are claimed for revision ${snapshot.revision}.`,
        },
        effect: {
          do: "resync",
          reason: `Two different states are claimed for revision ${snapshot.revision}.`,
        },
      };
    }
    return { sync, effect: { do: "none" } };
  }

  const adopted: SyncState = {
    gameId: sync.gameId,
    status: "live",
    state: snapshot,
    buffered: pruneBuffer(sync.buffered, snapshot.revision),
    problem: null,
  };
  return drain(adopted, current);
}

function receiveEvent(sync: SyncState, event: CommittedEvent): SyncOutcome {
  if (event.gameId !== sync.gameId) return { sync, effect: { do: "none" } };
  if (!sync.state) {
    // No baseline: a delta is meaningless without the state it applies to.
    return {
      sync: { ...sync, buffered: withBuffered(sync.buffered, event) },
      effect: { do: "resync", reason: "A move arrived before this client had any state." },
    };
  }

  const current = sync.state.revision;
  if (event.revision <= current) {
    // Already applied, or superseded. Duplicates and late deliveries land here.
    return { sync, effect: { do: "none" } };
  }

  if (event.revision > current + 1) {
    const buffered = withBuffered(sync.buffered, event);
    if (buffered.size > MAX_BUFFERED_EVENTS) {
      const reason = `Missed moves between revision ${current} and ${event.revision}.`;
      return {
        sync: { ...sync, status: "resync_required", buffered, problem: reason },
        effect: { do: "resync", reason },
      };
    }
    return { sync: { ...sync, status: "gap", buffered }, effect: { do: "none" } };
  }

  return drain({ ...sync, buffered: withBuffered(sync.buffered, event) }, current);
}

/** Apply every buffered event that is now contiguous with the current state. */
function drain(sync: SyncState, previousRevision: number): SyncOutcome {
  let state = sync.state;
  if (!state) return { sync, effect: { do: "none" } };

  const buffered = new Map(sync.buffered);
  for (;;) {
    const next = buffered.get(state.revision + 1);
    if (!next) break;
    buffered.delete(next.revision);
    const result = commit(state, {
      commandId: next.commandId,
      expectedRevision: state.revision,
      issuedBy: next.issuedBy,
      command: next.command,
      issuedAt: next.committedAt,
    });
    if (!result.ok) {
      // The authority accepted this move and we cannot. Our baseline is wrong;
      // the only honest recovery is authoritative data.
      const reason = `Revision ${next.revision} could not be applied locally: ${result.message}`;
      return {
        sync: { ...sync, state, status: "resync_required", buffered, problem: reason },
        effect: { do: "resync", reason },
      };
    }
    state = result.state;
  }

  const pruned = pruneBuffer(buffered, state.revision);
  const status: SyncStatus = pruned.size > 0 ? "gap" : "live";
  const advanced = state.revision > previousRevision;
  return {
    sync: { gameId: sync.gameId, status, state, buffered: pruned, problem: null },
    effect: advanced
      ? { do: "advanced", from: previousRevision, to: state.revision }
      : { do: "none" },
  };
}

function withBuffered(
  buffered: ReadonlyMap<number, CommittedEvent>,
  event: CommittedEvent,
): Map<number, CommittedEvent> {
  const next = new Map(buffered);
  // First delivery wins: a redelivery of the same revision carries the same
  // committed command, so there is nothing to choose between them.
  if (!next.has(event.revision)) next.set(event.revision, event);
  return next;
}

function pruneBuffer(
  buffered: ReadonlyMap<number, CommittedEvent>,
  revision: number,
): Map<number, CommittedEvent> {
  const next = new Map<number, CommittedEvent>();
  for (const [key, event] of buffered) {
    if (key > revision) next.set(key, event);
  }
  return next;
}

// ── Publishing side ──────────────────────────────────────────────────────────

/**
 * What a client sends when it wants to make a move. `expectedRevision` is the
 * whole concurrency story: the authority applies it only if the game is still
 * there, so two players acting on the same revision cannot both win.
 */
export type CommitRequest = {
  readonly gameId: string;
  readonly commandId: string;
  readonly expectedRevision: number;
  readonly issuedBy: "A" | "B" | "host";
  readonly command: CommittedEvent["command"];
  readonly issuedAt: string;
};

export type CommitResponse =
  | { outcome: "committed"; event: CommittedEvent; state: CanonicalState }
  /** The authority already had this command id. Same as committed, no new event. */
  | { outcome: "duplicate"; state: CanonicalState }
  /** Someone else moved first. The caller must rebase onto `state` and retry
   *  with a NEW command id if the intent still makes sense. */
  | { outcome: "conflict"; state: CanonicalState }
  | { outcome: "rejected"; message: string; state: CanonicalState };

/**
 * Apply a request against authoritative state. Used by the in-process
 * authority in tests and by the bot/solo path; the database RPC implements the
 * same contract for multiplayer.
 */
export function authorityApply(
  state: CanonicalState,
  request: CommitRequest,
): CommitResponse {
  const result = commit(state, {
    commandId: request.commandId,
    expectedRevision: request.expectedRevision,
    issuedBy: request.issuedBy,
    command: request.command,
    issuedAt: request.issuedAt,
  });
  if (!result.ok) {
    return result.reason === "stale_revision"
      ? { outcome: "conflict", state }
      : { outcome: "rejected", message: result.message, state };
  }
  if (result.duplicate || !result.event) return { outcome: "duplicate", state: result.state };
  return { outcome: "committed", event: result.event, state: result.state };
}

/**
 * Bring a client up to date from a snapshot plus whatever deltas follow it.
 * The same code path serves a first join, a refresh and a reconnect, so those
 * three cannot drift apart.
 */
export function hydrate(
  gameId: string,
  snapshot: CanonicalState,
  events: readonly CommittedEvent[] = [],
): SyncState {
  let sync = receiveSnapshot(createSync(gameId), snapshot).sync;
  for (const event of events) sync = receive(sync, { kind: "event", event }).sync;
  return sync;
}

/** Rebuild from a base snapshot and a contiguous log; used by the authority to
 *  serve a late observer without recomputing the whole game per subscriber. */
export function projectAt(
  base: CanonicalState,
  events: readonly CommittedEvent[],
  targetRevision: number,
): CanonicalState {
  const upTo = events.filter(
    (event) => event.revision > base.revision && event.revision <= targetRevision,
  );
  return replay(base, upTo);
}
