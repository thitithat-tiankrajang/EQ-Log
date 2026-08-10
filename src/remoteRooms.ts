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
const LIVE_READ_FIELDS = `${LIVE_SUMMARY_FIELDS},state,session`;
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
  "session",
  "created_at",
  "updated_at",
];
const ARCHIVE_READ_FIELDS =
  "game_id,name,player_a,player_b,game_mode,mode_key,turn_number,score_a,score_b,snapshot,created_at,finished_at";

const latestLiveSessions = new Map<string, LiveRoomSession>();
const liveWriteDrains = new Map<string, Promise<void>>();
const roomWriteQueues = new Map<string, Promise<void>>();

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
  // Confirm the initial state and session through the same atomic write path
  // used during play. This also repairs a room created by an older database
  // function that returned an id before persisting its state.
  await updateRoomState({ id, game: initialGame, session });
  const payload = await readRoom(id);
  if (!payload) throw new Error("The live game could not be loaded after creation.");
  if (payload.meta.ownerId && payload.meta.ownerId !== ownerId) {
    throw new Error("The live game owner did not match the signed-in account.");
  }
  if (roomCode) payload.meta.roomCode = roomCode;
  return { id, meta: payload.meta, game: payload.game };
}

export function updateRoomState(args: {
  id: string;
  game: GameState;
  session: LiveRoomSession;
  event?: RoomSessionEvent;
}): Promise<void> {
  return enqueueRoomWrite(args.id, async () => {
    if (!supabase) return;
    if (args.game.status === "finished") {
      const completion = deriveCompletion(args.game);
      const { error } = await supabase.rpc("finalize_live_game", {
        target_game_id: args.id,
        target_state: encodeGame(args.game),
        target_completion_kind: completion.kind,
        target_completion_reason: completion.reason,
        target_surrendered_side: completion.surrenderedSide,
      });
      if (error) throw schemaError(error.message);
      return;
    }
    const { error } = await supabase.rpc("sync_live_game_state", {
      target_game_id: args.id,
      target_state: encodeGame(args.game),
      target_session: args.session,
    });
    if (error) throw schemaError(error.message);
  });
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
  const playerUserIds = {
    ...(row.invite_user_a_id ? { A: row.invite_user_a_id } : {}),
    ...(row.invite_user_b_id ? { B: row.invite_user_b_id } : {}),
  };
  return {
    ...game,
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

function enqueueRoomWrite(id: string, task: () => Promise<void>): Promise<void> {
  const previous = roomWriteQueues.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  roomWriteQueues.set(id, next);
  const cleanup = () => {
    if (roomWriteQueues.get(id) === next) roomWriteQueues.delete(id);
  };
  void next.then(cleanup, cleanup);
  return next;
}

function schemaError(message: string): Error {
  if (
    /sync_live_game_state/i.test(message) &&
    /does not exist|schema cache|PGRST20|42883/i.test(message)
  ) {
    return new Error(
      "Live game sync needs an upgrade. Run supabase/live_game_sync_repair_migration.sql.",
    );
  }
  if (
    /does not exist|schema cache|PGRST20|create_live_game|finalize_live_game|sync_live_game|update_live_game|cancel_live_game|join_live_game/i.test(
      message,
    )
  ) {
    return new Error(
      "Live game storage is not enabled yet. Run supabase/game_archives_migration.sql.",
    );
  }
  return new Error(message);
}
