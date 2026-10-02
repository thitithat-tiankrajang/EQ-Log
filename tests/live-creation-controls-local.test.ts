// @vitest-environment node
import { expect, it } from "vitest";
import { call, player, policy, service, settings, sql } from "./live-security-browser/fixtures";
const local = ["closed", "stage-only"].includes(process.env.LIVE_SECURITY_CREATION_CONTROLS ?? "")
  ? it
  : it.skip;
local(
  "rollout switches close Normal and Stage creation without charges or disabling existing projections",
  async () => {
    const who = await player();
    const before = sql("select count(*) from public.room_live");
    expect(
      (await call(who, { operation: "create-stage", requestId: crypto.randomUUID() })).status,
    ).toBe(503);
    if (process.env.LIVE_SECURITY_CREATION_CONTROLS === "stage-only") {
      const opponent = await player();
      const created = await call(who, {
        operation: "create",
        requestId: crypto.randomUUID(),
        settings: settings(who, opponent),
        policy: policy("private"),
      });
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      expect((await call(who, { operation: "cancel", id: created.body.id })).status).toBe(200);
    } else {
      expect(
        (await call(who, { operation: "create", requestId: crypto.randomUUID() })).status,
      ).toBe(503);
    }
    expect(sql("select count(*) from public.room_live")).toBe(before);
    expect(sql(`select count(*) from public.probot_consumptions where user_id='${who.id}'`)).toBe(
      "0",
    );
    const existing = await service
      .from("room_live")
      .select("room_id")
      .eq("access_scope", "public")
      .limit(1)
      .single();
    expect(existing.error).toBeNull();
    const read = await call(who, { operation: "read", id: existing.data!.room_id });
    expect(read.status).toBe(200);
    expect(read.body.match.yourRack).toEqual([]);
    expect(JSON.stringify(read.body)).not.toMatch(
      /"(?:rackA|rackB|tilebag|canonical|history|session)"\s*:/,
    );
  },
  30000,
);
