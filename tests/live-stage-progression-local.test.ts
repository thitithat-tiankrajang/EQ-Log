// @vitest-environment node
import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { call, player, service, sql } from "./live-security-browser/fixtures";
import { stageStartCanonical } from "../src/features/survival/sealedStart";
import { seedFor } from "../src/bot/superRequest";
import { displayToken } from "../src/game";
import poc from "../docs/survival-poc-results.json";

const local = process.env.LIVE_SECURITY_STATUS_FILE ? it : it.skip;
async function until(check: () => Promise<boolean>) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Stage bot turn did not recover");
}
async function humanAnalysis(view: any) {
  const side = view.yourSide,
    board: unknown[] = [];
  view.board.forEach((row: any[], r: number) =>
    row.forEach((placed, c) => {
      if (placed)
        board.push({
          cell: r * 15 + c,
          kind: placed.tile.token,
          face: displayToken(placed.tile),
          side: placed.side,
          turn: placed.placedTurn,
        });
    }),
  );
  const noScoreTail: string[] = [];
  for (const log of [...view.logs].reverse()) {
    if (log.action === "end_game") continue;
    if (log.score > 0 || noScoreTail.length === 6) break;
    noScoreTail.unshift(log.side);
  }
  // This test's human chooses moves from their lawful observation only. The
  // actual opponent runs through the durable worker and authoritative callback.
  const request = {
    roomId: view.id,
    revision: view.revision,
    seed: seedFor(view.id, view.revision),
    side,
    board,
    rack: view.yourRack.map((tile: any) => tile.token),
    ownPending: [],
    opponentRackCount: view.rackCount[side === "A" ? "B" : "A"],
    opponentPendingCount: 0,
    bagCount: view.tilebagCount,
    scores: view.scores,
    turnNumber: view.turnNumber,
    noScoreTail,
  };
  const proposal: any = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["services/trusted-bot/runtime.mjs"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error("Human observation analysis failed"));
      else resolve(JSON.parse(out));
    });
    child.stdin.end(JSON.stringify(request));
  });
  if (proposal.type === "pass") return { kind: "pass" };
  if (proposal.type !== "place") throw new Error("Unexpected Stage action");
  const used = new Set<string>();
  return {
    kind: "place",
    placements: proposal.placements.map((placed: any) => {
      const tile = view.yourRack.find(
        (tile: any) => tile.token === placed.kind && !used.has(tile.id),
      );
      if (!tile) throw new Error("Analysis used an unavailable own tile");
      used.add(tile.id);
      return {
        tileId: tile.id,
        row: placed.r,
        col: placed.c,
        ...(tile.token === "?" || tile.token === "+/-" || tile.token === "x//"
          ? { assignedToken: placed.token }
          : {}),
      };
    }),
  };
}

