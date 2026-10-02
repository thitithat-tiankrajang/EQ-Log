// @vitest-environment node
import { expect, it } from "vitest";
import { authorityTestEnabled, call, player, policy, service, sql } from "./helpers/liveAuthority";
const local = authorityTestEnabled ? it : it.skip;

for (const hosted of [false, true])
  local(
    `secure ${hosted ? "Hosted" : "self-directed"} Solo starts from one Ready seat and preserves lifecycle/Replay`,
    async () => {
      const a = await player(),
        host = hosted ? await player() : a,
        other = await player();
      const created = await call(host, {
        operation: "create",
        requestId: crypto.randomUUID(),
        policy: policy("private"),
        settings: {
          name: "Solo compatibility",
          gameMode: "solo",
          playerA: "Solo",
          playerB: "",
          playerAUserId: a.id,
          startingSide: "A",
          tileDrawMode: "play",
          emailPlayMode: hosted ? "hosted" : undefined,
          untimed: true,
        },
      });
      expect(created.status).toBe(200);
      const id = created.body.id;
      const ready = await call(a, { operation: "ready", id });
      expect(ready.status).toBe(200);
      expect(ready.body.match).toMatchObject({ status: "playing", activeSide: "A", yourSide: "A" });
      expect(ready.body.match.yourRack).toHaveLength(8);
      const passed = await call(a, {
        operation: "action",
        id,
        revision: ready.body.match.revision,
        commandId: crypto.randomUUID(),
        action: { kind: "pass" },
      });
      expect(passed.status).toBe(200);
      expect(passed.body.match.activeSide).toBe("A");
      expect(passed.body.match.turnNumber).toBe(ready.body.match.turnNumber + 1);
      let view = (await call(host, { operation: "read", id })).body.match;
      expect(view.canAdminister).toBe(true);
      if (hosted) expect(view.yourRack).toEqual([]);
      expect(
        (
          await call(other, {
            operation: "admin",
            id,
            revision: view.revision,
            commandId: crypto.randomUUID(),
            action: { kind: "pause" },
          })
        ).status,
      ).toBe(404);
      for (const kind of ["pause", "resume", "finish"]) {
        const reply = await call(host, {
          operation: "admin",
          id,
          revision: view.revision,
          commandId: crypto.randomUUID(),
          action: { kind },
        });
        expect(reply.status, `${kind} must use authoritative Solo lifecycle`).toBe(200);
        view = reply.body.match;
      }
      const replay = await call(a, { gameId: id }, "archive-replay");
      expect(replay.status).toBe(200);
      expect(replay.body.replay.finalRacks.A).toHaveLength(8);
      expect(sql(`select count(*) from public.game_history where source_id='${id}'`)).toBe("1");
    },
    30000,
  );

local(
  "F10/F27: physical Hosted creation must support the required recording workflow",
  async () => {
    const host = await player(),
      a = await player(),
      b = await player();
    const created = await call(host, {
      operation: "create",
      requestId: crypto.randomUUID(),
      policy: policy("private"),
      settings: {
        name: "Physical Hosted",
        gameMode: "versus",
        playerA: "A",
        playerB: "B",
        playerAUserId: a.id,
        playerBUserId: b.id,
        emailPlayMode: "hosted",
        tileDrawMode: "manual",
        startingSide: "A",
        untimed: true,
      },
    });
    expect(
      created.status,
      "Physical Hosted is required product behavior; refusing it is not compatibility",
    ).toBe(200);
  },
  30000,
);

local(
  "F07: Pass & Play retains its mode identity and supports a second-player handoff",
  async () => {
    const owner = await player();
    const created = await call(owner, {
      operation: "create",
      requestId: crypto.randomUUID(),
      policy: policy("private"),
      settings: {
        name: "Pass & Play",
        gameMode: "versus",
        playerA: "A",
        playerB: "B",
        tileDrawMode: "play",
        startingSide: "A",
        untimed: true,
      },
    });
    expect(created.status).toBe(200);
    const read = await call(owner, { operation: "read", id: created.body.id });
    expect(read.body.match.mode, "Pass & Play cannot silently become an A-only online match").toBe(
      "local_versus",
    );
    const ready = await call(owner, { operation: "ready", id: created.body.id });
    expect(ready.body.match.status).toBe("playing");
  },
  30000,
);

local(
  "legacy cutover preserves private evidence, gates old metadata writers, and protects active completion",
  async () => {
    const legacyId = sql(
      "select room_id from private.live_legacy_quarantine order by quarantined_at limit 1",
    );
    expect(legacyId, "Actual pre-security cutover fixture required").toMatch(/^[0-9a-f-]{36}$/);
    expect(
      sql(
        `select (q.room_row->'state'=l.state and q.room_row->'canonical'=l.canonical and (q.room_row->>'revision')::bigint=l.revision)::text from private.live_legacy_quarantine q join public.room_live l on l.room_id=q.room_id where q.room_id='${legacyId}'`,
      ),
    ).toBe("true");
    const approved = await player();
    expect(
      (await approved.client.rpc("join_live_game", { target_game_id: legacyId })).error,
    ).toBeTruthy();
    expect(
      (
        await approved.client.rpc("set_room_ready", {
          target_room_id: legacyId,
          target_side: "A",
          target_ready: true,
        })
      ).error,
    ).toBeTruthy();
    for (const fn of [
      "join_live_game_before_security_gate",
      "set_room_ready_before_security_gate",
      "cancel_live_game_before_security_gate",
    ])
      expect(
        sql(
          `select has_function_privilege('authenticated',oid,'EXECUTE') from pg_proc where proname='${fn}'`,
        ),
      ).toBe("f");
    const a = await player(),
      b = await player();
    const created = await call(a, {
      operation: "create",
      requestId: crypto.randomUUID(),
      policy: policy("private"),
      settings: {
        name: "Active deletion gate",
        gameMode: "versus",
        playerA: "A",
        playerB: "B",
        playerAUserId: a.id,
        playerBUserId: b.id,
        emailPlayMode: "direct",
        tileDrawMode: "play",
        untimed: true,
      },
    });
    expect(created.status).toBe(200);
    const id = created.body.id;
    await call(a, { operation: "ready", id });
    await call(b, { operation: "ready", id });
    expect((await call(a, { operation: "cancel", id })).status).toBe(403);
    expect(sql(`select count(*) from public.room_live where room_id='${id}'`)).toBe("1");
    expect(
      (await service.from("room_live").select("authority_protocol").eq("room_id", id).single())
        .data!.authority_protocol,
    ).toBe("server-v1");
  },
  30000,
);
