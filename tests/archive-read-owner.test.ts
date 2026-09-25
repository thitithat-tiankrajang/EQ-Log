// A finished game read back from its archive still names its owner.
//
// Without the owner the app treated the player who had just finished the game as a spectator
// the moment the archive landed, and swapped every control and panel under them.
import { describe, expect, it, vi } from "vitest";
import { createNewGame } from "../src/game";
import { encodeGame } from "../src/codec";

const OWNER = "66666666-6666-4666-8666-666666666666";
const GAME = "77777777-7777-4777-8777-777777777777";

const selects = vi.hoisted(() => [] as { table: string; columns: string }[]);
const rows = vi.hoisted(() => ({ public: null as unknown }));

vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => {
        selects.push({ table, columns });
        const query = {
          eq: () => query,
          is: () => query,
          limit: () => query,
          maybeSingle: async () => ({
            data: table === "public_game_snapshots" ? rows.public : null,
            error: null,
          }),
        };
        return query;
      },
    }),
    rpc: async () => ({ data: null, error: null }),
  },
}));

import { readRoom } from "../src/remoteRooms";

describe("reading a finished game back", () => {
  it("asks the archive for its owner and keeps it", async () => {
    const game = {
      ...createNewGame({ name: "Done", playerA: "A", playerB: "B", startingSide: "A" }),
      status: "finished" as const,
    };
    rows.public = {
      game_id: GAME,
      source_owner_id: OWNER,
      name: "Done",
      player_a: "A",
      player_b: "B",
      game_mode: "versus",
      mode_key: "local_versus",
      turn_number: 1,
      score_a: 0,
      score_b: 0,
      snapshot: encodeGame(game),
      created_at: game.createdAt,
      finished_at: game.createdAt,
    };
    const payload = await readRoom(GAME);
    expect(selects.find((entry) => entry.table === "public_game_snapshots")?.columns).toContain(
      "source_owner_id",
    );
    expect(payload?.meta.ownerId).toBe(OWNER);
  });
});
