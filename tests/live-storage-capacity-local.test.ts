// @vitest-environment node
import { expect, it } from "vitest";
import { call, player, policy, settings, sql } from "./live-security-browser/fixtures";
const local = process.env.LIVE_SECURITY_STATUS_FILE ? it : it.skip;

local(
  "authoritative private completion keeps History/Recent/Replay available when Free/Plus/Pro Saved is full",
  async () => {
    for (const [plan, capacity] of [
      [undefined, 100],
      ["plus", 1000],
      ["pro", 1000],
    ] as const) {
      const a = await player(plan),
        b = await player(),
        spectator = await player();
      sql(`with ids as (select gen_random_uuid() id from generate_series(1,${capacity})),
      h as (insert into public.game_history(source_kind,source_id,participant_id,game_id,participant_side,
        game_name,mode_key,game_mode,completed_at,result_authority)
        select 'normal',id,'${a.id}',id,'A','Capacity fixture','solo_practice','solo',now(),'client_reported'
        from ids returning source_id)
      insert into public.saved_game_items(source_kind,source_id,participant_id)
        select 'normal',source_id,'${a.id}' from h`);
      const usage = async () => {
        const result = await a.client.rpc("saved_game_usage");
        expect(result.error).toBeNull();
        return result.data[0];
      };
      expect(await usage()).toMatchObject({ active_count: capacity, capacity });
      const created = await call(a, {
        operation: "create",
        requestId: crypto.randomUUID(),
        settings: settings(a, b),
        policy: policy("private"),
      });
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      const id = created.body.id;
      await call(a, { operation: "ready", id });
      const ready = await call(b, { operation: "ready", id });
      const terminal = {
        operation: "action",
        id,
        revision: ready.body.match.revision,
        commandId: crypto.randomUUID(),
        action: { kind: "resign" },
      };
      const replies = await Promise.all([call(a, terminal), call(a, terminal), call(a, terminal)]);
      expect(replies.some((reply) => reply.status === 200)).toBe(true);
      expect(replies.every((reply) => [200, 404, 409, 400].includes(reply.status))).toBe(true);
      expect(await usage()).toMatchObject({ active_count: capacity, capacity });
      expect(sql(`select count(*) from public.game_history where source_id='${id}'`)).toBe("2");
      expect(sql(`select count(*) from public.recent_game_payloads where source_id='${id}'`)).toBe(
        "1",
      );
      expect(sql(`select count(*) from public.saved_game_items where source_id='${id}'`)).toBe("0");
      expect(sql(`select count(*) from public.room_live where room_id='${id}'`)).toBe("0");
      for (const who of [a, b]) {
        const history = await who.client.rpc("list_my_game_history", { p_limit: 20 });
        expect(history.error).toBeNull();
        expect(history.data.some((entry: any) => entry.game_id === id)).toBe(true);
        const replay = await call(who, { gameId: id }, "archive-replay");
        expect(replay.status).toBe(200);
        expect(replay.body.replay.finalRacks.A).toBeDefined();
        expect(replay.body.replay.finalRacks.B).toBeDefined();
      }
      expect((await call(spectator, { gameId: id }, "archive-replay")).status).toBe(404);
      expect(
        (
          await a.client.rpc("create_live_game", {
            target_state: {},
            target_access_scope: "private",
            target_archive_policy: "private",
            target_region_id: null,
            target_join_policy: "invite_only",
            target_private_parent_id: null,
          })
        ).error,
      ).not.toBeNull();
    }
  },
  60000,
);
