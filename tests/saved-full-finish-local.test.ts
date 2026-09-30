// @vitest-environment node
/** Opt-in isolated DB gate: full Saved never participates in normal finish. */
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { encodeGame } from "../src/codec";
import { encodeCanonical, canonicalFromSnapshot } from "../src/domain/projection";
import { createNewGame, pushActionSnapshot } from "../src/game";

const workdir = process.env.LIFECYCLE_TEST_SUPABASE_WORKDIR;
const local = workdir ? it : it.skip;

local(
  "Free, Plus and Pro full accounts finish without a new Saved item",
  async () => {
    const output = execFileSync("supabase", ["status", "--workdir", workdir!, "-o", "env"], {
      encoding: "utf8",
    });
    const env: Record<string, string> = {};
    for (const line of output.split("\n")) {
      const match = line.match(/^([A-Z_]+)="?([^"\n]+)"?$/);
      if (match) env[match[1]!] = match[2]!;
    }
    const url = env.API_URL!;
    if (!url.startsWith("http://127.0.0.1:") || !env.DB_URL?.includes("127.0.0.1"))
      throw new Error("Full finish test requires an isolated loopback stack.");
    const sql = (statement: string) =>
      execFileSync("psql", [env.DB_URL!, "-v", "ON_ERROR_STOP=1", "-At", "-c", statement], {
        encoding: "utf8",
      }).trim();
    const service = createClient(url, env.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

    for (const [plan, capacity] of [
      ["free", 100],
      ["plus", 1000],
      ["pro", 1000],
    ] as const) {
      const email = `full-${plan}-${crypto.randomUUID()}@example.test`;
      const password = "LocalTest-FullSaved-2026!";
      const made = await service.auth.admin.createUser({ email, password, email_confirm: true });
      if (made.error || !made.data.user) throw made.error ?? new Error("Missing user.");
      const userId = made.data.user.id;
      const approved = await service
        .from("profiles")
        .update({ status: "approved" })
        .eq("id", userId);
      if (approved.error) throw approved.error;
      if (plan !== "free")
        sql(`insert into public.plan_segments
      (user_id,plan_key,starts_at,ends_at,chain_anchor,chain_months)
      values ('${userId}'::uuid,'${plan}',now()-interval '1 day',
        now()+interval '1 year',now()-interval '1 day',12)`);
      sql(`with ids as (select gen_random_uuid() id from generate_series(1,${capacity})),
      h as (insert into public.game_history (source_kind,source_id,participant_id,
        game_id,participant_side,game_name,mode_key,game_mode,completed_at,result_authority)
        select 'normal',id,'${userId}'::uuid,id,'A','Capacity fixture',
          'solo_practice','solo',now(),'client_reported' from ids returning source_id)
      insert into public.saved_game_items (source_kind,source_id,participant_id)
        select 'normal',source_id,'${userId}'::uuid from h`);
      const client = createClient(url, env.ANON_KEY!, { auth: { persistSession: false } });
      const signed = await client.auth.signInWithPassword({ email, password });
      if (signed.error || !signed.data.session) throw signed.error ?? new Error("No session.");
      const token = signed.data.session.access_token;
      expect((await client.rpc("saved_game_usage")).data?.[0]).toMatchObject({
        active_count: capacity,
        capacity,
      });

      async function finish(legacy: boolean, incompleteHistory = false) {
        const started = createNewGame({
          name: `Full ${plan} ${legacy ? "old" : "new"}`,
          playerA: "Owner",
          playerB: "B",
          startingSide: "A",
          gameMode: incompleteHistory ? "versus" : "solo",
        });
        const owned = { ...started, playerUserIds: { ...started.playerUserIds, A: userId } };
        let roomId: string;
        if (legacy) {
          // The old creation function is called only on this isolated stack to
          // recreate a genuine pre-cutover private room and its frozen policy.
          const state = JSON.stringify(encodeGame(owned)).replaceAll("'", "''");
          const output = sql(`begin;
          select set_config('request.jwt.claims',
            '{"role":"authenticated","sub":"${userId}"}',true);
          select set_config('request.jwt.claim.sub','${userId}',true);
          select room_id from public.create_live_game_before_saved_cutover(
            '${state}'::jsonb,'private','private',null,'invite_only',null);
          commit;`);
          roomId = output
            .split("\n")
            .filter((line) =>
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(line),
            )
            .at(-1)!;
          expect(roomId).toBeTruthy();
          sql(`update public.room_live set legacy_private_autosave=true
          where room_id='${roomId}'::uuid`);
          const resumable = await client.rpc("list_live_games", {
            target_access_scope: "private",
            target_region_id: null,
          });
          expect(resumable.error).toBeNull();
          expect(resumable.data.some((row: { room_id: string }) => row.room_id === roomId)).toBe(
            true,
          );
          expect(
            sql(`select count(*) from public.game_history
          where source_id='${roomId}'::uuid`),
          ).toBe("0");
          const dryRun = await fetch(`${url}/functions/v1/migrate-saved-legacy`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.SERVICE_ROLE_KEY!}`,
              apikey: env.SERVICE_ROLE_KEY!,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ userId, dryRun: true, limit: 25 }),
          });
          const preview = await dryRun.json();
          expect(dryRun.status, JSON.stringify(preview)).toBe(200);
          expect(preview.counts.inProgressExcluded).toBe(1);
        } else {
          const created = await client.rpc("create_live_game", {
            target_state: encodeGame(owned),
            target_access_scope: "private",
            target_archive_policy: "private",
            target_region_id: null,
            target_join_policy: "invite_only",
            target_private_parent_id: null,
          });
          if (created.error) throw created.error;
          roomId = (Array.isArray(created.data) ? created.data[0] : created.data).room_id as string;
          expect(
            sql(`select archive_policy || ':' || legacy_private_autosave::text
          from public.room_live where room_id='${roomId}'::uuid`),
          ).toBe("none:false");
        }
        const first = await client.rpc("commit_live_game_command", {
          target_game_id: roomId,
          target_expected_revision: 0,
          target_command_id: crypto.randomUUID(),
          target_issued_by: "host",
          target_command: { kind: "create" },
          target_canonical: encodeCanonical(canonicalFromSnapshot(owned, 1)),
          target_canonical_digest: `local-${plan}-${legacy}`,
          target_state: encodeGame({ ...owned, revision: 1 }),
        });
        if (first.error) throw first.error;
        if (incompleteHistory)
          sql(`insert into public.game_timelines (game_id,version,line_count,node_count,doc)
            values ('${roomId}'::uuid,1,0,0,'{"v":1,"version":1,"lines":[]}'::jsonb)`);
        const finishedWithHistory = pushActionSnapshot({
          ...owned,
          revision: 2,
          status: "finished",
          timers: { ...owned.timers, paused: true },
        });
        const finished = incompleteHistory
          ? { ...finishedWithHistory, historyIndex: 0 }
          : finishedWithHistory;
        const oldLimit =
          legacy && plan === "free"
            ? sql("select value_int from public.system_settings where key='private_board_limit'") ||
              "absent"
            : null;
        if (oldLimit !== null)
          sql(`insert into public.system_settings(key,value_int)
        values('private_board_limit',0) on conflict(key)
        do update set value_int=excluded.value_int`);
        let response: Response;
        const terminalWire = JSON.stringify({ gameId: roomId, state: encodeGame(finished) });
        const terminalStarted = performance.now();
        try {
          response = await fetch(`${url}/functions/v1/normal-terminal`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              apikey: env.ANON_KEY!,
              "Content-Type": "application/json",
            },
            body: terminalWire,
          });
        } finally {
          if (oldLimit === "absent")
            sql("delete from public.system_settings where key='private_board_limit'");
          else if (oldLimit !== null)
            sql(`update public.system_settings set value_int=${oldLimit}
          where key='private_board_limit'`);
        }
        const body = await response.json();
        if (process.env.BENCHMARK_SYNC === "1")
          console.log(
            `SYNC_COMPAT_FINISH=${JSON.stringify({
              plan,
              legacy,
              incompleteHistory,
              requestBytes: Buffer.byteLength(terminalWire),
              responseBytes: Buffer.byteLength(JSON.stringify(body)),
              ms: Number((performance.now() - terminalStarted).toFixed(2)),
            })}`,
          );
        expect(response.status, JSON.stringify(body)).toBe(200);
        expect(body.replayRetained).toBe(!incompleteHistory);
        const history = await client.rpc("list_my_game_history", { p_limit: 20 });
        expect(history.error).toBeNull();
        expect(
          history.data.find((row: { source_id: string }) => row.source_id === roomId),
        ).toMatchObject({ is_recent: !incompleteHistory, saved_state: legacy ? "overflow" : null });
        expect(
          sql(`select count(*) from public.private_library_items
        where source_game_id='${roomId}'::uuid`),
        ).toBe(legacy ? "1" : "0");
        if (incompleteHistory) {
          const retry = await fetch(`${url}/functions/v1/normal-terminal`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              apikey: env.ANON_KEY!,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ gameId: roomId, state: encodeGame(finished) }),
          });
          expect(retry.status, JSON.stringify(await retry.json())).toBe(200);
          const replay = await fetch(`${url}/functions/v1/archive-replay`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              apikey: env.ANON_KEY!,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ gameId: roomId }),
          });
          const opened = await replay.json();
          expect(replay.status, JSON.stringify(opened)).toBe(200);
          expect(opened.archive.scope).toBe("saved");
        }
        return roomId;
      }

      const newRoom = await finish(false);
      expect(
        sql(`select count(*) from public.saved_game_items where source_id='${newRoom}'::uuid`),
      ).toBe("0");
      const oldRoom = await finish(true);
      expect(
        sql(`select state from public.saved_game_items where source_id='${oldRoom}'::uuid`),
      ).toBe("overflow");
      expect((await client.rpc("saved_game_usage")).data?.[0]).toMatchObject({
        active_count: capacity,
        capacity,
      });
      if (plan === "free") {
        const oldIncomplete = await finish(true, true);
        expect(
          sql(`select state from public.saved_game_items
        where source_id='${oldIncomplete}'::uuid`),
        ).toBe("overflow");
        expect(
          sql(`select count(*) from public.saved_legacy_payloads
        where source_id='${oldIncomplete}'::uuid`),
        ).toBe("1");
        expect(
          sql(`select (snapshot ? 'timeline')::text from public.saved_legacy_payloads
        where source_id='${oldIncomplete}'::uuid`),
        ).toBe("true");
      }
    }
  },
  30_000,
);
