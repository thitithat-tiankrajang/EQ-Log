import { BOARD_SIZE, RACK_SIZE } from "../constants/gameRules";
import {
  getAssignmentOptions,
  getRack,
  tileNeedsAssignment,
  type AmathToken,
  type GameState,
  type Side,
} from "../game";

/**
 * Phase B — trusted tentative live sync. The protocol, shared by the trusted
 * relay (Edge) and the browser. See docs/phase-b-tentative-sync-protocol.md.
 *
 * The sender browser is untrusted: it PROPOSES its whole current public
 * tentative set; the relay validates that proposal against the authoritative
 * game and forwards a message it builds itself — never the sender's JSON.
 *
 *   proposal (browser → relay)   { id, revision, seq, tiles: [{ tileId, row, col, face? }] }
 *   message  (relay → opponent)  { gameId, revision, seq, side, tiles: [{ row, col, kind, face? }] }
 *
 * - Snapshot, not operations: every message is the complete current set, so a
 *   dropped, duplicated or reordered message is corrected by the next one, and
 *   CLEAR is simply the empty set.
 * - Epoch = the authoritative `room_live.revision`. Any commit (move, Pass,
 *   Exchange, control, host action, completion) advances it, so a message from
 *   an older epoch can never be shown on the newer board.
 * - Order within an epoch = `seq`, chosen by the sender, strictly increasing;
 *   the receiver keeps only the highest.
 * - Tile ids go to the relay (to prove ownership) and stop there; the opponent
 *   receives only what a physical board shows: square, tile kind, and the
 *   chosen face of an alternative tile once it has one.
 */

export const TENTATIVE_LIMITS = {
  /** Largest proposal body accepted, in bytes. */
  maxBodyBytes: 2048,
  /** seq is a microsecond-scale timestamp: not older than this, not ahead of the server by more. */
  maxSeqAgeMs: 10 * 60 * 1000,
  maxSeqLeadMs: 60 * 1000,
  /** Per sender and game: token bucket. */
  burst: 20,
  perSecond: 10,
} as const;

export type TentativeProposalTile = { tileId: string; row: number; col: number; face?: string };
export type TentativeProposal = {
  id: string;
  revision: number;
  seq: number;
  tiles: TentativeProposalTile[];
};
export type PublicTentativeTile = { row: number; col: number; kind: AmathToken; face?: string };
export type TentativeMessage = {
  gameId: string;
  revision: number;
  seq: number;
  side: Side;
  tiles: PublicTentativeTile[];
};

/** Authoritative facts the relay needs; read by the server, never from the request. */
export type TentativeFacts = {
  id: string;
  revision: number;
  mode: string;
  purpose: string;
  authorityProtocol: string;
  seats: Partial<Record<Side, string | null>>;
};

/**
 * V1 runs only for ONLINE human-v-human games: two authenticated seats on their
 * own devices, server authority. Off for Pass & Play (one device), Hosted /
 * Physical (a host and recorded draws), Solo, bots, Stage, and Ranked (its own
 * authority path; not enabled in V1).
 */
export function tentativeSyncAllowed(facts: TentativeFacts, game: GameState): boolean {
  return (
    facts.authorityProtocol === "server-v1" &&
    facts.purpose === "normal" &&
    facts.mode === "online_versus" &&
    game.emailPlayMode === "direct" &&
    game.gameMode !== "solo" &&
    !game.botSide &&
    Boolean(facts.seats.A && facts.seats.B && facts.seats.A !== facts.seats.B)
  );
}

export type TentativeVerdict =
  | { ok: true; message: TentativeMessage; recipient: string }
  | { ok: false; status: number; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROPOSAL_KEYS = new Set(["operation", "id", "revision", "seq", "tiles"]);
const TILE_KEYS = new Set(["tileId", "row", "col", "face"]);
const fail = (status: number, error: string): TentativeVerdict => ({ ok: false, status, error });

/** Shape only: strict keys, bounded sizes. Everything else is checked against the game. */
export function parseTentativeProposal(body: unknown): TentativeProposal | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  if (!Object.keys(raw).every((key) => PROPOSAL_KEYS.has(key))) return null;
  const { id, revision, seq, tiles } = raw;
  if (typeof id !== "string" || !UUID.test(id)) return null;
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) return null;
  if (!Number.isSafeInteger(seq) || (seq as number) <= 0) return null;
  if (!Array.isArray(tiles) || tiles.length > RACK_SIZE) return null;
  const parsed: TentativeProposalTile[] = [];
  for (const item of tiles) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const tile = item as Record<string, unknown>;
    if (!Object.keys(tile).every((key) => TILE_KEYS.has(key))) return null;
    if (typeof tile.tileId !== "string" || tile.tileId.length > 32) return null;
    if (!Number.isInteger(tile.row) || !Number.isInteger(tile.col)) return null;
    if (tile.face !== undefined && (typeof tile.face !== "string" || tile.face.length > 4))
      return null;
    parsed.push({
      tileId: tile.tileId,
      row: tile.row as number,
      col: tile.col as number,
      ...(tile.face !== undefined ? { face: tile.face as string } : {}),
    });
  }
  return { id, revision: revision as number, seq: seq as number, tiles: parsed };
}

