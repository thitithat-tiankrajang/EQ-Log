import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { decodeGame, encodeGame } from "./codec";
import { getGameMode, type ActionType, type GameMode, type GameState, type GameStatus, type PendingPlacement, type Side } from "./game";
import type { RoomMeta } from "./rooms";
import { supabase } from "./supabaseClient";
import { REMOTE_CAPABILITIES_TTL_MS } from "./constants/network";
import { STORAGE_KEYS } from "./constants/storage";

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

export type RemoteRoomRecord = {
  id: string;
  owner_id: string | null;
  name: string;
  player_a: string;
  player_b: string;
  status: GameState["status"];
  lifecycle_status?: GameState["status"] | null;
  game_mode?: GameMode | null;
  member_a_id?: string | null;
  member_b_id?: string | null;
  invite_email_a?: string | null;
  invite_email_b?: string | null;
  starting_side?: "A" | "B" | null;
  turn_number: number;
  score_a: number;
  score_b: number;
  state?: unknown;
  created_at: string;
  updated_at: string;
  profiles?:
    | { display_name: string | null; email: string | null }
    | { display_name: string | null; email: string | null }[]
    | null;
};

type RemoteRoomLiveRecord = {
  room_id: string;
  session: unknown;
  updated_at: string;
};

type DatabaseResult = {
  data: unknown;
  error: { code?: string; message: string; details?: string } | null;
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

const META_FIELDS =
  "id,owner_id,name,player_a,player_b,status,turn_number,score_a,score_b,created_at,updated_at,profiles:owner_id(display_name,email)";
const SUMMARY_FIELDS =
  "id,owner_id,name,player_a,player_b,status,lifecycle_status,game_mode,member_a_id,member_b_id,starting_side,turn_number,score_a,score_b,created_at,updated_at,profiles:owner_id(display_name,email)";
const INVITE_FIELDS = "invite_email_a,invite_email_b";
const READ_ROOM_FIELDS = `${META_FIELDS},state`;

type RemoteCapabilities = {
  summaryColumns?: boolean;
  liveRoom?: boolean;
  draftStatus?: boolean;
  inviteColumns?: boolean;
  checkedAt: number;
};

let remoteCapabilities = readRemoteCapabilities();
const stateWriteQueues = new Map<string, Promise<void>>();
const latestLiveSessions = new Map<string, LiveRoomSession>();
const liveWriteDrains = new Map<string, Promise<void>>();

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

export async function listRooms(): Promise<RoomMeta[]> {
  if (!supabase) return [];
  const useSummary = remoteCapabilities.summaryColumns !== false;
  const useInvite = remoteCapabilities.inviteColumns !== false;
  const selectFields = buildSelectFields({ summary: useSummary, invite: useInvite });
  let result: DatabaseResult = await supabase
    .from("rooms")
    .select(selectFields)
    .order("updated_at", { ascending: false });
  if (useInvite && result.error && isMissingInviteColumnsError(result.error)) {
    setRemoteCapability("inviteColumns", false);
    result = await supabase
      .from("rooms")
      .select(buildSelectFields({ summary: useSummary, invite: false }))
      .order("updated_at", { ascending: false });
  } else if (useInvite && !result.error) {
    setRemoteCapability("inviteColumns", true);
  }
  if (useSummary && result.error && isMissingSummarySchemaError(result.error)) {
    setRemoteCapability("summaryColumns", false);
    result = await supabase.from("rooms").select(META_FIELDS).order("updated_at", { ascending: false });
  } else if (useSummary && !result.error) {
    setRemoteCapability("summaryColumns", true);
  }
  if (result.error) throw result.error;
  return ((result.data ?? []) as unknown as RemoteRoomRecord[]).map(metaFromRow);
}

function buildSelectFields({ summary, invite }: { summary: boolean; invite: boolean }): string {
  const base = summary ? SUMMARY_FIELDS : META_FIELDS;
  return invite ? `${base},${INVITE_FIELDS}` : base;
}

export async function readRoom(id: string): Promise<RemoteRoomPayload | null> {
  if (!supabase) return null;
  const sessionPromise = readLiveSession(id);
  const useInvite = remoteCapabilities.inviteColumns !== false;
  const fields = useInvite ? `${READ_ROOM_FIELDS},${INVITE_FIELDS}` : READ_ROOM_FIELDS;
  let roomResult = await supabase.from("rooms").select(fields).eq("id", id).maybeSingle();
  if (useInvite && roomResult.error && isMissingInviteColumnsError(roomResult.error)) {
    setRemoteCapability("inviteColumns", false);
    roomResult = await supabase.from("rooms").select(READ_ROOM_FIELDS).eq("id", id).maybeSingle();
  } else if (useInvite && !roomResult.error) {
    setRemoteCapability("inviteColumns", true);
  }
  const session = await sessionPromise;
  if (roomResult.error) throw roomResult.error;
  if (!roomResult.data) return null;
  const row = roomResult.data as unknown as RemoteRoomRecord;
  return {
    game: decodeRoomGame(row),
    meta: metaFromRow(row),
    session,
    needsCompaction: getEncodedVersion(row.state) < 2,
    needsInviteRepair: rowNeedsInviteRepair(row),
  };
}

export async function createRoom(
  game: GameState,
  ownerId: string,
  session: LiveRoomSession,
): Promise<{ id: string; meta: RoomMeta }> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const databaseStatus = getDatabaseStatus(game.status);
  const basePayload = {
    ...roomStatePayload(game, databaseStatus),
    owner_id: ownerId,
  };
  const requiresInvite = hasRoomInvites(game);
  const useSummary = remoteCapabilities.summaryColumns !== false;
  const useInvite = requiresInvite || remoteCapabilities.inviteColumns !== false;
  const summaryFields = useSummary ? roomSummaryPayload(game) : {};
  const inviteFields = useInvite ? roomInvitePayload(game) : {};
  const insertPayload = { ...basePayload, ...summaryFields, ...inviteFields };
  let result: DatabaseResult = await supabase
    .from("rooms")
    .insert(insertPayload)
    .select(buildSelectFields({ summary: useSummary, invite: useInvite }))
    .single();

  if (useInvite && result.error && isMissingInviteColumnsError(result.error)) {
    setRemoteCapability("inviteColumns", false);
    if (requiresInvite) throw missingInviteSchemaError();
    const fallbackPayload = { ...basePayload, ...summaryFields };
    result = await supabase
      .from("rooms")
      .insert(fallbackPayload)
      .select(buildSelectFields({ summary: useSummary, invite: false }))
      .single();
  } else if (useInvite && !result.error) {
    setRemoteCapability("inviteColumns", true);
  }

  if (isDraftStatusConstraintError(result.error, databaseStatus)) {
    setRemoteCapability("draftStatus", false);
    // An old capability cache may say invite columns are unavailable even
    // though this insert just proved only the draft status was rejected.
    // Email rooms must retain their relational invite columns on retry.
    const retryPayload = useInvite
      ? { ...insertPayload, status: "playing" }
      : { ...basePayload, ...summaryFields, status: "playing" };
    result = await supabase
      .from("rooms")
      .insert(retryPayload)
      .select(buildSelectFields({ summary: useSummary, invite: useInvite }))
      .single();
    if (useInvite && !result.error) setRemoteCapability("inviteColumns", true);
  } else if (databaseStatus === "draft" && !result.error) {
    setRemoteCapability("draftStatus", true);
  }

  if (useSummary && result.error && isMissingSummarySchemaError(result.error)) {
    setRemoteCapability("summaryColumns", false);
    const legacyInvite = useInvite;
    const legacyPayload = legacyInvite ? { ...basePayload, ...inviteFields } : basePayload;
    const legacyFields = legacyInvite ? `${META_FIELDS},${INVITE_FIELDS}` : META_FIELDS;
    let legacy = await supabase.from("rooms").insert(legacyPayload).select(legacyFields).single();
    if (isDraftStatusConstraintError(legacy.error, databaseStatus)) {
      setRemoteCapability("draftStatus", false);
      legacy = await supabase
        .from("rooms")
        .insert({ ...legacyPayload, status: "playing" })
        .select(legacyFields)
        .single();
    }
    result = legacy;
  }
  if (result.error) throw result.error;
  const meta = metaFromRow(result.data as unknown as RemoteRoomRecord);
  await updateRoomSession(meta.id, session);
  return { id: meta.id, meta };
}

