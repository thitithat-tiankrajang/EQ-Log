import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { available, call, player, policy, settings, sql, type Player } from "./fixtures";

test.skip(!available, "Requires the isolated local security stack.");
const spent = (who: Player) =>
  Number(sql(`select count(*) from public.probot_consumptions where user_id='${who.id}'`));
const balance = (who: Player) =>
  Number(
    sql(
      `select coalesce((select balance from public.economy_balances where user_id='${who.id}' and currency='probot_credit'),0)`,
    ),
  );
const grant = (who: Player) =>
  sql(
    `select public.economy_post('${who.id}','probot_credit',5,'admin_grant','admin_request','security','security:${randomUUID()}','${who.id}','isolated fixture')`,
  );

test("Edge funding: Free/Plus/Pro exactly once, conflicts, no fallback, board limits and safe retries", async () => {
  for (const plan of [undefined, "plus", "pro"] as const) {
    const a = await player(plan);
    const body = {
      operation: "create",
      requestId: randomUUID(),
      settings: settings(a),
      policy: policy(),
      funding: plan ? "allowance" : "credit",
    };
    if (!plan) {
      const refused = await call(a, body);
      expect(refused.status).toBe(400);
      expect(refused.body.error).toContain("insufficient_credits");
      expect(spent(a)).toBe(0);
      grant(a);
      const noAllowance = await call(a, { ...body, requestId: randomUUID(), funding: "allowance" });
      expect(noAllowance.status).toBe(400);
      expect(balance(a)).toBe(5);
    }
    const before = await a.client.rpc("get_my_probot_status");
    expect(before.error).toBeNull();
    const made = await Promise.all([call(a, body), call(a, body), call(a, body)]);
    expect(made.map((result) => result.status)).toEqual([200, 200, 200]);
    expect(new Set(made.map((result) => result.body.id)).size).toBe(1);
    expect(spent(a)).toBe(1);
    const after = await a.client.rpc("get_my_probot_status");
    expect(after.error).toBeNull();
    if (plan) expect(after.data.allowance.available).toBe(before.data.allowance.available - 1);
    else expect(balance(a)).toBe(4);
    const conflict = await call(a, { ...body, funding: plan ? "credit" : "allowance" });
    expect(conflict.status).toBe(400);
    expect(conflict.body.error).toContain("idempotency_conflict");
    expect(spent(a)).toBe(1);
    const id = made[0].body.id;
    for (let retry = 0; retry < 3; retry++)
      expect((await call(a, { operation: "read", id })).status).toBe(200);
    expect(spent(a)).toBe(1);
    // The unsafe raw browser creation primitive remains revoked.
    expect(
      (
        await a.client.rpc("create_bot_game", {
          target_request_id: randomUUID(),
          target_bot_key: "authur_strong",
          target_bot_side: "B",
          target_state: {},
          target_access_scope: "public",
          target_archive_policy: "public",
          target_join_policy: "invite_only",
          target_funding: "credit",
        })
      ).error,
    ).toBeTruthy();
  }

  const a = await player("plus"),
    b = await player(),
    host = await player();
  grant(a);
  const first = await call(a, {
    operation: "create",
    requestId: randomUUID(),
    settings: settings(a),
    policy: policy(),
    funding: "allowance",
  });
  expect(first.status).toBe(200);
  const second = await call(a, {
    operation: "create",
    requestId: randomUUID(),
    settings: settings(a, b),
    policy: policy(),
  });
  expect(second.status).toBe(200);
  const third = await call(host, {
    operation: "create",
    requestId: randomUUID(),
    settings: { ...settings(a, b), emailPlayMode: "hosted" },
    policy: policy(),
  });
  expect(third.status).toBe(200);
  expect(Number(sql(`select public.active_board_count('${a.id}',now(),null,null)`))).toBe(3);
  expect(Number(sql(`select public.active_board_count('${host.id}',now(),null,null)`))).toBe(0);
  expect(Number(sql(`select public.active_board_count('${b.id}',now(),null,null)`))).toBe(2);
  const over = {
    operation: "create",
    requestId: randomUUID(),
    settings: settings(a),
    policy: policy(),
    funding: "credit",
  };
  const refused = await call(a, over);
  expect(refused.status).toBe(400);
  expect(refused.body.error).toContain("active_board_limit");
  expect(balance(a)).toBe(5);
  expect(spent(a)).toBe(1);
  const ranked = await call(a, { operation: "create", minutesA: 10, minutesB: 10 }, "ranked");
  expect(ranked.status).toBeGreaterThanOrEqual(400);
  expect(JSON.stringify(ranked.body)).toContain("active_board_limit");
  // Lowering the configured limit never prevents reconnect or a move on an
  // existing board. It must prevent gaining a new board.
  sql("update public.system_settings set value_int=1 where key='max_active_boards_per_user'");
  try {
    expect((await call(a, { operation: "read", id: first.body.id })).status).toBe(200);
    const ready = await call(a, { operation: "ready", id: first.body.id });
    expect(ready.status).toBe(200);
    const pass = await call(a, {
      operation: "action",
      id: first.body.id,
      revision: ready.body.match.revision,
      commandId: randomUUID(),
      action: { kind: "pass" },
    });
    expect(pass.status).toBe(200);
    expect(
      Number(
        sql(
          `select count(*) from public.live_bot_jobs where room_id='${first.body.id}' and revision=${pass.body.match.revision}`,
        ),
      ),
    ).toBe(1);
    expect(spent(a)).toBe(1);
  } finally {
    sql("update public.system_settings set value_int=3 where key='max_active_boards_per_user'");
  }
  expect((await call(a, { operation: "cancel", id: second.body.id })).status).toBe(200);
  const retry = await Promise.all([call(a, over), call(a, over)]);
  expect(retry.map((result) => result.status)).toEqual([200, 200]);
  expect(new Set(retry.map((result) => result.body.id)).size).toBe(1);
  expect(spent(a)).toBe(2);
  expect(balance(a)).toBe(4);
});
