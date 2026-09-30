// @vitest-environment node
/** Opt-in measurement against the disposable loopback Supabase stack only. */
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { encodeGame } from "../src/codec";
import { buildCompletedGameRecord } from "../src/completedGame/record";
import { deriveCompletion } from "../src/features/gameRecords/domain";
import { canonicalFromSnapshot, encodeCanonical } from "../src/domain/projection";
import { restoreSnapshot } from "../src/game";
import { frozenLegalGame } from "./helpers/completedCorpus";

const workdir = process.env.SYNC_PERF_SUPABASE_WORKDIR;
const benchmark = workdir ? it : it.skip;
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const percentile = (samples: number[], fraction: number) =>
  Number([...samples].sort((a, b) => a - b)[Math.ceil(samples.length * fraction) - 1]!.toFixed(2));

benchmark(
  "measures authenticated metadata, replay and Save paths at scale",
  async () => {
    const status = execFileSync("supabase", ["status", "--workdir", workdir!, "-o", "env"], {
      encoding: "utf8",
    });
    const env: Record<string, string> = {};
    for (const line of status.split("\n")) {
      const match = line.match(/^([A-Z_]+)="?([^"\n]+)"?$/);
      if (match) env[match[1]!] = match[2]!;
    }
    const url = env.API_URL!;
    const dbUrl = env.DB_URL!;
    if (!url.startsWith("http://127.0.0.1:") || !dbUrl.includes("127.0.0.1"))
      throw new Error("Only a disposable loopback stack is permitted.");
    const sql = (statement: string) =>
      execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-At", "-f", "-"], {
        encoding: "utf8",
        input: statement,
      }).trim();
    const service = createClient(url, env.SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const email = `sync-perf-${crypto.randomUUID()}@example.test`;
    const password = "LocalTest-SyncPerf-2026!";
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error("No user.");
    const userId = created.data.user.id;
    const approved = await service.from("profiles").update({ status: "approved" }).eq("id", userId);
    if (approved.error) throw approved.error;
    const client = createClient(url, env.ANON_KEY!, { auth: { persistSession: false } });
    const signed = await client.auth.signInWithPassword({ email, password });
    if (signed.error || !signed.data.session) throw signed.error ?? new Error("No session.");
    const token = signed.data.session.access_token;
    const headers = {
      apikey: env.ANON_KEY!,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    async function request(path: string, body?: unknown) {
      const wire = body === undefined ? undefined : JSON.stringify(body);
      const start = performance.now();
      const response = await fetch(`${url}${path}`, {
        method: wire === undefined ? "GET" : "POST",
        headers,
        body: wire,
      });
      const responseWire = await response.text();
      if (!response.ok)
        throw new Error(`${path}: ${response.status} ${responseWire.slice(0, 350)}`);
      return {
        requestBytes: Buffer.byteLength(wire ?? ""),
        responseBytes: Buffer.byteLength(responseWire),
        ms: performance.now() - start,
        data: JSON.parse(responseWire) as unknown,
      };
    }
    async function sample(path: string, body: unknown | undefined, runs = 11) {
      await request(path, body); // warm the local route and database cache
      const results = [];
      for (let i = 0; i < runs; i++) results.push(await request(path, body));
      return {
        requestBytes: results[0]!.requestBytes,
        responseBytes: results[0]!.responseBytes,
        p50Ms: percentile(
          results.map((result) => result.ms),
          0.5,
        ),
        p90Ms: percentile(
          results.map((result) => result.ms),
          0.9,
        ),
        rows: Array.isArray(results[0]!.data) ? results[0]!.data.length : null,
      };
    }
    const gameRows = [];
    const games: Array<{ oldId: string; newId: string }> = [];
    for (const [label, turns, kind] of [
      ["short", 3, "long"],
      ["normal40", 40, "long"],
      ["long60", 60, "long"],
      ["rackout", 39, "rackout"],
    ] as const) {
      const source = frozenLegalGame(kind, turns, true);
      const oldId = crypto.randomUUID();
      const newId = crypto.randomUUID();
      const withId = (gameId: string) => ({
        ...source,
        gameId,
        playerUserIds: { A: userId },
        history: source.history.map((snapshot) => ({
          ...snapshot,
          gameId,
          playerUserIds: { A: userId },
        })),
      });
      const oldGame = withId(oldId);
      const newGame = withId(newId);
      const legacy = encodeGame(oldGame);
      const buildStarted = performance.now();
      const compact = await buildCompletedGameRecord(newGame);
      const compactBuildMs = Number((performance.now() - buildStarted).toFixed(2));
      const oldInsert = await service.from("private_library_items").insert({
        owner_id: userId,
        item_type: "game",
        name: label,
        source_scope: "private",
        source_game_id: oldId,
        game_id: oldId,
        game_mode: "versus",
        mode_key: "friend",
        completion_kind: "terminated",
        completion_reason: "resignation",
        snapshot: legacy,
      });
      if (oldInsert.error) throw oldInsert.error;
      const h = await service.from("game_history").insert({
        source_kind: "normal",
        source_id: newId,
        participant_id: userId,
        game_id: newId,
        participant_side: "A",
        game_name: label,
        mode_key: "friend",
        game_mode: "versus",
        completed_at: "2026-01-01T00:00:00.000Z",
        result_authority: "client_reported",
      });
      if (h.error) throw h.error;
      const p = await service.from("recent_game_payloads").insert({
        source_id: newId,
        game_id: newId,
        record_digest: compact.digest,
        record: compact,
      });
      if (p.error) throw p.error;
      const recent = await service.rpc("recent_retain_completed_source", {
        p_source_kind: "normal",
        p_source_id: newId,
      });
      if (recent.error) throw recent.error;
      games.push({ oldId, newId });
      const oldOpen = await sample("/functions/v1/archive-replay", { gameId: oldId }, 7);
      const newOpen = await sample("/functions/v1/archive-replay", { gameId: newId }, 7);
      const oldResponse = await request("/functions/v1/archive-replay", { gameId: oldId });
      const newResponse = await request("/functions/v1/archive-replay", { gameId: newId });
      expect((oldResponse.data as { replay: { finalBoard: unknown } }).replay.finalBoard).toEqual(
        (newResponse.data as { replay: { finalBoard: unknown } }).replay.finalBoard,
      );
      gameRows.push({
        label,
        turns,
        legacySerializedBytes: size(legacy),
        compactSerializedBytes: size(compact),
        compactBuildMs,
        oldOpen,
        newOpen,
      });
    }

    const before = sql(`select count(*)||':'||coalesce(sum(pg_column_size(record)),0)
      from public.recent_game_payloads where source_id='${games[1]!.newId}'::uuid;`);
    const save = await request("/functions/v1/save-completed-game", {
      sourceKind: "normal",
      sourceId: games[1]!.newId,
    });
    const saveRetrySamples = [];
    for (let n = 0; n < 7; n++)
      saveRetrySamples.push(
        await request("/functions/v1/save-completed-game", {
          sourceKind: "normal",
          sourceId: games[1]!.newId,
        }),
      );
    const after = sql(`select count(*)||':'||coalesce(sum(pg_column_size(record)),0)
      from public.recent_game_payloads where source_id='${games[1]!.newId}'::uuid;`);
    expect(after).toBe(before);
    expect(
      sql(`select count(*) from public.saved_game_items where participant_id='${userId}'::uuid
      and source_id='${games[1]!.newId}'::uuid;`),
    ).toBe("1");
    const old40 = frozenLegalGame("long", 40, true);
    const old40Game = {
      ...old40,
      gameId: games[1]!.oldId,
      history: old40.history.map((snapshot) => ({ ...snapshot, gameId: games[1]!.oldId })),
    };
    const oldPublic = await service.from("public_game_snapshots").insert({
      game_id: games[1]!.oldId,
      source_owner_id: userId,
      name: "Old public copy",
      player_a: "Ann",
      player_b: "Ben",
      game_mode: "versus",
      mode_key: "friend",
      turn_number: old40.turnNumber,
      score_a: old40.scores.A,
      score_b: old40.scores.B,
      completion_kind: "terminated",
      completion_reason: "surrender",
      snapshot: encodeGame(old40Game),
      created_at: old40.createdAt,
      finished_at: "2026-01-01T01:00:00.000Z",
    });
    if (oldPublic.error) throw oldPublic.error;
    const oldSave = await request("/rest/v1/rpc/save_archive_to_private", {
      target_scope: "public",
      target_game_id: games[1]!.oldId,
      target_parent_id: null,
    });
    const oldCopiedBytes = Number(
      sql(`select pg_column_size(snapshot) from public.private_library_items
      where owner_id='${userId}'::uuid and source_scope='public'
        and source_game_id='${games[1]!.oldId}'::uuid limit 1;`),
    );
    expect(oldCopiedBytes).toBeGreaterThan(0);

    sql(`insert into public.plan_segments
      (user_id,plan_key,starts_at,ends_at,chain_anchor,chain_months)
      values ('${userId}'::uuid,'plus',now()-interval '1 day',
        now()+interval '1 year',now()-interval '1 day',12);`);

    // Metadata scale fixture: all rows have genuine ownership keys, while
    // only the four replay rows above contain a validated full game payload.
    sql(`with ids as (
      select gen_random_uuid() id, n from generate_series(1,1000) n
    ), h as (
      insert into public.game_history (source_kind,source_id,participant_id,
        game_id,participant_side,game_name,mode_key,game_mode,completed_at,result_authority)
      select 'normal',id,'${userId}'::uuid,id,'A','Metadata '||n,
        'solo_practice','solo','2026-01-01'::timestamptz+n*interval '1 minute',
        'client_reported' from ids returning source_id,completed_at
    ) insert into public.saved_game_items (source_kind,source_id,participant_id,saved_at)
      select 'normal',source_id,'${userId}'::uuid,completed_at from h;`);
    sql(`insert into public.private_library_items
      (owner_id,item_type,name,source_scope,source_game_id,game_id,
       game_mode,mode_key,completion_kind,completion_reason,snapshot,updated_at)
      select '${userId}'::uuid,'game','Old metadata '||n,'private',
        gen_random_uuid(),gen_random_uuid(),'versus','friend','terminated',
        'resignation','{}'::jsonb,'2026-01-01'::timestamptz+n*interval '1 minute'
      from generate_series(1,100) n;`);
    const oldFields =
      "id,owner_id,item_type,parent_id,name,source_scope,source_game_id,game_id,game_mode,mode_key,completion_kind,completion_reason,turn_number,score_a,score_b,trashed_at,created_at,updated_at";
    const oldPath = `/rest/v1/private_library_items?select=${oldFields}&order=updated_at.desc`;
    const lists = {
      old20: await sample(`${oldPath}&limit=20`, undefined),
      old100: await sample(`${oldPath}&limit=100`, undefined),
      history20: await sample("/rest/v1/rpc/list_my_game_history", { p_limit: 20 }),
      historyLegacy20: null as Awaited<ReturnType<typeof sample>> | null,
      recent20: null as Awaited<ReturnType<typeof sample>> | null,
      history100Pages: [] as unknown[],
      saved100Pages: [] as unknown[],
      saved1000Traversal: null as null | {
        pages: number;
        rows: number;
        requestBytes: number;
        responseBytes: number;
        ms: number;
      },
      saved20: await sample("/rest/v1/rpc/list_my_saved_games", {
        p_limit: 20,
        p_state: "active",
      }),
      saved50: await sample("/rest/v1/rpc/list_my_saved_games", {
        p_limit: 50,
        p_state: "active",
      }),
    };
    // The RPCs cap at 50 rows. The extra row is a next-page probe.
    let historyCursor: { completed_at: string; source_kind: string; source_id: string } | null =
      null;
    for (const count of [50, 50, 1]) {
      const page = await request("/rest/v1/rpc/list_my_game_history", {
        p_limit: count,
        p_before_at: historyCursor?.completed_at ?? null,
        p_before_kind: historyCursor?.source_kind ?? null,
        p_before_id: historyCursor?.source_id ?? null,
      });
      const rows = page.data as Array<{
        completed_at: string;
        source_kind: string;
        source_id: string;
      }>;
      historyCursor = rows.at(-1) ?? null;
      lists.history100Pages.push({
        requestBytes: page.requestBytes,
        responseBytes: page.responseBytes,
        ms: Number(page.ms.toFixed(2)),
        rows: rows.length,
      });
    }
    let cursor: { saved_at: string; source_kind: string; source_id: string } | null = null;
    for (const count of [50, 50, 1]) {
      const page = await request("/rest/v1/rpc/list_my_saved_games", {
        p_limit: count,
        p_state: "active",
        p_before_at: cursor?.saved_at ?? null,
        p_before_kind: cursor?.source_kind ?? null,
        p_before_id: cursor?.source_id ?? null,
      });
      const rows = page.data as Array<{
        saved_at: string;
        source_kind: string;
        source_id: string;
      }>;
      cursor = rows.at(-1) ?? null;
      lists.saved100Pages.push({
        requestBytes: page.requestBytes,
        responseBytes: page.responseBytes,
        ms: Number(page.ms.toFixed(2)),
        rows: rows.length,
      });
    }
    cursor = null;
    const traversal = { pages: 0, rows: 0, requestBytes: 0, responseBytes: 0, ms: 0 };
    while (true) {
      const page = await request("/rest/v1/rpc/list_my_saved_games", {
        p_limit: 50,
        p_state: "active",
        p_before_at: cursor?.saved_at ?? null,
        p_before_kind: cursor?.source_kind ?? null,
        p_before_id: cursor?.source_id ?? null,
      });
      const rows = page.data as Array<{ saved_at: string; source_kind: string; source_id: string }>;
      traversal.pages++;
      traversal.rows += rows.length;
      traversal.requestBytes += page.requestBytes;
      traversal.responseBytes += page.responseBytes;
      traversal.ms += page.ms;
      if (rows.length < 50) break;
      cursor = rows.at(-1)!;
    }
    expect(traversal.rows).toBe(1000);
    lists.saved1000Traversal = { ...traversal, ms: Number(traversal.ms.toFixed(2)) };

    const recentSource = frozenLegalGame("long", 3, true);
    const retentionTimes: number[] = [];
    const recentBefore = Number(
      sql(`select count(*) from public.recent_game_items
      where participant_id='${userId}'::uuid;`),
    );
    for (let n = 0; n < 25; n++) {
      const id = crypto.randomUUID();
      const game = {
        ...recentSource,
        gameId: id,
        history: recentSource.history.map((snapshot) => ({ ...snapshot, gameId: id })),
      };
      const record = await buildCompletedGameRecord(game);
      const history = await service.from("game_history").insert({
        source_kind: "normal",
        source_id: id,
        participant_id: userId,
        game_id: id,
        participant_side: "A",
        game_name: `Recent page ${n}`,
        mode_key: "friend",
        game_mode: "versus",
        completed_at: new Date(Date.UTC(2026, 1, 2, 0, n)).toISOString(),
        result_authority: "client_reported",
      });
      if (history.error) throw history.error;
      const payload = await service.from("recent_game_payloads").insert({
        source_id: id,
        game_id: id,
        record_digest: record.digest,
        record,
      });
      if (payload.error) throw payload.error;
      const started = performance.now();
      const retained = await service.rpc("recent_retain_completed_source", {
        p_source_kind: "normal",
        p_source_id: id,
      });
      if (retained.error) throw retained.error;
      retentionTimes.push(performance.now() - started);
      expect(
        Number(
          sql(`select count(*) from public.recent_game_items
        where participant_id='${userId}'::uuid;`),
        ),
      ).toBe(Math.min(20, recentBefore + n + 1));
    }
    const recentRetention = {
      initialItems: recentBefore,
      finalItems: Number(
        sql(`select count(*) from public.recent_game_items
        where participant_id='${userId}'::uuid;`),
      ),
      firstEvictionAtInsert: 21 - recentBefore,
      p50Ms: percentile(retentionTimes.slice(20 - recentBefore), 0.5),
      p90Ms: percentile(retentionTimes.slice(20 - recentBefore), 0.9),
    };
    lists.recent20 = await sample("/rest/v1/rpc/list_my_game_history", { p_limit: 20 });
    const legacySource = frozenLegalGame("long", 40, true);
    for (let n = 0; n < 20; n++) {
      const id = crypto.randomUUID();
      const game = {
        ...legacySource,
        gameId: id,
        history: legacySource.history.map((snapshot) => ({ ...snapshot, gameId: id })),
      };
      const old = await service.from("private_library_items").insert({
        owner_id: userId,
        item_type: "game",
        name: `Legacy page ${n}`,
        source_scope: "private",
        source_game_id: id,
        game_id: id,
        game_mode: "versus",
        mode_key: "friend",
        completion_kind: "terminated",
        completion_reason: "surrender",
        snapshot: encodeGame(game),
      });
      if (old.error) throw old.error;
      const history = await service.from("game_history").insert({
        source_kind: "normal",
        source_id: id,
        participant_id: userId,
        game_id: id,
        participant_side: "A",
        game_name: `Legacy page ${n}`,
        mode_key: "friend",
        game_mode: "versus",
        completed_at: new Date(Date.UTC(2026, 1, 1, 0, n)).toISOString(),
        result_authority: "client_reported",
      });
      if (history.error) throw history.error;
    }
    lists.historyLegacy20 = await sample("/rest/v1/rpc/list_my_game_history", { p_limit: 20 });
    expect(
      sql(`select state from public.saved_game_items where participant_id='${userId}'::uuid
      and source_id='${games[1]!.newId}'::uuid;`),
    ).toBe("overflow");
    sql(`update public.plan_segments set ends_at=now()-interval '1 hour'
      where user_id='${userId}'::uuid and plan_key='plus';`);
    const downgradeStarted = performance.now();
    const downgraded = Number(sql(`select public.reconcile_saved_capacity('${userId}'::uuid);`));
    const downgradeMs = Number((performance.now() - downgradeStarted).toFixed(2));
    expect(downgraded).toBe(900);
    expect(
      Number(
        sql(`select count(*) from public.saved_game_items
      where participant_id='${userId}'::uuid and state='active';`),
      ),
    ).toBe(100);
    console.log(
      `SYNC_PERFORMANCE=${JSON.stringify({
        gameRows,
        lists,
        save: {
          requestBytes: save.requestBytes,
          responseBytes: save.responseBytes,
          ms: Number(save.ms.toFixed(2)),
          payloadBefore: before,
          payloadAfter: after,
          savedRelationTupleBytes: Number(
            sql(`select pg_column_size(i) from public.saved_game_items i
            where i.participant_id='${userId}'::uuid and i.source_id='${games[1]!.newId}'::uuid;`),
          ),
          oldRequestBytes: oldSave.requestBytes,
          oldResponseBytes: oldSave.responseBytes,
          oldMs: Number(oldSave.ms.toFixed(2)),
          oldCopiedPayloadTupleBytes: oldCopiedBytes,
          retryP50Ms: percentile(
            saveRetrySamples.map((result) => result.ms),
            0.5,
          ),
          retryP90Ms: percentile(
            saveRetrySamples.map((result) => result.ms),
            0.9,
          ),
        },
        recentRetention,
        downgrade: { changed: downgraded, msIncludingPsql: downgradeMs, activeAfter: 100 },
        metadataRows: 1000,
      })}`,
    );
  },
  180_000,
);

