// @vitest-environment node
/** Opt-in isolated Supabase lifecycle/cutover gate. */
import { execFile, execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { encodeGame } from "../src/codec";
import { buildCompletedGameRecord } from "../src/completedGame/record";
import { encodeCanonical, canonicalFromSnapshot } from "../src/domain/projection";
import { createNewGame, pushActionSnapshot, type GameState } from "../src/game";

const workdir = process.env.LIFECYCLE_TEST_SUPABASE_WORKDIR;
const local = workdir ? it : it.skip;

local(
  "new private games finish with Compact Recent while Saved is full",
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
      throw new Error("Lifecycle test requires an isolated loopback stack.");
    const sql = (statement: string) =>
      execFileSync("psql", [env.DB_URL!, "-v", "ON_ERROR_STOP=1", "-At", "-c", statement], {
        encoding: "utf8",
      }).trim();
    const service = createClient(url, env.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const password = "LocalTest-Lifecycle-2026!";
    const email = `lifecycle-${crypto.randomUUID()}@example.test`;
    const made = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (made.error || !made.data.user) throw made.error ?? new Error("Missing user.");
    const ownerId = made.data.user.id;
    const approved = await service
      .from("profiles")
      .update({ status: "approved" })
      .eq("id", ownerId);
    if (approved.error) throw approved.error;
    const client = createClient(url, env.ANON_KEY!, { auth: { persistSession: false } });
    const signed = await client.auth.signInWithPassword({ email, password });
    if (signed.error || !signed.data.session) throw signed.error ?? new Error("No session.");
    const token = signed.data.session.access_token;
    const call = async (name: string, gameId: string, state?: unknown) => {
      const response = await fetch(`${url}/functions/v1/${name}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: env.ANON_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId, ...(state ? { state } : {}) }),
      });
      return { status: response.status, body: await response.json() };
    };
    const prior = createNewGame({
      name: "New private cutover",
      playerA: "Owner",
      playerB: "B",
      startingSide: "A",
      gameMode: "solo",
    });
    const owned: GameState = { ...prior, playerUserIds: { ...prior.playerUserIds, A: ownerId } };
    const created = await client.rpc("create_live_game", {
      target_state: encodeGame(owned),
      target_access_scope: "private",
      target_archive_policy: "private",
      target_region_id: null,
      target_join_policy: "invite_only",
      target_private_parent_id: null,
    });
    if (created.error) throw created.error;
    const roomId = created.data[0].room_id as string;
    expect(roomId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(roomId).not.toBe(owned.gameId);
    const room = await service
      .from("room_live")
      .select("archive_policy,legacy_private_autosave")
      .eq("room_id", roomId)
      .single();
    if (room.error) throw room.error;
    expect(room.data).toMatchObject({ archive_policy: "none", legacy_private_autosave: false });
    const first = await client.rpc("commit_live_game_command", {
      target_game_id: roomId,
      target_expected_revision: 0,
      target_command_id: crypto.randomUUID(),
      target_issued_by: "host",
      target_command: { kind: "create" },
      target_canonical: encodeCanonical(canonicalFromSnapshot(owned, 1)),
      target_canonical_digest: "local-lifecycle",
      target_state: encodeGame({ ...owned, revision: 1 }),
    });
    if (first.error) throw first.error;
    sql(`with ids as (select gen_random_uuid() id from generate_series(1,100)),
    h as (insert into public.game_history (source_kind,source_id,participant_id,
      game_id,participant_side,game_name,mode_key,game_mode,completed_at,result_authority)
      select 'normal',id,'${ownerId}'::uuid,id,'A','Capacity fixture',
        'solo_practice','solo',now(),'client_reported' from ids returning source_id)
    insert into public.saved_game_items (source_kind,source_id,participant_id)
      select 'normal',source_id,'${ownerId}'::uuid from h`);
    expect((await client.rpc("saved_game_usage")).data?.[0]).toMatchObject({
      active_count: 100,
      capacity: 100,
    });
    const finished = pushActionSnapshot({
      ...owned,
      revision: 2,
      status: "finished",
      timers: { ...owned.timers, paused: true },
    });
    const finalState = encodeGame(finished);
    expect(typeof finalState).toBe("object");
    expect(JSON.parse(JSON.stringify({ gameId: roomId, state: finalState }))).toMatchObject({
      gameId: roomId,
      state: { v: 3 },
    });
    const capture = await call("normal-terminal", roomId, finalState);
    expect(capture.status, JSON.stringify(capture.body)).toBe(200);
    expect(capture.body.replayRetained).toBe(true);
    const history = await client.rpc("list_my_game_history", { p_limit: 20 });
    expect(history.error).toBeNull();
    expect(
      history.data.find((row: { source_id: string }) => row.source_id === roomId),
    ).toMatchObject({ is_recent: true, is_saved: false, saved_state: null });
    expect((await client.rpc("saved_game_usage")).data?.[0]).toMatchObject({
      active_count: 100,
      capacity: 100,
    });
    expect(
      sql(`select count(*) from public.saved_game_items where source_id='${roomId}'::uuid`),
    ).toBe("0");
    const replay = await call("archive-replay", roomId);
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    expect(replay.body.archive.scope).toBe("recent");
    expect((await call("normal-terminal", roomId, encodeGame(finished))).status).toBe(200);

    const legacyId = crypto.randomUUID();
    const legacy = encodeGame({ ...finished, gameId: crypto.randomUUID() });
    const legacyHistory = await service.from("game_history").insert({
      source_kind: "normal",
      source_id: legacyId,
      game_id: legacyId,
      participant_id: ownerId,
      source_owner_id: ownerId,
      participant_side: "A",
      game_name: "Old private completion",
      mode_key: "solo_practice",
      game_mode: "solo",
      completed_at: new Date().toISOString(),
      score_for: finished.scores.A,
      score_against: finished.scores.B,
      result_authority: "client_reported",
    });
    if (legacyHistory.error) throw legacyHistory.error;
    const oldItem = await service
      .from("private_library_items")
      .insert({
        owner_id: ownerId,
        item_type: "game",
        name: "Old private completion",
        source_scope: "private",
        source_game_id: legacyId,
        game_id: legacyId,
        game_mode: "solo",
        mode_key: "solo_practice",
        completion_kind: "terminated",
        completion_reason: "manual",
        turn_number: finished.turnNumber,
        score_a: finished.scores.A,
        score_b: finished.scores.B,
        snapshot: legacy,
      })
      .select("id")
      .single();
    if (oldItem.error) throw oldItem.error;
    const migrate = async (
      dryRun: boolean,
      authorization = env.SERVICE_ROLE_KEY!,
      cursor: unknown = null,
      limit = 25,
    ) => {
      const response = await fetch(`${url}/functions/v1/migrate-saved-legacy`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authorization}`,
          apikey: env.SERVICE_ROLE_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userId: ownerId, dryRun, limit, ...(cursor ? { cursor } : {}) }),
      });
      return { status: response.status, body: await response.json() };
    };
    expect((await migrate(true, token)).status).toBe(403);
    const preview = await migrate(true);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.counts, JSON.stringify(preview.body)).toMatchObject({
      eligible: 1,
      overflow: 1,
    });
    expect(
      sql(`select count(*) from public.saved_game_items where source_id='${legacyId}'::uuid`),
    ).toBe("0");
    const migrated = await migrate(false);
    expect(migrated.status, JSON.stringify(migrated.body)).toBe(200);
    expect(migrated.body.counts).toMatchObject({ eligible: 1, overflow: 1 });
    expect((await migrate(false)).body.counts.alreadyProcessed).toBe(1);
    expect(
      sql(`select state from public.saved_game_items where source_id='${legacyId}'::uuid`),
    ).toBe("overflow");
    expect(
      sql(`select count(*) from public.saved_legacy_payloads where source_id='${legacyId}'::uuid`),
    ).toBe("1");
    const legacyReplay = await call("archive-replay", legacyId);
    expect(legacyReplay.status, JSON.stringify(legacyReplay.body)).toBe(200);
    expect(legacyReplay.body.archive.scope).toBe("saved");

    const insertOld = async (sourceId: string, snapshot: unknown, trashedAt: string | null) => {
      const h = await service.from("game_history").insert({
        source_kind: "normal",
        source_id: sourceId,
        game_id: sourceId,
        participant_id: ownerId,
        source_owner_id: ownerId,
        participant_side: "A",
        game_name: "Old private fixture",
        mode_key: "solo_practice",
        game_mode: "solo",
        completed_at: new Date().toISOString(),
        score_for: finished.scores.A,
        score_against: finished.scores.B,
        result_authority: "client_reported",
      });
      if (h.error) throw h.error;
      const old = await service.from("private_library_items").insert({
        owner_id: ownerId,
        item_type: "game",
        name: "Old private fixture",
        source_scope: "private",
        source_game_id: sourceId,
        game_id: sourceId,
        game_mode: "solo",
        mode_key: "solo_practice",
        completion_kind: "terminated",
        completion_reason: "manual",
        turn_number: finished.turnNumber,
        score_a: finished.scores.A,
        score_b: finished.scores.B,
        snapshot,
        trashed_at: trashedAt,
      });
      if (old.error) throw old.error;
    };
    const trashedLegacyId = crypto.randomUUID();
    await insertOld(trashedLegacyId, legacy, new Date().toISOString());
    const incompleteId = crypto.randomUUID();
    await insertOld(incompleteId, { v: 1, status: "finished" }, null);
    const duplicateOld = await service.from("private_library_items").insert({
      owner_id: ownerId,
      item_type: "game",
      name: "Duplicate old private fixture",
      source_scope: "private",
      source_game_id: legacyId,
      game_id: legacyId,
      game_mode: "solo",
      mode_key: "solo_practice",
      completion_kind: "terminated",
      completion_reason: "manual",
      turn_number: finished.turnNumber,
      score_a: finished.scores.A,
      score_b: finished.scores.B,
      snapshot: legacy,
    });
    if (duplicateOld.error) throw duplicateOld.error;
    const classification = await migrate(true);
    expect(classification.status, JSON.stringify(classification.body)).toBe(200);
    expect(classification.body.counts).toMatchObject({
      eligible: 1,
      trashed: 1,
      ambiguousExcluded: 1,
      duplicateSkipped: 1,
      alreadyProcessed: 1,
    });
    const pages = [];
    let pageCursor: unknown = null;
    do {
      const page = await migrate(true, env.SERVICE_ROLE_KEY!, pageCursor, 2);
      expect(page.status, JSON.stringify(page.body)).toBe(200);
      pages.push(page.body.counts);
      pageCursor = page.body.nextCursor;
    } while (pageCursor);
    expect(pages.reduce((total, page) => total + page.eligible, 0)).toBe(1);
    expect(pages.reduce((total, page) => total + page.trashed, 0)).toBe(1);
    const classified = await migrate(false);
    expect(classified.status, JSON.stringify(classified.body)).toBe(200);
    expect(classified.body.counts).toMatchObject({
      trashed: 1,
      ambiguousExcluded: 1,
      duplicateSkipped: 1,
      alreadyProcessed: 1,
    });
    expect(
      sql(`select state from public.saved_game_items
    where source_id='${trashedLegacyId}'::uuid`),
    ).toBe("trashed");
    expect(
      sql(`select count(*) from public.saved_game_items
    where source_id='${incompleteId}'::uuid`),
    ).toBe("0");
    expect((await call("archive-replay", trashedLegacyId)).status).toBe(200);
    expect(
      (
        await service.rpc("cleanup_unreferenced_saved_legacy_payload", {
          p_source_id: trashedLegacyId,
        })
      ).data,
    ).toBe(false);
    expect(
      (
        await client.rpc("change_my_saved_game", {
          p_source_kind: "normal",
          p_source_id: trashedLegacyId,
          p_action: "delete",
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await service.rpc("cleanup_unreferenced_saved_legacy_payload", {
          p_source_id: trashedLegacyId,
        })
      ).data,
    ).toBe(true);
    expect(
      sql(`select count(*) from public.game_history
    where source_id='${trashedLegacyId}'::uuid`),
    ).toBe("1");
    expect(
      (
        await service.rpc("cleanup_unreferenced_saved_legacy_payload", {
          p_source_id: legacyId,
        })
      ).data,
    ).toBe(false);

    const activeIds = sql(`select source_id from public.saved_game_items
    where participant_id='${ownerId}'::uuid and state='active'
    order by saved_at,source_id limit 6`).split("\n");
    expect(activeIds).toHaveLength(6);
    const change = (sourceId: string, action: string) =>
      client.rpc("change_my_saved_game", {
        p_source_kind: "normal",
        p_source_id: sourceId,
        p_action: action,
      });
    const [trashWhileSaving, savedAfterTrash] = await Promise.all([
      change(activeIds[0]!, "trash"),
      client.rpc("save_completed_game", { p_source_kind: "normal", p_source_id: roomId }),
    ]);
    expect(trashWhileSaving.error).toBeNull();
    if (savedAfterTrash.error) {
      expect(savedAfterTrash.error.message).toContain("Saved capacity reached");
      expect(
        (
          await client.rpc("save_completed_game", {
            p_source_kind: "normal",
            p_source_id: roomId,
          })
        ).error,
      ).toBeNull();
    }
    expect((await client.rpc("saved_game_usage")).data?.[0]?.active_count).toBe(100);

    expect((await change(activeIds[1]!, "trash")).error).toBeNull();
    expect((await change(activeIds[2]!, "trash")).error).toBeNull();
    expect((await change(activeIds[1]!, "restore")).error).toBeNull();
    const restores = await Promise.all([
      change(activeIds[0]!, "restore"),
      change(activeIds[2]!, "restore"),
    ]);
    expect(restores.filter((r) => !r.error)).toHaveLength(1);
    expect(
      restores.filter((r) => r.error?.message.includes("Saved capacity reached")),
    ).toHaveLength(1);
    expect((await client.rpc("saved_game_usage")).data?.[0]?.active_count).toBe(100);

    // A legitimate second finished Compact source gives Save a replay eligible
    // competitor while one Trash item is waiting to Restore.
    const next = createNewGame({
      name: "Racing saved replay",
      playerA: "Owner",
      playerB: "B",
      startingSide: "A",
      gameMode: "solo",
    });
    const nextFinished = {
      ...next,
      status: "finished" as const,
      timers: { ...next.timers, paused: true },
    };
    const nextRecord = await buildCompletedGameRecord(nextFinished);
    const nextHistory = await service.from("game_history").insert({
      source_kind: "normal",
      source_id: next.gameId,
      game_id: next.gameId,
      participant_id: ownerId,
      participant_side: "A",
      game_name: next.name,
      mode_key: "solo_practice",
      game_mode: "solo",
      completed_at: new Date().toISOString(),
      result_authority: "client_reported",
    });
    if (nextHistory.error) throw nextHistory.error;
    const nextPayload = await service.from("recent_game_payloads").insert({
      source_id: next.gameId,
      game_id: next.gameId,
      record_digest: nextRecord.digest,
      record: nextRecord,
    });
    if (nextPayload.error) throw nextPayload.error;
    expect(
      (
        await service.rpc("recent_retain_completed_source", {
          p_source_kind: "normal",
          p_source_id: next.gameId,
        })
      ).error,
    ).toBeNull();
    const awaitingRestore = restores[0]!.error ? activeIds[0]! : activeIds[2]!;
    expect((await change(activeIds[3]!, "trash")).error).toBeNull();
    const restoreVsSave = await Promise.all([
      change(awaitingRestore, "restore"),
      client.rpc("save_completed_game", { p_source_kind: "normal", p_source_id: next.gameId }),
    ]);
    expect(restoreVsSave.filter((r) => !r.error)).toHaveLength(1);
    expect((await client.rpc("saved_game_usage")).data?.[0]?.active_count).toBe(100);

    // Simulate a second pre-existing Overflow ownership for the lock race.
    sql(`update public.saved_game_items set state='overflow',state_changed_at=now()
    where participant_id='${ownerId}'::uuid and source_id='${activeIds[4]}'::uuid`);
    const activations = await Promise.all([
      change(legacyId, "activate"),
      change(activeIds[4]!, "activate"),
    ]);
    expect(activations.filter((r) => !r.error)).toHaveLength(1);
    expect((await client.rpc("saved_game_usage")).data?.[0]?.active_count).toBe(100);

    const third = createNewGame({
      name: "Activation race replay",
      playerA: "Owner",
      playerB: "B",
      startingSide: "A",
      gameMode: "solo",
    });
    const thirdRecord = await buildCompletedGameRecord({
      ...third,
      status: "finished",
      timers: { ...third.timers, paused: true },
    });
    const thirdHistory = await service.from("game_history").insert({
      source_kind: "normal",
      source_id: third.gameId,
      game_id: third.gameId,
      participant_id: ownerId,
      participant_side: "A",
      game_name: third.name,
      mode_key: "solo_practice",
      game_mode: "solo",
      completed_at: new Date().toISOString(),
      result_authority: "client_reported",
    });
    if (thirdHistory.error) throw thirdHistory.error;
    const thirdPayload = await service.from("recent_game_payloads").insert({
      source_id: third.gameId,
      game_id: third.gameId,
      record_digest: thirdRecord.digest,
      record: thirdRecord,
    });
    if (thirdPayload.error) throw thirdPayload.error;
    expect(
      (
        await service.rpc("recent_retain_completed_source", {
          p_source_kind: "normal",
          p_source_id: third.gameId,
        })
      ).error,
    ).toBeNull();
    const overflowForRace = sql(`select source_id from public.saved_game_items
    where participant_id='${ownerId}'::uuid and state='overflow' order by saved_at limit 1`);
    expect(overflowForRace).toBeTruthy();
    expect((await change(activeIds[5]!, "trash")).error).toBeNull();
    const activateVsSave = await Promise.all([
      change(overflowForRace, "activate"),
      client.rpc("save_completed_game", { p_source_kind: "normal", p_source_id: third.gameId }),
    ]);
    expect(activateVsSave.filter((r) => !r.error)).toHaveLength(1);
    expect((await client.rpc("saved_game_usage")).data?.[0]?.active_count).toBe(100);

    const adminEmail = `lifecycle-admin-${crypto.randomUUID()}@example.test`;
    const adminMade = await service.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
    });
    if (adminMade.error || !adminMade.data.user) throw adminMade.error ?? new Error("No admin.");
    const adminProfile = await service
      .from("profiles")
      .update({ status: "approved", is_admin: true })
      .eq("id", adminMade.data.user.id);
    if (adminProfile.error) throw adminProfile.error;
    const admin = createClient(url, env.ANON_KEY!, { auth: { persistSession: false } });
    const adminSigned = await admin.auth.signInWithPassword({ email: adminEmail, password });
    if (adminSigned.error) throw adminSigned.error;
    const grant = await admin.rpc("admin_grant_plan", {
      target_user: ownerId,
      target_plan: "plus",
      target_months: 1,
      target_reason: "lifecycle race",
      target_request_id: crypto.randomUUID(),
    });
    if (grant.error) throw grant.error;
    const passId = grant.data[0].pass_id as string;
    const remainingOverflow = sql(`select source_id from public.saved_game_items
    where participant_id='${ownerId}'::uuid and state='overflow' order by saved_at limit 1`);
    expect(
      (await change(remainingOverflow || activeIds[5]!, remainingOverflow ? "activate" : "restore"))
        .error,
    ).toBeNull();
    expect((await client.rpc("saved_game_usage")).data?.[0]?.active_count).toBe(101);
    expect((await change(roomId, "trash")).error).toBeNull();
    const beforeDowngrade = Number(
      sql(`select count(*) from public.saved_game_items
    where participant_id='${ownerId}'::uuid`),
    );
    const downgradeRace = await Promise.all([
      admin.rpc("admin_revoke_pass", {
        target_pass: passId,
        target_reason: "lifecycle downgrade race",
      }),
      change(roomId, "restore"),
    ]);
    expect(downgradeRace[0]!.error).toBeNull();
    if (downgradeRace[1]!.error)
      expect(downgradeRace[1]!.error.message).toContain("Saved capacity reached");
    expect((await client.rpc("saved_game_usage")).data?.[0]).toMatchObject({
      active_count: 100,
      capacity: 100,
    });
    expect(
      Number(
        sql(`select count(*) from public.saved_game_items
    where participant_id='${ownerId}'::uuid`),
      ),
    ).toBe(beforeDowngrade);

    // Deletion and a safe replay open can race; independent Recent retention
    // keeps the payload available and History untouched.
    expect((await change(roomId, "trash")).error).toBeNull();
    const [deleted, opened] = await Promise.all([
      change(roomId, "delete"),
      call("archive-replay", roomId),
    ]);
    expect(deleted.error).toBeNull();
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    sql(`insert into public.completed_payload_cleanup_queue (source_id,queued_at)
      values ('${roomId}'::uuid,'2000-01-01'::timestamptz)
      on conflict (source_id) do update set queued_at=excluded.queued_at`);
    const cleanup = new Promise<string>((resolve, reject) => {
      execFile(
        "psql",
        [
          env.DB_URL!,
          "-v",
          "ON_ERROR_STOP=1",
          "-At",
          "-c",
          "select public.process_completed_payload_cleanup(1, interval '0 seconds')",
        ],
        { encoding: "utf8" },
        (error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
      );
    });
    const [processed, openedDuringCleanup] = await Promise.all([
      cleanup,
      call("archive-replay", roomId),
    ]);
    expect(processed).toBe("1");
    expect(openedDuringCleanup.status, JSON.stringify(openedDuringCleanup.body)).toBe(200);
    expect((await call("archive-replay", roomId)).status).toBe(200);
    expect(sql(`select count(*) from public.game_history where source_id='${roomId}'::uuid`)).toBe(
      "1",
    );
    const secondGrant = await admin.rpc("admin_grant_plan", {
      target_user: ownerId,
      target_plan: "plus",
      target_months: 1,
      target_reason: "Save downgrade race",
      target_request_id: crypto.randomUUID(),
    });
    if (secondGrant.error) throw secondGrant.error;
    const beforePlusRestore = (await client.rpc("saved_game_usage")).data?.[0]?.active_count;
    const trashedIds = sql(`select source_id from public.saved_game_items
    where participant_id='${ownerId}'::uuid and state='trashed'
    order by saved_at limit 1`).split("\n");
    expect(trashedIds).toHaveLength(1);
    for (const id of trashedIds) expect((await change(id, "restore")).error).toBeNull();
    if (beforePlusRestore === 99)
      sql(`with id as (select gen_random_uuid() value),
    h as (insert into public.game_history (source_kind,source_id,participant_id,
      game_id,participant_side,game_name,mode_key,game_mode,completed_at,result_authority)
      select 'normal',value,'${ownerId}'::uuid,value,'A','Plus capacity fixture',
        'solo_practice','solo',now(),'client_reported' from id returning source_id)
    insert into public.saved_game_items (source_kind,source_id,participant_id)
      select 'normal',source_id,'${ownerId}'::uuid from h`);
    expect((await client.rpc("saved_game_usage")).data?.[0]?.active_count).toBe(101);
    const beforeSaveRace = Number(
      sql(`select count(*) from public.saved_game_items
    where participant_id='${ownerId}'::uuid`),
    );
    const saveVsDowngrade = await Promise.all([
      client.rpc("save_completed_game", { p_source_kind: "normal", p_source_id: roomId }),
      admin.rpc("admin_revoke_pass", {
        target_pass: secondGrant.data[0].pass_id,
        target_reason: "Save downgrade race",
      }),
    ]);
    expect(saveVsDowngrade[1]!.error).toBeNull();
    if (saveVsDowngrade[0]!.error)
      expect(saveVsDowngrade[0]!.error.message).toContain("Saved capacity reached");
    expect((await client.rpc("saved_game_usage")).data?.[0]).toMatchObject({
      active_count: 100,
      capacity: 100,
    });
    expect(
      Number(
        sql(`select count(*) from public.saved_game_items
    where participant_id='${ownerId}'::uuid`),
      ),
    ).toBe(beforeSaveRace + (saveVsDowngrade[0]!.error ? 0 : 1));
  },
  30_000,
);
