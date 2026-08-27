import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { decodeGame, encodeGame } from "./codec";
import {
  type ActionType,
  type GameMode,
  type GameState,
  type PendingPlacement,
  type Side,
} from "./game";
import type { RoomMeta } from "./rooms";
import { supabase } from "./supabaseClient";
import type { RoomScope, RoomVisibility } from "./roomScope";
import { deriveCompletion, deriveModeKey } from "./features/gameRecords/domain";
import { revisionOf, withRevision } from "./gameSync";
import { canonicalFromSnapshot, encodeCanonical } from "./domain/projection";

type ActionMode = "none" | ActionType;

export type LiveRoomSession = {
  version: 1;
  actorId: string | null;
  gameId: string | null;
  turnNumber: number | null;
  activeSide: Side | null;
  actionMode: ActionMode;
  pendingPlacements: PendingPlacement[];
  exchangeDraft: {
    outgoingIds: string[];
    incomingTiles: GameState["tilebag"];
  };
  selectedRackTileId: string | null;
  selectedPendingTileId: string | null;
  updatedAt: string;
};

export type LiveAccessScope = "public" | "region" | "private";
export type ArchivePolicy = "public" | "region" | "private" | "none";
export type JoinPolicy = "open" | "code_only" | "invite_only";

export type CreateRoomPolicy = {
  accessScope: LiveAccessScope;
  archivePolicy: ArchivePolicy;
  joinPolicy: JoinPolicy;
  regionId: string | null;
  privateParentId?: string | null;
};

export type RemoteRoomRecord = {
  id: string;
  owner_id: string | null;
  name: string;
  player_a: string;
  player_b: string;
  status: GameState["status"];
  lifecycle_status?: GameState["status"] | null;
  game_mode?: GameMode | null;
  mode_key?: string | null;
  member_a_id?: string | null;
  member_b_id?: string | null;
  invite_user_a_id?: string | null;
  invite_user_b_id?: string | null;
  starting_side?: Side | null;
  creator_side?: Side | null;
  turn_number: number;
  score_a: number;
  score_b: number;
  state?: unknown;
  /** Authoritative position of the live game. */
  revision?: number;
  created_at: string;
  updated_at: string;
  visibility?: RoomVisibility;
  access_scope?: LiveAccessScope;
  archive_policy?: ArchivePolicy;
  join_policy?: JoinPolicy;
  room_code?: string | null;
  region_id?: string | null;
  profiles?: { display_name: string | null } | { display_name: string | null }[] | null;
};

type LiveRoomRow = {
  room_id: string;
  owner_id: string | null;
  name: string;
  player_a: string;
  player_b: string;
  status: "waiting" | "playing" | "paused";
  access_scope: LiveAccessScope;
  archive_policy: ArchivePolicy;
  join_policy: JoinPolicy;
  region_id: string | null;
  game_mode: GameMode;
  mode_key: string;
  member_a_id: string | null;
  member_b_id: string | null;
  player_a_user_id: string | null;
  player_b_user_id: string | null;
  starting_side: Side;
  creator_side: Side | null;
  turn_number: number;
  score_a: number;
  score_b: number;
  state?: unknown;
  revision?: number;
  session?: unknown;
  created_at: string;
  updated_at: string;
  profiles?: RemoteRoomRecord["profiles"];
};

type LiveRoomSummaryRow = {
  room_id: string;
  name: string;
  player_a: string;
  player_b: string;
  status: "waiting" | "playing" | "paused";
  access_scope: LiveAccessScope;
  archive_policy: ArchivePolicy;
  join_policy: JoinPolicy;
  region_id: string | null;
  game_mode: GameMode;
  mode_key: string;
  starting_side: Side;
  turn_number: number;
  score_a: number;
  score_b: number;
  created_at: string;
  updated_at: string;
  owner_name: string | null;
  viewer_role: "Owner" | "Admin" | "Player A" | "Player B" | "Spectator";
  can_manage: boolean;
  has_opponent: boolean;
};

type ArchiveRoomRow = {
  game_id: string;
  source_owner_id?: string | null;
  name: string;
  player_a: string;
  player_b: string;
  game_mode: GameMode;
  mode_key: string;
  turn_number: number;
  score_a: number;
  score_b: number;
  creator_side?: Side | null;
  snapshot: unknown;
  created_at: string;
  finished_at: string;
  region_id?: string | null;
};

