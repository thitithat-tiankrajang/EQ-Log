/**
 * The Ranked Edge Function against the real Ranked authority.
 *
 * The browser's `rankedClient` talks to the Edge Function's own handler, and
 * the handler talks to a real PostgreSQL database with the C7 migration, as
 * the service role — so every refusal travels database → Edge → client exactly
 * as it will in production, and every rule is the database's.
 *
 * Local only, and skipped unless RANKED_EDGE_PSQL names a psql command for a
 * throwaway database that has every migration applied, e.g.
 *
 *   RANKED_EDGE_PSQL="psql postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
 *     npx vitest run tests/ranked-edge-db.test.ts
 *
 * It commits throwaway users and matches (ids 00000000-0000-4000-8000-0000000f8xxx)
 * and deletes them afterwards. Never point it at a hosted project.
 */
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  handleRanked,
  StoreError,
  type MatchRow,
  type RankedStore,
} from "../supabase/functions/ranked/handler";
import type { RankedStakesRow } from "../src/features/ranked/stakes";

const PSQL = process.env.RANKED_EDGE_PSQL?.trim();
const command = PSQL ? PSQL.split(/\s+/) : [];
if (PSQL && !/localhost|127\.0\.0\.1|\s-d\s|^runuser|\/var\/run\/postgresql/.test(PSQL)) {
  throw new Error("RANKED_EDGE_PSQL must point at a local database");
}

const actor = vi.hoisted(() => ({ token: null as string | null }));
vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: {
    functions: {
      // The Edge Function's transport, with its handler and this database.
      invoke: async (_name: string, { body }: { body: unknown }) => {
        const response = await handleRanked(
          { authorization: actor.token ? `Bearer ${actor.token}` : null, body },
          store,
        );
        if (response.status < 400) return { data: response.body, error: null };
        return {
          data: null,
          error: Object.assign(new Error("Edge Function returned a non-2xx status code"), {
            context: new Response(JSON.stringify(response.body), { status: response.status }),
          }),
        };
      },
    },
  },
}));

import { RankedRequestError, rankedClient } from "../src/features/ranked/client";

// ── the database, through psql ─────────────────────────────────────────────
function run(sql: string, vars: Record<string, string>, role: "service" | "owner"): string {
  const settings = Object.entries(vars).flatMap(([key, value]) => ["-v", `${key}=${value}`]);
  const script = `\\set VERBOSITY verbose\nbegin;\n${role === "service" ? "set local role service_role;\n" : ""}${sql};\ncommit;\n`;
  try {
    return execFileSync(
      command[0],
      [...command.slice(1), "-X", "-Atq", "-v", "ON_ERROR_STOP=1", ...settings],
      {
        input: script,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    ).trim();
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "");
    const match = /ERROR:\s+([0-9A-Z]{5}): (.*)/.exec(stderr);
    if (!match) throw error;
    throw new StoreError(match[2].trim(), match[1]);
  }
}
const json = <T>(sql: string, vars: Record<string, string> = {}): T =>
  JSON.parse(
    run(`with t as (${sql}) select coalesce(json_agg(t), '[]') from t`, vars, "service") || "[]",
  ) as T;
const one = <T>(sql: string, vars: Record<string, string> = {}): T | null =>
  json<T[]>(sql, vars)[0] ?? null;
const owner = (sql: string, vars: Record<string, string> = {}) => run(sql, vars, "owner");

const PREFIX = "00000000-0000-4000-8000-0000000f8";
let next = 1;
const users = new Set<string>();
function user(): string {
  const id = `${PREFIX}${String(next++).padStart(3, "0")}`;
  users.add(id);
  return id;
}

