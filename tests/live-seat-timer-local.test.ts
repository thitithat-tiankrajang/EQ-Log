// @vitest-environment node
import { expect, it } from "vitest";
import { call, player, policy, settings, sql, authorityTestEnabled } from "./helpers/liveAuthority";
import { spawn } from "node:child_process";
const local = authorityTestEnabled ? it : it.skip;
local(
  "open seat and room-code joins change capability revision, invalidate Ready and preserve recipient scope",
  async () => {
    for (const byCode of [false, true]) {
      const a = await player(),
        b = await player();
      const created = await call(a, {
        operation: "create",
        requestId: crypto.randomUUID(),
        settings: { ...settings(a, b), playerBUserId: null },
        policy: {
          ...policy(byCode ? "private" : "public"),
          joinPolicy: byCode ? "code_only" : "open",
        },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      const id = created.body.id;
      const before = (await call(a, { operation: "read", id })).body.match;
      const joined = await b.client.rpc(
        "join_live_game",
        byCode ? { target_room_code: created.body.roomCode } : { target_game_id: id },
      );
      expect(joined.error).toBeNull();
      const after = (await call(b, { operation: "read", id })).body.match;
      expect(after.yourSide).toBe("B");
      expect(after.revision).toBe(before.revision + 1);
      expect(after.yourRack).toEqual([]);
      const duplicate = await b.client.rpc(
        "join_live_game",
        byCode ? { target_room_code: created.body.roomCode } : { target_game_id: id },
      );
      expect(duplicate.error).toBeNull();
      expect((await call(b, { operation: "read", id })).body.match.revision).toBe(after.revision);
      const stale = await call(a, {
        operation: "control",
        id,
        revision: before.revision,
        commandId: crypto.randomUUID(),
        action: { kind: "configure", settings: before.waitingSettings },
      });
      expect(stale.status).toBe(409);
      expect((await call(a, { operation: "cancel", id })).status).toBe(200);
    }
  },
  30000,
);
local(
  "region access and the baseline private autosave retirement preserve scope without live snapshots",
  async () => {
    const a = await player(),
      b = await player(),
      outsider = await player();
    const region = crypto.randomUUID(),
      folder = crypto.randomUUID();
    sql(
      `insert into public.regions(id,name) values('${region}','Local region ${region}');update public.profiles set region_id='${region}' where id in ('${a.id}','${b.id}');insert into public.private_library_items(id,owner_id,item_type,name) values('${folder}','${a.id}','folder','Local destination')`,
    );
    const regional = await call(a, {
      operation: "create",
      requestId: crypto.randomUUID(),
      settings: settings(a, b),
      policy: { ...policy("region"), regionId: region },
    });
    expect(regional.status, JSON.stringify(regional.body)).toBe(200);
    expect((await call(outsider, { operation: "read", id: regional.body.id })).status).toBe(404);
    const denied = await outsider.client.rpc("join_live_game", {
      target_room_code: regional.body.roomCode,
    });
    expect(denied.error).not.toBeNull();
    expect((await call(a, { operation: "cancel", id: regional.body.id })).status).toBe(200);
    const privateRoom = await call(a, {
      operation: "create",
      requestId: crypto.randomUUID(),
      settings: settings(a, b),
      policy: { ...policy("private"), privateParentId: folder },
    });
    expect(privateRoom.status).toBe(200);
    const id = privateRoom.body.id;
    await call(a, { operation: "ready", id });
    const ready = await call(b, { operation: "ready", id });
    expect(
      (
        await call(a, {
          operation: "action",
          id,
          revision: ready.body.match.revision,
          commandId: crypto.randomUUID(),
          action: { kind: "resign" },
        })
      ).status,
    ).toBe(200);
    expect(
      sql(
        `select count(*) from public.private_library_items where source_game_id='${id}' and parent_id='${folder}'`,
      ),
    ).toBe("0");
    const saved = await a.client.rpc("save_completed_game", {
      p_source_kind: "normal",
      p_source_id: id,
    });
    expect(saved.error).toBeNull();
    expect(
      sql(
        `select count(*) from public.saved_game_items where participant_id='${a.id}' and source_id='${id}'`,
      ),
    ).toBe("1");
  },
  30000,
);
local(
  "Authur as A starts and commits its full trusted turn before human B, with exactly one funding consumption",
  async () => {
    const a = await player("plus");
    const created = await call(a, {
      operation: "create",
      requestId: crypto.randomUUID(),
      policy: policy("private"),
      funding: "allowance",
      settings: {
        name: "Authur A",
        gameMode: "versus",
        playerA: "Authur",
        playerB: "Human B",
        botSide: "A",
        botEngine: "authur",
        botDifficulty: "super",
        startingSide: "A",
        tileDrawMode: "play",
        untimed: true,
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const id = created.body.id;
    const ready = await call(a, { operation: "ready", id });
    expect(ready.body.match.activeSide).toBe("A");
    expect(ready.body.match.yourSide).toBe("B");
    const worker = spawn(
      process.execPath,
      [
        `--env-file=${process.env.LIVE_SECURITY_WORKER_ENV_FILE}`,
        "services/trusted-bot/worker.mjs",
      ],
      { stdio: "ignore" },
    );
    try {
      let view = ready.body.match;
      const end = Date.now() + 90000;
      while (view.botTurn && Date.now() < end) {
        await new Promise((r) => setTimeout(r, 200));
        view = (await call(a, { operation: "read", id })).body.match;
      }
      expect(view.botTurn).toBe(false);
      expect(view.logs[0].side).toBe("A");
      expect(view.logs[0].rackBefore).toBeUndefined();
      expect(view.activeSide).toBe("B");
      expect(sql(`select count(*) from public.probot_consumptions where room_id='${id}'`)).toBe(
        "1",
      );
      expect(JSON.stringify(view)).not.toMatch(/"(?:canonical|tilebag|rackA|history|seed)"\s*:/);
    } finally {
      worker.kill("SIGTERM");
      await new Promise<void>((resolve) => worker.once("exit", () => resolve()));
    }
  },
  120000,
);
local(
  "asymmetric clocks keep an untimed side, clamp normal overtime and pause Save & Exit for Solo",
  async () => {
    const a = await player();
    const created = await call(a, {
      operation: "create",
      requestId: crypto.randomUUID(),
      policy: policy("private"),
      settings: {
        name: "Solo clocks",
        gameMode: "solo",
        playerA: "Solo",
        playerB: "",
        playerAUserId: a.id,
        startingSide: "A",
        tileDrawMode: "play",
        timerMinutes: { A: 1, B: null },
      },
    });
    expect(created.status).toBe(200);
    let view = (await call(a, { operation: "ready", id: created.body.id })).body.match;
    expect(view.clockPolicy.untimed.B).toBe(true);
    sql(
      `update public.room_live set state=jsonb_set(state,'{currentTurnStartedAt}',to_jsonb((now()-interval '3 hours')::text)) where room_id='${view.id}'`,
    );
    const moved = await call(a, {
      operation: "action",
      id: view.id,
      revision: view.revision,
      commandId: crypto.randomUUID(),
      action: { kind: "pass" },
    });
    expect(moved.status).toBe(200);
    view = moved.body.match;
    expect(view.status).toBe("playing");
    expect(view.timers.A).toBe(view.clockPolicy.minSeconds);
    const paused = await call(a, {
      operation: "control",
      id: view.id,
      revision: view.revision,
      commandId: crypto.randomUUID(),
      action: { kind: "save-exit" },
    });
    expect(paused.status, JSON.stringify(paused.body)).toBe(200);
    expect(paused.body.match.paused).toBe(true);
    expect((await call(a, { operation: "read", id: view.id })).body.match.timers).toEqual(
      paused.body.match.timers,
    );
  },
  30000,
);