export type RemoteRoomPayload = {
  game: GameState;
  meta: RoomMeta;
  session: LiveRoomSession;
  needsCompaction: boolean;
  needsInviteRepair: boolean;
};

export type RoomSessionEvent =
  | "create"
  | "state"
  | "submit_action"
  | "undo"
  | "redo"
  | "end_game"
  | "resume_game"
  | "timer_toggle"
  | "stop_request"
  | "stop_response"
  | "stop_game"
  | "surrender"
  | "manual_score"
  | "note"
  | "rename"
  | "import"
  | "delete";

const LIVE_SUMMARY_FIELDS =
  "room_id,owner_id,name,player_a,player_b,status,access_scope,archive_policy,join_policy,region_id,game_mode,mode_key,member_a_id,member_b_id,player_a_user_id,player_b_user_id,starting_side,creator_side,turn_number,score_a,score_b,created_at,updated_at,profiles:owner_id(display_name)";
const LIVE_READ_FIELDS = `${LIVE_SUMMARY_FIELDS},state,revision,session`;
const LIVE_REALTIME_COLUMNS = [
  "room_id",
  "owner_id",
  "name",
  "player_a",
  "player_b",
  "status",
  "access_scope",
  "archive_policy",
  "join_policy",
  "region_id",
  "game_mode",
  "mode_key",
  "member_a_id",
  "member_b_id",
  "player_a_user_id",
  "player_b_user_id",
  "starting_side",
  "creator_side",
  "turn_number",
  "score_a",
  "score_b",
  "state",
  "revision",
  "session",
  "created_at",
  "updated_at",
];
const ARCHIVE_READ_FIELDS =
  "game_id,name,player_a,player_b,game_mode,mode_key,turn_number,score_a,score_b,snapshot,created_at,finished_at";

const latestLiveSessions = new Map<string, LiveRoomSession>();
const liveWriteDrains = new Map<string, Promise<void>>();
const roomWriteQueues = new Map<string, Promise<unknown>>();

export function makeLiveSession(args: {
  actorId: string | null;
  gameId: string | null;
  turnNumber: number | null;
  activeSide: Side | null;
  actionMode: ActionMode;
  pendingPlacements: PendingPlacement[];
  exchangeDraft: LiveRoomSession["exchangeDraft"];
  selectedRackTileId: string | null;
  selectedPendingTileId: string | null;
}): LiveRoomSession {
  return {
    version: 1,
    actorId: args.actorId,
    gameId: args.gameId,
    turnNumber: args.turnNumber,
    activeSide: args.activeSide,
    actionMode: args.actionMode,
    pendingPlacements: args.pendingPlacements,
    exchangeDraft: args.exchangeDraft,
    selectedRackTileId: args.selectedRackTileId,
    selectedPendingTileId: args.selectedPendingTileId,
    updatedAt: new Date().toISOString(),
  };
}

export function emptyLiveSession(actorId: string | null = null): LiveRoomSession {
  return makeLiveSession({
    actorId,
    gameId: null,
    turnNumber: null,
    activeSide: null,
    actionMode: "none",
    pendingPlacements: [],
    exchangeDraft: { outgoingIds: [], incomingTiles: [] },
    selectedRackTileId: null,
    selectedPendingTileId: null,
  });
}

export async function listRooms(scope: RoomScope): Promise<RoomMeta[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("list_live_games", {
    target_access_scope: scope.visibility,
    target_region_id: scope.regionId,
  });
  if (error) throw schemaError(error.message);
  return ((data ?? []) as LiveRoomSummaryRow[]).map(metaFromSummaryRow);
}

export async function listPrivateRooms(): Promise<RoomMeta[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("list_live_games", {
    target_access_scope: "private",
    target_region_id: null,
  });
  if (error) throw schemaError(error.message);
  return ((data ?? []) as LiveRoomSummaryRow[]).map(metaFromSummaryRow);
}