benchmark(
  "measures old-compatible and new terminal requests for the same legal traces",
  async () => {
    const status = execFileSync("supabase", ["status", "--workdir", workdir!, "-o", "env"], {
      encoding: "utf8",
    });
    const env: Record<string, string> = {};
    for (const line of status.split("\n")) {
      const match = line.match(/^([A-Z_]+)="?([^"\n]+)"?$/);
      if (match) env[match[1]!] = match[2]!;
    }
    if (!env.API_URL?.startsWith("http://127.0.0.1:") || !env.DB_URL?.includes("127.0.0.1"))
      throw new Error("Only a disposable loopback stack is permitted.");
    const sql = (statement: string) =>
      execFileSync("psql", [env.DB_URL!, "-v", "ON_ERROR_STOP=1", "-At", "-f", "-"], {
        encoding: "utf8",
        input: statement,
      }).trim();
    const service = createClient(env.API_URL, env.SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const email = `sync-finish-${crypto.randomUUID()}@example.test`;
    const password = "LocalTest-SyncFinish-2026!";
    const made = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (made.error || !made.data.user) throw made.error ?? new Error("No user.");
    const userId = made.data.user.id;
    const approved = await service.from("profiles").update({ status: "approved" }).eq("id", userId);
    if (approved.error) throw approved.error;
    const client = createClient(env.API_URL, env.ANON_KEY!, { auth: { persistSession: false } });
    const signed = await client.auth.signInWithPassword({ email, password });
    if (signed.error || !signed.data.session) throw signed.error ?? new Error("No session.");
    const headers = {
      apikey: env.ANON_KEY!,
      Authorization: `Bearer ${signed.data.session.access_token}`,
      "Content-Type": "application/json",
    };
    const results = [];
    const cases = [
      ...Array.from({ length: 7 }, () => ["short", 3, "long"] as const),
      ...Array.from({ length: 3 }, () => ["normal40", 40, "long"] as const),
      ...Array.from({ length: 3 }, () => ["long60", 60, "long"] as const),
    ];
    for (const [label, turns, kind] of cases) {
      for (const path of ["old-compatible", "new"] as const) {
        const source = frozenLegalGame(kind, turns, true);
        const sourceCompletion = deriveCompletion(source);
        const gameId = crypto.randomUUID();
        const finished = {
          ...source,
          gameId,
          revision: 1,
          playerUserIds: { A: userId },
          matchControl: { surrenderedSide: sourceCompletion.surrenderedSide ?? undefined },
          history: source.history.map((snapshot, index) => ({
            ...snapshot,
            gameId,
            revision: index === source.history.length - 1 ? 1 : 0,
            playerUserIds: { A: userId },
            matchControl:
              index === source.history.length - 1
                ? { surrenderedSide: sourceCompletion.surrenderedSide ?? undefined }
                : snapshot.matchControl,
          })),
        };
        const initial = restoreSnapshot(finished, 0);
        initial.history = [initial.history[0]!];
        initial.historyIndex = 0;
        const initialWire = encodeGame(initial);
        let roomId: string;
        if (path === "old-compatible") {
          const value = JSON.stringify(initialWire).replaceAll("'", "''");
          const output = sql(`begin;
            select set_config('request.jwt.claims',
              '{"role":"authenticated","sub":"${userId}"}',true);
            select set_config('request.jwt.claim.sub','${userId}',true);
            select room_id from public.create_live_game_before_saved_cutover(
              '${value}'::jsonb,'private','private',null,'invite_only',null);
            commit;`);
          roomId =
            output
              .match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)
              ?.at(-1) ?? "";
        } else {
          const created = await client.rpc("create_live_game", {
            target_state: initialWire,
            target_access_scope: "private",
            target_archive_policy: "private",
            target_region_id: null,
            target_join_policy: "invite_only",
            target_private_parent_id: null,
          });
          if (created.error) throw created.error;
          roomId = (Array.isArray(created.data) ? created.data[0] : created.data).room_id;
        }
        expect(roomId).toMatch(/^[0-9a-f-]{36}$/);
        const completion = deriveCompletion(finished);
        const body =
          path === "new"
            ? { gameId: roomId, state: encodeGame(finished) }
            : {
                target_game_id: roomId,
                target_state: encodeGame(finished),
                target_completion_kind: completion.kind,
                target_completion_reason: completion.reason,
                target_surrendered_side: completion.surrenderedSide,
              };
        const wire = JSON.stringify(body);
        const endpoint =
          path === "new" ? "/functions/v1/normal-terminal" : "/rest/v1/rpc/finalize_live_game";
        const start = performance.now();
        const response = await fetch(`${env.API_URL}${endpoint}`, {
          method: "POST",
          headers,
          body: wire,
        });
        const responseWire = await response.text();
        expect(response.status, responseWire).toBe(200);
        if (path === "new")
          expect((JSON.parse(responseWire) as { replayRetained: boolean }).replayRetained).toBe(
            true,
          );
        const ms = performance.now() - start;
        const stored = sql(`select
          coalesce((select pg_column_size(snapshot)::text from public.private_library_items
            where source_game_id='${roomId}'::uuid limit 1),'0') || ':' ||
          coalesce((select pg_column_size(record)::text from public.recent_game_payloads
            where source_id='${roomId}'::uuid),'0') || ':' ||
          coalesce((select sum(pg_column_size(h))::text from public.game_history h
            where source_id='${roomId}'::uuid),'0') || ':' ||
          coalesce((select sum(pg_column_size(i))::text from public.recent_game_items i
            where source_id='${roomId}'::uuid),'0');`);
        results.push({
          label,
          path,
          requestBytes: Buffer.byteLength(wire),
          responseBytes: Buffer.byteLength(responseWire),
          ms: Number(ms.toFixed(2)),
          storedTupleBytes: stored,
        });
      }
    }
    const summary = Object.fromEntries(
      ["short", "normal40", "long60"].flatMap((label) =>
        (["old-compatible", "new"] as const).map((path) => {
          const samples = results.filter((row) => row.label === label && row.path === path);
          return [
            `${label}:${path}`,
            {
              runs: samples.length,
              p50Ms: percentile(
                samples.map((row) => row.ms),
                0.5,
              ),
              p90Ms: percentile(
                samples.map((row) => row.ms),
                0.9,
              ),
              requestBytes: samples[0]!.requestBytes,
              responseBytes: samples[0]!.responseBytes,
              storedTupleBytes: samples[0]!.storedTupleBytes,
            },
          ] as const;
        }),
      ),
    );
    console.log(`SYNC_FINISH_PERFORMANCE=${JSON.stringify(summary)}`);
  },
  180_000,
);

