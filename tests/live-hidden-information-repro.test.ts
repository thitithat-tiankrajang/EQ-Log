import { beforeEach, expect, it, vi } from "vitest";
import { createNewGame } from "../src/game";
import { encodeGame } from "../src/codec";

const database = vi.hoisted(() => ({ row: null as unknown }));
vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: database.row, error: null }) }),
      }),
    }),
    rpc: async () => ({ data: null, error: null }),
  },
}));
import { readRoom } from "../src/remoteRooms";

beforeEach(() => {
  const game = createNewGame({
    name: "secrecy repro",
    playerA: "A",
    playerB: "B",
    tileDrawMode: "play",
    startingSide: "A",
  });
  database.row = {
    room_id: "room",
    state: encodeGame(game),
    revision: 0,
    status: "playing",
    owner_id: "A",
  };
});

it("retires the raw live GameState browser reader rather than returning opponent secrets", async () => {
  await expect(readRoom("room")).rejects.toThrow(/recipient|live.*projection/i);
});