export async function readRoom(id: string): Promise<RemoteRoomPayload | null> {
  if (!supabase) return null;
  const liveResult = await supabase
    .from("room_live")
    .select(LIVE_READ_FIELDS)
    .eq("room_id", id)
    .maybeSingle();
  if (liveResult.error) throw schemaError(liveResult.error.message);
  if (liveResult.data) {
    const payload = payloadFromRow(normalizeLiveRow(liveResult.data as unknown as LiveRoomRow));
    const { data: roomCode } = await supabase.rpc("get_live_game_code", { target_game_id: id });
    payload.meta.roomCode = typeof roomCode === "string" ? roomCode : null;
    return payload;
  }

  const publicResult = await supabase
    .from("public_game_snapshots")
    .select(ARCHIVE_READ_FIELDS)
    .eq("game_id", id)
    .maybeSingle();
  if (publicResult.error) throw schemaError(publicResult.error.message);
  if (publicResult.data)
    return payloadFromArchive(publicResult.data as unknown as ArchiveRoomRow, "public");

  const regionResult = await supabase
    .from("region_game_snapshots")
    .select(`${ARCHIVE_READ_FIELDS},region_id`)
    .eq("game_id", id)
    .maybeSingle();
  if (regionResult.error) throw schemaError(regionResult.error.message);
  if (regionResult.data)
    return payloadFromArchive(regionResult.data as unknown as ArchiveRoomRow, "region");

  const privateResult = await supabase
    .from("private_library_items")
    .select(
      "game_id,name,game_mode,mode_key,turn_number,score_a,score_b,snapshot,created_at,updated_at",
    )
    .eq("item_type", "game")
    .eq("game_id", id)
    .is("trashed_at", null)
    .limit(1)
    .maybeSingle();
  if (privateResult.error) throw schemaError(privateResult.error.message);
  if (!privateResult.data) return null;
  const privateRow = privateResult.data as unknown as {
    game_id: string;
    name: string;
    game_mode: GameMode;
    mode_key: string;
    turn_number: number;
    score_a: number;
    score_b: number;
    snapshot: unknown;
    created_at: string;
    updated_at: string;
  };
  const decoded = decodeGame(privateRow.snapshot as Parameters<typeof decodeGame>[0]);
  return payloadFromArchive(
    {
      ...privateRow,
      player_a: decoded.players.A,
      player_b: decoded.players.B,
      finished_at: privateRow.updated_at,
    },
    "public",
    "private",
  );
}

export async function createRoom(
  game: GameState,
  ownerId: string,
  session: LiveRoomSession,
  scope: RoomScope,
  policy?: CreateRoomPolicy,
): Promise<{ id: string; meta: RoomMeta; game: GameState }> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const initialGame = assignOwnerToReservedSide(game, ownerId);
  const resolvedPolicy: CreateRoomPolicy =
    policy ??
    (scope.visibility === "region"
      ? {
          accessScope: "region",
          archivePolicy: "region",
          joinPolicy: hasAssignedPlayers(game) ? "invite_only" : "open",
          regionId: scope.regionId,
        }
      : {
          accessScope: "public",
          archivePolicy: "public",
          joinPolicy: hasAssignedPlayers(game) ? "invite_only" : "open",
          regionId: null,
        });
  const { data, error } = await supabase.rpc("create_live_game", {
    target_state: encodeGame(initialGame),
    target_access_scope: resolvedPolicy.accessScope,
    target_archive_policy: resolvedPolicy.archivePolicy,
    target_region_id: resolvedPolicy.regionId,
    target_join_policy: resolvedPolicy.joinPolicy,
    target_private_parent_id: resolvedPolicy.privateParentId ?? null,
  });
  if (error) throw schemaError(error.message);
  const result = Array.isArray(data) ? data[0] : data;
  const id = String((result as { room_id?: unknown } | null)?.room_id ?? "");
  const roomCode = String((result as { room_code?: unknown } | null)?.room_code ?? "");
  if (!id) throw new Error("The live game was created without an id.");
  // Confirm the initial state and session through the same conditional write
  // path used during play. This also repairs a room created by an older
  // database function that returned an id before persisting its state.
  await commitRoomState({ id, game: initialGame, session, event: "create" });
  const payload = await readRoom(id);
  if (!payload) throw new Error("The live game could not be loaded after creation.");
  if (payload.meta.ownerId && payload.meta.ownerId !== ownerId) {
    throw new Error("The live game owner did not match the signed-in account.");
  }
  if (roomCode) payload.meta.roomCode = roomCode;
  return { id, meta: payload.meta, game: payload.game };
}

