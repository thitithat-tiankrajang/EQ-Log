// Ending a game is the one write a player cannot retry their way out of, and it
// takes a different path from every other write: `finalize_live_game` instead of
// the conditional command commit.
//
// What is pinned here is not the happy path — it is what the player is TOLD when
// it fails. A finish that reports the wrong cause sends someone to re-run a
// migration that was already applied, while the real refusal goes unread.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_NEW_GAME_SETTINGS } from "../src/constants/roomDefaults";
import { createNewGame, type GameState } from "../src/game";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: { rpc },
}));

import { commitRoomState } from "../src/remoteRooms";

const ROOM_ID = "55555555-5555-4555-8555-555555555555";

function finishedGame(): GameState {
  const game = createNewGame({ ...DEFAULT_NEW_GAME_SETTINGS, tileDrawMode: "play" });
  return { ...game, status: "finished", timers: { ...game.timers, paused: true } };
}

/** Fail the next RPC the way PostgREST reports a Postgres error. */
function failWith(error: {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}) {
  rpc.mockImplementation(async () => ({ data: null, error }));
}

describe("finishing a game", () => {
  beforeEach(() => rpc.mockReset());

  it("goes through finalize_live_game, not the command commit", async () => {
    rpc.mockImplementation(async () => ({ data: null, error: null }));
    await commitRoomState({ id: ROOM_ID, game: finishedGame() });

    const names = rpc.mock.calls.map((call) => call[0] as string);
    expect(names).toContain("finalize_live_game");
    expect(names).not.toContain("commit_live_game_command");
  });

  it("reports what the database actually refused, naming the function is not enough", async () => {
    // The regression. This branch used to fire on the FUNCTION NAME alone, so a
    // permission failure — which necessarily names the function — was reported
    // as a missing schema, and the player was told to run a migration that was
    // already there.
    failWith({
      message: "permission denied for function public.finalize_live_game",
      code: "42501",
    });

    await expect(commitRoomState({ id: ROOM_ID, game: finishedGame() })).rejects.toThrow(
      /permission denied/i,
    );
    await expect(commitRoomState({ id: ROOM_ID, game: finishedGame() })).rejects.not.toThrow(
      /not enabled yet/i,
    );
  });

  it("passes a rule the finish broke straight through", async () => {
    // One of the nine `raise` sites inside finalize_live_game. None of them
    // names the function, and all of them are the answer to "why did it fail".
    failWith({ message: "natural completion does not match the final game log", code: "22023" });
    await expect(commitRoomState({ id: ROOM_ID, game: finishedGame() })).rejects.toThrow(
      /natural completion does not match/i,
    );
  });

  it("carries the code, details and hint, not just the sentence", async () => {
    // `23514` and `42501` read very differently to anyone diagnosing this, and
    // neither is visible in the sentence a `raise` produces.
    failWith({
      message: "new row violates check constraint",
      code: "23514",
      details: "Failing row contains (aether_super).",
      hint: "Run supabase/bot_super_tier_migration.sql.",
    });

    await expect(commitRoomState({ id: ROOM_ID, game: finishedGame() })).rejects.toThrow(
      /aether_super/,
    );
    await expect(commitRoomState({ id: ROOM_ID, game: finishedGame() })).rejects.toThrow(/23514/);
  });

  it("still says which migration to run when the function is genuinely absent", async () => {
    failWith({
      message: "Could not find the function public.finalize_live_game in the schema cache",
      code: "PGRST202",
    });
    await expect(commitRoomState({ id: ROOM_ID, game: finishedGame() })).rejects.toThrow(
      /game_archives_migration\.sql/,
    );
  });
});