/**
 * The trusted check. `actorId` comes from the verified JWT; `facts` and `game`
 * from the authoritative row. Returns the public message and its one recipient.
 */
export function validateTentative(
  actorId: string,
  facts: TentativeFacts,
  game: GameState,
  proposal: TentativeProposal,
  now: number,
): TentativeVerdict {
  const seated = facts.seats.A === actorId ? "A" : facts.seats.B === actorId ? "B" : null;
  if (!seated) return fail(403, "Not a seated player.");
  if (!tentativeSyncAllowed(facts, game)) return fail(403, "Tentative sync is off for this game.");
  if (game.status !== "playing" || game.roomStage !== "playing" || game.timers.paused)
    return fail(409, "The game is not in play.");
  if (proposal.revision !== facts.revision) return fail(409, "Stale revision.");
  if (game.activeSide !== seated) return fail(409, "Not your turn.");
  if (game.phase !== "choose_action") return fail(409, "Not your turn.");
  const seqMs = proposal.seq / 1000;
  if (seqMs < now - TENTATIVE_LIMITS.maxSeqAgeMs || seqMs > now + TENTATIVE_LIMITS.maxSeqLeadMs)
    return fail(400, "Invalid sequence.");
  const rack = new Map(getRack(game, seated).map((tile) => [tile.id, tile]));
  const ids = new Set<string>();
  const squares = new Set<string>();
  const tiles: PublicTentativeTile[] = [];
  for (const item of proposal.tiles) {
    const tile = rack.get(item.tileId);
    if (!tile) return fail(400, "A tile is not in your rack.");
    if (ids.has(item.tileId)) return fail(400, "A tile is used twice.");
    ids.add(item.tileId);
    if (item.row < 0 || item.col < 0 || item.row >= BOARD_SIZE || item.col >= BOARD_SIZE)
      return fail(400, "Invalid square.");
    const square = `${item.row}:${item.col}`;
    if (squares.has(square) || game.board[item.row]?.[item.col])
      return fail(400, "Square is not free.");
    squares.add(square);
    if (item.face !== undefined) {
      if (!tileNeedsAssignment(tile.token)) return fail(400, "This tile has no face to choose.");
      if (!getAssignmentOptions(tile.token).includes(item.face))
        return fail(400, "Invalid face for this tile.");
    }
    tiles.push({
      row: item.row,
      col: item.col,
      kind: tile.token,
      ...(item.face !== undefined ? { face: item.face } : {}),
    });
  }
  const recipient = facts.seats[seated === "A" ? "B" : "A"]!;
  return {
    ok: true,
    recipient,
    message: { gameId: facts.id, revision: facts.revision, seq: proposal.seq, side: seated, tiles },
  };
}

/** Per-sender token bucket (relay side). Returns false when the sender must slow down. */
export function createRateLimiter(limits = TENTATIVE_LIMITS) {
  const buckets = new Map<string, { tokens: number; at: number }>();
  return (key: string, now: number) => {
    const bucket = buckets.get(key) ?? { tokens: limits.burst, at: now };
    bucket.tokens = Math.min(
      limits.burst,
      bucket.tokens + ((now - bucket.at) / 1000) * limits.perSecond,
    );
    bucket.at = now;
    buckets.set(key, bucket);
    if (buckets.size > 10_000) buckets.delete(buckets.keys().next().value!);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  };
}

// ── Receiver ────────────────────────────────────────────────────────────────

/** The newest accepted message for the opponent's current or a later epoch. */
export type RemoteTentativeState = TentativeMessage | null;

/**
 * Keep a message only if it is from the current epoch or newer, and newer than
 * what is held for its epoch. Older epochs, older or duplicate seqs: ignored.
 */
export function receiveTentative(
  held: RemoteTentativeState,
  message: TentativeMessage,
  revision: number,
): RemoteTentativeState {
  if (message.revision < revision) return held;
  if (held && message.revision < held.revision) return held;
  if (held && message.revision === held.revision && message.seq <= held.seq) return held;
  return message;
}

/** What to draw: only a message from exactly the board's epoch, never from the viewer's own seat. */
export function visibleTentative(
  held: RemoteTentativeState,
  revision: number,
  viewerSide: Side | null,
): PublicTentativeTile[] {
  if (!held || held.revision !== revision || held.side === viewerSide) return [];
  return held.tiles;
}

/** A unique, increasing sequence per sender: microseconds since the epoch, never repeating. */
export function createSequence(clock: () => number = () => Date.now()) {
  let last = 0;
  return () => {
    last = Math.max(last + 1, Math.floor(clock() * 1000));
    return last;
  };
}
