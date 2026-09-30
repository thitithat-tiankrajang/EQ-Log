// @vitest-environment node
/**
 * Opt-in end-to-end security gate against an isolated local Supabase stack.
 * Set ARCHIVE_TEST_SUPABASE_WORKDIR to that stack's project root. The test
 * creates and removes its own users/rows; it never targets a linked project.
 */
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { createNewGame } from "../src/game";
import { encodeGame } from "../src/codec";
import { buildCompletedGameRecord } from "../src/completedGame/record";

const localWorkdir = process.env.ARCHIVE_TEST_SUPABASE_WORKDIR;
const runLocal = localWorkdir ? it : it.skip;

runLocal(
  "serves only safe replay through a real local archive endpoint",
  async () => {
    const output = execFileSync("supabase", ["status", "--workdir", localWorkdir!, "-o", "env"], {
      encoding: "utf8",
    });
    const env: Record<string, string> = {};
    for (const line of output.split("\n")) {
      const match = line.match(/^([A-Z_]+)="?([^"\n]+)"?$/);
      if (match) env[match[1]!] = match[2]!;
    }
    const url = env.API_URL!;
    const anonKey = env.ANON_KEY!;
    const service = createClient(url, env.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const users: string[] = [];
    const gameIds: string[] = [];
    const regionA = crypto.randomUUID();
    const regionB = crypto.randomUUID();
    const password = "LocalTest-Archive-2026!";

    async function makeUser(tag: string, region: string, status = "approved") {
      const email = `archive-${tag}-${crypto.randomUUID()}@example.test`;
      const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user)
        throw created.error ?? new Error("Missing test user.");
      const id = created.data.user.id;
      users.push(id);
      const profile = await service
        .from("profiles")
        .update({ status, region_id: region })
        .eq("id", id);
      if (profile.error) throw profile.error;
      const client = createClient(url, anonKey, { auth: { persistSession: false } });
      const signed = await client.auth.signInWithPassword({ email, password });
      if (signed.error || !signed.data.session) throw signed.error ?? new Error("Missing session.");
      return { id, client, token: signed.data.session.access_token };
    }

    async function endpoint(token: string, gameId: string, claims?: Record<string, unknown>) {
      const response = await fetch(`${url}/functions/v1/archive-replay`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ gameId, ...claims }),
      });
      return { status: response.status, body: await response.json() };
    }

    try {
      const regions = await service.from("regions").insert([
        { id: regionA, name: "Archive test A" },
        { id: regionB, name: "Archive test B" },
      ]);
      if (regions.error) throw regions.error;
      const owner = await makeUser("owner", regionA);
      const member = await makeUser("member", regionA);
      const other = await makeUser("other", regionB);
      const pending = await makeUser("pending", regionA, "pending");
      const started = createNewGame({
        name: "Archive smoke",
        playerA: "A",
        playerB: "B",
        startingSide: "A",
      });
      const game = {
        ...started,
        status: "finished" as const,
        timers: { ...started.timers, paused: true },
      };
      const legacy = encodeGame(game);
      const compact = await buildCompletedGameRecord(game);
      const publicLegacyId = crypto.randomUUID();
      const publicCompactId = crypto.randomUUID();
      const regionId = crypto.randomUUID();
      gameIds.push(publicLegacyId, publicCompactId, regionId);
      const common = {
        source_owner_id: owner.id,
        name: "Archive smoke",
        player_a: "A",
        player_b: "B",
        game_mode: "versus",
        mode_key: "friend",
        completion_kind: "natural",
        completion_reason: "rack_out",
        created_at: game.createdAt,
        finished_at: new Date().toISOString(),
      };
      const publicRows = await service.from("public_game_snapshots").insert([
        { ...common, game_id: publicLegacyId, snapshot: legacy },
        { ...common, game_id: publicCompactId, snapshot: compact },
      ]);
      if (publicRows.error) throw publicRows.error;
      const regionRow = await service
        .from("region_game_snapshots")
        .insert({ ...common, game_id: regionId, region_id: regionA, snapshot: compact });
      if (regionRow.error) throw regionRow.error;

      const old = await endpoint(member.token, publicLegacyId);
      const current = await endpoint(member.token, publicCompactId);
      expect(old.status).toBe(200);
      expect(current.status).toBe(200);
      expect(old.body.replay.status).toBe("finished");
      expect(current.body.replay.status).toBe("finished");
      expect(old.body.replay.finalBoard).toEqual(current.body.replay.finalBoard);
      const safeWire = JSON.stringify(current.body);
      expect(safeWire).not.toContain(compact.digest);
      expect(safeWire).not.toContain(game.rackA[0]?.id);
      expect(safeWire).not.toMatch(/tilebag|drawOrder|finalStateDigest|decisionSeed/);
      expect((await endpoint(pending.token, publicCompactId)).status).toBe(404);
      expect((await endpoint(member.token, regionId)).status).toBe(200);
      expect((await endpoint(other.token, regionId)).status).toBe(404);

      const copied = await owner.client.rpc("save_archive_to_private", {
        target_scope: "public",
        target_game_id: publicLegacyId,
        target_parent_id: null,
      });
      if (copied.error) throw copied.error;
      expect(copied.data).toBeTruthy();
      const removed = await service
        .from("public_game_snapshots")
        .delete()
        .eq("game_id", publicLegacyId);
      if (removed.error) throw removed.error;
      const privateReplay = await endpoint(owner.token, publicLegacyId);
      expect(privateReplay.status).toBe(200);
      expect(privateReplay.body.archive.scope).toBe("private");
      expect(
        (await endpoint(other.token, publicLegacyId, { isOwner: true, canView: true })).status,
      ).toBe(404);

      expect(
        (await owner.client.from("private_library_items").select("snapshot")).error,
      ).toBeTruthy();
      expect(
        (await member.client.from("public_game_snapshots").select("snapshot")).error,
      ).toBeTruthy();
      expect(
        (await member.client.from("region_game_snapshots").select("snapshot")).error,
      ).toBeTruthy();
      expect(
        (
          await owner.client.from("public_game_snapshots").insert({
            game_id: crypto.randomUUID(),
            snapshot: compact,
          })
        ).error,
      ).toBeTruthy();
      expect(
        (
          await owner.client
            .from("public_game_snapshots")
            .update({ snapshot: legacy })
            .eq("game_id", publicCompactId)
        ).error,
      ).toBeTruthy();
      expect(
        (
          await owner.client
            .from("private_library_items")
            .update({ snapshot: compact })
            .eq("id", copied.data)
        ).error,
      ).toBeTruthy();
      const retained = await service
        .from("public_game_snapshots")
        .select("snapshot")
        .eq("game_id", publicCompactId)
        .single();
      if (retained.error) throw retained.error;
      expect(retained.data.snapshot).toEqual(compact);
    } finally {
      for (const table of [
        "private_library_items",
        "public_game_snapshots",
        "region_game_snapshots",
      ]) {
        for (const id of gameIds) await service.from(table).delete().eq("game_id", id);
      }
      for (const user of users) await service.auth.admin.deleteUser(user);
      await service.from("regions").delete().in("id", [regionA, regionB]);
    }
  },
  30_000,
);
