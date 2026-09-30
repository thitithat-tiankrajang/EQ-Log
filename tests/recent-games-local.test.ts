// @vitest-environment node
/** Opt-in real concurrency/security gate. Use an isolated loopback stack only. */
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { createNewGame } from "../src/game";
import { buildCompletedGameRecord } from "../src/completedGame/record";

const workdir = process.env.RECENT_TEST_SUPABASE_WORKDIR;
const local = workdir ? it : it.skip;

local(
  "concurrent retention converges per participant and opens only a safe retained replay",
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
      throw new Error("Recent integration test requires an isolated loopback stack.");
    const service = createClient(url, env.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const password = "LocalTest-Recent-2026!";
    const users: string[] = [];
    async function makeUser(label: string) {
      const email = `recent-${label}-${crypto.randomUUID()}@example.test`;
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
    async function endpoint(token: string, gameId: string) {
      const response = await fetch(`${url}/functions/v1/archive-replay`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: env.ANON_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId, participantId: users[0] }),
      });
      return { status: response.status, body: await response.json() };
    }

    try {
      const a = await makeUser("a");
      const b = await makeUser("b");
      const host = await makeUser("host");
      const started = createNewGame({
        name: "Recent shared replay",
        playerA: "A",
        playerB: "B",
        startingSide: "A",
      });
      const finished = {
        ...started,
        status: "finished" as const,
        timers: { ...started.timers, paused: true },
      };
      const record = await buildCompletedGameRecord(finished);
      const sharedId = started.gameId;
      const laterIds = Array.from({ length: 22 }, () => crypto.randomUUID());
      const history = [
        ...[a.id, b.id].map((participant, index) => ({
          source_kind: "normal",
          source_id: sharedId,
          participant_id: participant,
          game_id: sharedId,
          participant_side: index === 0 ? "A" : "B",
          game_name: "Recent shared replay",
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
          game_name: `Recent ${index + 1}`,
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
        {
          source_id: sharedId,
          game_id: sharedId,
          record_digest: record.digest,
          record,
        },
        ...laterIds.map((id) => ({
          source_id: id,
          game_id: id,
          record_digest: fakeDigest,
          record: {
            format: 1,
            digest: fakeDigest,
            genesis: { meta: { gameId: id } },
          },
        })),
      ]);
      if (insertedPayload.error) throw insertedPayload.error;

      const retain = (id: string) =>
        service.rpc("recent_retain_completed_source", {
          p_source_kind: "normal",
          p_source_id: id,
        });
      const first = await Promise.all([retain(sharedId), retain(sharedId)]);
      for (const result of first) expect(result.error).toBeNull();
      const before = await endpoint(b.token, sharedId);
      expect(before.status).toBe(200);
      expect(before.body.archive.scope).toBe("recent");
      expect(before.body.replay.status).toBe("finished");
      const safe = JSON.stringify(before.body);
      expect(safe).not.toContain(record.digest);
      expect(safe).not.toContain(started.tilebag[0]!.id);
      expect(safe).not.toMatch(/tilebag|drawOrder|finalStateDigest|decisionSeed/);
      expect((await endpoint(host.token, sharedId)).status).toBe(404);

      const filled = await Promise.all(laterIds.slice(0, 19).map(retain));
      for (const result of filled) expect(result.error).toBeNull();
      const atCapacity = await service
        .from("recent_game_items")
        .select("source_id")
        .eq("participant_id", a.id);
      expect(atCapacity.data).toHaveLength(20);
      const racing = endpoint(a.token, sharedId);
      const concurrent = await Promise.all([
        ...laterIds.slice(19).map(retain),
        retain(laterIds[20]!),
        retain(laterIds[20]!),
      ]);
      const racingRead = await racing;
      expect([200, 404]).toContain(racingRead.status);
      if (racingRead.status === 200) {
        expect(racingRead.body.archive.scope).toBe("recent");
        expect(JSON.stringify(racingRead.body)).not.toContain(record.digest);
      }
      for (const result of concurrent) expect(result.error).toBeNull();
      const retained = await service
        .from("recent_game_items")
        .select("source_id,participant_id,completed_at")
        .in("participant_id", [a.id, b.id]);
      if (retained.error) throw retained.error;
      const aRows = retained.data.filter((row) => row.participant_id === a.id);
      const bRows = retained.data.filter((row) => row.participant_id === b.id);
      expect(aRows).toHaveLength(20);
      expect(new Set(aRows.map((row) => row.source_id))).toEqual(new Set(laterIds.slice(2)));
      expect(bRows.map((row) => row.source_id)).toEqual([sharedId]);
      expect((await endpoint(a.token, sharedId)).status).toBe(404);
      expect((await endpoint(b.token, sharedId)).status).toBe(200);
      expect((await endpoint(host.token, sharedId)).status).toBe(404);
      expect((await a.client.from("recent_game_items").select("*")).error).toBeTruthy();
      expect((await a.client.from("recent_game_payloads").select("record")).error).toBeTruthy();
      expect(
        (
          await a.client.rpc("recent_retain_completed_source", {
            p_source_kind: "normal",
            p_source_id: sharedId,
          })
        ).error,
      ).toBeTruthy();
      expect(
        (
          await a.client.rpc("read_recent_game_payload", {
            p_game_id: sharedId,
            p_user_id: b.id,
          })
        ).error,
      ).toBeTruthy();
      const aPage = await a.client.rpc("list_my_game_history", { p_limit: 30 });
      const bPage = await b.client.rpc("list_my_game_history", { p_limit: 30 });
      expect(aPage.error).toBeNull();
      expect(bPage.error).toBeNull();
      expect(aPage.data).toHaveLength(23);
      expect(aPage.data.find((row: { game_id: string }) => row.game_id === sharedId)).toMatchObject(
        {
          is_recent: false,
          replay_availability: "unavailable",
        },
      );
      expect(bPage.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            game_id: sharedId,
            is_recent: true,
            replay_availability: "compact_available",
          }),
        ]),
      );
      if (process.env.BENCHMARK_RECENT === "1")
        console.log(
          `RECENT_LOCAL_READ_BENCHMARK=${JSON.stringify({
            historyRpcCount: 1,
            historyRows: aPage.data.length,
            historyResponseBytes: new TextEncoder().encode(JSON.stringify(aPage.data)).length,
            recentSafeOpenResponseBytes: new TextEncoder().encode(JSON.stringify(before.body))
              .length,
            rawRecordBytes: new TextEncoder().encode(JSON.stringify(record)).length,
          })}`,
        );
      const retry = await retain(sharedId);
      expect(retry.error).toBeNull();
      const afterRetry = await service
        .from("recent_game_items")
        .select("source_id")
        .eq("participant_id", a.id);
      expect(afterRetry.data).toHaveLength(20);
      expect(afterRetry.data?.some((row) => row.source_id === sharedId)).toBe(false);
    } finally {
      for (const id of users) await service.auth.admin.deleteUser(id);
    }
  },
  90_000,
);