export function updateRoomState(args: {
  id: string;
  game: GameState;
  session: LiveRoomSession;
  event?: RoomSessionEvent;
}): Promise<void> {
  return enqueueRoomWrite(stateWriteQueues, args.id, async () => {
    if (!supabase) return;
    const databaseStatus = getDatabaseStatus(args.game.status);
    const basePayload = roomStatePayload(args.game, databaseStatus);
    const requiresInvite = hasRoomInvites(args.game);
    const useSummary = remoteCapabilities.summaryColumns !== false;
    const useInvite = requiresInvite || remoteCapabilities.inviteColumns !== false;
    const summaryFields = useSummary ? roomSummaryPayload(args.game) : {};
    const inviteFields = useInvite ? roomInvitePayload(args.game) : {};
    const updatePayload = { ...basePayload, ...summaryFields, ...inviteFields };
    let result = await supabase.from("rooms").update(updatePayload).eq("id", args.id);

    if (useInvite && result.error && isMissingInviteColumnsError(result.error)) {
      setRemoteCapability("inviteColumns", false);
      if (requiresInvite) throw missingInviteSchemaError();
      const fallbackPayload = { ...basePayload, ...summaryFields };
      result = await supabase.from("rooms").update(fallbackPayload).eq("id", args.id);
    } else if (useInvite && !result.error) {
      setRemoteCapability("inviteColumns", true);
    }

    if (isDraftStatusConstraintError(result.error, databaseStatus)) {
      setRemoteCapability("draftStatus", false);
      const retryPayload = useInvite
        ? { ...updatePayload, status: "playing" }
        : { ...basePayload, ...summaryFields, status: "playing" };
      result = await supabase.from("rooms").update(retryPayload).eq("id", args.id);
      if (useInvite && !result.error) setRemoteCapability("inviteColumns", true);
    } else if (databaseStatus === "draft" && !result.error) {
      setRemoteCapability("draftStatus", true);
    }

    if (useSummary && result.error && isMissingSummarySchemaError(result.error)) {
      setRemoteCapability("summaryColumns", false);
      const legacyPayload = useInvite ? { ...basePayload, ...inviteFields } : basePayload;
      let legacy = await supabase.from("rooms").update(legacyPayload).eq("id", args.id);
      if (isDraftStatusConstraintError(legacy.error, databaseStatus)) {
        setRemoteCapability("draftStatus", false);
        legacy = await supabase
          .from("rooms")
          .update({ ...legacyPayload, status: "playing" })
          .eq("id", args.id);
      }
      result = legacy;
    }
    if (result.error) throw result.error;
  });
}

