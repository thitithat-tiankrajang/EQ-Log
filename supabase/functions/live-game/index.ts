import { createClient } from "npm:@supabase/supabase-js@2";
import { handleLiveGame, type LiveSource } from "./handler.ts";
import { decodeGame, encodeGame } from "../../../src/codec.ts";
import { canonicalFromSnapshot, encodeCanonical } from "../../../src/domain/projection.ts";
import { buildCompletedGameRecord } from "../../../src/completedGame/record.ts";
import { createWaitingGame } from "../../../src/pregame.ts";
import { makeSnapshot, type NewGameSettings } from "../../../src/game.ts";
import { botKeyFor } from "../../../src/bot/catalog.ts";
import { createSurvivalTestGame } from "../../../src/features/survival/seededGame.ts";
import { stageStartCanonical } from "../../../src/features/survival/sealedStart.ts";
import { decodeMultiverse, encodeMultiverse } from "../../../src/gameplay/multiverseCodec.ts";
import { EMPTY_MULTIVERSE } from "../../../src/gameplay/multiverse.ts";
import { prepareStageTerminal } from "../../../src/completedGame/stageTerminal.ts";
import type { StageSealedStart } from "../../../src/completedGame/adapters.ts";
import poc from "../../../docs/survival-poc-results.json";
import { deriveCompletion } from "../../../src/features/gameRecords/domain.ts";
import { buildAuthurRequest } from "../../../src/bot/authur/request.ts";
import { botActionFor, type TrustedBotMove } from "../../../src/liveGame/botAction.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);
  let authorization = request.headers.get("Authorization");
  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization ?? "" } },
  });
  try {
    let body = (await request.json()) as Record<string, unknown>;
    let trustedActor: string | null = null;
    let jobLeaseToken: unknown = null;
    let trustedJob: { id: string; room_id: string; revision: number; actor_id: string } | null =
      null;
    if (["bot-result", "bot-observation"].includes(String(body.operation))) {
      const secret = Deno.env.get("LIVE_BOT_SECRET");
      if (
        !secret ||
        secret.length < 32 ||
        request.headers.get("X-Live-Bot-Secret") !== secret ||
        authorization !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`
      )
        return respond({ error: "Trusted worker required." }, 401);
      const job = await db.from("live_bot_jobs").select("*").eq("id", body.jobId).maybeSingle();
      if (job.error || !job.data || job.data.lease_token !== body.leaseToken)
        return respond({ error: "Bot job unavailable." }, 409);
      if (job.data.status === "done") return respond({ ok: true });
      if (job.data.status !== "running" || Date.parse(job.data.lease_expires_at) < Date.now())
        return respond({ error: "Bot lease expired." }, 409);
      jobLeaseToken = body.leaseToken;
      trustedJob = job.data;
      trustedActor = job.data.actor_id;
      const live = await db
        .from("room_live")
        .select("state,revision")
        .eq("room_id", job.data.room_id)
        .maybeSingle();
      if (!live.data) {
        const completed = await db
          .from("game_history")
          .select("source_id")
          .eq("source_id", job.data.room_id)
          .limit(1);
        if (completed.data?.length) {
          await db.from("live_bot_jobs").update({ status: "done" }).eq("id", job.data.id);
          return respond({ ok: true });
        }
        return respond({ error: "Bot game unavailable." }, 409);
      }
      // A lost callback acknowledgement must not replay an authoritative turn.
      const committed = await db
        .from("live_game_events")
        .select("actor_id")
        .eq("game_id", job.data.room_id)
        .eq("command_id", job.data.id)
        .maybeSingle();
      if (committed.data?.actor_id === job.data.actor_id) {
        await db
          .from("live_bot_jobs")
          .update({ status: "done" })
          .eq("id", job.data.id)
          .eq("lease_token", body.leaseToken);
        return respond({ ok: true });
      }
      if (live.data.revision !== job.data.revision)
        return respond({ error: "Bot revision changed." }, 409);
      if (body.operation === "bot-observation") {
        const game = decodeGame(live.data.state);
        if (
          game.botEngine !== "authur" ||
          game.status !== "playing" ||
          game.timers.paused ||
          game.activeSide !== game.botSide
        )
          return respond({ error: "Bot turn unavailable." }, 409);
        return respond({
          engine: "authur",
          request: buildAuthurRequest(game, job.data.room_id, job.data.revision),
        });
      }
      body = {
        operation: "action",
        id: job.data.room_id,
        revision: job.data.revision,
        commandId: job.data.id,
        action: botActionFor(decodeGame(live.data.state), body.move as TrustedBotMove),
      };
      authorization = `Bearer ${trustedActor}`;
    }
    if (
      ["create", "create-stage", "stage-admin", "cancel", "bot-turn", "handoff"].includes(
        String(body.operation),
      )
    ) {
      const { data: auth, error: authError } = await userClient.auth.getUser();
      if (authError || !auth.user) return respond({ error: "Sign in required." }, 401);
      if (body.operation === "stage-admin") {
        const profile = await db
          .from("profiles")
          .select("is_admin")
          .eq("id", auth.user.id)
          .single();
        if (profile.error || !profile.data.is_admin)
          return respond({ error: "Administrator required." }, 403);
        if (body.action === "import") {
          const rows = poc.levels
            .filter(
              (level) =>
                level.status === "awaiting_admin_approval" &&
                "immediateWinningMoves" in level &&
                level.immediateWinningMoves === 0,
            )
            .slice(0, 10)
            .map((level) => ({
              season_key: "2026-09-poc",
              level_no: level.level,
              seed: level.seed,
              reference_key: "endgame-v1",
              sample_policy: level.samplePolicy,
              sample_count: level.trials,
              win_count: level.wins,
              immediate_winning_moves:
                "immediateWinningMoves" in level ? level.immediateWinningMoves : -1,
              shortest_winning_replay_turns: Math.min(
                ...level.winningReplays.map((replay) => replay.actions.length),
              ),
              bot_latency_ms: level.authurDecisionMs,
              winning_replays: level.winningReplays,
              status: "draft",
            }));
          const imported = await db.from("survival_levels").insert(rows);
          if (imported.error) return respond({ error: "Unable to import Stage drafts." }, 409);
          return respond({ ok: true });
        }
        if (typeof body.levelId !== "string" || !["seal", "approve"].includes(String(body.action)))
          return respond({ error: "Invalid Stage request." }, 400);
        const level = await db
          .from("survival_levels")
          .select("seed,winning_replays,immediate_winning_moves,shortest_winning_replay_turns")
          .eq("id", body.levelId)
          .single();
        if (level.error) return respond({ error: "Stage unavailable." }, 404);
        if (
          body.action === "approve" &&
          (typeof body.note !== "string" ||
            !body.note.trim() ||
            level.data.winning_replays.length < 3 ||
            level.data.immediate_winning_moves !== 0 ||
            level.data.shortest_winning_replay_turns < 5)
        )
          return respond({ error: "Stage does not meet approval requirements." }, 400);
        const sealed = await db.rpc("trusted_admin_stage", {
          p_actor_id: auth.user.id,
          p_level_id: body.levelId,
          p_start: stageStartCanonical(level.data.seed),
          p_note: body.action === "approve" ? body.note : null,
        });
        if (sealed.error) return respond({ error: "Stage could not be approved or sealed." }, 409);
        return respond({ ok: true });
      }
      // Rollout can keep creation closed while existing secure games recover.
      if (
        ["create", "create-stage"].includes(String(body.operation)) &&
        (Deno.env.get("LIVE_GAME_CREATION_ENABLED") === "false" ||
          (body.operation === "create-stage" && Deno.env.get("STAGE_CREATION_ENABLED") === "false"))
      )
        return respond({ error: "New game creation is temporarily unavailable." }, 503);
      if (body.operation === "create-stage") {
        if ((Deno.env.get("LIVE_BOT_SECRET")?.length ?? 0) < 32)
          return respond({ error: "Trusted Stage execution is unavailable." }, 503);
        if (typeof body.levelId !== "string" || typeof body.requestId !== "string")
          return respond({ error: "Invalid Stage request." }, 400);
        // The actor's RLS must allow this level before private generation inputs are read.
        const allowed = await userClient
          .from("survival_levels")
          .select("id")
          .eq("id", body.levelId)
          .maybeSingle();
        if (allowed.error || !allowed.data) return respond({ error: "Stage unavailable." }, 404);
        const level = await db
          .from("survival_levels")
          .select("seed")
          .eq("id", body.levelId)
          .single();
        if (level.error) throw level.error;
        const game = createSurvivalTestGame(
          level.data.seed,
          typeof body.playerName === "string" ? body.playerName.slice(0, 80) : "Player",
          auth.user.id,
        );
        game.name = "Stage attempt";
        const created = await db.rpc("trusted_create_stage", {
          p_actor_id: auth.user.id,
          p_level_id: body.levelId,
          p_request_id: body.requestId,
          p_state: encodeGame(game),
          p_canonical: encodeCanonical(canonicalFromSnapshot(game, 1)),
        });
        if (created.error) return respond({ error: "Unable to start Stage attempt." }, 409);
        return respond({ id: created.data.room_id });
      }
      if (body.operation === "create") {
        const input = body.settings as NewGameSettings;
        if (!input || typeof input.name !== "string" || input.name.length > 160)
          return respond({ error: "Invalid room settings." }, 400);
        const local =
          !input.emailPlayMode &&
          !input.botSide &&
          input.gameMode !== "solo" &&
          !input.playerAUserId &&
          !input.playerBUserId &&
          !input.playerAEmail &&
          !input.playerBEmail;
        const settings: NewGameSettings = {
          name: input.name,
          gameMode: input.gameMode,
          playerA: input.playerA,
          playerB: input.playerB,
          playerAUserId: input.playerAUserId,
          playerBUserId: input.playerBUserId,
          playerAEmail: input.playerAEmail,
          playerBEmail: input.playerBEmail,
          startingSide: input.startingSide === "B" ? "B" : "A",
          timerMinutes: input.timerMinutes,
          untimed: input.untimed,
          botSide: input.botSide,
          botEngine: input.botEngine,
          botDifficulty: input.botDifficulty,
          tileDrawMode:
            input.botSide || input.emailPlayMode === "direct"
              ? "play"
              : (input.tileDrawMode ?? "play"),
          emailPlayMode:
            input.emailPlayMode === "hosted"
              ? "hosted"
              : local || (input.gameMode === "solo" && !input.emailPlayMode)
                ? undefined
                : "direct",
          emailPlayersCanSeeOpponentRack: false,
        };
        if (settings.botSide) {
          if (!(
            (settings.botEngine === "authur" && settings.botDifficulty === "super") ||
            (settings.botEngine === "stage5b" && settings.botDifficulty === "stage5b64")
          ))
            return respond({ error: "This bot has no secure live execution path yet." }, 400);
          if (
            settings.botEngine === "authur" &&
            (Deno.env.get("LIVE_BOT_SECRET")?.length ?? 0) < 32
          )
            return respond({ error: "Trusted Authur execution is unavailable." }, 503);
          // A catalog bot seat can never become a browser-controlled seat.
          settings.playerAUserId = settings.botSide === "A" ? null : auth.user.id;
          settings.playerBUserId = settings.botSide === "B" ? null : auth.user.id;
          settings.playerAEmail = null;
          settings.playerBEmail = null;
        } else if (
          !settings.playerAUserId &&
          !settings.playerBUserId &&
          !settings.playerAEmail &&
          !settings.playerBEmail
        ) {
          settings.playerAUserId = auth.user.id;
        }
        // Fresh CSPRNG deal happens only here. No supplied rack, seed, bag,
        // canonical, history, score or position is admitted from the browser.
        const game = createWaitingGame(settings);
        if (local || (input.gameMode === "solo" && !input.emailPlayMode)) {
          game.emailPlayMode = undefined;
          game.history = [makeSnapshot(game)];
        }
        const { data, error } = await db.rpc("trusted_create_live_game", {
          p_actor_id: auth.user.id,
          p_state: encodeGame(game),
          p_policy: local ? { ...body.policy, joinPolicy: "invite_only" } : body.policy,
          p_request_id: body.requestId,
          p_bot_key: game.botSide ? botKeyFor(game) : null,
          p_bot_side: game.botSide ?? null,
          p_funding: body.funding ?? null,
        });
        if (error) return respond({ error: error.message }, 400);
        return respond({ id: data.room_id, roomCode: data.room_code });
      }
      if (typeof body.id !== "string") return respond({ error: "Invalid game ID." }, 400);
      if (body.operation === "handoff") {
        const visible = await userClient
          .from("room_live")
          .select("room_id")
          .eq("room_id", body.id)
          .maybeSingle();
        if (visible.error || !visible.data)
          return respond({ error: "Live game unavailable." }, 404);
        const claim = await db.rpc("claim_local_turn", {
          p_actor_id: auth.user.id,
          p_room_id: body.id,
          p_revision: body.revision,
          p_side: body.side,
        });
        if (claim.error)
          return respond({ error: "Local handoff unavailable. Reload and retry." }, 409);
        body.handoffToken = claim.data;
        body.operation = "read";
      } else if (body.operation === "bot-turn") {
        const allowed = await userClient
          .from("room_live")
          .select("room_id")
          .eq("room_id", body.id)
          .maybeSingle();
        if (!allowed.data) return respond({ error: "Live game unavailable." }, 404);
        const live = await db
          .from("room_live")
          .select("state,revision,owner_id")
          .eq("room_id", body.id)
          .single();
        if (live.error || live.data.owner_id !== auth.user.id)
          return respond({ error: "Bot controller required." }, 403);
        const queued = await db.rpc("enqueue_live_bot", {
          p_room_id: body.id,
          p_revision: body.revision,
          p_actor_id: auth.user.id,
          p_request:
            decodeGame(live.data.state).botEngine === "stage5b"
              ? {}
              : buildAuthurRequest(decodeGame(live.data.state), body.id, live.data.revision),
        });
        if (queued.error) return respond({ error: "Bot turn unavailable. Reload and retry." }, 409);
        body.operation = "read";
      } else {
        if (body.operation === "cancel") {
          const result = await userClient.rpc("cancel_live_game", { target_game_id: body.id });
          if (result.error) return respond({ error: "Unable to cancel room." }, 403);
          return respond({ cancelled: true });
        }
      }
    }
    const result = await handleLiveGame(
      { authorization, body },
      {
        authenticate: async (token) => {
          if (trustedActor) return token === trustedActor ? trustedActor : null;
          const { data, error } = await userClient.auth.getUser(token);
          return error ? null : (data.user?.id ?? null);
        },
        read: async (id, _actorId) => {
          // Authorization is evaluated with the actual caller's JWT. Service access
          // is used only after this safe metadata check, never to bypass room RLS.
          const visible = await userClient
            .from("room_live")
            .select("room_id")
            .eq("room_id", id)
            .maybeSingle();
          if (!trustedActor && (visible.error || !visible.data)) return null;
          if (trustedJob && trustedJob.room_id !== id) return null;
          const { data, error } = await db
            .from("room_live")
            .select(
              "room_id,owner_id,player_a_user_id,player_b_user_id,revision,mode_key,room_purpose,authority_protocol,state,bot_key,bot_config_version,bot_difficulty,local_claim_token,local_claim_side,local_claim_revision",
            )
            .eq("room_id", id)
            .maybeSingle();
          if (error) throw error;
          if (!data) return null;
          const timeline = await db
            .from("game_timelines")
            .select("version,doc")
            .eq("game_id", id)
            .maybeSingle();
          if (timeline.error) throw timeline.error;
          return {
            id,
            ownerId: data.owner_id,
            seats: { A: data.player_a_user_id, B: data.player_b_user_id },
            revision: data.revision,
            mode: data.room_purpose === "stage" ? "stage" : data.mode_key,
            purpose: data.room_purpose,
            authorityProtocol: data.authority_protocol,
            ...(data.local_claim_token
              ? {
                  localClaim: {
                    token: data.local_claim_token,
                    side: data.local_claim_side,
                    revision: data.local_claim_revision,
                  },
                }
              : {}),
            ...(data.bot_key
              ? {
                  bot: {
                    catalogId: data.bot_key,
                    catalogVersion: String(data.bot_config_version),
                    difficulty: data.bot_difficulty,
                  },
                }
              : {}),
            state: data.state,
            timeline: timeline.data
              ? { ...decodeMultiverse(timeline.data.doc), version: timeline.data.version }
              : EMPTY_MULTIVERSE,
          } as LiveSource;
        },
        committed: async (id, commandId, actorId) => {
          const { data, error } = await db
            .from("live_game_events")
            .select("actor_id")
            .eq("game_id", id)
            .eq("command_id", commandId)
            .maybeSingle();
          if (error) throw error;
          return data?.actor_id === actorId;
        },
        commit: async (source, actorId, commandId, side, action, game, changedTimeline) => {
          if (game.status === "finished") {
            const timeline = await db
              .from("game_timelines")
              .select("version,doc")
              .eq("game_id", source.id)
              .maybeSingle();
            if (timeline.error) throw timeline.error;
            const branches = timeline.data ? decodeMultiverse(timeline.data.doc) : undefined;
            if (source.purpose === "stage") {
              const attempt = await db
                .from("survival_attempts")
                .select("level_id")
                .eq("room_id", source.id)
                .single();
              if (attempt.error) throw attempt.error;
              const level = await db
                .from("survival_levels")
                .select("seed,start_canonical")
                .eq("id", attempt.data.level_id)
                .single();
              if (level.error) throw level.error;
              const room = await db
                .from("room_live")
                .select("bot_key,bot_config_version,bot_difficulty")
                .eq("room_id", source.id)
                .single();
              if (room.error) throw room.error;
              const prepared = await prepareStageTerminal(
                {
                  roomId: source.id,
                  ownerId: source.ownerId,
                  levelId: attempt.data.level_id,
                  seed: level.data.seed,
                  revision: source.revision,
                  liveState: source.state,
                  sealedStart: level.data.start_canonical as StageSealedStart,
                  completionAuthority: "server-reduced",
                  botKey: room.data.bot_key,
                  botConfigVersion: room.data.bot_config_version,
                  botDifficulty: room.data.bot_difficulty,
                  branches,
                },
                encodeGame(game),
              );
              const captured = await db.rpc("capture_stage_terminal", {
                target_game_id: source.id,
                target_player_id: source.ownerId,
                target_expected_revision: source.revision,
                target_timeline_version: timeline.data?.version ?? null,
                target_state: prepared.state,
                target_record: prepared.record,
                target_completion_kind: prepared.completion.kind,
                target_completion_reason: prepared.completion.reason,
                target_surrendered_side: prepared.completion.surrenderedSide,
              });
              if (captured.error) throw captured.error;
              return true;
            }
            const completion = deriveCompletion(game);
            const record = await buildCompletedGameRecord(game, branches, {
              mode: game.botSide ? "bot" : "standard",
              completionAuthority: "server-reduced",
              ...(source.bot ? { bot: source.bot } : {}),
            });
            const { error } = await db.rpc("capture_normal_terminal", {
              p_room_id: source.id,
              p_actor_id: actorId,
              p_expected_revision: source.revision,
              p_timeline_version: timeline.data?.version ?? null,
              p_state: encodeGame(game),
              p_record: record,
              p_completion_kind: completion.kind,
              p_completion_reason: completion.reason,
              p_surrendered_side: completion.surrenderedSide,
            });
            if (error) throw error;
            return true;
          }
          if (body.operation === "practice-bot" && !changedTimeline) {
            const { data, error } = await db.rpc("trusted_commit_practice_bot", {
              p_actor_id: actorId,
              p_room_id: source.id,
              p_revision: source.revision,
              p_command_id: commandId,
              p_action: action,
              p_canonical: encodeCanonical(canonicalFromSnapshot(game, game.revision!)),
              p_state: encodeGame(game),
            });
            if (error) throw error;
            return data === "committed" || data === "duplicate";
          }
          if (body.operation === "control" || changedTimeline) {
            const { data, error } = await db.rpc("trusted_commit_live_capability", {
              p_actor_id: actorId,
              p_room_id: source.id,
              p_revision: source.revision,
              p_command_id: commandId,
              p_action: action,
              p_canonical: encodeCanonical(canonicalFromSnapshot(game, game.revision!)),
              p_state: encodeGame(game),
              p_timeline: changedTimeline ? encodeMultiverse(changedTimeline) : null,
              p_timeline_version: source.timeline?.version ?? 0,
            });
            if (error) throw error;
            return data === "committed" || data === "duplicate";
          }
          const { data, error } = await db.rpc("trusted_commit_live_game", {
            p_actor_id: actorId,
            p_room_id: source.id,
            p_revision: source.revision,
            p_command_id: commandId,
            p_side: side,
            p_action: action,
            p_canonical: encodeCanonical(canonicalFromSnapshot(game, game.revision!)),
            p_state: encodeGame(game),
          });
          if (error) throw error;
          return data === "committed" || data === "duplicate";
        },
      },
      Boolean(trustedActor),
    );
    if (trustedJob) {
      await db
        .from("live_bot_jobs")
        .update({
          status: result.status === 200 ? "done" : result.status === 409 ? "cancelled" : "failed",
        })
        .eq("id", trustedJob.id)
        .eq("lease_token", jobLeaseToken);
      // The private proposal/worker projection can never reach a human client.
      return respond(
        result.status === 200 ? { ok: true } : { error: "Bot result refused." },
        result.status,
      );
    }
    if (
      result.status === 200 &&
      result.body.match?.botTurn &&
      result.body.match.yourSide &&
      result.body.match.mode !== "stage5b_standard"
    ) {
      // Queue before replying to the human's committed move/start. A browser
      // disconnect after the response must not be required to schedule Authur.
      // The database trigger already queues atomically. This read only refreshes
      // the private observation for older jobs; it is not required for recovery.
      const live = await db
        .from("room_live")
        .select("state,revision,owner_id,authority_protocol")
        .eq("room_id", result.body.match.id)
        .maybeSingle();
      if (
        live.data &&
        live.data.authority_protocol === "server-v1" &&
        live.data.revision === result.body.match.revision
      ) {
        const queued = await db.rpc("enqueue_live_bot", {
          p_room_id: result.body.match.id,
          p_revision: live.data.revision,
          p_actor_id: live.data.owner_id,
          p_request:
            decodeGame(live.data.state).botEngine === "stage5b"
              ? {}
              : buildAuthurRequest(
                  decodeGame(live.data.state),
                  result.body.match.id,
                  live.data.revision,
                ),
        });
        if (queued.error) console.error("Trusted bot enqueue failed; owner read will retry.");
      }
    }
    return respond(
      body.handoffToken && body.operation === "read" && result.body.match?.localConfirmed
        ? { ...result.body, handoffToken: body.handoffToken }
        : result.body,
      result.status,
    );
  } catch {
    return respond({ error: "Live game unavailable." }, 500);
  }
});
