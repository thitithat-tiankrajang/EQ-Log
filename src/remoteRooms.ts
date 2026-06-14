import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { decodeGame, encodeGame } from "./codec";
import type { ActionType, GameState, PendingPlacement } from "./game";
import type { RoomMeta } from "./rooms";
import { supabase } from "./supabaseClient";

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
  turn_number: number;
  score_a: number;
  score_b: number;
  state: unknown;
  session?: unknown | null;
  created_at: string;
  updated_at: string;
  profiles?: { display_name: string | null; email: string | null } | { display_name: string | null; email: string | null }[] | null;
};

export type RemoteRoomPayload = {
  game: GameState;
  meta: RoomMeta;
  session: LiveRoomSession;
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

const ROOM_SELECT =
  "id,owner_id,name,player_a,player_b,status,turn_number,score_a,score_b,state,session,created_at,updated_at,profiles:owner_id(display_name,email)";
const LEGACY_ROOM_SELECT =
  "id,owner_id,name,player_a,player_b,status,turn_number,score_a,score_b,state,created_at,updated_at,profiles:owner_id(display_name,email)";

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
  const result = await supabase
    .from("rooms")
    .select(ROOM_SELECT)
    .order("updated_at", { ascending: false });
  let data: unknown = result.data;
  let error = result.error;
  if (error && isMissingLiveSchemaError(error)) {
    const legacy = await supabase.from("rooms").select(LEGACY_ROOM_SELECT).order("updated_at", { ascending: false });
    data = legacy.data as unknown;
    error = legacy.error;
  }
  if (error) throw error;
  return ((data ?? []) as unknown as RemoteRoomRecord[]).map(metaFromRow);
}

export async function readRoom(id: string): Promise<RemoteRoomPayload | null> {
  if (!supabase) return null;
  const result = await supabase.from("rooms").select(ROOM_SELECT).eq("id", id).maybeSingle();
  let data: unknown = result.data;
  let error = result.error;
  if (error && isMissingLiveSchemaError(error)) {
    const legacy = await supabase.from("rooms").select(LEGACY_ROOM_SELECT).eq("id", id).maybeSingle();
    data = legacy.data as unknown;
    error = legacy.error;
  }
  if (error) throw error;
  if (!data) return null;
  return payloadFromRow(data as unknown as RemoteRoomRecord);
}

export async function createRoom(
  game: GameState,
  ownerId: string,
  session: LiveRoomSession,
): Promise<{ id: string; meta: RoomMeta }> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const insertPayload = {
    owner_id: ownerId,
    name: game.name,
    player_a: game.players.A,
    player_b: game.players.B,
    status: game.status,
    turn_number: game.turnNumber,
    score_a: game.scores.A,
    score_b: game.scores.B,
    state: encodeGame(game),
    session,
  };
  const result = await supabase
    .from("rooms")
    .insert(insertPayload)
    .select(ROOM_SELECT)
    .single();
  let data: unknown = result.data;
  let error = result.error;
  if (error && isMissingLiveSchemaError(error)) {
    const { session: _session, ...legacyPayload } = insertPayload;
    const legacy = await supabase.from("rooms").insert(legacyPayload).select(LEGACY_ROOM_SELECT).single();
    data = legacy.data as unknown;
    error = legacy.error;
  }
  if (error) throw error;
  const meta = metaFromRow(data as unknown as RemoteRoomRecord);
  await appendRoomSession(meta.id, game, session, "create");
  return { id: meta.id, meta };
}

export async function updateRoomState(args: {
  id: string;
  game: GameState;
  session: LiveRoomSession;
  event?: RoomSessionEvent;
}): Promise<void> {
  if (!supabase) return;
  const updatePayload = {
    name: args.game.name,
    player_a: args.game.players.A,
    player_b: args.game.players.B,
    status: args.game.status,
    turn_number: args.game.turnNumber,
    score_a: args.game.scores.A,
    score_b: args.game.scores.B,
    state: encodeGame(args.game),
    session: args.session,
    updated_at: new Date().toISOString(),
  };
  let { error } = await supabase
    .from("rooms")
    .update(updatePayload)
    .eq("id", args.id);
  if (error && isMissingLiveSchemaError(error)) {
    const { session: _session, ...legacyPayload } = updatePayload;
    const legacy = await supabase.from("rooms").update(legacyPayload).eq("id", args.id);
    error = legacy.error;
  }
  if (error) throw error;
  if (args.event) await appendRoomSession(args.id, args.game, args.session, args.event);
}

export async function updateRoomSession(id: string, session: LiveRoomSession): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from("rooms")
    .update({
      session,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error && isMissingLiveSchemaError(error)) return;
  if (error) throw error;
}

export async function deleteRoom(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("rooms").delete().eq("id", id);
  if (error) throw error;
}

export async function appendRoomSession(
  roomId: string,
  game: GameState,
  session: LiveRoomSession,
  event: RoomSessionEvent,
): Promise<void> {
  if (!supabase) return;
  const latestLog = game.logs.at(-1);
  const { error } = await supabase.from("room_sessions").insert({
    room_id: roomId,
    actor_id: session.actorId,
    event,
    turn_number: game.turnNumber,
    action: latestLog?.action ?? null,
    log_id: latestLog?.id ?? null,
    state: encodeGame(game),
    session,
  });
  if (error && isMissingLiveSchemaError(error)) return;
  if (error) throw error;
}

export function subscribeToRooms(onChange: (payload: RealtimePostgresChangesPayload<RemoteRoomRecord>) => void) {
  const client = supabase;
  if (!client) return () => undefined;
  const channel = client
    .channel("public:rooms")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "rooms" },
      (payload: RealtimePostgresChangesPayload<RemoteRoomRecord>) => onChange(payload),
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}

export function payloadFromRow(row: RemoteRoomRecord): RemoteRoomPayload {
  return {
    game: decodeGame(row.state as Parameters<typeof decodeGame>[0]),
    meta: metaFromRow(row),
    session: parseSession(row.session),
  };
}

function metaFromRow(row: RemoteRoomRecord): RoomMeta {
  const owner = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  const players = extractPlayerMembersFromState(row.state);
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerName: owner?.display_name ?? owner?.email ?? null,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    playerA: row.player_a,
    playerB: row.player_b,
    memberAId: players.memberAId,
    memberBId: players.memberBId,
    startingSide: players.startingSide,
    turnNumber: row.turn_number,
    scoreA: row.score_a,
    scoreB: row.score_b,
    status: row.status,
  };
}

// Lightweight extractor: walks the encoded state JSON for the fields we need
// without fully decoding the game. Tolerates legacy rows (returns nulls).
function extractPlayerMembersFromState(
  state: unknown,
): { memberAId: string | null; memberBId: string | null; startingSide: "A" | "B" | null } {
  if (!state || typeof state !== "object") {
    return { memberAId: null, memberBId: null, startingSide: null };
  }
  const obj = state as {
    playerMembers?: { A?: string; B?: string };
    startingSide?: "A" | "B";
    activeSide?: "A" | "B";
    history?: { activeSide?: "A" | "B" }[];
  };
  const members = obj.playerMembers ?? {};
  const startingSide =
    obj.startingSide ?? obj.history?.[0]?.activeSide ?? obj.activeSide ?? null;
  return {
    memberAId: members.A ?? null,
    memberBId: members.B ?? null,
    startingSide,
  };
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

function isMissingLiveSchemaError(error: { code?: string; message?: string } | null): boolean {
  const text = `${error?.code ?? ""} ${error?.message ?? ""}`;
  return /42703|PGRST204|rooms\.session|session.*rooms|room_sessions|schema cache/i.test(text);
}
