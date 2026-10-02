// @vitest-environment node
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { decideArchBot } from "../src/bot/archbot/decide";
import { valueHeadFromBytes } from "../src/bot/archbot/model";
import { archBotModelPath } from "../src/bot/archbot/identity";
import {
  authorityTestEnabled,
  call,
  player,
  policy,
  resign,
  service,
  sql,
} from "./helpers/liveAuthority";
const local = authorityTestEnabled ? it : it.skip;
local(
  "finishes a production ArchBot room through server authority, Compact, History, Recent and safe Replay",
  async () => {
    const who = await player();
    const created = await call(who, {
      operation: "create",
      requestId: crypto.randomUUID(),
      policy: policy("private"),
      settings: {
        name: "ArchBot Storage gate",
        gameMode: "versus",
        playerA: "Human",
        playerB: "ArchBot",
        playerAUserId: who.id,
        startingSide: "A",
        botSide: "B",
        botEngine: "stage5b",
        botDifficulty: "stage5b64",
        tileDrawMode: "play",
        untimed: true,
      },
    });
    // Required product behavior. A safe refusal is a release failure, not a pass.
    expect(created.status, "F50: ArchBot needs its full-strength client practice path").toBe(200);
    const id = created.body.id;
    const rewardState = () =>
      sql(`select json_build_object(
      'balances',(select coalesce(json_agg(b),'[]') from public.economy_balances b where user_id='${who.id}'),
      'consumptions',(select count(*) from public.probot_consumptions where user_id='${who.id}'),
      'rating',(select rating from public.ranked_ratings where player_id='${who.id}'),
      'stage',(select count(*) from public.survival_attempts where player_id='${who.id}')
    )`);
    const beforeRewards = rewardState();
    const ready = await call(who, { operation: "ready", id });
    expect(ready.status).toBe(200);
    const moved = await call(who, {
      operation: "action",
      id,
      revision: ready.body.match.revision,
      commandId: crypto.randomUUID(),
      action: { kind: "pass" },
    });
    expect(moved.status).toBe(200);
    const observed = moved.body.match;
    expect(observed.practiceBot.side).toBe("B");
    expect(observed.practiceBot.request.rack).toHaveLength(8);
    const outsider = await player();
    expect(
      (
        await call(outsider, {
          operation: "practice-bot",
          id,
          revision: observed.revision,
          commandId: crypto.randomUUID(),
          action: { type: "pass", placements: [], exchange: [] },
        })
      ).status,
    ).toBe(404);
    const bytes = (path: string) => {
      const b = readFileSync(path);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    };
    const dir = `public${archBotModelPath("/")}`;
    const model = await valueHeadFromBytes(bytes(`${dir}/model.json`), bytes(`${dir}/weights.bin`));
    const decision = decideArchBot(observed.practiceBot.request, model);
    const proposal = {
      operation: "practice-bot",
      id,
      revision: observed.revision,
      commandId: crypto.randomUUID(),
      action: { type: decision.type, placements: decision.placements, exchange: decision.exchange },
    };
    const committed = await call(who, proposal);
    expect(committed.status, JSON.stringify(committed.body)).toBe(200);
    const view = committed.body.match;
    const retry = await call(who, proposal);
    expect(retry.status).toBe(200);
    expect(retry.body.match.revision).toBe(view.revision);
    expect(view.botTurn, "Full Stage5B64 proposal must commit exactly once").toBe(false);
    expect(view.logs.some((log: any) => log.side === "B")).toBe(true);
    expect(JSON.stringify(view)).not.toMatch(
      /"(?:rackB|tilebag|canonical|history|decisionSeed|rngStep)"\s*:/,
    );
    expect(view.practiceBot).toBeUndefined();
    expect(sql(`select count(*) from public.live_bot_jobs where room_id='${id}'`)).toBe("0");
    await resign(who, view);
    const record = await service
      .from("recent_game_payloads")
      .select("record")
      .eq("source_id", id)
      .single();
    expect(record.error).toBeNull();
    expect(record.data!.record.provenance.completionAuthority).toBe("server-reduced");
    expect(sql(`select count(*) from public.game_history where source_id='${id}'`)).toBe("1");
    const replay = await call(who, { gameId: id }, "archive-replay");
    expect(replay.status).toBe(200);
    expect(replay.body.replay.bot.displayName).toBe("ArchBot");
    expect(replay.body.replay.finalRacks.A).toBeDefined();
    expect(replay.body.replay.finalRacks.B).toBeDefined();
    expect(rewardState()).toBe(beforeRewards);
    expect(
      sql(
        `select count(*) from public.user_mode_stats where profile_id='${who.id}' and mode_key='stage5b_standard' and games_played=1`,
      ),
    ).toBe("1");
  },
  150000,
);
