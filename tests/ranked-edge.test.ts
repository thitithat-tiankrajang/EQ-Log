import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ store: null as unknown, token: "user-1" as string | null }));
vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: {
    functions: {
      invoke: async (_name: string, { body }: { body: unknown }) => {
        const { handleRanked } = await import("../supabase/functions/ranked/handler");
        const response = await handleRanked(
          { authorization: transport.token ? `Bearer ${transport.token}` : null, body },
          transport.store as never,
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

import { handleRanked, StoreError, type RankedStore } from "../supabase/functions/ranked/handler";
import { RankedRequestError, rankedClient } from "../src/features/ranked/client";
import { createRankedGame } from "../src/features/ranked/rules";
import { chooseLocale, resetActiveLocale } from "../src/i18n/locale";

const ROOM = "3f0c1d2e-aaaa-4bbb-8ccc-123456789abc";
const VIEWER = "11111111-1111-4111-8111-111111111111";
const CREATOR = "22222222-2222-4222-8222-222222222222";

const stakesRow = {
  match_id: ROOM,
  viewer_side: "B",
  opponent_id: CREATOR,
  viewer_rating: 1200,
  viewer_games: 50,
  opponent_rating: 1437,
  win_rating: 1218,
  draw_rating: 1206,
  loss_rating: 1194,
  basis: "rs1:" + "a".repeat(64),
};

/** An in-memory store: whatever the database would say, scripted per test. */
function fakeStore(overrides: Partial<RankedStore> = {}): RankedStore & {
  claim: ReturnType<typeof vi.fn>;
} {
  const game = createRankedGame(CREATOR, "Creator", 15, 15, "A");
  const base: RankedStore = {
    authenticate: async (token) =>
      token === "user-1" ? VIEWER : token === "pending" ? "p-1" : null,
    profile: async (id) =>
      id === VIEWER
        ? { display_name: "Viewer", status: "approved" }
        : { display_name: "P", status: "pending" },
    names: async (ids) => new Map(ids.map((id) => [id, id === CREATOR ? "Creator" : "Someone"])),
    listOpen: async () => [],
    listMine: async () => [],
    leaderboard: async () => [],
    ownRating: async () => null,
    insertWaiting: async () => ({ id: ROOM, revision: 0 }),
    stakes: async () => stakesRow,
    claim: async () => ({ match_id: ROOM, revision: 1, resumed: false }),
    match: async () => ({
      id: ROOM,
      player_a_id: CREATOR,
      player_b_id: VIEWER,
      status: "matched",
      revision: 1,
      minutes_a: 15,
      minutes_b: 15,
      state: game,
      created_at: new Date().toISOString(),
    }),
    deleteUnstarted: async () => 1,
    ready: async () => true,
    commit: async () => true,
    result: async () => null,
  };
  const store = { ...base, ...overrides };
  return { ...store, claim: vi.fn(store.claim) };
}

const refused =
  (message: string, sqlState = "P0001") =>
  async () => {
    throw new StoreError(message, sqlState);
  };

beforeEach(() => {
  window.localStorage.clear();
  resetActiveLocale();
  transport.token = "user-1";
});
afterEach(() => {
  resetActiveLocale();
  vi.restoreAllMocks();
});

describe("preview", () => {
  it("returns the database's stakes for the authenticated viewer, and nothing more", async () => {
    const stakes = vi.fn(async () => stakesRow);
    const response = await handleRanked(
      { authorization: "Bearer user-1", body: { operation: "preview", id: ROOM, userId: CREATOR } },
      fakeStore({ stakes }),
    );
    expect(response.status).toBe(200);
    expect(stakes).toHaveBeenCalledWith(ROOM, VIEWER);
    expect(response.body.preview).toEqual({
      matchId: ROOM,
      opponent: { id: CREATOR, name: "Creator" },
      minutes: 15,
      rating: 1200,
      after: { win: 1218, draw: 1206, loss: 1194 },
      basis: stakesRow.basis,
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /1437|opponent_rating|viewer_games|EXP|level/i,
    );
  });
});

describe("join", () => {
  it("claims through v2 with the basis the player confirmed, and nothing else", async () => {
    const store = fakeStore();
    const response = await handleRanked(
      {
        authorization: "Bearer user-1",
        body: { operation: "join", id: ROOM, basis: stakesRow.basis },
      },
      store,
    );
    expect(response.status).toBe(200);
    expect(store.claim).toHaveBeenCalledTimes(1);
    expect(store.claim.mock.calls[0].slice(0, 4)).toEqual([
      ROOM,
      VIEWER,
      "Viewer",
      stakesRow.basis,
    ]);
  });

  it("passes a missing basis to the database as missing, never filling one in", async () => {
    const store = fakeStore({
      claim: refused("ranked_stakes_required: confirm the stakes before joining", "22023"),
    });
    for (const basis of [undefined, "", 42, { basis: "x" }]) {
      const response = await handleRanked(
        { authorization: "Bearer user-1", body: { operation: "join", id: ROOM, basis } },
        store,
      );
      expect(response).toMatchObject({ status: 400, body: { code: "ranked_stakes_required" } });
    }
    for (const call of store.claim.mock.calls) expect(call[3]).toBeNull();
  });

  it("answers stale stakes with the new preview, claiming once and never again", async () => {
    const store = fakeStore({
      claim: refused("ranked_stakes_changed: the stakes for this match have changed"),
    });
    const response = await handleRanked(
      { authorization: "Bearer user-1", body: { operation: "join", id: ROOM, basis: "rs1:old" } },
      store,
    );
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("ranked_stakes_changed");
    expect((response.body.preview as { basis: string }).basis).toBe(stakesRow.basis);
    expect(store.claim).toHaveBeenCalledTimes(1);
  });
});

describe("refusals", () => {
  const database: Array<[string, number]> = [
    ["ranked_already_active: you are already in an active Ranked match", 409],
    ["ranked_room_unavailable: this room's creator is in another Ranked match", 409],
    ["ranked_stakes_changed: the stakes for this match have changed", 409],
    ["ranked_stakes_required: confirm the stakes before joining", 400],
    ["ranked_room_claimed: this Ranked room has already been taken", 409],
    ["ranked_room_expired: this Ranked room is no longer open", 409],
    ["ranked_room_not_found: no such Ranked room", 404],
    ["ranked_room_finished: this Ranked match has finished", 409],
    ["ranked_own_room: this is your own Ranked room", 409],
    ["approval_required: an approved account is required", 403],
    ["active_board_limit: a seated player has 3 active boards already (limit 3)", 409],
  ];

  it.each(database)("keep the database's code: %s", async (message, status) => {
    const code = message.split(":")[0];
    const response = await handleRanked(
      { authorization: "Bearer user-1", body: { operation: "join", id: ROOM, basis: "rs1:x" } },
      fakeStore({ claim: refused(message), stakes: refused(message) }),
    );
    expect(response.status).toBe(status);
    expect(response.body.code).toBe(code);
  });

  it.each(database)("reach the client as RankedRequestError.code: %s", async (message) => {
    const code = message.split(":")[0];
    transport.store = fakeStore({ claim: refused(message), stakes: refused(message) });
    const error = await rankedClient.join(ROOM, "rs1:x").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(RankedRequestError);
    expect((error as RankedRequestError).code).toBe(code);
    // The client explains it; the code is never replaced by prose.
    expect((error as RankedRequestError).message).not.toMatch(/^[a-z_]+:/);
  });

  it("name the caller's own board limit, whatever the service-role wording", async () => {
    transport.store = fakeStore({
      claim: refused("active_board_limit: a seated player has 3 active boards already (limit 3)"),
    });
    const error = (await rankedClient.join(ROOM, "rs1:x").catch((e) => e)) as RankedRequestError;
    expect(error.code).toBe("active_board_limit");
    expect(error.message).toMatch(/^You already have the maximum number of active boards/);
    chooseLocale("th");
    const thai = (await rankedClient.join(ROOM, "rs1:x").catch((e) => e)) as RankedRequestError;
    expect(thai.message).toMatch(/^คุณมีกระดานที่กำลังเล่นครบจำนวนแล้ว/);
  });

  it("never forward raw database or runtime text", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const failure of [
      refused('relation "ranked_matches" does not exist', "42P01"),
      async () => {
        throw new TypeError("Cannot read properties of undefined (reading 'id')");
      },
    ]) {
      const response = await handleRanked(
        { authorization: "Bearer user-1", body: { operation: "preview", id: ROOM } },
        fakeStore({ stakes: failure }),
      );
      expect(response).toEqual({
        status: 500,
        body: { error: "Ranked request failed.", code: "ranked_request_failed" },
      });
    }
  });

  it("still explain a move the rules refuse, in the rules' words", async () => {
    const store = fakeStore();
    const match = await store.match(ROOM);
    const response = await handleRanked(
      {
        authorization: "Bearer user-1",
        body: {
          operation: "action",
          id: ROOM,
          revision: match!.revision,
          action: { kind: "pass" },
        },
      },
      store,
    );
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Match is not playing.");
  });

  it("refuse unauthenticated, unapproved and malformed requests before touching a match", async () => {
    const store = fakeStore();
    const match = vi.spyOn(store, "match");
    const cases: Array<[string | null, unknown, number, string]> = [
      [null, { operation: "preview", id: ROOM }, 401, "sign_in_required"],
      ["Basic abc", { operation: "preview", id: ROOM }, 401, "sign_in_required"],
      ["Bearer forged", { operation: "preview", id: ROOM }, 401, "sign_in_required"],
      ["Bearer pending", { operation: "preview", id: ROOM }, 403, "approval_required"],
      ["Bearer user-1", { operation: "preview", id: "not-a-uuid" }, 400, "ranked_invalid_request"],
      ["Bearer user-1", { operation: "preview", id: 7 }, 400, "ranked_invalid_request"],
      ["Bearer user-1", { operation: "nonsense", id: ROOM }, 400, "ranked_invalid_request"],
      ["Bearer user-1", "not an object", 400, "ranked_invalid_request"],
    ];
    for (const [authorization, body, status, code] of cases) {
      const response = await handleRanked({ authorization, body }, store);
      expect(response, JSON.stringify(body)).toMatchObject({ status, body: { code } });
    }
    expect(store.claim).not.toHaveBeenCalled();
    expect(match).not.toHaveBeenCalled();
  });

  it("say a second waiting room is one", async () => {
    const response = await handleRanked(
      { authorization: "Bearer user-1", body: { operation: "create", minutesA: 10, minutesB: 10 } },
      fakeStore({
        insertWaiting: refused("duplicate key value violates unique constraint", "23505"),
      }),
    );
    expect(response).toMatchObject({ status: 409, body: { code: "ranked_already_waiting" } });
  });
});

describe("the Edge source", () => {
  const root = process.cwd();
  const handler = readFileSync(join(root, "supabase/functions/ranked/handler.ts"), "utf8");
  const index = readFileSync(join(root, "supabase/functions/ranked/index.ts"), "utf8");
  const bundle = readFileSync(join(root, "supabase/functions/ranked/index.js"), "utf8");

  it("claims only through v2, with no v1 path left to fall back to", () => {
    for (const source of [index, bundle]) {
      expect(source).toContain('"ranked_claim_match_v2"');
      expect(source).not.toMatch(/"ranked_claim_match"/);
      expect(source).toContain('"ranked_stakes"');
    }
  });

  it("is the bundle that deploys", () => {
    // index.js is the configured entrypoint; it must carry the handler.
    expect(bundle).toContain("ranked_stakes_changed");
    expect(bundle).toContain("ranked_request_failed");
  });

  it("does no rating, active-match or board arithmetic, and knows no EXP or level", () => {
    for (const source of [handler, index]) {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      expect(code).not.toMatch(/10\s*\*\*|Math\.pow|\/\s*400\b/);
      expect(code).not.toMatch(/games\s*<\s*10|max_active_boards|active_board_count/);
      expect(code).not.toMatch(/\.in\(\s*"status"\s*,\s*\[\s*"matched"\s*,\s*"playing"/);
      expect(code).not.toMatch(/\bexp\b|\blevel\b/i);
    }
  });
});