benchmark(
  "keeps create, several live commits, reload and the next commit operational",
  async () => {
    const status = execFileSync("supabase", ["status", "--workdir", workdir!, "-o", "env"], {
      encoding: "utf8",
    });
    const env: Record<string, string> = {};
    for (const line of status.split("\n")) {
      const match = line.match(/^([A-Z_]+)="?([^"\n]+)"?$/);
      if (match) env[match[1]!] = match[2]!;
    }
    if (!env.API_URL?.startsWith("http://127.0.0.1:") || !env.DB_URL?.includes("127.0.0.1"))
      throw new Error("Only a disposable loopback stack is permitted.");
    const service = createClient(env.API_URL, env.SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    });
    const email = `sync-live-${crypto.randomUUID()}@example.test`;
    const password = "LocalTest-SyncLive-2026!";
    const made = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (made.error || !made.data.user) throw made.error ?? new Error("No user.");
    const userId = made.data.user.id;
    const approved = await service.from("profiles").update({ status: "approved" }).eq("id", userId);
    if (approved.error) throw approved.error;
    const client = createClient(env.API_URL, env.ANON_KEY!, { auth: { persistSession: false } });
    const signed = await client.auth.signInWithPassword({ email, password });
    if (signed.error || !signed.data.session) throw signed.error ?? new Error("No session.");
    const trace = frozenLegalGame("long", 4);
    const id = crypto.randomUUID();
    const game = {
      ...trace,
      gameId: id,
      playerUserIds: { A: userId },
      history: trace.history.map((snapshot, index) => ({
        ...snapshot,
        gameId: id,
        revision: index,
        playerUserIds: { A: userId },
      })),
    };
    function at(index: number) {
      const state = restoreSnapshot(game, index);
      state.history = state.history.slice(0, index + 1);
      state.historyIndex = index;
      state.revision = index;
      return state;
    }
    const createdAt = performance.now();
    const created = await client.rpc("create_live_game", {
      target_state: encodeGame(at(0)),
      target_access_scope: "private",
      target_archive_policy: "private",
      target_region_id: null,
      target_join_policy: "invite_only",
      target_private_parent_id: null,
    });
    if (created.error) throw created.error;
    const roomId = (Array.isArray(created.data) ? created.data[0] : created.data).room_id as string;
    const createMs = performance.now() - createdAt;
    const commits = [];
    let activeClient = client;
    for (let index = 1; index <= 4; index++) {
      const state = at(index);
      const args = {
        target_game_id: roomId,
        target_expected_revision: index - 1,
        target_command_id: crypto.randomUUID(),
        target_issued_by: index % 2 ? "A" : "B",
        target_command: { kind: "submit_action" },
        target_canonical: encodeCanonical(canonicalFromSnapshot(state, index)),
        target_canonical_digest: `sync-live-${index}`,
        target_state: encodeGame(state),
      };
      const started = performance.now();
      const committed = await activeClient.rpc("commit_live_game_command", args);
      if (committed.error) throw committed.error;
      expect(committed.data[0].revision).toBe(index);
      commits.push({
        revision: index,
        requestBytes: size(args),
        responseBytes: size(committed.data),
        ms: Number((performance.now() - started).toFixed(2)),
      });
      if (index === 3) {
        const reloaded = createClient(env.API_URL, env.ANON_KEY!, {
          auth: { persistSession: false },
          global: { headers: { Authorization: `Bearer ${signed.data.session.access_token}` } },
        });
        const startedReload = performance.now();
        const [head, room] = await Promise.all([
          reloaded.rpc("get_live_game_snapshot", { target_game_id: roomId }),
          reloaded.from("room_live").select("state,revision").eq("room_id", roomId).single(),
        ]);
        if (head.error || room.error) throw head.error ?? room.error;
        expect(head.data[0].revision).toBe(3);
        expect(room.data.revision).toBe(3);
        expect(room.data.state.turnNumber).toBe(state.turnNumber);
        activeClient = reloaded;
        console.log(
          `SYNC_LIVE_RELOAD=${JSON.stringify({
            createMs: Number(createMs.toFixed(2)),
            reloadMs: Number((performance.now() - startedReload).toFixed(2)),
            canonicalResponseBytes: size(head.data),
            roomResponseBytes: size(room.data),
          })}`,
        );
      }
    }
    expect(commits).toHaveLength(4);
    console.log(`SYNC_LIVE_COMMITS=${JSON.stringify(commits)}`);
  },
  30_000,
);
