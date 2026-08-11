// The render seed that stops Play flashing "load → disappear → load" on return.
//
// The one property that makes it safe to render before revalidating: it can only
// ever move FORWARD. A late, lower-revision write of the same game is ignored, so
// a returning mount can never be seeded with a position the game has already
// left. A different game replaces wholesale, because that is not a comparison —
// it is a different subject.
import { beforeEach, describe, expect, it } from "vitest";

import type { GameState } from "../src/game";
import * as cache from "../src/playSnapshotCache";

// The cache only reads `gameId` and `revision`; a full snapshot is unnecessary
// and would only obscure what is under test.
const snap = (gameId: string, revision: number) =>
  ({ gameId, revision }) as unknown as GameState;

const ROOM = "room-1";

beforeEach(() => cache.forget(ROOM));

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
});