/**
 * The outcome of a conditional commit.
 *
 * `conflict` is not an error: it means another writer got to this revision
 * first and the caller must adopt authoritative state before trying again.
 * `duplicate` means this exact intent had already been committed — a retry
 * after a lost response — and is as good as success.
 */
export type CommitOutcome =
  | { outcome: "committed"; revision: number }
  | { outcome: "duplicate"; revision: number }
  | { outcome: "conflict"; revision: number };

export type CommitStateArgs = {
  id: string;
  game: GameState;
  session: LiveRoomSession;
  event?: RoomSessionEvent;
  /**
   * The revision this change was composed against. The server applies the
   * change only if the game is still at this revision. Defaults to the
   * revision carried by `game`, which is the one it was derived from.
   */
  expectedRevision?: number;
  /**
   * Stable per intent. A retry of the same intent MUST reuse it so the server
   * can recognize it and refuse to apply the same move twice. A fresh id per
   * call is correct only when each call really is a distinct intent.
   */
  commandId?: string;
  issuedBy?: Side | "host";
};

/**
 * Commit a change conditionally on the revision it was composed against.
 *
 * Alongside the rendered record this writes the canonical placement table: the
 * bounded, self-sufficient description of where all 100 physical tiles are. It
 * is derived here, which means a state that does not describe the physical set
 * throws before anything is sent rather than being persisted and distributed.
 */
export function commitRoomState(args: CommitStateArgs): Promise<CommitOutcome> {
  const expectedRevision = args.expectedRevision ?? revisionOf(args.game);
  const commandId = args.commandId ?? crypto.randomUUID();
  const issuedBy = args.issuedBy ?? "host";
  return enqueueRoomWrite(args.id, async () => {
    if (!supabase) return { outcome: "committed", revision: expectedRevision };
    const nextRevision = expectedRevision + 1;
    // Throws if `game` is not a lawful 100-tile position. Failing here keeps
    // an impossible state out of the database and off every other client.
    const canonical = encodeCanonical(canonicalFromSnapshot(args.game, nextRevision));

    if (args.game.status === "finished") {
      const completion = deriveCompletion(args.game);
      const { error } = await supabase.rpc("finalize_live_game", {
        target_game_id: args.id,
        target_state: encodeGame(withRevision(args.game, nextRevision)),
        target_completion_kind: completion.kind,
        target_completion_reason: completion.reason,
        target_surrendered_side: completion.surrenderedSide,
      });
      if (error) throw describeDatabaseError(error);
      return { outcome: "committed", revision: nextRevision };
    }

    const { data, error } = await supabase.rpc("commit_live_game_command", {
      target_game_id: args.id,
      target_expected_revision: expectedRevision,
      target_command_id: commandId,
      target_issued_by: issuedBy,
      target_command: { kind: args.event ?? "state" },
      target_canonical: canonical,
      target_canonical_digest: canonicalDigest(canonical),
      target_state: encodeGame(withRevision(args.game, nextRevision)),
      target_session: args.session,
    });
    if (error) throw describeDatabaseError(error);
    const row = (Array.isArray(data) ? data[0] : data) as {
      outcome?: string;
      revision?: number;
    } | null;
    const revision = Number(row?.revision ?? expectedRevision);
    if (row?.outcome === "conflict") return { outcome: "conflict", revision };
    if (row?.outcome === "duplicate") return { outcome: "duplicate", revision };
    return { outcome: "committed", revision };
  });
}

/** Digest of the canonical wire form. Two clients that agree on the physical
 *  position produce the same string, so disagreement is detectable. */