local(
  "plays a repository Stage candidate to a natural win with trusted Authur, persisted progression and two-sided Replay",
  async () => {
    if (!process.env.LIVE_SECURITY_WORKER_ENV_FILE)
      throw new Error("Private worker environment required");
    const owner = await player(),
      observer = await player();
    sql(`update public.profiles set is_admin=true where id='${owner.id}'`);
    const candidate = poc.levels[0]!,
      levelId = crypto.randomUUID();
    expect(candidate.status).toBe("awaiting_admin_approval");
    const inserted = await service.from("survival_levels").insert({
      id: levelId,
      season_key: `readiness-${levelId}`,
      level_no: 1,
      seed: candidate.seed,
      reference_key: "endgame-v1",
      sample_policy: candidate.samplePolicy,
      sample_count: candidate.trials,
      win_count: candidate.wins,
      winning_replays: candidate.winningReplays,
      immediate_winning_moves: candidate.immediateWinningMoves,
      shortest_winning_replay_turns: candidate.minimumSurvivalTurns,
      start_canonical: stageStartCanonical(candidate.seed),
      start_sealed_at: new Date().toISOString(),
      status: "approved",
      approved_by: owner.id,
      approved_at: new Date().toISOString(),
      admin_note: "LOCAL ONLY repository candidate; not production approval",
    });
    expect(inserted.error).toBeNull();
    const worker = spawn(
      process.execPath,
      [
        `--env-file=${process.env.LIVE_SECURITY_WORKER_ENV_FILE}`,
        "services/trusted-bot/worker.mjs",
      ],
      { detached: true, stdio: "ignore" },
    );
    let id: string | undefined;
    try {
      const created = await call(owner, {
        operation: "create-stage",
        levelId,
        playerName: "Stage player",
        requestId: crypto.randomUUID(),
      });
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      id = created.body.id;
      for (let turn = 0; turn < 30; turn++) {
        const read = await call(owner, { operation: "read", id });
        if (read.status === 404) break;
        expect(read.status).toBe(200);
        const view = read.body.match;
        expect(JSON.stringify(view)).not.toMatch(
          /"(?:rackA|rackB|tilebag|canonical|history|session)"\s*:/,
        );
        if (view.botTurn) {
          const before = view.revision;
          await until(async () => {
            const next = await call(owner, { operation: "read", id });
            return next.status === 404 || next.body.match.revision > before;
          });
        } else {
          const action = await humanAnalysis(view);
          const result = await call(owner, {
            operation: "action",
            id,
            revision: view.revision,
            commandId: crypto.randomUUID(),
            action,
          });
          expect(result.status, JSON.stringify(result.body)).toBe(200);
        }
      }
      const attempt = await service
        .from("survival_attempts")
        .select("finished_at,result,result_authority,player_score,authur_score")
        .eq("room_id", id)
        .single();
      expect(attempt.error).toBeNull();
      expect(attempt.data!.finished_at).toBeTruthy();
      expect(attempt.data!.result_authority).toBe("server_reduced");
      expect(attempt.data!.result).toBe("win");
      const wins = await owner.client
        .from("survival_attempts")
        .select("level_id")
        .eq("player_id", owner.id)
        .eq("result", "win");
      expect(wins.error).toBeNull();
      expect(wins.data).toContainEqual({ level_id: levelId });
      expect(
        sql(`select count(*) from public.live_bot_jobs where room_id='${id}' and status='done'`),
      ).not.toBe("0");
      expect(
        sql(`select count(*) from public.probot_consumptions where user_id='${owner.id}'`),
      ).toBe("0");
      expect(sql(`select count(*) from public.room_live where room_id='${id}'`)).toBe("0");
      expect(
        sql(`select count(*) from public.stage_completed_attempts where room_id='${id}'`),
      ).toBe("1");
      const replay = await call(owner, { gameId: id }, "archive-replay");
      expect(replay.status).toBe(200);
      expect(replay.body.replay.finalRacks.A).toBeDefined();
      expect(replay.body.replay.finalRacks.B).toBeDefined();
      expect(
        replay.body.replay.positions.every((position: any) => position.racks.A && position.racks.B),
      ).toBe(true);
      expect((await call(observer, { gameId: id }, "archive-replay")).status).toBe(404);
      console.info(
        "STAGE_PROGRESSION: repository seed",
        candidate.seed,
        "natural win; trusted bot; server_reduced; own wins query; persisted Replay; zero funding charges. LOCAL ONLY.",
      );
    } finally {
      if (worker.pid) {
        try {
          process.kill(-worker.pid, "SIGKILL");
        } catch {
          /* exited */
        }
      }
      if (id && sql(`select count(*) from public.room_live where room_id='${id}'`) !== "0") {
        const read = await call(owner, { operation: "read", id });
        await call(owner, {
          operation: "action",
          id,
          revision: read.body.match.revision,
          commandId: crypto.randomUUID(),
          action: { kind: "resign" },
        });
      }
    }
  },
  180000,
);
