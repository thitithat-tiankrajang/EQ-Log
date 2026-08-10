import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_NEW_GAME_SETTINGS } from "../src/constants/roomDefaults";
import { createWaitingGame } from "../src/pregame";
import { makeRoomScope, roomBelongsToScope } from "../src/roomScope";
import { createRoom, duplicateRoom, listRooms } from "../src/rooms";

describe("room scope isolation", () => {
  beforeEach(() => window.localStorage.clear());

  it("requires a region id for private region rooms", () => {
    expect(makeRoomScope("public", null)).toEqual({ visibility: "public", regionId: null });
    expect(makeRoomScope("region", null)).toBeNull();
    expect(makeRoomScope("region", "north")).toEqual({
      visibility: "region",
      regionId: "north",
    });
  });

  it("never includes region rooms in the Public list or another region", () => {
    const game = createWaitingGame(DEFAULT_NEW_GAME_SETTINGS);
    const publicRoom = createRoom(game, { visibility: "public", regionId: null });
    const northRoom = createRoom(
      { ...game, gameId: crypto.randomUUID(), name: "North room" },
      { visibility: "region", regionId: "north" },
    );
    createRoom(
      { ...game, gameId: crypto.randomUUID(), name: "South room" },
      { visibility: "region", regionId: "south" },
    );

    expect(listRooms({ visibility: "public", regionId: null }).map((room) => room.id)).toEqual([
      publicRoom.id,
    ]);
    expect(listRooms({ visibility: "region", regionId: "north" }).map((room) => room.id)).toEqual([
      northRoom.id,
    ]);
    expect(
      roomBelongsToScope(
        { visibility: "region", regionId: "north" },
        { visibility: "region", regionId: "south" },
      ),
    ).toBe(false);
  });

  it("keeps a duplicated room inside its original scope", () => {
    const game = createWaitingGame(DEFAULT_NEW_GAME_SETTINGS);
    const original = createRoom(game, { visibility: "region", regionId: "north" });
    const copy = duplicateRoom(original.id);

    expect(copy).not.toBeNull();
    expect(listRooms({ visibility: "public", regionId: null })).toEqual([]);
    expect(listRooms({ visibility: "region", regionId: "north" })).toHaveLength(2);
  });
});