export function updateRoomSession(id: string, session: LiveRoomSession): Promise<void> {
  latestLiveSessions.set(id, session);
  const activeDrain = liveWriteDrains.get(id);
  if (activeDrain) return activeDrain;
  const drain = drainLiveSessionWrites(id);
  liveWriteDrains.set(id, drain);
  const cleanup = () => {
    if (liveWriteDrains.get(id) === drain) liveWriteDrains.delete(id);
  };
  void drain.then(cleanup, cleanup);
  return drain;
}

export async function updateRoomReady(id: string, side: "A" | "B", ready: boolean): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc("set_room_ready", {
    target_ready: ready,
    target_room_id: id,
    target_side: side,
  });
  if (error) {
    if (/set_room_ready|PGRST202|42883/i.test(`${error.code ?? ""} ${error.message}`)) {
      throw new Error(
        "Waiting-room readiness is not enabled in Supabase yet. Run supabase/email_players_migration.sql.",
      );
    }
    throw new Error(error.message || "Unable to update ready status.");
  }
}

export async function repairRoomInvites(id: string, game: GameState): Promise<void> {
  if (!supabase || !hasRoomInvites(game)) return;
  const { error } = await supabase
    .from("rooms")
    .update(roomInvitePayload(game))
    .eq("id", id);
  if (error && isMissingInviteColumnsError(error)) throw missingInviteSchemaError();
  if (error) throw new Error(error.message || "Unable to repair room email assignments.");
  setRemoteCapability("inviteColumns", true);
}

