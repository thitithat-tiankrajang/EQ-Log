// Local rooms are written to localStorage, but not on the tick that changes
// them.
//
// The one caller of `saveRoomState` runs on every change to the game, and
// encoding a match — history, and every TurnLog's two board snapshots and two
// tilebags — is not something to do between a tap and the next frame. So the
// encode is deferred and coalesced.
//
// Deferring is only safe while two things hold, and this file is what holds
// them: a read in the same session must see what was last saved, and the write
// must be forced out before the page can be taken away.

import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_NEW_GAME_SETTINGS } from "../src/constants/roomDefaults";
import { createNewGame, type GameState } from "../src/game";
import * as roomStore from "../src/rooms";

const ROOM = "room-writes";
const key = `amath-lab-room-${ROOM}`;

function game(name: string): GameState {
  return { ...createNewGame(DEFAULT_NEW_GAME_SETTINGS), name };
}

beforeEach(() => {
  window.localStorage.clear();
  roomStore.flushRoomWrites();
  window.localStorage.clear();
});

describe("deferred local room writes", () => {
  it("does not encode the match on the calling tick", () => {
    roomStore.saveRoomState(ROOM, game("first"));
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it("reads back what was saved, before it has been written", () => {
    roomStore.saveRoomState(ROOM, game("only in memory"));
    expect(roomStore.readRoom(ROOM)?.name).toBe("only in memory");
  });

  it("coalesces a burst into the last state", () => {
    for (const name of ["a", "b", "c"]) roomStore.saveRoomState(ROOM, game(name));
    roomStore.flushRoomWrites();
    expect(roomStore.readRoom(ROOM)?.name).toBe("c");
  });

  it("flushes when the page is hidden, which may be its last chance to run", () => {
    roomStore.saveRoomState(ROOM, game("survives"));
    expect(window.localStorage.getItem(key)).toBeNull();

    window.dispatchEvent(new Event("pagehide"));

    expect(window.localStorage.getItem(key)).not.toBeNull();
    expect(roomStore.readRoom(ROOM)?.name).toBe("survives");
  });

  it("does not resurrect a room that was deleted while a write was pending", () => {
    roomStore.saveRoomState(ROOM, game("doomed"));
    roomStore.deleteRoom(ROOM);
    roomStore.flushRoomWrites();

    expect(roomStore.readRoom(ROOM)).toBeNull();
    expect(window.localStorage.getItem(key)).toBeNull();
  });
});
