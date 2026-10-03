import { useCallback, useEffect, useRef, useState } from "react";
import { RACK_SIZE } from "../../constants/gameRules";

/**
 * The player's private workspace for one unfinished game: rack order and Notes.
 *
 * Never authoritative, never sent anywhere: not in commands, projections,
 * realtime, History or Replay. Two backends:
 *
 * - `local`  — localStorage. The data is tiny (eight IDs and at most
 *   NOTES_MAX characters) and must be read synchronously on mount so the rack
 *   never flashes in server order before the saved order arrives. IndexedDB's
 *   async open would buy capacity this does not need at the cost of that flash.
 * - `memory` — a module Map. Pass & Play uses it: tile IDs are manifest
 *   ordinals (an ID reveals its token), so persisting one side's rack order on a
 *   shared device would let the other player read that rack after a refresh.
 *
 * Lifecycle: a record lives while the game is unfinished. When the player sees
 * the Result, it stays for that Result visit and is deleted when they leave it.
 * A player who was away at completion sees the Notes on the completed-game page
 * the next time they open it, and they are deleted when they leave it. Records
 * nobody revisits are swept after ORPHAN_DAYS. Signing out deletes the user's.
 */

export const WORKSPACE_PREFIX = "eq-lab:live-ws:v1:";
export const NOTES_MAX = 4000;
export const ORPHAN_DAYS = 30;

export type WorkspaceSlot = "A" | "B" | "host:A" | "host:B";
export type WorkspaceMode = "local" | "memory" | "none";

export type WorkspaceRecord = {
  v: 1;
  rackOrder: (string | null)[];
  notes: string;
  updatedAt: string;
  /** Set once the player has seen this game finished. */
  terminalSeen?: true;
};

export function workspaceKey(userId: string, gameId: string, slot: WorkspaceSlot) {
  return `${WORKSPACE_PREFIX}${userId}:${gameId}:${slot}`;
}

type Store = {
  read(key: string): WorkspaceRecord | null;
  write(key: string, record: WorkspaceRecord): void;
  remove(key: string): void;
  keys(): string[];
};

function parse(value: string | null): WorkspaceRecord | null {
  if (!value) return null;
  try {
    const record = JSON.parse(value) as WorkspaceRecord;
    if (record?.v !== 1 || !Array.isArray(record.rackOrder) || typeof record.notes !== "string")
      return null;
    return record;
  } catch {
    return null;
  }
}

const memory = new Map<string, WorkspaceRecord>();
const memoryStore: Store = {
  read: (key) => memory.get(key) ?? null,
  write: (key, record) => void memory.set(key, record),
  remove: (key) => void memory.delete(key),
  keys: () => [...memory.keys()],
};

// Private windows and full quotas throw; the workspace then lives in memory.
const localStore: Store = {
  read(key) {
    try {
      return parse(window.localStorage.getItem(key));
    } catch {
      return memoryStore.read(key);
    }
  },
  write(key, record) {
    try {
      window.localStorage.setItem(key, JSON.stringify(record));
    } catch {
      memoryStore.write(key, record);
    }
  },
  remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {}
    memoryStore.remove(key);
  },
  keys() {
    try {
      const keys: string[] = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(WORKSPACE_PREFIX)) keys.push(key);
      }
      return keys;
    } catch {
      return [];
    }
  },
};

function storeFor(mode: WorkspaceMode): Store | null {
  return mode === "local" ? localStore : mode === "memory" ? memoryStore : null;
}

/**
 * Saved slots keep their tile; tiles that left (played, exchanged, undone) leave
 * holes; arriving tiles fill those holes left to right, then any other empty
 * slot. Holes the player made on purpose stay where they put them.
 */
export function reconcileRackOrder(saved: readonly (string | null)[], rackIds: readonly string[]) {
  const present = new Set(rackIds);
  const order: (string | null)[] = Array.from({ length: RACK_SIZE }, () => null);
  const departed: number[] = [];
  const open: number[] = [];
  const placed = new Set<string>();
  for (let index = 0; index < RACK_SIZE; index += 1) {
    const id = saved[index] ?? null;
    if (id && present.has(id) && !placed.has(id)) {
      order[index] = id;
      placed.add(id);
    } else if (id) departed.push(index);
    else open.push(index);
  }
  const arriving = rackIds.filter((id) => !placed.has(id));
  for (const slot of [...departed, ...open]) {
    const id = arriving.shift();
    if (!id) break;
    order[slot] = id;
  }
  return order;
}

/** Delete records untouched for ORPHAN_DAYS. */
export function sweepWorkspaces(now = Date.now()) {
  const limit = now - ORPHAN_DAYS * 24 * 60 * 60 * 1000;
  for (const key of localStore.keys()) {
    const record = localStore.read(key);
    if (!record || Date.parse(record.updatedAt) < limit) localStore.remove(key);
  }
}

