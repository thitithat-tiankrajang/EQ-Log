// @vitest-environment node
import { expect, it } from "vitest";
import {
  authorityTestEnabled,
  call,
  player,
  resign,
  service,
  sql,
  stage,
} from "./helpers/liveAuthority";
const local = authorityTestEnabled ? it : it.skip;
local(
  "captures a sealed Stage atomically, once, through server-authoritative live commands",
  async () => {
    const owner = await player(),
      outsider = await player();
    const { levelId, match } = await stage(owner);
    expect((await call(owner, { gameId: match.id }, "archive-replay")).status).toBe(404);
    expect(JSON.stringify(match)).not.toMatch(
      /"(?:seed|rackB|tilebag|canonical|history|winning_replays|start_canonical)"\s*:/,
    );
    expect(
      (
        await call(outsider, {
          operation: "action",
          id: match.id,
          revision: match.revision,
          commandId: crypto.randomUUID(),
          action: { kind: "resign" },
        })
      ).status,
    ).toBe(404);
    for (const rpc of ["capture_stage_terminal", "create_stage_attempt", "finalize_live_game"])
      expect(
        sql(`select count(*)>0 and bool_and(not has_function_privilege('authenticated',p.oid,'EXECUTE'))
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='${rpc}'`),
      ).toBe("t");
    expect(
      (await owner.client.from("survival_levels").select("seed,start_canonical")).error,
    ).toBeTruthy();
    const reseal = await service
      .from("survival_levels")
      .update({ start_canonical: {} })
      .eq("id", levelId);
    expect(reseal.error?.message).toContain("stage_start_in_use");
    await resign(owner, match);
    const records = await service
      .from("stage_completed_attempts")
      .select("record,state_authority")
      .eq("room_id", match.id);
    expect(records.error).toBeNull();
    expect(records.data).toHaveLength(1);
    expect(records.data![0]!.state_authority).toBe("server_reduced");
    expect(records.data![0]!.record.provenance.completionAuthority).toBe("server-reduced");
    expect(
      sql(
        `select count(*) from public.game_history where source_id in (select id from public.survival_attempts where room_id='${match.id}')`,
      ),
    ).toBe("1");
    const attempt = await service
      .from("survival_attempts")
      .select("result,result_authority,finished_at")
      .eq("room_id", match.id)
      .single();
    expect(attempt.data).toMatchObject({ result: "loss", result_authority: "server_reduced" });
    expect(attempt.data!.finished_at).not.toBeNull();
    const replay = await call(owner, { gameId: match.id }, "archive-replay");
    expect(replay.status).toBe(200);
    expect(replay.body.replay.finalRacks.A).toBeDefined();
    expect(replay.body.replay.finalRacks.B).toBeDefined();
    expect((await call(outsider, { gameId: match.id }, "archive-replay")).status).toBe(404);
    expect(
      (await call(owner, { gameId: match.id, state: { status: "finished" } }, "stage-terminal"))
        .status,
    ).toBe(409);
  },
  30000,
);