/** The service-role database the Edge Function uses; the token is the user id. */
const store: RankedStore = {
  authenticate: async (token) => (users.has(token) ? token : null),
  profile: async (userId) =>
    one("select display_name, status from public.profiles where id = :'id'", { id: userId }),
  names: async (ids) =>
    new Map(
      json<{ id: string; display_name: string | null }[]>(
        "select id, display_name from public.profiles where id = any(:'ids'::uuid[])",
        { ids: `{${ids.join(",")}}` },
      ).map((row) => [row.id, row.display_name]),
    ),
  listOpen: async (since) =>
    json(
      `select id, player_a_id, minutes_a, created_at from public.ranked_matches
        where status = 'waiting' and created_at >= :'since' order by created_at desc limit 50`,
      { since },
    ),
  listMine: async (userId) =>
    json(
      `select id, player_a_id, player_b_id, status, created_at from public.ranked_matches
        where :'id' in (player_a_id::text, player_b_id::text) order by created_at desc limit 20`,
      { id: userId },
    ),
  leaderboard: async () =>
    json(`select player_id, rating, games, wins, losses, draws from public.ranked_ratings
           where games >= 10 order by rating desc, wins desc limit 100`),
  ownRating: async (userId) =>
    one(
      "select rating, games, wins, losses, draws from public.ranked_ratings where player_id = :'id'",
      {
        id: userId,
      },
    ),
  insertWaiting: async (row) =>
    one<{ id: string; revision: number }>(
      `insert into public.ranked_matches (player_a_id, status, minutes_a, minutes_b, state)
       values (:'a', 'waiting', :'ma'::int, :'mb'::int, :'s'::jsonb) returning id, revision`,
      {
        a: row.player_a_id,
        ma: String(row.minutes_a),
        mb: String(row.minutes_b),
        s: JSON.stringify(row.state),
      },
    )!,
  stakes: async (matchId, viewerId) =>
    one<RankedStakesRow>("select * from public.ranked_stakes(:'m', :'v')", {
      m: matchId,
      v: viewerId,
    })!,
  claim: async (matchId, playerId, playerName, basis, now) =>
    one<{ match_id: string; revision: number; resumed: boolean }>(
      "select * from public.ranked_claim_match_v2(:'m', :'p', :'n', nullif(:'b', ''), :'t'::timestamptz)",
      { m: matchId, p: playerId, n: playerName, b: basis ?? "", t: now },
    )!,
  match: async (id) =>
    one<MatchRow>("select * from public.ranked_matches where id = :'id'", { id }),
  deleteUnstarted: async (id) =>
    json<unknown[]>(
      `delete from public.ranked_matches where id = :'id' and status in ('waiting', 'matched') returning id`,
      { id },
    ).length,
  ready: async (matchId, playerId, now) =>
    one<{ ok: boolean }>("select public.ranked_ready_match(:'m', :'p', :'t'::timestamptz) ok", {
      m: matchId,
      p: playerId,
      t: now,
    })!.ok,
  commit: async (matchId, revision, state, winner, reason) =>
    one<{ ok: boolean }>(
      `select public.ranked_commit_match(:'m', :'r'::bigint, :'s'::jsonb, nullif(:'w', ''), nullif(:'x', '')) ok`,
      {
        m: matchId,
        r: String(revision),
        s: JSON.stringify(state),
        w: winner ?? "",
        x: reason ?? "",
      },
    )!.ok,
  result: async (matchId) =>
    one(
      `select rating_a_before, rating_a_after, rating_b_before, rating_b_after
         from public.ranked_results where match_id = :'m'`,
      { m: matchId },
    ),
};