export function forgetUserWorkspaces(userId: string) {
  for (const key of localStore.keys())
    if (key.startsWith(`${WORKSPACE_PREFIX}${userId}:`)) localStore.remove(key);
}

const SLOTS: WorkspaceSlot[] = ["A", "B", "host:A", "host:B"];

/** Notes left for a completed game, e.g. a player who was away when it finished. */
export function leftoverNotes(userId: string, gameId: string) {
  // Leaving a Result (for example to open its Replay) already discarded them.
  if (pendingDeletes.has(`${userId}:${gameId}`)) return [];
  return SLOTS.flatMap((slot) => {
    const record = localStore.read(workspaceKey(userId, gameId, slot));
    // Replay renders before the departing Result's effect cleanup. Do not let
    // that reader cancel the Result's deletion and resurrect already-seen Notes.
    const notes = record?.terminalSeen ? "" : record?.notes.trim();
    return notes ? [{ slot, notes }] : [];
  });
}

export function deleteGameWorkspaces(userId: string, gameId: string) {
  for (const slot of SLOTS) {
    localStore.remove(workspaceKey(userId, gameId, slot));
    memoryStore.remove(workspaceKey(userId, gameId, slot));
  }
}

// React StrictMode unmounts and remounts on first mount; a deletion scheduled by
// that throwaway unmount is cancelled by the remount instead of losing Notes.
const pendingDeletes = new Map<string, ReturnType<typeof setTimeout>>();
export function scheduleGameDelete(userId: string, gameId: string) {
  const key = `${userId}:${gameId}`;
  clearTimeout(pendingDeletes.get(key));
  pendingDeletes.set(
    key,
    setTimeout(() => {
      pendingDeletes.delete(key);
      deleteGameWorkspaces(userId, gameId);
    }, 0),
  );
}
export function cancelGameDelete(userId: string, gameId: string) {
  const key = `${userId}:${gameId}`;
  clearTimeout(pendingDeletes.get(key));
  pendingDeletes.delete(key);
}

const blank = (): WorkspaceRecord => ({
  v: 1,
  rackOrder: [],
  notes: "",
  updatedAt: new Date().toISOString(),
});

/**
 * One slot's workspace. `rackIds` is the rack the projection authorizes now;
 * the returned order always holds exactly those IDs (plus holes).
 */
export function useLiveWorkspace({
  userId,
  gameId,
  slot,
  mode,
  rackIds,
  finished,
}: {
  userId: string;
  gameId: string;
  slot: WorkspaceSlot | null;
  mode: WorkspaceMode;
  rackIds: readonly string[];
  finished: boolean;
}) {
  const key = slot ? workspaceKey(userId, gameId, slot) : null;
  const store = storeFor(mode);
  const [record, setRecord] = useState<WorkspaceRecord>(() => (key && store?.read(key)) || blank());
  const [loadedKey, setLoadedKey] = useState(key);
  const recordRef = useRef(record);
  recordRef.current = record;
  if (loadedKey !== key) {
    // A different seat (Pass & Play handoff, Physical host switching racks).
    const next = (key && store?.read(key)) || blank();
    setLoadedKey(key);
    setRecord(next);
  }

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (key && store) store.write(key, recordRef.current);
  }, [key, store]);
  const save = useCallback(
    (next: WorkspaceRecord) => {
      recordRef.current = next;
      setRecord(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 150);
    },
    [flush],
  );
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      if (timer.current) flush();
    };
  }, [flush]);

  // Seeing the game finished marks the record; leaving that Result deletes it.
  useEffect(() => {
    if (!finished || mode === "none") return;
    cancelGameDelete(userId, gameId);
    if (!recordRef.current.terminalSeen) {
      save({ ...recordRef.current, terminalSeen: true, updatedAt: new Date().toISOString() });
      // The next route can render immediately; its reader needs this marker now.
      flush();
    }
    return () => scheduleGameDelete(userId, gameId);
  }, [finished, mode, userId, gameId, save, flush]);

  const order = reconcileRackOrder(record.rackOrder, rackIds);
  const setOrder = useCallback(
    (next: (string | null)[]) =>
      save({ ...recordRef.current, rackOrder: next, updatedAt: new Date().toISOString() }),
    [save],
  );
  const setNotes = useCallback(
    (notes: string) =>
      save({
        ...recordRef.current,
        notes: notes.slice(0, NOTES_MAX),
        updatedAt: new Date().toISOString(),
      }),
    [save],
  );
  return { order, setOrder, notes: record.notes, setNotes, persisted: mode };
}
