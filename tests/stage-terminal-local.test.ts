// @vitest-environment node
/** Opt-in real Supabase gate. Set STAGE_TEST_SUPABASE_WORKDIR to an isolated local stack. */
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { encodeGame } from "../src/codec";
import { encodeCanonical, canonicalFromSnapshot } from "../src/domain/projection";
import { pushActionSnapshot } from "../src/game";
import { stageStartCanonical } from "../src/features/survival/repository";
import { createSurvivalTestGame } from "../src/features/survival/seededGame";

const workdir = process.env.STAGE_TEST_SUPABASE_WORKDIR;
const local = workdir ? it : it.skip;

local(
  "captures a sealed Stage atomically, once, through the trusted endpoint",
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
    const anonKey = env.ANON_KEY!;
    if (!url.startsWith("http://127.0.0.1:") || !env.DB_URL?.includes("127.0.0.1"))
      throw new Error("Stage integration test requires an isolated loopback Supabase stack.");
    execFileSync("psql", [
      env.DB_URL,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "insert into private.runtime_secrets (key, value) values ('room_code_secret', repeat('s', 40)) on conflict (key) do nothing",
    ]);
    const service = createClient(url, env.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const password = "LocalTest-Stage-2026!";
    async function makeUser(tag: string, admin = false) {
      const email = `stage-${tag}-${crypto.randomUUID()}@example.test`;
      const made = await service.auth.admin.createUser({ email, password, email_confirm: true });
      if (made.error || !made.data.user) throw made.error ?? new Error("Missing test user.");
      const approved = await service
        .from("profiles")
        .update({ status: "approved", is_admin: admin })
        .eq("id", made.data.user.id);
      if (approved.error) throw approved.error;
      const client = createClient(url, anonKey, { auth: { persistSession: false } });
      const session = await client.auth.signInWithPassword({ email, password });
      if (session.error || !session.data.session)
        throw session.error ?? new Error("Missing session.");
      return { id: made.data.user.id, client, token: session.data.session.access_token };
    }
    async function call(name: string, token: string, body: unknown) {
      const response = await fetch(`${url}/functions/v1/${name}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    }
    const owner = await makeUser("owner", true);
    const other = await makeUser("other");
    const levelId = crypto.randomUUID();
    const seed = 17;
    const level = await owner.client.from("survival_levels").insert({
      id: levelId,
      season_key: `local-${levelId}`,
      level_no: 1,
      seed,
      sample_policy: "local-test",
      sample_count: 3,
      win_count: 3,
      winning_replays: [{}, {}, {}],
      immediate_winning_moves: 0,
      shortest_winning_replay_turns: 5,
      status: "approved",
      admin_note: "Local sealed Stage capture test.",
      approved_by: owner.id,
      approved_at: new Date().toISOString(),
    });
    if (level.error) throw level.error;
    const sealed = await owner.client.rpc("admin_seal_stage_start", {
      target_level: levelId,
      target_start: stageStartCanonical(seed),
    });
    if (sealed.error) throw sealed.error;
    const unsealedId = crypto.randomUUID();
    const unsealed = await owner.client.from("survival_levels").insert({
      id: unsealedId,
      season_key: `local-unsealed-${unsealedId}`,
      level_no: 1,
      seed: 18,
      sample_policy: "local-test",
      sample_count: 3,
      win_count: 0,
    });
    if (unsealed.error) throw unsealed.error;
    const refusedStart = await owner.client.rpc("create_stage_attempt", {
      target_request_id: crypto.randomUUID(),
      target_level_id: unsealedId,
      target_state: encodeGame(createSurvivalTestGame(18, "Player", owner.id)),
    });
    expect(refusedStart.error).toBeTruthy();
    const prior = createSurvivalTestGame(seed, "Player", owner.id);
    const created = await owner.client.rpc("create_stage_attempt", {
      target_request_id: crypto.randomUUID(),
      target_level_id: levelId,
      target_state: encodeGame(prior),
    });
    if (created.error) throw created.error;
    const initial = Array.isArray(created.data) ? created.data[0] : created.data;
    const roomId = initial.room_id as string;
    const attemptId = initial.attempt_id as string;
    expect(roomId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    const newAttempt = await owner.client
      .from("survival_attempts")
      .select("result_authority,finished_at")
      .eq("id", attemptId)
      .single();
    if (newAttempt.error) throw newAttempt.error;
    expect(newAttempt.data).toMatchObject({ result_authority: "advisory", finished_at: null });
    expect((await call("archive-replay", owner.token, { gameId: roomId })).status).toBe(404);
    const reseal = await owner.client.rpc("admin_seal_stage_start", {
      target_level: levelId,
      target_start: {
        ...stageStartCanonical(seed),
        turnNumber: stageStartCanonical(seed).turnNumber + 1,
      },
    });
    expect(reseal.error?.message).toContain("stage_start_in_use");
    const frozen = await service
      .from("survival_levels")
      .select("start_canonical")
      .eq("id", levelId)
      .single();
    if (frozen.error) throw frozen.error;
    expect(frozen.data.start_canonical).toEqual(stageStartCanonical(seed));
    const canonical = encodeCanonical(canonicalFromSnapshot(prior, 1));
    const committed = await owner.client.rpc("commit_live_game_command", {
      target_game_id: roomId,
      target_expected_revision: 0,
      target_command_id: crypto.randomUUID(),
      target_issued_by: "host",
      target_command: { kind: "create" },
      target_canonical: canonical,
      target_canonical_digest: "local-test",
      target_state: encodeGame({ ...prior, revision: 1 }),
    });
    if (committed.error) throw committed.error;
    expect(committed.data[0].revision).toBe(1);
    const final = pushActionSnapshot({
      ...prior,
      revision: 2,
      status: "finished" as const,
      timers: { ...prior.timers, paused: true },
    });
    const finalState = encodeGame(final);

    const reported = await owner.client
      .from("survival_attempts")
      .update({
        result: "win",
        player_score: 9999,
        authur_score: 0,
        finished_at: new Date().toISOString(),
      })
      .eq("id", attemptId);
    expect(reported.error).toBeTruthy();
    const direct = await owner.client.rpc("capture_stage_terminal", {
      target_game_id: roomId,
      target_player_id: owner.id,
      target_expected_revision: 1,
      target_timeline_version: null,
      target_state: finalState,
      target_record: {},
      target_completion_kind: "terminated",
      target_completion_reason: "manual",
      target_surrendered_side: null,
    });
    expect(direct.error).toBeTruthy();
    const bypass = await owner.client.rpc("finalize_live_game_before_stage_capture", {
      target_game_id: roomId,
      target_state: finalState,
      target_completion_kind: "terminated",
      target_completion_reason: "manual",
      target_surrendered_side: null,
    });
    expect(bypass.error).toBeTruthy();
    const oldFinalizer = await owner.client.rpc("finalize_live_game", {
      target_game_id: roomId,
      target_state: finalState,
      target_completion_kind: "terminated",
      target_completion_reason: "manual",
      target_surrendered_side: null,
    });
    expect(oldFinalizer.error).toBeTruthy();
    const denied = await call("stage-terminal", other.token, { gameId: roomId, state: finalState });
    expect(denied.status, JSON.stringify(denied.body)).toBe(404);
    expect(
      (await call("stage-terminal", owner.token, { gameId: roomId, state: encodeGame(prior) }))
        .status,
    ).not.toBe(200);
    expect(
      (
        await call("stage-terminal", owner.token, {
          gameId: roomId,
          state: { ...finalState, scores: { A: 9999, B: 0 } },
        })
      ).status,
    ).not.toBe(200);
    const beforeCapture = await service
      .from("stage_completed_attempts")
      .select("attempt_id")
      .eq("room_id", roomId);
    if (beforeCapture.error) throw beforeCapture.error;
    expect(beforeCapture.data).toHaveLength(0);
    expect(
      (await service.from("room_live").select("room_id").eq("room_id", roomId)).data,
    ).toHaveLength(1);

    const payload = { gameId: roomId, state: finalState, won: true, result: "win" };
    const captureStarted = performance.now();
    const [first, duplicate] = await Promise.all([
      call("stage-terminal", owner.token, payload),
      call("stage-terminal", owner.token, payload),
    ]);
    if (process.env.BENCHMARK_SYNC === "1")
      console.log(
        `SYNC_STAGE_FINISH=${JSON.stringify({
          concurrentRequests: 2,
          requestBytesEach: Buffer.byteLength(JSON.stringify(payload)),
          responseBytesEach: Buffer.byteLength(JSON.stringify(first.body)),
          concurrentWallMs: Number((performance.now() - captureStarted).toFixed(2)),
        })}`,
      );
    expect(first.status).toBe(200);
    expect(duplicate.status).toBe(200);
    expect(first.body).toEqual(duplicate.body);
    expect(first.body.outcome).toBe("loss");
    expect(first.body.attemptId).toBe(attemptId);
    expect((await call("stage-terminal", owner.token, payload)).body).toEqual(first.body);

    const captured = await service
      .from("stage_completed_attempts")
      .select("attempt_id,room_id,record,record_digest,score_a,score_b,rules_version")
      .eq("room_id", roomId);
    if (captured.error) throw captured.error;
    expect(captured.data).toHaveLength(1);
    expect(captured.data![0].record.format).toBe(1);
    expect(captured.data![0].record_digest).toBe(first.body.digest);
    const recent = await service
      .from("recent_game_items")
      .select("source_kind,source_id,participant_id")
      .eq("source_kind", "stage")
      .eq("source_id", attemptId);
    if (recent.error) throw recent.error;
    expect(recent.data).toEqual([
      { source_kind: "stage", source_id: attemptId, participant_id: owner.id },
    ]);
    expect([captured.data![0].score_a, captured.data![0].score_b]).toEqual([
      prior.scores.A,
      prior.scores.B,
    ]);
    const attempt = await owner.client
      .from("survival_attempts")
      .select("result,result_authority,player_score,authur_score")
      .eq("id", attemptId)
      .single();
    if (attempt.error) throw attempt.error;
    expect(attempt.data.result).toBe("loss");
    expect(attempt.data.result_authority).toBe("captured_client_state");
    expect(
      (await service.from("room_live").select("room_id").eq("room_id", roomId)).data,
    ).toHaveLength(0);
    expect(
      (await owner.client.from("stage_completed_attempts").select("record")).error,
    ).toBeTruthy();
    expect(
      (await other.client.from("stage_completed_attempts").select("record")).error,
    ).toBeTruthy();

    const replay = await call("archive-replay", owner.token, { gameId: roomId });
    expect(replay.status).toBe(200);
    expect(replay.body.archive.scope).toBe("stage");
    expect(replay.body.replay.finalScores).toEqual(prior.scores);
    const wire = JSON.stringify(replay.body);
    expect(wire).not.toContain(first.body.digest);
    expect(wire).not.toContain(prior.rackA[0]!.id);
    expect(wire).not.toMatch(/tilebag|drawOrder|physical|sealedStartDigest|decisionSeed/);
    expect((await call("archive-replay", other.token, { gameId: roomId })).status).toBe(404);
  },
  60_000,
);
