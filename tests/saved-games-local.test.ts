// @vitest-environment node
/** Opt-in real Saved concurrency, retention and safe-reader gate. Isolated loopback stack only. */
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { createNewGame } from "../src/game";
import { encodeGame } from "../src/codec";
import { buildCompletedGameRecord } from "../src/completedGame/record";

const workdir = process.env.SAVED_TEST_SUPABASE_WORKDIR;
const local = workdir ? it : it.skip;
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

local(
  "explicit Save survives Recent eviction and enforces concurrent capacity at the database",
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
    const dbUrl = env.DB_URL!;
    if (!url.startsWith("http://127.0.0.1:") || !dbUrl.includes("127.0.0.1"))
      throw new Error("Saved integration test requires an isolated loopback stack.");
    const service = createClient(url, env.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const password = "LocalTest-Saved-2026!";
    const users: string[] = [];
    async function makeUser(label: string) {
      const email = `saved-${label}-${crypto.randomUUID()}@example.test`;
      const made = await service.auth.admin.createUser({ email, password, email_confirm: true });
      if (made.error || !made.data.user) throw made.error ?? new Error("Missing user.");
      users.push(made.data.user.id);
      const updated = await service
        .from("profiles")
        .update({ status: "approved" })
        .eq("id", made.data.user.id);
      if (updated.error) throw updated.error;
      const client = createClient(url, env.ANON_KEY!, { auth: { persistSession: false } });
      const signed = await client.auth.signInWithPassword({ email, password });
      if (signed.error || !signed.data.session) throw signed.error ?? new Error("No session.");
      return { id: made.data.user.id, client, token: signed.data.session.access_token };
    }
    function sql(statement: string) {
      return execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-At", "-c", statement], {
        encoding: "utf8",
      }).trim();
    }
    async function endpoint(token: string, gameId: string) {
      const response = await fetch(`${url}/functions/v1/archive-replay`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: env.ANON_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId }),
      });
      return { status: response.status, body: await response.json() };
    }
    async function saveEndpoint(token: string, sourceId: string) {
      const response = await fetch(`${url}/functions/v1/save-completed-game`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: env.ANON_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sourceKind: "normal", sourceId }),
      });
      return { status: response.status, body: await response.json() };
    }
    const a = await makeUser("a");
    const b = await makeUser("b");
    const host = await makeUser("host");
    try {
      const initial = createNewGame({
        name: "Saved shared replay",
        playerA: "A",
        playerB: "B",
        startingSide: "A",
      });
      const finished = {
        ...initial,
        status: "finished" as const,
        timers: { ...initial.timers, paused: true },
      };
      const record = await buildCompletedGameRecord(finished);
      const sharedId = initial.gameId;
      const racingInitial = createNewGame({
        name: "Saved eviction race",
        playerA: "A",
        playerB: "B",
        startingSide: "A",
      });
      const racingRecord = await buildCompletedGameRecord({
        ...racingInitial,
        status: "finished",
        timers: { ...racingInitial.timers, paused: true },
      });
      const laterIds = [
        racingInitial.gameId,
        ...Array.from({ length: 101 }, () => crypto.randomUUID()),
      ];
      const history = [
        ...[a.id, b.id].map((participant, index) => ({
          source_kind: "normal",
          source_id: sharedId,
          participant_id: participant,
          game_id: sharedId,
          participant_side: index === 0 ? "A" : "B",
          game_name: "Saved shared replay",
          mode_key: "friend",
          game_mode: "versus",
          completed_at: "2026-01-01T00:00:00.000Z",
          result_authority: "client_reported",
        })),
        ...laterIds.map((id, index) => ({
          source_kind: "normal",
          source_id: id,
          participant_id: a.id,
          game_id: id,
          participant_side: "A",
          game_name: `Later ${index + 1}`,
          mode_key: "solo_practice",
          game_mode: "solo",
          completed_at: new Date(Date.UTC(2026, 0, 2, 0, index)).toISOString(),
          result_authority: "client_reported",
        })),
      ];
      const insertedHistory = await service.from("game_history").insert(history);
      if (insertedHistory.error) throw insertedHistory.error;
      const fakeDigest = "a".repeat(64);
      const insertedPayload = await service.from("recent_game_payloads").insert([
        { source_id: sharedId, game_id: sharedId, record_digest: record.digest, record },
        ...laterIds.map((id, index) => ({
          source_id: id,
          game_id: id,
          record_digest: index === 0 ? racingRecord.digest : fakeDigest,
          record:
            index === 0
              ? racingRecord
              : { format: 1, digest: fakeDigest, genesis: { meta: { gameId: id } } },
        })),
      ]);
      if (insertedPayload.error) throw insertedPayload.error;
      const retain = (id: string) =>
        service.rpc("recent_retain_completed_source", { p_source_kind: "normal", p_source_id: id });
      expect((await retain(sharedId)).error).toBeNull();
      const dup = await Promise.all([
        a.client.rpc("save_completed_game", { p_source_kind: "normal", p_source_id: sharedId }),
        a.client.rpc("save_completed_game", { p_source_kind: "normal", p_source_id: sharedId }),
      ]);
      expect(dup.every((result) => result.error === null)).toBe(true);
      expect(dup.map((result) => result.data?.[0]?.already_saved).sort()).toEqual([false, true]);
      expect(
        (
          await b.client.rpc("save_completed_game", {
            p_source_kind: "normal",
            p_source_id: sharedId,
          })
        ).error,
      ).toBeNull();
      expect(
        (
          await host.client.rpc("save_completed_game", {
            p_source_kind: "normal",
            p_source_id: sharedId,
          })
        ).error,
      ).toBeTruthy();
      const before = await endpoint(a.token, sharedId);
      expect(before.status).toBe(200);
      expect(JSON.stringify(before.body)).not.toContain(record.digest);
      expect(JSON.stringify(before.body)).not.toMatch(/tilebag|drawOrder|finalStateDigest/);

      const [openDuringEviction, ...retained] = await Promise.all([
        endpoint(a.token, sharedId),
        ...laterIds.slice(0, 20).map(retain),
      ]);
      expect(openDuringEviction.status).toBe(200);
      expect(retained.every((result) => result.error === null)).toBe(true);
      const evictionRace = await Promise.all([
        a.client.rpc("save_completed_game", { p_source_kind: "normal", p_source_id: laterIds[0] }),
        retain(laterIds[20]!),
      ]);
      expect(evictionRace[1]!.error).toBeNull();
      const racedSavedId = evictionRace[0]!.error ? laterIds[1]! : laterIds[0]!;
      if (evictionRace[0]!.error) {
        expect(evictionRace[0]!.error.message).toContain("replay unavailable for Saved");
        expect(
          (
            await a.client.rpc("save_completed_game", {
              p_source_kind: "normal",
              p_source_id: racedSavedId,
            })
          ).error,
        ).toBeNull();
      }
      expect((await retain(laterIds[21]!)).error).toBeNull();
      if (!evictionRace[0]!.error) expect((await endpoint(a.token, laterIds[0]!)).status).toBe(200);
      const aRecent = await service
        .from("recent_game_items")
        .select("source_id")
        .eq("participant_id", a.id)
        .eq("source_id", sharedId);
      expect(aRecent.data).toHaveLength(0);
      const after = await endpoint(a.token, sharedId);
      expect(after.status).toBe(200);
      expect(after.body.archive.scope).toBe("saved");
      expect(after.body.replay.status).toBe("finished");
      expect((await endpoint(host.token, sharedId)).status).toBe(404);
      expect((await endpoint(b.token, sharedId)).status).toBe(200);

      const cleanupWhileShared = await service.rpc("cleanup_unreferenced_recent_payload", {
        p_source_id: sharedId,
      });
      expect(cleanupWhileShared.error).toBeNull();
      expect(cleanupWhileShared.data).toBe(false);
      expect(idPattern.test(a.id)).toBe(true);
      const seedValues = laterIds
        .slice(0, 98)
        .filter((id) => id !== racedSavedId)
        .map((id) => `('normal','${id}'::uuid,'${a.id}'::uuid)`)
        .join(",");
      sql(
        `insert into public.saved_game_items (source_kind,source_id,participant_id) values ${seedValues}`,
      );
      expect((await retain(laterIds[98]!)).error).toBeNull();
      expect((await retain(laterIds[99]!)).error).toBeNull();
      const racing = await Promise.all(
        laterIds
          .slice(98, 100)
          .map((id) =>
            a.client.rpc("save_completed_game", { p_source_kind: "normal", p_source_id: id }),
          ),
      );
      expect(racing.filter((result) => !result.error)).toHaveLength(1);
      expect(
        racing.filter((result) => result.error?.message.includes("Saved capacity reached")),
      ).toHaveLength(1);
      const usage = await a.client.rpc("saved_game_usage");
      expect(usage.error).toBeNull();
      expect(usage.data?.[0]).toMatchObject({
        active_count: 100,
        capacity: 100,
        plan_name: "Free",
      });
      expect(
        (
          await a.client.rpc("save_completed_game", {
            p_source_kind: "normal",
            p_source_id: sharedId,
          })
        ).data?.[0]?.already_saved,
      ).toBe(true);
      expect(
        (
          await a.client
            .from("saved_game_items")
            .insert({ source_kind: "normal", source_id: laterIds[100], participant_id: a.id })
        ).error,
      ).toBeTruthy();
      expect((await a.client.from("saved_legacy_payloads").select("snapshot")).error).toBeTruthy();
      expect(
        (await a.client.rpc("read_saved_game_payload", { p_game_id: sharedId, p_user_id: b.id }))
          .error,
      ).toBeTruthy();
      expect((await endpoint(b.token, laterIds[0]!)).status).toBe(404);

      // A plan grant uses the same account advisory lock as Save. Either order
      // is legal; after the grant, one more explicit Save succeeds. Revocation
      // keeps the over-capacity item readable.
      const promoted = await service.from("profiles").update({ is_admin: true }).eq("id", host.id);
      if (promoted.error) throw promoted.error;
      expect((await retain(laterIds[100]!)).error).toBeNull();
      const planRace = await Promise.all([
        host.client.rpc("admin_grant_plan", {
          target_user: a.id,
          target_plan: "plus",
          target_months: 1,
          target_reason: "isolated Saved race",
          target_request_id: crypto.randomUUID(),
        }),
        a.client.rpc("save_completed_game", {
          p_source_kind: "normal",
          p_source_id: laterIds[100],
        }),
      ]);
      expect(planRace[0]!.error).toBeNull();
      const passId = planRace[0]!.data?.[0]?.pass_id as string;
      if (planRace[1]!.error) {
        expect(planRace[1]!.error.message).toContain("Saved capacity reached");
        expect(
          (
            await a.client.rpc("save_completed_game", {
              p_source_kind: "normal",
              p_source_id: laterIds[100],
            })
          ).error,
        ).toBeNull();
      }
      expect((await a.client.rpc("saved_game_usage")).data?.[0]).toMatchObject({
        active_count: 101,
        capacity: 1000,
        plan_name: "EQ Plus",
      });
      const revoked = await host.client.rpc("admin_revoke_pass", {
        target_pass: passId,
        target_reason: "isolated Saved downgrade",
      });
      expect(revoked.error).toBeNull();
      expect((await a.client.rpc("saved_game_usage")).data?.[0]).toMatchObject({
        active_count: 100,
        capacity: 100,
        plan_name: "Free",
      });
      expect(
        (
          await a.client.rpc("save_completed_game", {
            p_source_kind: "normal",
            p_source_id: laterIds[100],
          })
        ).data?.[0]?.already_saved,
      ).toBe(true);

      // A payload retained only by Recent cannot be cleaned; after the relation
      // leaves Recent and has no Saved owner, the trusted cleanup can remove it.
      expect((await retain(laterIds[101]!)).error).toBeNull();
      expect(
        (await service.rpc("cleanup_unreferenced_recent_payload", { p_source_id: laterIds[101] }))
          .data,
      ).toBe(false);
      sql(`delete from public.recent_game_items where source_id='${laterIds[101]}'::uuid`);
      expect(
        (await service.rpc("cleanup_unreferenced_recent_payload", { p_source_id: laterIds[101] }))
          .data,
      ).toBe(true);
      expect((await endpoint(a.token, sharedId)).status).toBe(200);

      // A full Saved list never participates in game completion. The Stage
      // terminal integration gate independently exercises real finalization.
      const listed = await a.client.rpc("list_my_saved_games", { p_limit: 20 });
      expect(listed.error).toBeNull();
      expect(listed.data).toHaveLength(20);
      if (process.env.BENCHMARK_SAVED === "1")
        console.log(
          `SAVED_LOCAL_BENCHMARK=${JSON.stringify({
            listRows: listed.data.length,
            listResponseBytes: new TextEncoder().encode(JSON.stringify(listed.data)).length,
            oneCompactPayloadBytes: new TextEncoder().encode(JSON.stringify(record)).length,
            activeCount: 100,
          })}`,
        );
      const historyPage = await a.client.rpc("list_my_game_history", { p_limit: 20 });
      expect(historyPage.error).toBeNull();
      expect(historyPage.data.some((row: { is_saved: boolean }) => row.is_saved)).toBe(true);

      // Legacy v3 is frozen once and remains readable after its owner's old
      // Private Library item enters the legacy Trash.
      const legacyId = crypto.randomUUID();
      const legacyState = { ...finished, gameId: legacyId };
      const legacy = encodeGame(legacyState);
      const legacyHistory = await service.from("game_history").insert({
        source_kind: "normal",
        source_id: legacyId,
        participant_id: b.id,
        source_owner_id: host.id,
        game_id: legacyId,
        participant_side: "A",
        game_name: "Legacy saved",
        mode_key: "friend",
        game_mode: "versus",
        completed_at: "2026-01-03T00:00:00.000Z",
        result_authority: "client_reported",
      });
      if (legacyHistory.error) throw legacyHistory.error;
      const oldItem = await service
        .from("private_library_items")
        .insert({
          owner_id: b.id,
          item_type: "game",
          name: "Legacy saved",
          game_id: legacyId,
          game_mode: "versus",
          mode_key: "friend",
          completion_kind: "natural",
          completion_reason: "finished",
          snapshot: legacy,
        })
        .select("id")
        .single();
      if (oldItem.error) throw oldItem.error;
      expect(
        (
          await b.client.rpc("save_completed_game", {
            p_source_kind: "normal",
            p_source_id: legacyId,
          })
        ).error?.message,
      ).toBe("legacy_validation_required");
      const saveLegacy = await saveEndpoint(b.token, legacyId);
      expect(saveLegacy.status, JSON.stringify(saveLegacy.body)).toBe(200);
      expect(saveLegacy.body.already_saved).toBe(false);
      expect((await saveEndpoint(b.token, legacyId)).body.already_saved).toBe(true);
      const frozen = await endpoint(b.token, legacyId);
      expect(frozen.status).toBe(200);
      expect(frozen.body.archive.scope).toBe("saved");
      expect(frozen.body.replay.status).toBe("finished");
      sql(
        `update public.private_library_items set trashed_at=now() where id='${oldItem.data.id}'::uuid`,
      );
      expect((await endpoint(b.token, legacyId)).status).toBe(200);
      expect((await endpoint(host.token, legacyId)).status).toBe(404);
      const retainedLegacyCleanup = await service.rpc("cleanup_unreferenced_saved_legacy_payload", {
        p_source_id: legacyId,
      });
      expect(retainedLegacyCleanup.error).toBeNull();
      expect(retainedLegacyCleanup.data).toBe(false);
      expect((await endpoint(b.token, legacyId)).status).toBe(200);

      const hostOnlyId = crypto.randomUUID();
      const hostOnlyHistory = await service.from("game_history").insert({
        source_kind: "normal",
        source_id: hostOnlyId,
        participant_id: b.id,
        source_owner_id: host.id,
        game_id: hostOnlyId,
        participant_side: "A",
        game_name: "Host private legacy",
        mode_key: "friend",
        game_mode: "versus",
        completed_at: "2026-01-03T01:00:00.000Z",
        result_authority: "client_reported",
      });
      if (hostOnlyHistory.error) throw hostOnlyHistory.error;
      const hostOnlyArchive = await service.from("private_library_items").insert({
        owner_id: host.id,
        item_type: "game",
        name: "Host private legacy",
        game_id: hostOnlyId,
        game_mode: "versus",
        mode_key: "friend",
        completion_kind: "natural",
        completion_reason: "finished",
        snapshot: encodeGame({ ...finished, gameId: hostOnlyId }),
      });
      if (hostOnlyArchive.error) throw hostOnlyArchive.error;
      expect((await endpoint(b.token, hostOnlyId)).status).toBe(404);
      const hostHistory = await b.client.rpc("list_my_game_history", { p_limit: 20 });
      expect(hostHistory.error).toBeNull();
      expect(
        hostHistory.data.find((row: { source_id: string }) => row.source_id === hostOnlyId),
      ).toMatchObject({ replay_availability: "unavailable", can_save: true, is_saved: false });
      const seatedHostSave = await saveEndpoint(b.token, hostOnlyId);
      expect(seatedHostSave.status, JSON.stringify(seatedHostSave.body)).toBe(200);
      expect((await endpoint(b.token, hostOnlyId)).body.archive.scope).toBe("saved");
      expect((await saveEndpoint(host.token, hostOnlyId)).status).toBe(403);

      const malformedId = crypto.randomUUID();
      const malformedHistory = await service.from("game_history").insert({
        source_kind: "normal",
        source_id: malformedId,
        participant_id: b.id,
        game_id: malformedId,
        participant_side: "A",
        game_name: "Unreadable legacy",
        mode_key: "friend",
        game_mode: "versus",
        completed_at: "2026-01-04T00:00:00.000Z",
        result_authority: "client_reported",
      });
      if (malformedHistory.error) throw malformedHistory.error;
      const malformedArchive = await service.from("private_library_items").insert({
        owner_id: b.id,
        item_type: "game",
        name: "Unreadable legacy",
        game_id: malformedId,
        game_mode: "versus",
        mode_key: "friend",
        completion_kind: "natural",
        completion_reason: "finished",
        snapshot: {
          v: 3,
          gameId: malformedId,
          status: "finished",
          history: [],
          logs: [],
        },
      });
      if (malformedArchive.error) throw malformedArchive.error;
      const invalidSave = await saveEndpoint(b.token, malformedId);
      expect(invalidSave.status).toBe(422);
      expect(invalidSave.body.error).toMatch(/incomplete or unreadable/);
      expect(
        (await b.client.rpc("list_my_saved_games", { p_limit: 20 })).data.some(
          (row: { source_id: string }) => row.source_id === malformedId,
        ),
      ).toBe(false);
    } finally {
      for (const id of users) await service.auth.admin.deleteUser(id);
    }
  },
  120_000,
);
