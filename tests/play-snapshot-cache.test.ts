// The render seed that stops Play flashing "load → disappear → load" on return.
//
// The one property that makes it safe to render before revalidating: it can only
// ever move FORWARD. A late, lower-revision write of the same game is ignored, so
// a returning mount can never be seeded with a position the game has already
// left. A different game replaces wholesale, because that is not a comparison —
// it is a different subject.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_NEW_GAME_SETTINGS } from "../src/constants/roomDefaults";
import { createNewGame, type GameState } from "../src/game";
import { deserializeGame } from "../src/codec";
import * as cache from "../src/playSnapshotCache";

// The cache only reads `gameId` and `revision`; a full snapshot is unnecessary
// and would only obscure what is under test.
const snap = (gameId: string, revision: number) => ({ gameId, revision }) as unknown as GameState;

const ROOM = "room-1";

beforeEach(() => {
  // Drain anything a previous test left queued first: the mirror is written on
  // an idle callback now, and a stray write landing mid-test would be measuring
  // the last test, not this one.
  cache.flushMirror();
  window.sessionStorage.clear();
  cache.forget(ROOM);
});

describe("play snapshot cache", () => {
  it("returns the snapshot it was given", () => {
    cache.remember(ROOM, snap("g1", 7));
    expect(cache.get(ROOM)).toMatchObject({ gameId: "g1", revision: 7 });
  });

  it("never lets an older revision overwrite a newer one", () => {
    cache.remember(ROOM, snap("g1", 7));
    cache.remember(ROOM, snap("g1", 5)); // a late, out-of-order write
    expect(cache.get(ROOM)?.revision).toBe(7);
  });

  it("adopts a newer revision of the same game", () => {
    cache.remember(ROOM, snap("g1", 7));
    cache.remember(ROOM, snap("g1", 9));
    expect(cache.get(ROOM)?.revision).toBe(9);
  });

  it("replaces wholesale when the game itself changes", () => {
    cache.remember(ROOM, snap("g1", 42));
    cache.remember(ROOM, snap("g2", 1));
    expect(cache.get(ROOM)).toMatchObject({ gameId: "g2", revision: 1 });
  });

  it("forgets a room so a return does not seed a game that is gone", () => {
    cache.remember(ROOM, snap("g1", 7));
    cache.forget(ROOM);
    expect(cache.get(ROOM)).toBeUndefined();
  });

  it("survives a page reload in the same tab", async () => {
    const game = { ...createNewGame(DEFAULT_NEW_GAME_SETTINGS), revision: 7 };
    cache.remember(ROOM, game);
    // What a real teardown does: the tab is going away, so the mirror is forced
    // out rather than left to an idle callback that will never run.
    cache.flushMirror();

    vi.resetModules();
    const reloadedCache = await import("../src/playSnapshotCache");

    expect(reloadedCache.get(ROOM)).toMatchObject({ gameId: game.gameId, revision: 7 });
  });
});

// ── Keeping the mirror off the interaction path ──────────────────────────────
//
// `remember` runs from the realtime handler and the reconcile poll, so on a live
// game it fires every few seconds. Encoding the whole match and writing it to
// sessionStorage there put a full serialization of the history on the main
// thread, between the player and the next frame. The write still has to happen —
// it is what survives a phone discarding a backgrounded tab — but not then.
describe("play snapshot mirror", () => {
  const storageKey = `eq-lab:play-snapshot:v1:${ROOM}`;

  it("does not touch sessionStorage on the calling tick", () => {
    const game = { ...createNewGame(DEFAULT_NEW_GAME_SETTINGS), revision: 3 };
    cache.remember(ROOM, game);

    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
    // The in-memory seed — the one a remount in this session reads — is current.
    expect(cache.get(ROOM)?.revision).toBe(3);
  });

  it("coalesces a burst into the newest snapshot", () => {
    const game = createNewGame(DEFAULT_NEW_GAME_SETTINGS);

    for (let revision = 1; revision <= 5; revision += 1) {
      cache.remember(ROOM, { ...game, revision });
    }
    // Nothing has been serialized yet, however many payloads arrived.
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();

    cache.flushMirror();

    // One snapshot is stored, and it is the last one — not the first, and not
    // each of the five in turn.
    expect(cache.get(ROOM)?.revision).toBe(5);
    const stored = window.sessionStorage.getItem(storageKey);
    expect(stored).not.toBeNull();
    expect(deserializeGame(stored!)?.revision).toBe(5);
  });

  it("flushes when the page is hidden, which may be its last chance to run", () => {
    const game = { ...createNewGame(DEFAULT_NEW_GAME_SETTINGS), revision: 11 };
    cache.remember(ROOM, game);
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();

    window.dispatchEvent(new Event("pagehide"));

    expect(window.sessionStorage.getItem(storageKey)).not.toBeNull();
  });
});
