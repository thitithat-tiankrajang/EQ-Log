import {
  applyRankedAction,
  createRankedGame,
  isRankedTime,
  resultOf,
  settleRankedClock,
  type RankedAction,
} from "../../../src/features/ranked/rules.ts";
import { rankedPublicView } from "../../../src/features/ranked/publicView.ts";
import {
  rankedStakePreview,
  rankedStakesFromRow,
  type RankedStakePreview,
  type RankedStakesRow,
} from "../../../src/features/ranked/stakes.ts";
import type { GameState } from "../../../src/game.ts";

/**
 * The Ranked Edge Function's logic, apart from Deno and supabase-js so the same
 * code can be tested against a real database. It authenticates the caller,
 * then orchestrates the database's Ranked authority (C7) and translates its
 * refusals; it decides nothing the database decides — no rating arithmetic,
 * no active-match or board counting, no stake comparison.
 */

export type MatchRow = {
  id: string;
  player_a_id: string;
  player_b_id: string | null;
  status: "waiting" | "matched" | "playing" | "finished";
  revision: number;
  minutes_a: number;
  minutes_b: number;
  state: GameState;
  created_at: string;
};

/** A database refusal or failure, as the store reports it: the exception message. */
export class StoreError extends Error {
  constructor(
    message: string,
    readonly sqlState: string | null = null,
  ) {
    super(message);
    this.name = "StoreError";
  }
}

/** Everything the handler needs from the database, as the service role. */
export type RankedStore = {
  /** The authenticated user behind a bearer token, or null. */
  authenticate(token: string): Promise<string | null>;
  profile(userId: string): Promise<{ display_name: string | null; status: string } | null>;
  names(ids: string[]): Promise<Map<string, string | null>>;
  listOpen(
    since: string,
  ): Promise<{ id: string; player_a_id: string; minutes_a: number; created_at: string }[]>;
  listMine(userId: string): Promise<
    {
      id: string;
      player_a_id: string;
      player_b_id: string | null;
      status: string;
      created_at: string;
    }[]
  >;
  leaderboard(): Promise<
    {
      player_id: string;
      rating: number;
      games: number;
      wins: number;
      losses: number;
      draws: number;
    }[]
  >;
  ownRating(
    userId: string,
  ): Promise<{ rating: number; games: number; wins: number; losses: number; draws: number } | null>;
  /** Insert a waiting room; a second one for the creator fails with sqlState 23505. */
  insertWaiting(row: {
    player_a_id: string;
    minutes_a: number;
    minutes_b: number;
    state: GameState;
  }): Promise<{ id: string; revision: number }>;
  stakes(matchId: string, viewerId: string): Promise<RankedStakesRow>;
  claim(
    matchId: string,
    playerId: string,
    playerName: string,
    basis: string | null,
    now: string,
  ): Promise<{ match_id: string; revision: number; resumed: boolean }>;
  match(id: string): Promise<MatchRow | null>;
  /** Delete a waiting or matched match; the number of rows deleted. */
  deleteUnstarted(id: string): Promise<number>;
  ready(matchId: string, playerId: string, now: string): Promise<boolean>;
  commit(
    matchId: string,
    revision: number,
    state: GameState,
    winner: string | null,
    reason: string | null,
  ): Promise<boolean>;
  result(matchId: string): Promise<{
    rating_a_before: number;
    rating_a_after: number;
    rating_b_before: number;
    rating_b_after: number;
  } | null>;
};

export type RankedRequest = { authorization: string | null; body: unknown };
export type RankedResponse = { status: number; body: Record<string, unknown> };

/**
 * The database's Ranked refusal codes (the `snake_code:` prefix of the
 * exception), forwarded unchanged as `code`, with the HTTP status each maps to.
 */
const DATABASE_CODES: Record<string, number> = {
  approval_required: 403,
  active_board_limit: 409,
  active_board_limit_unconfigured: 503,
  ranked_already_active: 409,
  ranked_room_unavailable: 409,
  ranked_room_claimed: 409,
  ranked_room_expired: 409,
  ranked_room_finished: 409,
  ranked_own_room: 409,
  ranked_room_not_found: 404,
  ranked_stakes_changed: 409,
  ranked_stakes_required: 400,
};

/** Refusals the function itself makes, with their codes. */
function refuse(status: number, code: string, error: string): RankedResponse {
  return { status, body: { error, code } };
}

const SIGN_IN = () => refuse(401, "sign_in_required", "Sign in required.");
const APPROVAL = () => refuse(403, "approval_required", "Approved account required.");
const INVALID = (error: string) => refuse(400, "ranked_invalid_request", error);

/** A rule of play refused the action; its message is written for players. */
class RuleError extends Error {}