// ── fixtures ────────────────────────────────────────────────────────────────
function approved(name: string, status = "approved"): string {
  const id = user();
  owner(
    `insert into auth.users (id, email, aud, role) values (:'id', :'email', 'authenticated', 'authenticated');
     update public.profiles set status = :'status', display_name = :'name' where id = :'id'`,
    { id, email: `${id}@example.test`, status, name: `${name} ${id.slice(-3)}` },
  );
  return id;
}
function rate(id: string, rating: number, games: number) {
  owner(
    `insert into public.ranked_ratings (player_id, rating, games) values (:'id', :'r'::int, :'g'::int)
     on conflict (player_id) do update set rating = excluded.rating, games = excluded.games`,
    { id, r: String(rating), g: String(games) },
  );
}
async function as<T>(id: string | null, action: () => Promise<T>): Promise<T> {
  actor.token = id;
  try {
    return await action();
  } finally {
    actor.token = null;
  }
}
async function refusal(action: () => Promise<unknown>): Promise<RankedRequestError> {
  const error = await action().then(
    () => null,
    (cause: unknown) => cause,
  );
  expect(error, "expected a refusal").toBeInstanceOf(RankedRequestError);
  return error as RankedRequestError;
}
async function room(creator: string, minutes = 10): Promise<string> {
  return (await as(creator, () => rankedClient.create(minutes, minutes))).match.id;
}
async function claim(roomId: string, claimant: string): Promise<void> {
  await as(claimant, async () => {
    const { preview } = await rankedClient.preview(roomId);
    await rankedClient.join(roomId, preview.basis);
  });
}
const status = (id: string) =>
  one<{ status: string }>("select status from public.ranked_matches where id = :'id'", { id })
    ?.status;
const rating = (id: string) =>
  one<{ rating: number }>("select rating from public.ranked_ratings where player_id = :'id'", {
    id,
  })?.rating;

function cleanup() {
  owner(`
    delete from public.ranked_results where player_a_id::text like '${PREFIX}%' or player_b_id::text like '${PREFIX}%';
    delete from public.ranked_matches where player_a_id::text like '${PREFIX}%' or player_b_id::text like '${PREFIX}%';
    delete from public.ranked_ratings where player_id::text like '${PREFIX}%';
    update public.system_settings set value_int = 3 where key = 'max_active_boards_per_user';
    delete from auth.users where id::text like '${PREFIX}%'`);
}

