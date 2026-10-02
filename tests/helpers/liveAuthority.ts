import { expect } from "vitest";
import {
  call,
  player,
  policy,
  service,
  settings,
  sql,
  type Player,
} from "../live-security-browser/fixtures";
import { stageStartCanonical } from "../../src/features/survival/sealedStart";
import poc from "../../docs/survival-poc-results.json";

export { call, player, policy, service, settings, sql };
export const authorityTestEnabled = Boolean(process.env.LIVE_SECURITY_STATUS_FILE);

export async function normal(a: Player, b: Player, scope = "private") {
  const created = await call(a, {
    operation: "create",
    requestId: crypto.randomUUID(),
    settings: settings(a, b),
    policy: policy(scope),
  });
  expect(created.status, "Server-authoritative Normal creation must succeed").toBe(200);
  const id = created.body.id;
  expect((await call(a, { operation: "ready", id })).status).toBe(200);
  const ready = await call(b, { operation: "ready", id });
  expect(ready.status).toBe(200);
  expect(ready.body.match.status).toBe("playing");
  return ready.body.match;
}

export async function stage(owner: Player) {
  const id = crypto.randomUUID();
  const candidate = poc.levels[0]!;
  const inserted = await service.from("survival_levels").insert({
    id,
    season_key: `authority-${id}`,
    level_no: 1,
    seed: candidate.seed,
    reference_key: "endgame-v1",
    sample_policy: candidate.samplePolicy,
    sample_count: candidate.trials,
    win_count: candidate.wins,
    winning_replays: candidate.winningReplays,
    immediate_winning_moves: candidate.immediateWinningMoves,
    shortest_winning_replay_turns: candidate.minimumSurvivalTurns,
    status: "approved",
    start_canonical: stageStartCanonical(candidate.seed),
    start_sealed_at: new Date().toISOString(),
    approved_by: owner.id,
    approved_at: new Date().toISOString(),
    admin_note: "LOCAL ONLY approved repository evidence fixture",
  });
  expect(inserted.error).toBeNull();
  const created = await call(owner, {
    operation: "create-stage",
    levelId: id,
    playerName: "Stage authority test",
    requestId: crypto.randomUUID(),
  });
  expect(created.status, "Approved sealed Stage must start through live-game").toBe(200);
  const read = await call(owner, { operation: "read", id: created.body.id });
  expect(read.status).toBe(200);
  return { levelId: id, match: read.body.match };
}

export async function resign(who: Player, match: { id: string; revision: number }) {
  const command = {
    operation: "action",
    id: match.id,
    revision: match.revision,
    commandId: crypto.randomUUID(),
    action: { kind: "resign" },
  };
  const replies = await Promise.all([call(who, command), call(who, command), call(who, command)]);
  expect(replies.some((reply) => reply.status === 200)).toBe(true);
  expect(replies.every((reply) => [200, 400, 404, 409].includes(reply.status))).toBe(true);
  expect(sql(`select count(*) from public.room_live where room_id='${match.id}'`)).toBe("0");
  return command;
}