function canonicalDigest(canonical: Record<string, unknown>): string {
  const text = JSON.stringify(canonical);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function updateRoomSession(id: string, session: LiveRoomSession): Promise<void> {
  latestLiveSessions.set(id, session);
  const activeDrain = liveWriteDrains.get(id);
  if (activeDrain) return activeDrain;
  // State and draft writes share one room queue. Without this, an older draft
  // request can finish after a committed state write and leave spectators
  // rendering that stale draft on top of the new board.
  const drain = enqueueRoomWrite(id, () => drainLiveSessionWrites(id));
  liveWriteDrains.set(id, drain);
  const cleanup = () => {
    if (liveWriteDrains.get(id) === drain) liveWriteDrains.delete(id);
  };
  void drain.then(cleanup, cleanup);
  return drain;
}

export async function updateRoomReady(id: string, side: Side, ready: boolean): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc("set_room_ready", {
    target_ready: ready,
    target_room_id: id,
    target_side: side,
  });
  if (error) throw schemaError(error.message);
}

export async function joinRoom(args: {
  code?: string;
  gameId?: string;
}): Promise<{ id: string; claimedSide: Side | null }> {
  if (!supabase) throw new Error("Sign in to join a live game.");
  const { data, error } = await supabase.rpc("join_live_game", {
    target_room_code: args.code?.trim() || null,
    target_game_id: args.gameId ?? null,
  });
  if (error) throw schemaError(error.message);
  const result = Array.isArray(data) ? data[0] : data;
  const id = String((result as { room_id?: unknown } | null)?.room_id ?? "");
  const claimedSide = (result as { claimed_side?: Side | null } | null)?.claimed_side ?? null;
  if (!id) throw new Error("The live game could not be joined.");
  return { id, claimedSide };
}

export async function repairRoomInvites(id: string, game: GameState): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc("update_live_game_state", {
    target_game_id: id,
    target_state: encodeGame(game),
  });
  if (error) throw schemaError(error.message);
}

export async function deleteRoom(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc("cancel_live_game", { target_game_id: id });
  if (error) throw schemaError(error.message);
}

export type RoomChannelStatus = "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED";

/** One committed move, as broadcast to observers. */
export type LiveGameCommit = {
  revision: number;
  gameId: string;
  commandId: string;
  issuedBy: Side | "host";
  /** Canonical placement of all 100 tiles at `revision`. */
  canonical: unknown;
  canonicalDigest: string | null;
};

/**
 * Follow a game as a read-only observer.
 *
 * This is the spectator path, and it is deliberately not the player path. It
 * subscribes to a broadcast topic rather than to row changes, which matters at
 * scale for two reasons:
 *
 *   • The server publishes once per move. Row-change subscriptions re-evaluate
 *     access per subscriber per change, so authoritative write cost grows with
 *     the audience; a broadcast topic is authorized once, when the observer
 *     joins.
 *   • The payload is the canonical placement table — around a hundred short
 *     entries, the same size on move 200 as on move 1 — instead of the full
 *     record, which carries a board and two rack copies for every turn played
 *     and therefore grows with the length of the game.
 *
 * Each message is self-sufficient at its revision, so a missed message costs
 * nothing: the next one carries everything, and the caller's revision compare
 * stops an older one from landing on a newer one.
 */
export function subscribeToGameCommits(
  id: string,
  onCommit: (commit: LiveGameCommit) => void,
  onStatus?: (status: RoomChannelStatus) => void,
): () => void {
  const client = supabase;
  if (!client) return () => undefined;
  const channel = client
    .channel(`game:${id}`, { config: { private: true, broadcast: { self: false } } })
    .on("broadcast", { event: "commit" }, (message) => {
      const payload = (message as { payload?: Record<string, unknown> }).payload;
      if (!payload || payload.gameId !== id) return;
      const revision = Number(payload.revision);
      if (!Number.isFinite(revision)) return;
      onCommit({
        revision,
        gameId: id,
        commandId: String(payload.commandId ?? ""),
        issuedBy: (payload.issuedBy as Side | "host") ?? "host",
        canonical: payload.canonical,
        canonicalDigest:
          typeof payload.canonicalDigest === "string" ? payload.canonicalDigest : null,
      });
    })
    .subscribe((status) => onStatus?.(status as RoomChannelStatus));
  return () => {
    void client.removeChannel(channel);
  };
}

/**
 * The canonical head: one small row, the same one served to a joining
 * spectator, a refreshed tab and a reconnecting player, so those three paths
 * cannot drift apart.
 */
