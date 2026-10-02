// @vitest-environment node
/** Real JWT/RLS/Edge/lifecycle gate. Only an explicitly supplied loopback stack. */
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { decodeGame, encodeGame, serializeGame } from "../src/codec";
import { buildCompletedGameRecord } from "../src/completedGame/record";
import { displayToken } from "../src/game";
import { stageStartCanonical } from "../src/features/survival/sealedStart";
const workdir = process.env.LIVE_SECURITY_TEST_WORKDIR;
const local = workdir ? it : it.skip;

local(
  "enforces every live access path and commits Replay only with successful persistence",
  async () => {
    const status = execFileSync("supabase", ["status", "--workdir", workdir!, "-o", "env"], {
      encoding: "utf8",
    });
    const env: Record<string, string> = {};
    for (const line of status.split("\n")) {
      const item = line.match(/^([A-Z_]+)="?([^"\n]+)"?$/);
      if (item) env[item[1]!] = item[2]!;
    }
    if (!env.API_URL?.startsWith("http://127.0.0.1:") || !env.DB_URL?.includes("127.0.0.1"))
      throw new Error("Isolated loopback stack required.");
    const service = createClient(env.API_URL, env.SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const users: string[] = [];
    const games: string[] = [];
    const levels: string[] = [];
    const subscriptions: Array<{ client: ReturnType<typeof createClient>; channel: any }> = [];
    const sql = (query: string) =>
      execFileSync("psql", [env.DB_URL!, "-v", "ON_ERROR_STOP=1", "-Atc", query], {
        encoding: "utf8",
      });
    async function user(admin = false) {
      const email = `live-${crypto.randomUUID()}@example.test`;
      const password = "Live-test-only-2026!";
      const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user) throw created.error;
      const id = created.data.user.id;
      users.push(id);
      const profile = await service
        .from("profiles")
        .update({ status: "approved", is_admin: admin })
        .eq("id", id);
      if (profile.error) throw profile.error;
      const client = createClient(env.API_URL!, env.ANON_KEY!, { auth: { persistSession: false } });
      const signed = await client.auth.signInWithPassword({ email, password });
      if (signed.error || !signed.data.session) throw signed.error;
      return { id, client, token: signed.data.session.access_token };
    }
    type User = Awaited<ReturnType<typeof user>>;
    const owners = new Map<string, User>();
    async function call(actor: User, name: string, body: unknown) {
      const input = body as any;
      if (name === "live-game" && input.operation === "ready") {
        const read = await call(actor, name, { operation: "read", id: input.id });
        const ready = await call(actor, name, {
          operation: "control",
          id: input.id,
          revision: read.body.match.revision,
          commandId: crypto.randomUUID(),
          action: { kind: "ready", ready: true },
        });
        if (ready.status !== 200) return ready;
        const owner = owners.get(input.id);
        if (owner) {
          const view = await call(owner, name, { operation: "read", id: input.id });
          if (view.body.match.canLaunch) {
            const launch = await call(owner, name, {
              operation: "control",
              id: input.id,
              revision: view.body.match.revision,
              commandId: crypto.randomUUID(),
              action: { kind: "launch" },
            });
            expect(launch.status).toBe(200);
            await new Promise((resolve) => setTimeout(resolve, 3100));
            const start = await call(owner, name, {
              operation: "control",
              id: input.id,
              revision: launch.body.match.revision,
              commandId: crypto.randomUUID(),
              action: { kind: "start" },
            });
            expect(start.status).toBe(200);
          }
        }
        return call(actor, name, { operation: "read", id: input.id });
      }
      const response = await fetch(`${env.API_URL}/functions/v1/${name}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${actor.token}`,
          apikey: env.ANON_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (name === "live-game" && input.operation === "create" && response.status === 200)
        owners.set(payload.id, actor);
      return {
        status: response.status,
        body: payload as any,
        cache: response.headers.get("cache-control"),
      };
    }
    async function create(a: User, b: User, policy = "public", bot = false) {
      const requestId = crypto.randomUUID();
      const body = {
        operation: "create",
        requestId,
        settings: {
          name: "Security gate",
          playerA: "A",
          playerB: bot ? "Authur" : "B",
          playerAUserId: a.id,
          playerBUserId: bot ? null : b.id,
          startingSide: "A",
          untimed: true,
          tileDrawMode: "play",
          ...(bot ? { botSide: "B", botEngine: "authur", botDifficulty: "super" } : {}),
        },
        policy: {
          accessScope: policy,
          archivePolicy: policy,
          joinPolicy: "invite_only",
          regionId: null,
        },
      };
      const result = await call(a, "live-game", body);
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      games.push(result.body.id);
      const retry = await call(a, "live-game", body);
      expect(retry.status, JSON.stringify(retry.body)).toBe(200);
      expect(retry.body.id).toBe(result.body.id);
      return { id: result.body.id, requestId };
    }
    try {
      sql(
        "insert into private.runtime_secrets(key,value) values ('room_code_secret',repeat('s',40)) on conflict(key) do nothing",
      );
      const a = await user(true),
        b = await user(),
        spectator = await user();
      const { id } = await create(a, b);
      const initialPrivate = await service
        .from("room_live")
        .select("state")
        .eq("room_id", id)
        .single();
      if (initialPrivate.error) throw initialPrivate.error;
      const opening = decodeGame(initialPrivate.data.state);
      for (const actor of [a, b, spectator]) {
        const raw = await actor.client
          .from("room_live")
          .select("state,canonical,session")
          .eq("room_id", id);
        expect(raw.error).toBeTruthy();
        for (const table of ["game_timelines", "live_game_events", "ranked_private_revisions"])
          expect((await actor.client.from(table).select("*")).error).toBeTruthy();
        for (const name of [
          "get_live_game_snapshot",
          "get_live_game_engine_context",
          "list_live_game_events",
        ])
          expect((await actor.client.rpc(name, { target_game_id: id })).error).toBeTruthy();
        expect(
          (
            await actor.client.rpc("trusted_commit_live_game", {
              p_actor_id: actor.id,
              p_room_id: id,
              p_revision: 0,
              p_command_id: crypto.randomUUID(),
              p_side: "B",
              p_action: { kind: "pass" },
              p_canonical: {},
              p_state: {},
            })
          ).error,
        ).toBeTruthy();
        const waiting = await call(actor, "live-game", {
          operation: "read",
          id,
          viewerId: a.id,
          side: "A",
        });
        expect(waiting.status).toBe(200);
        expect(waiting.body.match.yourRack).toEqual([]);
        expect((await call(actor, "archive-replay", { gameId: id })).status).toBe(404);
      }
      // A historical/imported archive can use a different outer UUID while its
      // inner snapshot still identifies this live game. The same SQL snapshot
      // must deny that alias too, before any full Replay projection is built.
      const alias = crypto.randomUUID();
      games.push(alias);
      const aliasInsert = await service.from("public_game_snapshots").insert({
        game_id: alias,
        source_owner_id: a.id,
        name: "Live alias lifecycle fixture",
        player_a: "A",
        player_b: "B",
        game_mode: "versus",
        mode_key: "normal",
        completion_kind: "terminated",
        completion_reason: "surrender",
        snapshot: encodeGame({ ...opening, status: "finished" }),
        created_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      });
      if (aliasInsert.error) throw aliasInsert.error;
      const allegedFinished = { ...opening, status: "finished" as const };
      for (const snapshot of [
        encodeGame(allegedFinished),
        JSON.stringify(encodeGame(allegedFinished)),
        serializeGame(allegedFinished),
        await buildCompletedGameRecord(allegedFinished),
      ]) {
        const updated = await service
          .from("public_game_snapshots")
          .update({ snapshot })
          .eq("game_id", alias);
        if (updated.error) throw updated.error;
        for (const actor of [a, b, spectator])
          expect((await call(actor, "archive-replay", { gameId: alias })).status).toBe(404);
      }
      await service.from("public_game_snapshots").delete().eq("game_id", alias);
      expect((await call(a, "live-game", { operation: "ready", id })).status).toBe(200);
      const ready = await call(b, "live-game", { operation: "ready", id });
      expect(ready.status, JSON.stringify(ready.body)).toBe(200);
      expect(ready.body.match.status).toBe("playing");
      const viewA = await call(a, "live-game", { operation: "read", id, viewerId: b.id });
      expect(viewA.body.match.yourSide).toBe("A");
      expect(viewA.cache).toBe("no-store");
      expect(viewA.body.match.yourRack.map((t: any) => t.token)).toEqual(
        opening.rackA.map((t) => t.token),
      );
      const notifications: unknown[][] = [];
      for (const actor of [a, b, spectator]) {
        const received: unknown[] = [];
        notifications.push(received);
        const channel = actor.client
          .channel(`game:${id}`, { config: { private: true } })
          .on("broadcast", { event: "commit" }, (event) => received.push(event.payload));
        subscriptions.push({ client: actor.client, channel });
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error("Realtime subscription timed out")),
            10000,
          );
          channel.subscribe((state) => {
            if (state === "SUBSCRIBED") {
              clearTimeout(timeout);
              resolve();
            } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
              clearTimeout(timeout);
              reject(new Error(`Realtime subscription ${state}`));
            }
          });
        });
      }
      const command = crypto.randomUUID();
      const turn = await call(a, "live-game", {
        operation: "action",
        id,
        revision: viewA.body.match.revision,
        commandId: command,
        side: "B",
        state: { status: "finished" },
        action: { kind: "exchange", tileIds: [viewA.body.match.yourRack[0].id] },
      });
      expect(turn.status, JSON.stringify(turn.body)).toBe(200);
      await expect
        .poll(() => notifications.every((events) => events.length > 0), { timeout: 10000 })
        .toBe(true);
      for (const events of notifications)
        for (const event of events) {
          // Realtime attaches its own opaque message UUID to the body. It is
          // not a tile/canonical reference or the private command ID.
          expect(event).toMatchObject({ gameId: id, revision: turn.body.match.revision });
          expect(Object.keys(event as object).sort()).toEqual(["gameId", "id", "revision"]);
          expect((event as { id: string }).id).toMatch(/^[0-9a-f-]{36}$/);
          expect((event as { id: string }).id).not.toBe(command);
        }
      const duplicate = await call(a, "live-game", {
        operation: "action",
        id,
        revision: viewA.body.match.revision,
        commandId: command,
        action: { kind: "exchange", tileIds: [viewA.body.match.yourRack[0].id] },
      });
      expect(duplicate.status).toBe(200);
      expect(duplicate.body.match.revision).toBe(turn.body.match.revision);
      const readB = await call(b, "live-game", { operation: "read", id });
      expect(readB.body.match.logs[0].rackBefore).toBeUndefined();
      expect(readB.body.match.logs[0].rackAfter).toBeUndefined();
      expect(readB.body.match.logs[0].exchangedCount).toBe(1);
      const stale = await call(b, "live-game", {
        operation: "action",
        id,
        revision: 0,
        commandId: crypto.randomUUID(),
        action: { kind: "pass" },
      });
      expect(stale.status).toBe(409);
      expect(stale.body.match).toEqual(readB.body.match);
      for (let tab = 0; tab < 2; tab++)
        expect(
          (await call(spectator, "live-game", { operation: "read", id })).body.match.yourRack,
        ).toEqual([]);
      const publication = sql(
        "select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename in ('room_live','live_game_events','game_timelines','ranked_private_revisions','survival_levels','ranked_matches','public_game_snapshots','region_game_snapshots','private_library_items');",
      );
      expect(publication.trim()).toBe("");
      const broadcast = sql(
        "select pg_get_functiondef('public.broadcast_live_game_commit(uuid,bigint,text,text)'::regprocedure);",
      );
      expect(broadcast).not.toMatch(
        /canonical|state|inventory|target_command_id,|target_issued_by,/,
      );
      const terminal = crypto.randomUUID();
      sql(
        `create function public.live_security_test_failure() returns trigger language plpgsql as $$ begin if new.source_id='${id}'::uuid then raise exception 'injected persistence failure'; end if; return new; end $$; create trigger live_security_test_failure before insert on public.recent_game_payloads for each row execute function public.live_security_test_failure();`,
      );
      const failed = await call(b, "live-game", {
        operation: "action",
        id,
        revision: readB.body.match.revision,
        commandId: terminal,
        action: { kind: "resign" },
      });
      expect(failed.status).toBe(400);
      expect(
        (await service.from("room_live").select("room_id").eq("room_id", id).single()).data,
      ).toBeTruthy();
      expect((await call(a, "archive-replay", { gameId: id })).status).toBe(404);
      expect(
        (await service.from("game_history").select("source_id").eq("source_id", id)).data,
      ).toEqual([]);
      sql(
        "drop trigger live_security_test_failure on public.recent_game_payloads; drop function public.live_security_test_failure();",
      );
      const finished = await call(b, "live-game", {
        operation: "action",
        id,
        revision: readB.body.match.revision,
        commandId: terminal,
        action: { kind: "resign" },
      });
      expect(finished.status, JSON.stringify(finished.body)).toBe(200);
      const replay = await call(a, "archive-replay", { gameId: id });
      expect(replay.status, JSON.stringify(replay.body)).toBe(200);
      expect(replay.body.replay.positions[0].racks).toEqual({
        A: opening.rackA.map(displayToken).sort(),
        B: opening.rackB.map(displayToken).sort(),
      });
      expect(replay.body.replay.positions.length).toBeGreaterThan(2);
      expect(
        (await service.from("room_live").select("room_id").eq("room_id", id).maybeSingle()).data,
      ).toBeNull();
      expect((await call(b, "archive-replay", { gameId: id })).status).toBe(200);
      expect((await call(spectator, "archive-replay", { gameId: id })).status).toBe(200);
      expect(
        (await a.client.from("public_game_snapshots").select("snapshot").eq("game_id", id)).error,
      ).toBeTruthy();
      expect(
        (await call(a, "normal-terminal", { gameId: id, state: initialPrivate.data.state })).status,
      ).toBe(409);
      expect(
        (await call(a, "stage-terminal", { gameId: id, state: initialPrivate.data.state })).status,
      ).toBe(409);
      const privateRoom = await create(a, b, "private");
      expect(
        (await call(spectator, "live-game", { operation: "read", id: privateRoom.id })).status,
      ).toBe(404);
      expect((await call(b, "live-game", { operation: "read", id: privateRoom.id })).status).toBe(
        200,
      );
      await a.client.rpc("cancel_live_game", { target_game_id: privateRoom.id });
      const ranked = await call(a, "ranked", { operation: "create", minutesA: 10, minutesB: 10 });
      expect(ranked.status, JSON.stringify(ranked.body)).toBe(200);
      const rankedId = ranked.body.match.id;
      const preview = await call(b, "ranked", { operation: "preview", id: rankedId });
      const joined = await call(b, "ranked", {
        operation: "join",
        id: rankedId,
        basis: preview.body.preview.basis,
      });
      expect(joined.status, JSON.stringify(joined.body)).toBe(200);
      expect((await call(a, "ranked", { operation: "ready", id: rankedId })).status).toBe(200);
      const rankedReady = await call(b, "ranked", { operation: "ready", id: rankedId });
      expect(rankedReady.status).toBe(200);
      expect(
        (await b.client.from("ranked_matches").select("state").eq("id", rankedId)).error,
      ).toBeTruthy();
      expect((await call(spectator, "ranked", { operation: "read", id: rankedId })).status).toBe(
        403,
      );
      expect((await call(a, "archive-replay", { gameId: rankedId })).status).toBe(404);
      const rankedDone = await call(a, "ranked", {
        operation: "action",
        id: rankedId,
        revision: rankedReady.body.match.revision,
        action: { kind: "resign" },
      });
      expect(rankedDone.status, JSON.stringify(rankedDone.body)).toBe(200);
      const rankedReplay = await call(b, "archive-replay", { gameId: rankedId });
      expect(rankedReplay.status, JSON.stringify(rankedReplay.body)).toBe(200);
      expect(rankedReplay.body.replay.mode).toBe("ranked");
      expect(rankedReplay.body.replay.positions[0].racks.A).toHaveLength(8);
      expect(rankedReplay.body.replay.positions[0].racks.B).toHaveLength(8);
      expect((await call(spectator, "archive-replay", { gameId: rankedId })).status).toBe(404);
      const granted = await a.client.rpc("admin_grant_credits", {
        target_user: b.id,
        target_amount: 10,
        target_reason: "Isolated security test",
        target_request_id: crypto.randomUUID(),
      });
      if (granted.error) throw granted.error;
      const botRequest = crypto.randomUUID();
      const botBody = {
        operation: "create",
        requestId: botRequest,
        funding: "credit",
        settings: {
          name: "Bot gate",
          playerA: "B",
          playerB: "Authur",
          playerAUserId: b.id,
          playerBUserId: b.id,
          botSide: "B",
          botEngine: "authur",
          botDifficulty: "super",
          startingSide: "A",
          untimed: true,
        },
        policy: {
          accessScope: "private",
          archivePolicy: "private",
          joinPolicy: "invite_only",
          regionId: null,
        },
      };
      const bot = await call(b, "live-game", botBody);
      expect(bot.status, JSON.stringify(bot.body)).toBe(200);
      games.push(bot.body.id);
      const botRetry = await call(b, "live-game", botBody);
      expect(botRetry.body.id).toBe(bot.body.id);
      expect(
        sql(
          `select count(*) from public.probot_consumptions where user_id='${b.id}' and request_id='${botRequest}';`,
        ).trim(),
      ).toBe("1");
      expect(
        sql(
          `select funding from public.probot_consumptions where user_id='${b.id}' and request_id='${botRequest}';`,
        ).trim(),
      ).toBe("credit");
      expect(
        sql(
          `select count(*) from public.economy_entries where user_id='${b.id}' and reason='probot_room' and delta=-1;`,
        ).trim(),
      ).toBe("1");
      expect(
        sql(
          `select balance from public.economy_balances where user_id='${b.id}' and currency='probot_credit';`,
        ).trim(),
      ).toBe("9");
      const botReady = await call(b, "live-game", { operation: "ready", id: bot.body.id });
      expect(botReady.status).toBe(200);
      expect(botReady.body.match.yourSide).toBe("A");
      expect(botReady.body.match.playerBId).toBeNull();
      const humanPass = await call(b, "live-game", {
        operation: "action",
        id: bot.body.id,
        revision: botReady.body.match.revision,
        commandId: crypto.randomUUID(),
        action: { kind: "pass" },
      });
      expect(humanPass.status).toBe(200);
      const forgedBot = await call(b, "live-game", {
        operation: "action",
        id: bot.body.id,
        side: "B",
        revision: humanPass.body.match.revision,
        commandId: crypto.randomUUID(),
        action: { kind: "pass" },
      });
      expect(forgedBot.status).toBe(400);
      const botEnd = await call(b, "live-game", {
        operation: "action",
        id: bot.body.id,
        revision: humanPass.body.match.revision,
        commandId: crypto.randomUUID(),
        action: { kind: "resign" },
      });
      expect(botEnd.status, JSON.stringify(botEnd.body)).toBe(200);
      const levelId = crypto.randomUUID();
      levels.push(levelId);
      const level = await service.from("survival_levels").insert({
        id: levelId,
        season_key: `live-gate-${levelId}`,
        level_no: 1,
        seed: 17,
        reference_key: "endgame-v1",
        sample_policy: "test",
        sample_count: 3,
        win_count: 3,
        winning_replays: [{}, {}, {}],
        immediate_winning_moves: 0,
        shortest_winning_replay_turns: 5,
        start_canonical: stageStartCanonical(17),
        start_sealed_at: new Date().toISOString(),
        status: "approved",
        admin_note: "Isolated security test fixture",
        approved_by: a.id,
        approved_at: new Date().toISOString(),
      });
      if (level.error) throw level.error;
      expect(
        (await a.client.from("survival_levels").select("seed,start_canonical,winning_replays"))
          .error,
      ).toBeTruthy();
      const stage = await call(a, "live-game", {
        operation: "create-stage",
        levelId,
        requestId: crypto.randomUUID(),
        playerName: "A",
      });
      expect(stage.status, JSON.stringify(stage.body)).toBe(200);
      games.push(stage.body.id);
      const stageView = await call(a, "live-game", { operation: "read", id: stage.body.id });
      expect(stageView.status).toBe(200);
      expect(JSON.stringify(stageView.body)).not.toMatch(/seed|start_canonical|winning_replays/);
      expect(stageView.body.match.name).toBe("Stage attempt");
      const stageEnd = await call(a, "live-game", {
        operation: "action",
        id: stage.body.id,
        revision: stageView.body.match.revision,
        commandId: crypto.randomUUID(),
        action: { kind: "resign" },
      });
      expect(stageEnd.status, JSON.stringify(stageEnd.body)).toBe(200);
      expect((await call(a, "archive-replay", { gameId: stage.body.id })).status).toBe(200);
      expect((await call(b, "archive-replay", { gameId: stage.body.id })).status).toBe(404);
      console.info(
        "LIVE_LOCAL_GATE: JWT seats, raw SQL/RPC denial, three real Realtime subscribers, exchange logs, Replay rollback, Normal/Ranked/Stage terminal and Authur creation funding verified. Actual bot execution is covered separately by the live-security browser gate.",
      );
    } finally {
      for (const { client, channel } of subscriptions) await client.removeChannel(channel);
      sql(
        "drop trigger if exists live_security_test_failure on public.recent_game_payloads; drop function if exists public.live_security_test_failure();",
      );
      // This isolated fixture may have immutable rows; cleanup by exact test UUIDs.
      for (const game of games) {
        await service.from("room_live").delete().eq("room_id", game);
        await service.from("public_game_snapshots").delete().eq("game_id", game);
        await service.from("private_library_items").delete().eq("game_id", game);
      }
      for (const userId of users) await service.auth.admin.deleteUser(userId);
      // Stage rows have intentional restricted FKs; the disposable DB is retained for inspection.
    }
  },
  120000,
);
