// @vitest-environment node
import { expect, it } from "vitest";
import {
  authorityTestEnabled,
  call,
  normal,
  player,
  resign,
  service,
} from "./helpers/liveAuthority";
const local = authorityTestEnabled ? it : it.skip;
local(
  "creates one History entry per seated user under concurrent authoritative terminal commands",
  async () => {
    const a = await player(),
      b = await player(),
      spectator = await player();
    const match = await normal(a, b);
    await resign(a, match);
    const history = await service
      .from("game_history")
      .select("participant_id,result_authority")
      .eq("source_id", match.id);
    expect(history.error).toBeNull();
    expect(history.data).toHaveLength(2);
    expect(history.data).toEqual(
      expect.arrayContaining([
        { participant_id: a.id, result_authority: "server_reduced" },
        { participant_id: b.id, result_authority: "server_reduced" },
      ]),
    );
    for (const who of [a, b]) {
      const page = await who.client.rpc("list_my_game_history", { p_limit: 20 });
      expect(page.error).toBeNull();
      expect(page.data).toEqual(
        expect.arrayContaining([expect.objectContaining({ game_id: match.id, is_recent: true })]),
      );
      const replay = await call(who, { gameId: match.id }, "archive-replay");
      expect(replay.status).toBe(200);
      expect(replay.body.replay.finalRacks.A).toBeDefined();
      expect(replay.body.replay.finalRacks.B).toBeDefined();
    }
    expect((await spectator.client.rpc("list_my_game_history", { p_limit: 20 })).data).toEqual([]);
    expect((await call(spectator, { gameId: match.id }, "archive-replay")).status).toBe(404);
    expect((await a.client.from("game_history").select("*")).error).toBeTruthy();
    expect(
      (await a.client.from("game_history").update({ outcome: "win" }).eq("source_id", match.id))
        .error,
    ).toBeTruthy();
    expect(
      (
        await a.client.rpc("finalize_live_game", {
          target_game_id: match.id,
          target_state: {},
          target_completion_kind: "terminated",
          target_completion_reason: "manual",
          target_surrendered_side: null,
        })
      ).error,
    ).toBeTruthy();
  },
  30000,
);