export async function readGameSnapshot(
  id: string,
): Promise<{ revision: number; canonical: unknown; digest: string | null } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_live_game_snapshot", { target_game_id: id });
  if (error) throw schemaError(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as {
    revision?: number;
    canonical?: unknown;
    canonical_digest?: string | null;
  } | null;
  if (!row || row.canonical == null) return null;
  return {
    revision: Number(row.revision ?? 0),
    canonical: row.canonical,
    digest: row.canonical_digest ?? null,
  };
}

export function subscribeToRoom(
  id: string,
  onState: (payload: RealtimePostgresChangesPayload<RemoteRoomRecord>) => void,
  onSession: (session: LiveRoomSession) => void,
  onStatus?: (status: RoomChannelStatus) => void,
): () => void {
  const client = supabase;
  if (!client) return () => undefined;
  const realtimeFilter = {
    event: "*" as const,
    schema: "public",
    table: "room_live",
    filter: `room_id=eq.${id}`,
    select: LIVE_REALTIME_COLUMNS,
  };
  // Realtime supports column selection before the installed client types expose it.
  const typedRealtimeFilter = realtimeFilter as Omit<typeof realtimeFilter, "select">;
  const channel = client
    .channel(`live-game:${id}`)
    .on("postgres_changes", typedRealtimeFilter, (raw) => {
      const hasCompleteState = raw.new && isCompleteLiveRoomRow(raw.new);
      if (raw.eventType === "DELETE" || hasCompleteState) {
        const next = hasCompleteState ? normalizeLiveRow(raw.new as LiveRoomRow) : raw.new;
        const previous =
          raw.old && isCompleteLiveRoomRow(raw.old)
            ? normalizeLiveRow(raw.old as LiveRoomRow)
            : raw.old;
        onState({
          ...raw,
          new: next,
          old: previous,
        } as RealtimePostgresChangesPayload<RemoteRoomRecord>);
      }
      if (raw.new && "session" in raw.new) {
        onSession(parseSession((raw.new as unknown as LiveRoomRow).session));
      }
    })
    .subscribe((status) => onStatus?.(status as RoomChannelStatus));
  return () => {
    void client.removeChannel(channel);
  };
}

function isCompleteLiveRoomRow(value: object): value is LiveRoomRow {
  return LIVE_REALTIME_COLUMNS.every((column) => column in value);
}

export function payloadFromRow(row: RemoteRoomRecord): RemoteRoomPayload {
  if (!row.state) throw new Error("Live game state is missing.");
  const game = decodeRoomGame(row);
  return {
    game,
    meta: metaFromRow(row, game),
    session: parseSession((row as RemoteRoomRecord & { session?: unknown }).session),
    needsCompaction: false,
    needsInviteRepair: false,
  };
}

function payloadFromArchive(
  row: ArchiveRoomRow,
  visibility: RoomVisibility,
  accessScope: LiveAccessScope = visibility,
): RemoteRoomPayload {
  const game = decodeGame(row.snapshot as Parameters<typeof decodeGame>[0]);
  const meta: RoomMeta = {
    id: row.game_id,
    ownerId: row.source_owner_id ?? null,
    ownerName: null,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.finished_at,
    playerA: row.player_a,
    playerB: row.player_b,
    gameMode: row.game_mode,
    startingSide: game.startingSide,
    turnNumber: row.turn_number,
    scoreA: row.score_a,
    scoreB: row.score_b,
    status: "finished",
    visibility,
    regionId: row.region_id ?? null,
    accessScope,
    archivePolicy: accessScope === "private" ? "private" : visibility,
  };
  return {
    game,
    meta,
    session: emptyLiveSession(),
    needsCompaction: false,
    needsInviteRepair: false,
  };
}

