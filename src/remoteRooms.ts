import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { decodeGame, encodeGame } from "./codec";
import type { ActionType, GameState, GameStatus, PendingPlacement } from "./game";
import type { RoomMeta } from "./rooms";
import { supabase } from "./supabaseClient";
import { REMOTE_CAPABILITIES_TTL_MS } from "./constants/network";
import { STORAGE_KEYS } from "./constants/storage";

type ActionMode = "none" | ActionType;

export type LiveRoomSession = {
  version: 1;
  actorId: string | null;
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
  member_a_id?: string | null;
  member_b_id?: string | null;
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
  | "manual_score"
  | "note"
  | "rename"
  | "import"
  | "delete";

const META_FIELDS =
  "id,owner_id,name,player_a,player_b,status,turn_number,score_a,score_b,created_at,updated_at,profiles:owner_id(display_name,email)";
const SUMMARY_FIELDS =
  "id,owner_id,name,player_a,player_b,status,lifecycle_status,member_a_id,member_b_id,starting_side,turn_number,score_a,score_b,created_at,updated_at,profiles:owner_id(display_name,email)";
const READ_ROOM_FIELDS = `${META_FIELDS},state`;

type RemoteCapabilities = {
  summaryColumns?: boolean;
  liveRoom?: boolean;
  draftStatus?: boolean;
  checkedAt: number;
};

let remoteCapabilities = readRemoteCapabilities();
const stateWriteQueues = new Map<string, Promise<void>>();
const latestLiveSessions = new Map<string, LiveRoomSession>();
const liveWriteDrains = new Map<string, Promise<void>>();

export function makeLiveSession(args: {
  actorId: string | null;
  actionMode: ActionMode;
  pendingPlacements: PendingPlacement[];
  exchangeDraft: LiveRoomSession["exchangeDraft"];
  selectedRackTileId: string | null;
  selectedPendingTileId: string | null;
}): LiveRoomSession {
  return {
    version: 1,
    actorId: args.actorId,
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
  let result: DatabaseResult = await supabase
    .from("rooms")
    .select(useSummary ? SUMMARY_FIELDS : META_FIELDS)
    .order("updated_at", { ascending: false });
  if (useSummary && result.error && isMissingSummarySchemaError(result.error)) {
    setRemoteCapability("summaryColumns", false);
    result = await supabase.from("rooms").select(META_FIELDS).order("updated_at", { ascending: false });
  } else if (useSummary && !result.error) {
    setRemoteCapability("summaryColumns", true);
  }
  if (result.error) throw result.error;
  return ((result.data ?? []) as unknown as RemoteRoomRecord[]).map(metaFromRow);
}

export async function readRoom(id: string): Promise<RemoteRoomPayload | null> {
  if (!supabase) return null;
  const [roomResult, session] = await Promise.all([
    supabase.from("rooms").select(READ_ROOM_FIELDS).eq("id", id).maybeSingle(),
    readLiveSession(id),
  ]);
  if (roomResult.error) throw roomResult.error;
  if (!roomResult.data) return null;
  const row = roomResult.data as unknown as RemoteRoomRecord;
  return {
    game: decodeRoomGame(row),
    meta: metaFromRow(row),
    session,
    needsCompaction: getEncodedVersion(row.state) < 2,
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
  const useSummary = remoteCapabilities.summaryColumns !== false;
  const insertPayload = useSummary ? { ...basePayload, ...roomSummaryPayload(game) } : basePayload;
  let result: DatabaseResult = await supabase
    .from("rooms")
    .insert(insertPayload)
    .select(useSummary ? SUMMARY_FIELDS : META_FIELDS)
    .single();

  if (isDraftStatusConstraintError(result.error, databaseStatus)) {
    setRemoteCapability("draftStatus", false);
    result = await supabase
      .from("rooms")
      .insert({ ...insertPayload, status: "playing" })
      .select(useSummary ? SUMMARY_FIELDS : META_FIELDS)
      .single();
  } else if (databaseStatus === "draft" && !result.error) {
    setRemoteCapability("draftStatus", true);
  }

  if (useSummary && result.error && isMissingSummarySchemaError(result.error)) {
    setRemoteCapability("summaryColumns", false);
    let legacy = await supabase.from("rooms").insert(basePayload).select(META_FIELDS).single();
    if (isDraftStatusConstraintError(legacy.error, databaseStatus)) {
      setRemoteCapability("draftStatus", false);
      legacy = await supabase.from("rooms").insert({ ...basePayload, status: "playing" }).select(META_FIELDS).single();
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
    const useSummary = remoteCapabilities.summaryColumns !== false;
    const updatePayload = useSummary ? { ...basePayload, ...roomSummaryPayload(args.game) } : basePayload;
    let result = await supabase.from("rooms").update(updatePayload).eq("id", args.id);

    if (isDraftStatusConstraintError(result.error, databaseStatus)) {
      setRemoteCapability("draftStatus", false);
      result = await supabase.from("rooms").update({ ...updatePayload, status: "playing" }).eq("id", args.id);
    } else if (databaseStatus === "draft" && !result.error) {
      setRemoteCapability("draftStatus", true);
    }

    if (useSummary && result.error && isMissingSummarySchemaError(result.error)) {
      setRemoteCapability("summaryColumns", false);
      let legacy = await supabase.from("rooms").update(basePayload).eq("id", args.id);
      if (isDraftStatusConstraintError(legacy.error, databaseStatus)) {
        setRemoteCapability("draftStatus", false);
        legacy = await supabase.from("rooms").update({ ...basePayload, status: "playing" }).eq("id", args.id);
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
    member_a_id: game.playerMembers?.A ?? null,
    member_b_id: game.playerMembers?.B ?? null,
    starting_side: game.startingSide ?? game.activeSide,
  };
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
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    playerA: row.player_a,
    playerB: row.player_b,
    memberAId: row.member_a_id ?? legacy.memberAId,
    memberBId: row.member_b_id ?? legacy.memberBId,
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
  startingSide: "A" | "B" | null;
  status: GameStatus | null;
} {
  if (!state || typeof state !== "object") {
    return { memberAId: null, memberBId: null, startingSide: null, status: null };
  }
  const obj = state as {
    playerMembers?: { A?: string; B?: string };
    startingSide?: "A" | "B";
    activeSide?: "A" | "B";
    history?: { activeSide?: "A" | "B" }[];
    status?: GameStatus;
  };
  return {
    memberAId: obj.playerMembers?.A ?? null,
    memberBId: obj.playerMembers?.B ?? null,
    startingSide: obj.startingSide ?? obj.history?.[0]?.activeSide ?? obj.activeSide ?? null,
    status: normalizeGameStatus(obj.status),
  };
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
  return /42703|PGRST204|lifecycle_status|member_a_id|member_b_id|starting_side|schema cache/i.test(text);
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
  capability: "summaryColumns" | "liveRoom" | "draftStatus",
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