function databaseRefusal(error: StoreError): RankedResponse | null {
  const code = /^([a-z_]+):/.exec(error.message)?.[1];
  if (!code || !(code in DATABASE_CODES)) return null;
  if (code === "active_board_limit") {
    // Every Ranked operation seats only the caller as a new board: create seats
    // the creator, and a claim the claimant (the creator's waiting room already
    // counts). So the limit reached is always the caller's own, whatever the
    // service-role wording of the database message.
    return refuse(409, code, "active_board_limit: you have reached your active board limit.");
  }
  return refuse(DATABASE_CODES[code], code, error.message);
}

const OPERATIONS = new Set([
  "list",
  "leaderboard",
  "create",
  "preview",
  "join",
  "cancel",
  "ready",
  "read",
  "action",
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleRanked(
  request: RankedRequest,
  store: RankedStore,
  now: () => Date = () => new Date(),
): Promise<RankedResponse> {
  try {
    return await route(request, store, now);
  } catch (error) {
    if (error instanceof RuleError) return { status: 400, body: { error: error.message } };
    if (error instanceof StoreError) {
      const refusal = databaseRefusal(error);
      if (refusal) return refusal;
    }
    // Never forward raw database or runtime text.
    console.error("ranked request failed", error);
    return refuse(500, "ranked_request_failed", "Ranked request failed.");
  }
}

async function route(
  request: RankedRequest,
  store: RankedStore,
  now: () => Date,
): Promise<RankedResponse> {
  const authorization = request.authorization ?? "";
  if (!authorization.startsWith("Bearer ")) return SIGN_IN();
  // The viewer is whoever the token proves; nothing in the body names a user.
  const userId = await store.authenticate(authorization.slice(7));
  if (!userId) return SIGN_IN();
  const profile = await store.profile(userId);
  if (profile?.status !== "approved") return APPROVAL();
  const name = profile.display_name?.trim() || "Player";
  const body =
    request.body && typeof request.body === "object"
      ? (request.body as Record<string, unknown>)
      : {};
  const operation = typeof body.operation === "string" ? body.operation : "";
  if (!OPERATIONS.has(operation)) return INVALID("Unknown operation.");

  if (operation === "list") {
    // Discovery only: a stale list never decides anything, because preview and
    // join ask the database again. Rooms whose creator is busy are still
    // listed; the database refuses them (ranked_room_unavailable) until the
    // creator is free.
    const open = await store.listOpen(
      new Date(now().getTime() - 24 * 60 * 60 * 1000).toISOString(),
    );
    const names = await store.names(open.map((room) => room.player_a_id));
    const mine = await store.listMine(userId);
    return {
      status: 200,
      body: {
        open: open.map((room) => ({
          id: room.id,
          creatorId: room.player_a_id,
          creator: names.get(room.player_a_id) ?? "Player",
          minutesA: room.minutes_a,
          createdAt: room.created_at,
        })),
        mine,
      },
    };
  }

  if (operation === "leaderboard") {
    const ratings = await store.leaderboard();
    const names = await store.names(ratings.map((row) => row.player_id));
    const own = await store.ownRating(userId);
    return {
      status: 200,
      body: {
        rows: ratings.map((row, index) => ({
          ...row,
          place: index + 1,
          name: names.get(row.player_id) ?? "Player",
        })),
        own: own ?? { rating: 1000, games: 0, wins: 0, losses: 0, draws: 0 },
      },
    };
  }

  if (operation === "create") {
    const minutesA = Number(body.minutesA);
    const minutesB = Number(body.minutesB);
    if (!isRankedTime(minutesA) || minutesA !== minutesB)
      return INVALID("Choose the same 10, 15, 20 or 30 minutes for both sides.");
    const game = createRankedGame(
      userId,
      name,
      minutesA,
      minutesB,
      crypto.getRandomValues(new Uint8Array(1))[0] % 2 === 0 ? "A" : "B",
    );
    let created: { id: string; revision: number };
    try {
      created = await store.insertWaiting({
        player_a_id: userId,
        minutes_a: minutesA,
        minutes_b: minutesB,
        state: game,
      });
    } catch (error) {
      if (error instanceof StoreError && error.sqlState === "23505")
        return refuse(409, "ranked_already_waiting", "You already have a waiting ranked room.");
      throw error;
    }
    return {
      status: 200,
      body: { match: await viewFor(store, created.id, created.revision, game, userId) },
    };
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!UUID.test(id)) return INVALID("Invalid room id.");

  if (operation === "preview") {
    return { status: 200, body: { preview: await preview(store, id, userId) } };
  }

  if (operation === "join") {
    // The basis is the one the player confirmed; it is never filled in here.
    // Without one the database refuses (ranked_stakes_required), and a stale
    // one is refused (ranked_stakes_changed) — never retried with new stakes.
    const basis = typeof body.basis === "string" && body.basis ? body.basis : null;
    try {
      await store.claim(id, userId, name, basis, now().toISOString());
    } catch (error) {
      if (error instanceof StoreError && error.message.startsWith("ranked_stakes_changed:")) {
        // The new stakes, for the player to confirm again — not a claim.
        const fresh = await preview(store, id, userId).catch(() => null);
        return {
          status: 409,
          body: {
            error: error.message,
            code: "ranked_stakes_changed",
            ...(fresh ? { preview: fresh } : {}),
          },
        };
      }
      throw error;
    }
  }

  const match = await store.match(id);
  if (!match) return refuse(404, "ranked_room_not_found", "Ranked room not found.");
  if (match.player_a_id !== userId && match.player_b_id !== userId)
    return refuse(403, "ranked_not_a_player", "Only players can open this match.");

  if (operation === "cancel") {
    if (
      (match.status !== "waiting" && match.status !== "matched") ||
      (match.status === "waiting" && match.player_a_id !== userId)
    )
      return refuse(403, "ranked_match_started", "This match has already started.");
    if ((await store.deleteUnstarted(id)) === 0)
      return refuse(409, "ranked_match_started", "This room has already started.");
    return { status: 200, body: { cancelled: true } };
  }

  if (operation === "ready") {
    if (!(await store.ready(id, userId, now().toISOString())))
      return refuse(409, "ranked_cannot_ready", "This match cannot be readied.");
    const updated = await store.match(id);
    if (!updated) return refuse(404, "ranked_room_not_found", "Ranked room not found.");
    return {
      status: 200,
      body: { match: await viewFor(store, id, updated.revision, updated.state, userId) },
    };
  }

  if (operation === "read" || operation === "join") {
    const at = now().toISOString();
    const settled = settleRankedClock(match.state, at);
    if (settled.status === "finished" && match.status === "playing") {
      if (!(await commit(store, id, match.revision, settled)))
        return refuse(409, "ranked_position_changed", "Position changed; refresh the match.");
      return {
        status: 200,
        body: { match: await viewFor(store, id, match.revision + 1, settled, userId) },
      };
    }
    return {
      status: 200,
      body: { match: await viewFor(store, id, match.revision, settled, userId) },
    };
  }

  if (operation === "action") {
    if (match.revision !== body.revision)
      return refuse(409, "ranked_position_changed", "Position changed; refresh the match.");
    const side = match.player_a_id === userId ? "A" : "B";
    const action = body.action as RankedAction;
    if (!action || !["place", "exchange", "pass", "resign"].includes(action.kind))
      return INVALID("Unknown action.");
    let next: GameState;
    try {
      next = applyRankedAction(match.state, side, action, now().toISOString());
    } catch (error) {
      throw new RuleError(error instanceof Error ? error.message : "Invalid action.");
    }
    if (!(await commit(store, id, match.revision, next)))
      return refuse(409, "ranked_position_changed", "Position changed; refresh the match.");
    return {
      status: 200,
      body: { match: await viewFor(store, id, match.revision + 1, next, userId) },
    };
  }
  return INVALID("Unknown operation.");
}

/** What the viewer's rating would become, exactly as the database computed it. */
async function preview(
  store: RankedStore,
  id: string,
  userId: string,
): Promise<RankedStakePreview> {
  const stakes = rankedStakesFromRow(await store.stakes(id, userId));
  const [match, names] = await Promise.all([store.match(id), store.names([stakes.opponentId])]);
  if (!match) throw new StoreError("ranked_room_not_found: no such Ranked room");
  return rankedStakePreview(stakes, names.get(stakes.opponentId) ?? "Player", match.minutes_a);
}

async function commit(
  store: RankedStore,
  id: string,
  revision: number,
  game: GameState,
): Promise<boolean> {
  const result = resultOf(game);
  return store.commit(
    id,
    revision,
    game,
    result ? (result.winner ?? "draw") : null,
    result?.reason ?? null,
  );
}

async function viewFor(
  store: RankedStore,
  id: string,
  revision: number,
  game: GameState,
  userId: string,
) {
  const view = rankedPublicView(id, revision, game, userId);
  if (game.status !== "finished") return view;
  const data = await store.result(id);
  if (!data || !view.yourSide) return view;
  return {
    ...view,
    ratingChange:
      view.yourSide === "A"
        ? { before: data.rating_a_before, after: data.rating_a_after }
        : { before: data.rating_b_before, after: data.rating_b_after },
  };
}