function normalizeLiveRow(row: LiveRoomRow): RemoteRoomRecord {
  return {
    id: row.room_id,
    owner_id: row.owner_id,
    name: row.name,
    player_a: row.player_a,
    player_b: row.player_b,
    status: row.status === "waiting" || row.status === "paused" ? "draft" : "playing",
    lifecycle_status: row.status === "waiting" || row.status === "paused" ? "draft" : "playing",
    game_mode: row.game_mode,
    mode_key: row.mode_key,
    member_a_id: row.member_a_id,
    member_b_id: row.member_b_id,
    invite_user_a_id: row.player_a_user_id,
    invite_user_b_id: row.player_b_user_id,
    starting_side: row.starting_side,
    creator_side: row.creator_side,
    turn_number: row.turn_number,
    score_a: row.score_a,
    score_b: row.score_b,
    state: row.state,
    revision: row.revision,
    created_at: row.created_at,
    updated_at: row.updated_at,
    visibility: row.access_scope === "region" ? "region" : "public",
    access_scope: row.access_scope,
    archive_policy: row.archive_policy,
    join_policy: row.join_policy,
    region_id: row.region_id,
    profiles: row.profiles,
    session: row.session,
  } as RemoteRoomRecord & { session?: unknown };
}

function metaFromRow(row: RemoteRoomRecord, decoded?: GameState): RoomMeta {
  const owner = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  const game = decoded ?? (row.state ? decodeRoomGame(row) : null);
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerName: owner?.display_name ?? null,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    playerA: row.player_a,
    playerB: row.player_b,
    gameMode: row.game_mode ?? game?.gameMode ?? "versus",
    memberAId: row.member_a_id ?? game?.playerMembers?.A ?? null,
    memberBId: row.member_b_id ?? game?.playerMembers?.B ?? null,
    inviteUserAId: row.invite_user_a_id ?? game?.playerUserIds?.A ?? null,
    inviteUserBId: row.invite_user_b_id ?? game?.playerUserIds?.B ?? null,
    startingSide: row.starting_side ?? game?.startingSide ?? null,
    turnNumber: row.turn_number,
    scoreA: row.score_a,
    scoreB: row.score_b,
    status: game?.status ?? row.status,
    visibility: row.visibility ?? "public",
    regionId: row.region_id ?? null,
    accessScope: row.access_scope,
    archivePolicy: row.archive_policy,
    joinPolicy: row.join_policy,
    roomCode: row.room_code ?? null,
    modeKey: row.mode_key ?? (game ? deriveModeKey(game) : null),
  };
}

function metaFromSummaryRow(row: LiveRoomSummaryRow): RoomMeta {
  return {
    id: row.room_id,
    ownerId: null,
    ownerName: row.owner_name,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    playerA: row.player_a,
    playerB: row.player_b,
    gameMode: row.game_mode,
    startingSide: row.starting_side,
    turnNumber: row.turn_number,
    scoreA: row.score_a,
    scoreB: row.score_b,
    status: row.status === "playing" ? "playing" : "draft",
    visibility: row.access_scope === "region" ? "region" : "public",
    regionId: row.region_id,
    accessScope: row.access_scope,
    archivePolicy: row.archive_policy,
    joinPolicy: row.join_policy,
    modeKey: row.mode_key,
    hasOpponent: row.has_opponent,
    viewerRole: row.viewer_role,
    canManage: row.can_manage,
  };
}

function decodeRoomGame(row: RemoteRoomRecord): GameState {
  const game = decodeGame(row.state as Parameters<typeof decodeGame>[0]);
  // The row's revision is authoritative; the copy embedded in the stored state
  // is only a hint and is overwritten so the two can never disagree.
  const revision = Number.isFinite(row.revision) ? Number(row.revision) : (game.revision ?? 0);
  const playerUserIds = {
    ...(row.invite_user_a_id ? { A: row.invite_user_a_id } : {}),
    ...(row.invite_user_b_id ? { B: row.invite_user_b_id } : {}),
  };
  return {
    ...game,
    revision,
    playerUserIds,
    playerEmails: undefined,
    history: game.history.map((snapshot) => ({
      ...snapshot,
      playerUserIds,
      playerEmails: undefined,
    })),
  };
}

async function drainLiveSessionWrites(id: string): Promise<void> {
  while (latestLiveSessions.has(id)) {
    const session = latestLiveSessions.get(id);
    latestLiveSessions.delete(id);
    if (!session || !supabase) continue;
    const { error } = await supabase.rpc("update_live_game_session", {
      target_game_id: id,
      target_session: session,
    });
    if (error) throw schemaError(error.message);
  }
}

