import { afterEach, describe, expect, it, vi } from "vitest";

// Home's choices from rows shaped exactly as `list_live_games` returns them,
// through the real remoteRooms mapper (only the network call is stubbed). The
// server's "waiting" and "paused" reach Home as "draft": a Home that looked for
// the server's words never showed a room that had not started.
const rpc = vi.hoisted(() => vi.fn());
vi.mock("../src/supabaseClient", () => ({ isSupabaseConfigured: true, supabase: { rpc } }));

import { continuableGames, openGames } from "../src/features/arena/arenaGames";
import { listPrivateRooms, listRooms } from "../src/remoteRooms";
import type { RoomMeta } from "../src/rooms";

function row(
  name: string,
  status: string,
  viewerRole: string,
  extra: Record<string, unknown> = {},
) {
  return {
    room_id: `id-${name}`,
    name,
    player_a: "Hana",
    player_b: "Omar",
    status,
    access_scope: "public",
    archive_policy: "public",
    join_policy: "invite_only",
    region_id: null,
    game_mode: "versus",
    mode_key: null,
    starting_side: "A",
    turn_number: 0,
    score_a: 0,
    score_b: 0,
    created_at: "2026-09-28T10:00:00Z",
    updated_at: "2026-09-28T10:00:00Z",
    owner_name: "Hana",
    viewer_role: viewerRole,
    can_manage: viewerRole === "Owner",
    has_opponent: true,
    ...extra,
  };
}

const roleOf = (room: RoomMeta) => room.viewerRole ?? "Spectator";

afterEach(() => rpc.mockReset());

describe("Home with the server's own room rows", () => {
  it("offers games that are waiting to start or paused, not only ones being played", async () => {
    rpc.mockResolvedValueOnce({
      data: [
        row("waiting-mine", "waiting", "Owner"),
        row("paused-mine", "paused", "Player B"),
        row("playing-mine", "playing", "Player A"),
        row("waiting-theirs", "waiting", "Spectator"),
      ],
      error: null,
    });
    const rooms = await listRooms({ visibility: "public", regionId: null });
    expect(
      continuableGames(rooms, roleOf)
        .map((room) => room.name)
        .sort(),
    ).toEqual(["paused-mine", "playing-mine", "waiting-mine"]);
  });

  it("offers another player's open seat, and a private game of yours, as the lists give them", async () => {
    rpc.mockResolvedValueOnce({
      data: [
        row("open-seat", "waiting", "Spectator", { join_policy: "open", has_opponent: false }),
        row("started", "playing", "Spectator", { join_policy: "open" }),
      ],
      error: null,
    });
    const rooms = await listRooms({ visibility: "public", regionId: null });
    expect(openGames(rooms, roleOf).map((room) => room.name)).toEqual(["open-seat"]);

    rpc.mockResolvedValueOnce({
      data: [
        row("private-mine", "waiting", "Owner", {
          access_scope: "private",
          archive_policy: "private",
        }),
      ],
      error: null,
    });
    const privateRooms = await listPrivateRooms();
    expect(continuableGames(privateRooms, roleOf).map((room) => room.name)).toEqual([
      "private-mine",
    ]);
  });
});
