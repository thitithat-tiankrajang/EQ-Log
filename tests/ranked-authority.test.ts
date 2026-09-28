import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: { functions: { invoke } },
}));

import { RankedRequestError, rankedClient } from "../src/features/ranked/client";
import { rankedStakeChanges, rankedStakesFromRow } from "../src/features/ranked/stakes";
import { chooseLocale, resetActiveLocale } from "../src/i18n/locale";
import { en } from "../src/i18n/messages/en";
import { th } from "../src/i18n/messages/th";
import { SERVER_ERROR_CODES } from "../src/i18n/serverErrors";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase/migrations/20260930110000_ranked_match_authority.sql"),
  "utf8",
);
const boardsMigration = readFileSync(
  join(root, "supabase/migrations/20260929130000_active_boards.sql"),
  "utf8",
);
const edge = readFileSync(join(root, "supabase/functions/ranked/index.ts"), "utf8");

/** The migration without comments, for checks on what it executes. */
const executable = migration.replace(/--[^\n]*/g, "");
/** Everything outside function bodies: what runs once, at migration time. */
const topLevel = executable.replace(/\$\$[\s\S]*?\$\$/g, "$$$$");

function functionBody(name: string): string {
  const start = migration.indexOf(`create or replace function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const end = migration.indexOf("$$;", migration.indexOf("$$", start) + 2);
  return migration.slice(start, end);
}

/** An Edge Function refusal as supabase-js reports it. */
function refusal(body: Record<string, unknown>, status = 409) {
  return {
    data: null,
    error: Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: new Response(JSON.stringify(body), { status }),
    }),
  };
}

beforeEach(() => {
  window.localStorage.clear();
  resetActiveLocale();
  invoke.mockReset();
});

afterEach(() => {
  resetActiveLocale();
});

describe("the Ranked authority in the database", () => {
  it("is reachable by the service role only", () => {
    for (const fn of [
      "ranked_stakes(uuid, uuid)",
      "ranked_claim_match_v2(uuid, uuid, text, text, timestamptz)",
    ]) {
      expect(migration).toContain(
        `revoke all on function public.${fn} from public, anon, authenticated;`,
      );
      expect(migration).toContain(`grant execute on function public.${fn} to service_role;`);
    }
    for (const internal of [
      "ranked_rating_outcome(integer, integer, integer, integer, numeric)",
      "ranked_active_count(uuid, uuid)",
      "enforce_ranked_active_match()",
    ]) {
      expect(migration).toContain(
        `revoke all on function public.${internal} from public, anon, authenticated, service_role;`,
      );
      expect(migration).not.toMatch(new RegExp(`grant execute on function public.${internal}`));
    }
  });

  it("previews and applies ratings with one formula", () => {
    const commit = functionBody("ranked_commit_match");
    expect(commit).toContain("public.ranked_rating_outcome(a.rating, a.games, b.rating, b.games");
    expect(commit).not.toContain("power(");
    expect(functionBody("ranked_stakes")).toContain("public.ranked_rating_outcome(");
    expect(migration.match(/power\(10::numeric/g)).toHaveLength(1);
  });

  it("locks with the Phase 3 per-user lock, before the board trigger does", () => {
    expect(functionBody("enforce_ranked_active_match")).toContain("public.lock_board_users(");
    expect(functionBody("ranked_claim_match_v2")).toContain("public.lock_board_users(");
    // Triggers fire in name order: this one takes every seat first.
    expect("ranked_matches_active_match" < "ranked_matches_board_limit").toBe(true);
    expect(migration).toContain("create trigger ranked_matches_active_match");
    expect(boardsMigration).toContain("create trigger ranked_matches_board_limit");
    // …and never re-derives that lock by hand.
    expect(executable).not.toMatch(/hashtextextended\([^)]*, 41\)/);
  });

  it("changes no data and drops nothing", () => {
    // No statement at migration time writes or removes anything.
    expect(topLevel).not.toMatch(
      /^\s*(insert\s+into|update\s+\S+\s+set|delete\s+from|truncate|drop\s+(table|function|index))\b/im,
    );
    expect(topLevel).not.toMatch(/\b(unique|constraint)\b/i);
  });

  it("leaves the current Edge Function on the v1 claim until C8 moves it", () => {
    expect(edge).toContain('db.rpc("ranked_claim_match",');
    expect(edge).not.toContain("ranked_claim_match_v2");
    expect(migration).not.toMatch(/create or replace function public\.ranked_claim_match\(/);
  });

  it("gives every refusal a code the client explains in English and Thai", () => {
    const raised = new Set(
      [...migration.matchAll(/raise exception '([a-z_]+):/g)].map((match) => match[1]),
    );
    expect([...raised].sort()).toEqual(
      [
        "approval_required",
        "active_board_limit",
        "ranked_already_active",
        "ranked_own_room",
        "ranked_room_claimed",
        "ranked_room_expired",
        "ranked_room_finished",
        "ranked_room_not_found",
        "ranked_room_unavailable",
        "ranked_stakes_changed",
        "ranked_stakes_required",
      ].sort(),
    );
    for (const code of raised) {
      expect(SERVER_ERROR_CODES as readonly string[], code).toContain(code);
      expect((en.errors.server as Record<string, unknown>)[code], code).toBeTruthy();
      expect((th.errors.server as Record<string, unknown>)[code], code).toBeTruthy();
    }
  });
});

describe("Ranked refusals at the client boundary", () => {
  it("keep the server's code, and explain it", async () => {
    invoke.mockResolvedValue(
      refusal({ error: "ranked_stakes_changed: the stakes for this match have changed" }),
    );
    const error = await rankedClient.join("3f0c1d2e-aaaa-4bbb-8ccc-123456789abc").catch((e) => e);
    expect(error).toBeInstanceOf(RankedRequestError);
    expect(error.code).toBe("ranked_stakes_changed");
    expect(error.message).toMatch(/rating at stake has changed/);
    expect(error.serverMessage).toBe(
      "ranked_stakes_changed: the stakes for this match have changed",
    );
  });

  it("take the Edge Function's own code when it sends one", async () => {
    invoke.mockResolvedValue(
      refusal({
        error: "You already have the maximum number of active boards. Finish or cancel one first.",
        code: "active_board_limit",
      }),
    );
    const error = await rankedClient.create(10, 10).catch((e) => e);
    expect(error.code).toBe("active_board_limit");
    expect(error.message).toMatch(/maximum number of active boards/);
  });

  it("tell a busy claimant from a busy opponent", async () => {
    invoke.mockResolvedValue(
      refusal(
        { error: "ranked_already_active: a seated player is already in an active Ranked match" },
        400,
      ),
    );
    const other = await rankedClient.join("3f0c1d2e-aaaa-4bbb-8ccc-123456789abc").catch((e) => e);
    expect(other.code).toBe("ranked_already_active");
    expect(other.message).toMatch(/One of the players/);
    invoke.mockResolvedValue(
      refusal({ error: "ranked_already_active: you are already in an active Ranked match" }, 400),
    );
    const own = await rankedClient.join("3f0c1d2e-aaaa-4bbb-8ccc-123456789abc").catch((e) => e);
    expect(own.message).toMatch(/You're already in a Ranked match/);
  });

  it("are explained in Thai when the player chose Thai", async () => {
    chooseLocale("th");
    invoke.mockResolvedValue(refusal({ error: "ranked_room_unavailable: creator busy" }));
    const error = await rankedClient.join("3f0c1d2e-aaaa-4bbb-8ccc-123456789abc").catch((e) => e);
    expect(error.code).toBe("ranked_room_unavailable");
    expect(error.message).toBe("ผู้สร้างห้องนี้กำลังเล่นแมตช์จัดอันดับอื่นอยู่ ลองใหม่ภายหลัง");
  });

  it("pass other text through unchanged, with no code guessed", async () => {
    invoke.mockResolvedValue(refusal({ error: "This room is no longer open." }));
    const error = await rankedClient.join("3f0c1d2e-aaaa-4bbb-8ccc-123456789abc").catch((e) => e);
    expect(error.code).toBeNull();
    expect(error.message).toBe("This room is no longer open.");
  });

  it("leave the existing calls as they were", async () => {
    invoke.mockResolvedValue({ data: { match: { id: "m" } }, error: null });
    await rankedClient.join("m-1");
    expect(invoke).toHaveBeenLastCalledWith("ranked", { body: { operation: "join", id: "m-1" } });
  });
});

describe("stakes on the client", () => {
  const row = {
    match_id: "m-1",
    viewer_side: "B",
    opponent_id: "u-2",
    viewer_rating: 1200,
    viewer_games: 50,
    opponent_rating: 1437,
    win_rating: 1218,
    draw_rating: 1206,
    loss_rating: 1194,
    basis: "rs1:abc",
  };

  it("are the server's numbers, projected, with changes by subtraction only", () => {
    const stakes = rankedStakesFromRow(row);
    expect(stakes).toEqual({
      matchId: "m-1",
      side: "B",
      opponentId: "u-2",
      rating: 1200,
      games: 50,
      opponentRating: 1437,
      after: { win: 1218, draw: 1206, loss: 1194 },
      basis: "rs1:abc",
    });
    expect(rankedStakeChanges(stakes)).toEqual({ win: 18, draw: 6, loss: -6 });
  });

  it("refuse a row with no seat", () => {
    expect(() => rankedStakesFromRow({ ...row, viewer_side: "C" })).toThrow();
  });

  it("are never computed by client or Edge code", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) files.push(path);
      }
    };
    walk(join(root, "src"));
    files.push(join(root, "supabase/functions/ranked/index.ts"));
    const elo = /(10\s*\*\*|Math\.pow\(\s*10)[^;\n]*\/\s*400/;
    const offenders = files.filter((file) => elo.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