function parseSession(value: unknown): LiveRoomSession {
  if (!value || typeof value !== "object") return emptyLiveSession();
  const session = value as Partial<LiveRoomSession>;
  return {
    ...emptyLiveSession(session.actorId ?? null),
    ...session,
    version: 1,
    pendingPlacements: Array.isArray(session.pendingPlacements) ? session.pendingPlacements : [],
    exchangeDraft: session.exchangeDraft ?? { outgoingIds: [], incomingTiles: [] },
  };
}

function hasAssignedPlayers(game: GameState): boolean {
  return Boolean(game.playerUserIds?.A || game.playerUserIds?.B);
}

function assignOwnerToReservedSide(game: GameState, ownerId: string): GameState {
  const ownerSide: Side | null =
    game.gameMode === "solo" || game.botSide === "B" ? "A" : game.botSide === "A" ? "B" : null;
  if (!ownerSide || game.playerUserIds?.[ownerSide]) return game;
  return {
    ...game,
    playerUserIds: { ...game.playerUserIds, [ownerSide]: ownerId },
  };
}

function enqueueRoomWrite<T>(id: string, task: () => Promise<T>): Promise<T> {
  const previous = roomWriteQueues.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  roomWriteQueues.set(id, next as Promise<unknown>);
  const cleanup = () => {
    if (roomWriteQueues.get(id) === (next as Promise<unknown>)) roomWriteQueues.delete(id);
  };
  void next.then(cleanup, cleanup);
  return next;
}

function schemaError(message: string): Error {
  // The conditional commit path is the only write path. A deployment without
  // it cannot order concurrent moves, so say exactly what is missing rather
  // than falling back to a write that could overwrite a committed turn.
  if (
    /commit_live_game_command|get_live_game_snapshot|list_live_game_events/i.test(message) &&
    /does not exist|schema cache|PGRST20|42883/i.test(message)
  ) {
    return new Error(
      "Live game sync needs an upgrade. Run supabase/canonical_revision_migration.sql.",
    );
  }
  if (/unconditional state writes are no longer accepted/i.test(message)) {
    return new Error(
      "This client is out of date: live games now require a conditional commit. Reload the app.",
    );
  }
  if (
    /sync_live_game_state/i.test(message) &&
    /does not exist|schema cache|PGRST20|42883/i.test(message)
  ) {
    return new Error(
      "Live game sync needs an upgrade. Run supabase/live_game_sync_repair_migration.sql.",
    );
  }
  // Naming one of these functions is NOT on its own a sign that the schema is
  // missing — the same name appears in "permission denied for function ...",
  // in a signature mismatch, and in anything the function itself raises. This
  // branch used to fire on the name alone, which replaced every one of those
  // with an instruction to run a migration that was already applied: a precise
  // failure became a wrong answer, and the real message was lost. Both halves
  // are required, exactly as in the first branch above.
  if (
    /create_live_game|finalize_live_game|sync_live_game|update_live_game|cancel_live_game|join_live_game/i.test(
      message,
    ) &&
    /does not exist|schema cache|PGRST20|42883/i.test(message)
  ) {
    return new Error(
      "Live game storage is not enabled yet. Run supabase/game_archives_migration.sql.",
    );
  }
  // A schema signal with no function name still means what it says.
  if (/schema cache|PGRST20/i.test(message)) {
    return new Error(
      "Live game storage is not enabled yet. Run supabase/game_archives_migration.sql.",
    );
  }
  return new Error(message);
}

/**
 * Everything Postgres said, not just the sentence.
 *
 * A `PostgrestError` carries `code`, `details` and `hint` alongside `message`,
 * and passing the message alone throws away the half that identifies WHICH rule
 * refused — `23514` (a check constraint) and `42501` (permission) read very
 * differently to anyone diagnosing a failure, and neither is visible in the
 * sentence a `raise` produces.
 */
function describeDatabaseError(error: {
  message: string;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
}): Error {
  const parts = [error.message];
  if (error.details) parts.push(error.details);
  if (error.hint) parts.push(error.hint);
  const suffix = error.code ? ` [${error.code}]` : "";
  return schemaError(`${parts.join(" — ")}${suffix}`);
}