export async function deleteRoom(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("rooms").delete().eq("id", id);
  if (error) throw error;
}

export function subscribeToRoom(
  id: string,
  onState: (payload: RealtimePostgresChangesPayload<RemoteRoomRecord>) => void,
  onSession: (session: LiveRoomSession) => void,
): () => void {
  const client = supabase;
  if (!client) return () => undefined;
  let channel = client
    .channel(`room:${id}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "rooms", filter: `id=eq.${id}` },
      (payload: RealtimePostgresChangesPayload<RemoteRoomRecord>) => onState(payload),
    );

  if (remoteCapabilities.liveRoom !== false) {
    channel = channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "room_live", filter: `room_id=eq.${id}` },
      (payload: RealtimePostgresChangesPayload<RemoteRoomLiveRecord>) => {
        if (payload.new && "session" in payload.new) onSession(parseSession(payload.new.session));
      },
    );
  }
  channel.subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}

export function payloadFromRow(row: RemoteRoomRecord): RemoteRoomPayload {
  return {
    game: decodeRoomGame(row),
    meta: metaFromRow(row),
    session: emptyLiveSession(),
    needsCompaction: getEncodedVersion(row.state) < 2,
    needsInviteRepair: rowNeedsInviteRepair(row),
  };
}

function roomStatePayload(game: GameState, status: GameStatus) {
  return {
    name: game.name,
    player_a: game.players.A,
    player_b: game.players.B,
    status,
    turn_number: game.turnNumber,
    score_a: game.scores.A,
    score_b: game.scores.B,
    state: encodeGame(game),
    updated_at: new Date().toISOString(),
  };
}

function roomSummaryPayload(game: GameState) {
  return {
    lifecycle_status: game.status,
    game_mode: getGameMode(game),
    member_a_id: game.playerMembers?.A ?? null,
    member_b_id: game.playerMembers?.B ?? null,
    starting_side: game.startingSide ?? game.activeSide,
  };
}

function roomInvitePayload(game: GameState) {
  return {
    invite_email_a: game.playerEmails?.A ?? null,
    invite_email_b: game.playerEmails?.B ?? null,
  };
}

function hasRoomInvites(game: GameState): boolean {
  return Boolean(game.playerEmails?.A || game.playerEmails?.B);
}

function missingInviteSchemaError(): Error {
  return new Error(
    "Email play is not enabled in Supabase yet. Run supabase/email_players_migration.sql, then try again.",
  );
}

function decodeRoomGame(row: RemoteRoomRecord): GameState {
  if (!row.state) throw new Error("Room state is missing.");
  return decodeGame(row.state as Parameters<typeof decodeGame>[0]);
}

function getEncodedVersion(state: unknown): number {
  if (!state || typeof state !== "object") return 0;
  const version = Number((state as { v?: unknown }).v);
  return Number.isFinite(version) ? version : 0;
}

async function readLiveSession(id: string): Promise<LiveRoomSession> {
  if (!supabase || remoteCapabilities.liveRoom === false) return emptyLiveSession();
  const { data, error } = await supabase
    .from("room_live")
    .select("room_id,session,updated_at")
    .eq("room_id", id)
    .maybeSingle();
  if (error && isMissingLiveRoomError(error)) {
    setRemoteCapability("liveRoom", false);
    return emptyLiveSession();
  }
  if (error) throw error;
  setRemoteCapability("liveRoom", true);
  return data ? parseSession((data as RemoteRoomLiveRecord).session) : emptyLiveSession();
}

async function drainLiveSessionWrites(id: string): Promise<void> {
  while (latestLiveSessions.has(id)) {
    const session = latestLiveSessions.get(id);
    latestLiveSessions.delete(id);
    if (!session || !supabase || remoteCapabilities.liveRoom === false) continue;
    const { error } = await supabase.from("room_live").upsert(
      {
        room_id: id,
        actor_id: session.actorId,
        session,
        updated_at: session.updatedAt,
      },
      { onConflict: "room_id" },
    );
    if (error && isMissingLiveRoomError(error)) {
      setRemoteCapability("liveRoom", false);
      latestLiveSessions.delete(id);
      return;
    }
    if (error) throw error;
    setRemoteCapability("liveRoom", true);
  }
}

function metaFromRow(row: RemoteRoomRecord): RoomMeta {
  const owner = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  const legacy = extractSummaryFromState(row.state);
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerName: owner?.display_name ?? owner?.email ?? null,
    ownerEmail: owner?.email ?? null,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    playerA: row.player_a,
    playerB: row.player_b,
    gameMode: normalizeGameMode(row.game_mode) ?? legacy.gameMode ?? "versus",
    memberAId: row.member_a_id ?? legacy.memberAId,
    memberBId: row.member_b_id ?? legacy.memberBId,
    inviteEmailA: row.invite_email_a ?? legacy.inviteEmailA,
    inviteEmailB: row.invite_email_b ?? legacy.inviteEmailB,
    startingSide: row.starting_side ?? legacy.startingSide,
    turnNumber: row.turn_number,
    scoreA: row.score_a,
    scoreB: row.score_b,
    status: normalizeGameStatus(row.lifecycle_status) ?? legacy.status ?? row.status,
  };
}

function extractSummaryFromState(state: unknown): {
  memberAId: string | null;
  memberBId: string | null;
  inviteEmailA: string | null;
  inviteEmailB: string | null;
  startingSide: "A" | "B" | null;
  status: GameStatus | null;
  gameMode: GameMode | null;
} {
  if (!state || typeof state !== "object") {
    return {
      memberAId: null,
      memberBId: null,
      inviteEmailA: null,
      inviteEmailB: null,
      startingSide: null,
      status: null,
      gameMode: null,
    };
  }
  const obj = state as {
    playerMembers?: { A?: string; B?: string };
    playerEmails?: { A?: string; B?: string };
    startingSide?: "A" | "B";
    activeSide?: "A" | "B";
    history?: { activeSide?: "A" | "B" }[];
    status?: GameStatus;
    gameMode?: GameMode;
  };
  return {
    memberAId: obj.playerMembers?.A ?? null,
    memberBId: obj.playerMembers?.B ?? null,
    inviteEmailA: obj.playerEmails?.A ?? null,
    inviteEmailB: obj.playerEmails?.B ?? null,
    startingSide: obj.startingSide ?? obj.history?.[0]?.activeSide ?? obj.activeSide ?? null,
    status: normalizeGameStatus(obj.status),
    gameMode: normalizeGameMode(obj.gameMode),
  };
}

function rowNeedsInviteRepair(row: RemoteRoomRecord): boolean {
  const expected = extractSummaryFromState(row.state);
  return (
    emailValuesDiffer(expected.inviteEmailA, row.invite_email_a) ||
    emailValuesDiffer(expected.inviteEmailB, row.invite_email_b)
  );
}

function emailValuesDiffer(expected: string | null, actual: string | null | undefined): boolean {
  if (!expected) return false;
  return expected.trim().toLowerCase() !== (actual ?? "").trim().toLowerCase();
}

function normalizeGameMode(mode: unknown): GameMode | null {
  return mode === "solo" || mode === "versus" ? mode : null;
}

function normalizeGameStatus(status: unknown): GameStatus | null {
  return status === "playing" || status === "draft" || status === "finished" ? status : null;
}

function parseSession(value: unknown): LiveRoomSession {
  if (!value || typeof value !== "object") return emptyLiveSession();
  const session = value as Partial<LiveRoomSession>;
  return {
    version: 1,
    actorId: session.actorId ?? null,
    gameId: session.gameId ?? null,
    turnNumber: typeof session.turnNumber === "number" ? session.turnNumber : null,
    activeSide: session.activeSide === "A" || session.activeSide === "B" ? session.activeSide : null,
    actionMode: session.actionMode ?? "none",
    pendingPlacements: Array.isArray(session.pendingPlacements) ? session.pendingPlacements : [],
    exchangeDraft: {
      outgoingIds: Array.isArray(session.exchangeDraft?.outgoingIds) ? session.exchangeDraft.outgoingIds : [],
      incomingTiles: Array.isArray(session.exchangeDraft?.incomingTiles) ? session.exchangeDraft.incomingTiles : [],
    },
    selectedRackTileId: session.selectedRackTileId ?? null,
    selectedPendingTileId: session.selectedPendingTileId ?? null,
    updatedAt: session.updatedAt ?? new Date().toISOString(),
  };
}

function enqueueRoomWrite(
  queues: Map<string, Promise<void>>,
  id: string,
  operation: () => Promise<void>,
): Promise<void> {
  const previous = queues.get(id) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  queues.set(id, current);
  const cleanup = () => {
    if (queues.get(id) === current) queues.delete(id);
  };
  void current.then(cleanup, cleanup);
  return current;
}

function isDraftStatusConstraintError(
  error: { code?: string; message?: string; details?: string } | null,
  status: GameStatus,
): boolean {
  if (!error || status !== "draft" || error.code !== "23514") return false;
  const text = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return text.includes("rooms_status_check") || text.includes("status");
}

function getDatabaseStatus(status: GameStatus): GameStatus {
  return status === "draft" && remoteCapabilities.draftStatus === false ? "playing" : status;
}

function isMissingSummarySchemaError(error: { code?: string; message?: string } | null): boolean {
  const text = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /42703|PGRST204|lifecycle_status|game_mode|member_a_id|member_b_id|starting_side|schema cache/i.test(text);
}

function isMissingInviteColumnsError(error: { code?: string; message?: string } | null): boolean {
  const text = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /42703|PGRST204|invite_email_a|invite_email_b/i.test(text);
}

function isMissingLiveRoomError(error: { code?: string; message?: string } | null): boolean {
  const text = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /42P01|PGRST205|room_live|schema cache/i.test(text);
}

function readRemoteCapabilities(): RemoteCapabilities {
  const fallback: RemoteCapabilities = { checkedAt: Date.now() };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.remoteCapabilities);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as RemoteCapabilities;
    if (!parsed.checkedAt || Date.now() - parsed.checkedAt > REMOTE_CAPABILITIES_TTL_MS) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

function setRemoteCapability(
  capability: "summaryColumns" | "liveRoom" | "draftStatus" | "inviteColumns",
  value: boolean,
): void {
  if (remoteCapabilities[capability] === value) return;
  remoteCapabilities = { ...remoteCapabilities, [capability]: value, checkedAt: Date.now() };
  try {
    window.localStorage.setItem(STORAGE_KEYS.remoteCapabilities, JSON.stringify(remoteCapabilities));
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}
