// The parked lines of the rooms this tab has open, loaded when they are needed.
//
// Nothing here is on the path of a move. A game that has never branched carries no
// `timelineRef`, and nothing is ever loaded for it. A game that has branched says which version
// of its parked lines it was committed with, and the lines are fetched once for that version —
// in the background, after the board is already on screen — and again only when some device
// changes them.
//
// Module-level rather than component state, for the same reason `engineSessions` is: leaving
// Play and coming back must not refetch what is already known, and the turn log, the map and
// the play shell all read the same entry.
import { EMPTY_MULTIVERSE, type Multiverse } from "./gameplay/multiverse";
import { decodeMultiverse } from "./gameplay/multiverseCodec";

export type TimelineStatus = "idle" | "loading" | "ready" | "error";

export type TimelineEntry = {
  readonly status: TimelineStatus;
  readonly multiverse: Multiverse;
  readonly error: string | null;
  /** The highest version a load has been attempted for. Stops a missing row being re-asked forever. */
  readonly attempted: number;
};

export type TimelineLoader = (roomId: string) => Promise<{ version: number; doc: unknown } | null>;

const IDLE: TimelineEntry = {
  status: "idle",
  multiverse: EMPTY_MULTIVERSE,
  error: null,
  attempted: 0,
};

const entries = new Map<string, TimelineEntry>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let storeVersion = 0;

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getVersion(): number {
  return storeVersion;
}

export function getTimeline(roomId: string | null): TimelineEntry {
  return (roomId ? entries.get(roomId) : undefined) ?? IDLE;
}

function put(roomId: string, entry: TimelineEntry): void {
  entries.set(roomId, entry);
  storeVersion += 1;
  for (const listener of listeners) listener();
}

/** Take a document this tab already holds whole: one it just committed, or one an archive carried. */
export function adoptTimeline(roomId: string, multiverse: Multiverse): void {
  const current = getTimeline(roomId);
  put(roomId, {
    status: "ready",
    multiverse,
    error: null,
    attempted: Math.max(current.attempted, multiverse.version),
  });
}

/** `adoptTimeline` for a stored document that still has to be read. */
export function adoptStoredTimeline(roomId: string, raw: unknown): void {
  try {
    adoptTimeline(roomId, decodeMultiverse(raw));
  } catch (error) {
    put(roomId, { ...getTimeline(roomId), status: "error", error: messageOf(error) });
  }
}

/**
 * Make sure lines at least as new as `wanted` are loaded.
 *
 * A no-op while a load is running, once a load for `wanted` has been tried (a room whose row is
 * missing is not asked again and again), and when what is held is already new enough. `force`
 * retries after an error.
 */
export function ensureTimeline(
  roomId: string,
  wanted: number,
  loader: TimelineLoader,
  options: { force?: boolean } = {},
): Promise<void> {
  const current = getTimeline(roomId);
  if (current.status === "ready" && current.multiverse.version >= wanted) return Promise.resolve();
  const running = inflight.get(roomId);
  if (running) return running;
  if (!options.force && current.attempted >= wanted && current.status !== "idle") {
    return Promise.resolve();
  }
  put(roomId, {
    ...current,
    status: "loading",
    error: null,
    attempted: Math.max(current.attempted, wanted),
  });
  const task = loader(roomId)
    .then((stored) => {
      const loaded = stored
        ? { ...decodeMultiverse(stored.doc), version: stored.version }
        : EMPTY_MULTIVERSE;
      const latest = getTimeline(roomId);
      // A write from this tab may have landed while the read was in flight. Never let the older
      // of the two win.
      const multiverse = latest.multiverse.version > loaded.version ? latest.multiverse : loaded;
      put(roomId, { ...latest, status: "ready", multiverse, error: null });
    })
    .catch((error: unknown) => {
      put(roomId, { ...getTimeline(roomId), status: "error", error: messageOf(error) });
    })
    .finally(() => {
      inflight.delete(roomId);
    });
  inflight.set(roomId, task);
  return task;
}

export function forgetTimeline(roomId: string): void {
  if (!entries.delete(roomId)) return;
  storeVersion += 1;
  for (const listener of listeners) listener();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load the other lines of this game.";
}