describe.skipIf(!PSQL)("the Ranked Edge Function on the C7 authority", () => {
  beforeAll(() => {
    cleanup();
    owner(
      "insert into private.runtime_secrets (key, value) values ('room_code_secret', repeat('s', 40)) on conflict (key) do nothing",
    );
  });
  afterAll(() => cleanup());
  beforeEach(() => {
    actor.token = null;
  });

  it("previews the database's stakes, win, draw and loss, with a basis", async () => {
    const creator = approved("Creator");
    const viewer = approved("Viewer");
    rate(creator, 1437, 9);
    rate(viewer, 1200, 50);
    const id = await room(creator, 15);
    const { preview } = await as(viewer, () => rankedClient.preview(id));
    const authority = one<RankedStakesRow>("select * from public.ranked_stakes(:'m', :'v')", {
      m: id,
      v: viewer,
    })!;
    expect(preview).toEqual({
      matchId: id,
      opponent: { id: creator, name: expect.stringMatching(/^Creator/) },
      minutes: 15,
      rating: 1200,
      after: {
        win: authority.win_rating,
        draw: authority.draw_rating,
        loss: authority.loss_rating,
      },
      basis: authority.basis,
    });
    expect(preview.basis).toMatch(/^rs1:[0-9a-f]{64}$/);
    // Only what the player needs: not the opponent's rating or games.
    expect(Object.keys(preview).sort()).toEqual([
      "after",
      "basis",
      "matchId",
      "minutes",
      "opponent",
      "rating",
    ]);
  });

  it("joins with a fresh basis, and the draw stake is what a draw applies", async () => {
    const creator = approved("Creator");
    const viewer = approved("Viewer");
    rate(creator, 1500, 30);
    rate(viewer, 1310, 4);
    const id = await room(creator);
    const { preview } = await as(viewer, () => rankedClient.preview(id));
    const { match } = await as(viewer, () => rankedClient.join(id, preview.basis));
    expect(match.id).toBe(id);
    expect(status(id)).toBe("matched");
    // The creator sees their own stakes at the Ready step.
    const creatorView = (await as(creator, () => rankedClient.preview(id))).preview;
    expect(creatorView.opponent.id).toBe(viewer);
    await as(creator, () => rankedClient.ready(id));
    await as(viewer, () => rankedClient.ready(id));
    expect(status(id)).toBe("playing");
    const current = await store.match(id);
    owner(
      `select public.ranked_commit_match(:'m', :'r'::bigint,
         '{"status":"finished","scores":{"A":10,"B":10}}'::jsonb, 'draw', 'score')`,
      { m: id, r: String(current!.revision) },
    );
    expect(rating(viewer)).toBe(preview.after.draw);
    expect(rating(creator)).toBe(creatorView.after.draw);
  });

  it("refuses a join without a basis, and never claims on its own", async () => {
    const creator = approved("Creator");
    const viewer = approved("Viewer");
    const id = await room(creator);
    const error = await refusal(() => as(viewer, () => rankedClient.join(id)));
    expect(error.code).toBe("ranked_stakes_required");
    expect(status(id)).toBe("waiting");
  });

  it("refuses stale stakes with ranked_stakes_changed and the new preview, and claims nothing", async () => {
    const creator = approved("Creator");
    const viewer = approved("Viewer");
    rate(creator, 1300, 20);
    rate(viewer, 1310, 20);
    const id = await room(creator);
    const { preview } = await as(viewer, () => rankedClient.preview(id));
    rate(viewer, 1322, 21); // a result elsewhere moved the rating
    const before = await store.match(id);
    const error = await refusal(() => as(viewer, () => rankedClient.join(id, preview.basis)));
    expect(error.code).toBe("ranked_stakes_changed");
    expect(error.preview).not.toBeNull();
    expect(error.preview!.basis).not.toBe(preview.basis);
    expect(error.preview!.rating).toBe(1322);
    // Nothing was claimed, and nothing retried with the new stakes.
    const after = await store.match(id);
    expect(after).toEqual(before);
    // Confirming the new stakes is a new, explicit join.
    await as(viewer, () => rankedClient.join(id, error.preview!.basis));
    expect(status(id)).toBe("matched");
  });

  it("refuses a claimant already in a Ranked match", async () => {
    const a = approved("A");
    const b = approved("B");
    const c = approved("C");
    await claim(await room(a), b);
    const other = await room(c);
    const error = await refusal(() => claim(other, b));
    expect(error.code).toBe("ranked_already_active");
    expect(error.message).toMatch(/You're already in a Ranked match/);
  });

  it("keeps a busy creator's room, refuses it from a stale list, and opens it again once they are free", async () => {
    const creator = approved("Creator");
    const viewer = approved("Viewer");
    const host = approved("Host");
    const id = await room(creator);
    // The room is listed …
    const listed = await as(viewer, () => rankedClient.list());
    expect(listed.open.map((open) => open.id)).toContain(id);
    const { preview } = await as(viewer, () => rankedClient.preview(id));
    // … then its creator takes another match.
    const busy = await room(host);
    await claim(busy, creator);
    // The stale browser tries anyway: the database refuses, the room stays.
    expect((await refusal(() => as(viewer, () => rankedClient.join(id, preview.basis)))).code).toBe(
      "ranked_room_unavailable",
    );
    expect(status(id)).toBe("waiting");
    // Once the creator is free, the same room can be taken.
    await as(creator, () => rankedClient.ready(busy));
    await as(host, () => rankedClient.ready(busy));
    const match = (await as(host, () => rankedClient.read(busy))).match;
    await as(host, () => rankedClient.action(busy, match.revision, { kind: "resign" }));
    expect(status(busy)).toBe("finished");
    await claim(id, viewer);
    expect(status(id)).toBe("matched");
  });

  it("tells the claimant it is their own board limit", async () => {
    const creator = approved("Creator");
    const viewer = approved("Viewer");
    const id = await room(creator);
    await room(viewer); // the viewer's own waiting room is their one board
    owner(
      "update public.system_settings set value_int = 1 where key = 'max_active_boards_per_user'",
    );
    try {
      const { preview } = await as(viewer, () => rankedClient.preview(id));
      const error = await refusal(() => as(viewer, () => rankedClient.join(id, preview.basis)));
      expect(error.code).toBe("active_board_limit");
      expect(error.message).toMatch(/You already have the maximum number of active boards/);
      // Creating is the creator's own limit too — the old wording blamed "the
      // other player" here.
      const create = await refusal(() => as(viewer, () => rankedClient.create(10, 10)));
      expect(create.code).toBe("active_board_limit");
      expect(create.message).toMatch(/You already have the maximum number of active boards/);
    } finally {
      owner(
        "update public.system_settings set value_int = 3 where key = 'max_active_boards_per_user'",
      );
    }
    expect(status(id)).toBe("waiting");
    // Below the limit, a second waiting room is refused for what it is.
    const again = await refusal(() => as(viewer, () => rankedClient.create(10, 10)));
    expect(again.code).toBe("ranked_already_waiting");
  });

  it("refuses a room already taken, your own room, an expired room and a missing one", async () => {
    const creator = approved("Creator");
    const first = approved("First");
    const second = approved("Second");
    const id = await room(creator);
    const { preview } = await as(second, () => rankedClient.preview(id));
    await claim(id, first);
    expect((await refusal(() => as(second, () => rankedClient.join(id, preview.basis)))).code).toBe(
      "ranked_room_claimed",
    );
    expect((await refusal(() => as(second, () => rankedClient.preview(id)))).code).toBe(
      "ranked_room_claimed",
    );

    const own = await room(second);
    expect((await refusal(() => as(second, () => rankedClient.preview(own)))).code).toBe(
      "ranked_own_room",
    );
    expect((await refusal(() => as(second, () => rankedClient.join(own, "rs1:x")))).code).toBe(
      "ranked_own_room",
    );

    const late = approved("Late");
    const old = await room(late);
    owner(
      "update public.ranked_matches set created_at = now() - interval '25 hours' where id = :'id'",
      { id: old },
    );
    expect((await refusal(() => as(second, () => rankedClient.preview(old)))).code).toBe(
      "ranked_room_expired",
    );
    expect((await refusal(() => as(second, () => rankedClient.join(old, "rs1:x")))).code).toBe(
      "ranked_room_expired",
    );

    const missing = "3f0c1d2e-aaaa-4bbb-8ccc-123456789abc";
    expect((await refusal(() => as(second, () => rankedClient.preview(missing)))).code).toBe(
      "ranked_room_not_found",
    );
    expect((await refusal(() => as(second, () => rankedClient.join(missing, "rs1:x")))).code).toBe(
      "ranked_room_not_found",
    );
    expect((await refusal(() => as(second, () => rankedClient.preview("not-a-uuid")))).code).toBe(
      "ranked_invalid_request",
    );
  });

  it("keeps the approval gate and refuses unauthenticated requests", async () => {
    const creator = approved("Creator");
    const pending = approved("Pending", "pending");
    const id = await room(creator);
    for (const call of [
      () => rankedClient.preview(id),
      () => rankedClient.join(id, "rs1:x"),
      () => rankedClient.list(),
    ]) {
      expect((await refusal(() => as(pending, call))).code).toBe("approval_required");
      expect((await refusal(() => as(null, call))).code).toBe("sign_in_required");
      expect((await refusal(() => as("not-a-real-token", call))).code).toBe("sign_in_required");
    }
    expect(status(id)).toBe("waiting");
  });

  it("never lets the body name the viewer", async () => {
    const creator = approved("Creator");
    const viewer = approved("Viewer");
    const victim = approved("Victim");
    rate(victim, 2000, 80);
    const id = await room(creator);
    const response = await handleRanked(
      {
        authorization: `Bearer ${viewer}`,
        body: {
          operation: "preview",
          id,
          userId: victim,
          player_id: victim,
          target_player_id: victim,
        },
      },
      store,
    );
    expect(response.status).toBe(200);
    expect((response.body.preview as { rating: number }).rating).toBe(1000);
    const { preview } = response.body as { preview: { basis: string } };
    await handleRanked(
      {
        authorization: `Bearer ${viewer}`,
        body: { operation: "join", id, basis: preview.basis, userId: victim },
      },
      store,
    );
    expect((await store.match(id))!.player_b_id).toBe(viewer);
  });

  it("resumes a match you already hold, and plays it to the end", async () => {
    const creator = approved("Creator");
    const viewer = approved("Viewer");
    const id = await room(creator);
    await claim(id, viewer);
    // A second join (a retry, another tab) is a resume, whatever the basis.
    const again = await as(viewer, () => rankedClient.join(id, "rs1:whatever"));
    expect(again.match.id).toBe(id);
    await as(creator, () => rankedClient.ready(id));
    await as(viewer, () => rankedClient.ready(id));
    const read = await as(viewer, () => rankedClient.read(id));
    expect(read.match.id).toBe(id);
    await as(creator, () => rankedClient.action(id, read.match.revision, { kind: "resign" }));
    const finished = await as(viewer, () => rankedClient.read(id));
    expect(finished.match.ratingChange).toBeDefined();
  });

  it("lets a player with several legacy matches finish them, but not acquire another", async () => {
    const legacy = approved("Legacy");
    const o1 = approved("Old1");
    const o2 = approved("Old2");
    const fresh = approved("Fresh");
    // Two matches from before the rule: created as rooms, then seated with the rule off.
    const first = await room(o1);
    const second = await room(o2);
    owner(
      `alter table public.ranked_matches disable trigger ranked_matches_active_match;
      update public.ranked_matches set player_b_id = :'p', status = 'matched', revision = revision + 1,
        state = jsonb_set(jsonb_set(state, '{playerUserIds,B}', to_jsonb(:'p'::text), true), '{players,B}', '"Legacy"', true)
       where id in (:'a', :'b');
      alter table public.ranked_matches enable trigger ranked_matches_active_match`,
      { p: legacy, a: first, b: second },
    );
    // Cannot acquire a third …
    const third = await room(fresh);
    expect((await refusal(() => claim(third, legacy))).code).toBe("ranked_already_active");
    // … but reads, readies, plays and finishes both.
    for (const [id, other] of [
      [first, o1],
      [second, o2],
    ] as const) {
      await as(legacy, () => rankedClient.read(id));
      await as(legacy, () => rankedClient.ready(id));
      await as(other, () => rankedClient.ready(id));
      const match = (await as(legacy, () => rankedClient.read(id))).match;
      await as(legacy, () => rankedClient.action(id, match.revision, { kind: "resign" }));
      expect(status(id)).toBe("finished");
    }
    await claim(third, legacy);
    expect(status(third)).toBe("matched");
  });

  it("carries each database refusal code through Edge and client unchanged", async () => {
    // Collected from the tests above in one place, to prove the round trip for
    // every code C9 reacts to; each came from the database itself.
    const creator = approved("Creator");
    const viewer = approved("Viewer");
    const id = await room(creator);
    const codes: Record<string, string | null> = {
      ranked_stakes_required: (await refusal(() => as(viewer, () => rankedClient.join(id)))).code,
      ranked_stakes_changed: (
        await refusal(() => as(viewer, () => rankedClient.join(id, "rs1:stale")))
      ).code,
      ranked_own_room: (await refusal(() => as(creator, () => rankedClient.preview(id)))).code,
    };
    for (const [expected, actual] of Object.entries(codes)) expect(actual, expected).toBe(expected);
  });
});
