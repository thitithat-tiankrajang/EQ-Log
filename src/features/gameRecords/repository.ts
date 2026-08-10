import type { GameMode } from "../../game";
import { supabase } from "../../supabaseClient";
import type { CompletionKind, CompletionReason, ModeKey } from "./domain";

export type ArchiveScope = "public" | "region";
export const ARCHIVE_PAGE_SIZE = 48;

export type ArchivePage = {
  games: ArchiveGame[];
  total: number;
};

export type ArchiveMoveContext = {
  canMove: boolean;
  regions: Array<{ id: string; name: string }>;
};

export type ArchiveGame = {
  gameId: string;
  regionId: string | null;
  creatorName: string | null;
  name: string;
  playerA: string;
  playerB: string;
  gameMode: GameMode;
  modeKey: ModeKey;
  turnNumber: number;
  scoreA: number;
  scoreB: number;
  completionKind: CompletionKind;
  completionReason: CompletionReason;
  surrenderedSide: "A" | "B" | null;
  createdAt: string;
  finishedAt: string;
  archivedAt: string;
};

export type PrivateLibraryItem = {
  id: string;
  ownerId: string;
  itemType: "folder" | "game";
  parentId: string | null;
  name: string;
  sourceScope: "public" | "region" | "private" | null;
  sourceGameId: string | null;
  gameId: string | null;
  gameMode: GameMode | null;
  modeKey: ModeKey | null;
  completionKind: CompletionKind | null;
  completionReason: CompletionReason | null;
  turnNumber: number | null;
  scoreA: number | null;
  scoreB: number | null;
  trashedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UserModeStat = {
  profileId: string;
  modeKey: ModeKey;
  gamesCreated: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  soloScore: number;
  lastPlayedAt: string | null;
};

export type GameStorageLimits = {
  publicArchive: number;
  regionArchive: number;
  privateBoards: number;
};

const ARCHIVE_FIELDS =
  "game_id,source_owner_id,name,player_a,player_b,game_mode,mode_key,turn_number,score_a,score_b,completion_kind,completion_reason,surrendered_side,created_at,finished_at,archived_at";

export async function listArchiveGames(
  scope: ArchiveScope,
  regionId: string | null,
  offset = 0,
  limit = ARCHIVE_PAGE_SIZE,
): Promise<ArchivePage> {
  if (!supabase) return { games: [], total: 0 };
  const table = scope === "public" ? "public_game_snapshots" : "region_game_snapshots";
  const fields = scope === "region" ? `${ARCHIVE_FIELDS},region_id` : ARCHIVE_FIELDS;
  const creatorRelation =
    scope === "public"
      ? "creator:profiles!public_game_snapshots_source_owner_id_fkey(display_name)"
      : "creator:profiles!region_game_snapshots_source_owner_id_fkey(display_name)";
  let query = supabase.from(table).select(`${fields},${creatorRelation}`, { count: "exact" });
  if (scope === "region") {
    if (!regionId) return { games: [], total: 0 };
    query = query.eq("region_id", regionId);
  }
  const { data, error, count } = await query
    .order("finished_at", { ascending: false })
    .range(offset, offset + Math.max(1, limit) - 1);
  if (error) throw friendlySchemaError(error.message);
  return {
    games: ((data ?? []) as unknown as ArchiveRow[]).map(mapArchiveRow),
    total: count ?? 0,
  };
}

export async function listPrivateLibrary(): Promise<PrivateLibraryItem[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("private_library_items")
    .select(
      "id,owner_id,item_type,parent_id,name,source_scope,source_game_id,game_id,game_mode,mode_key,completion_kind,completion_reason,turn_number,score_a,score_b,trashed_at,created_at,updated_at",
    )
    .order("updated_at", { ascending: false });
  if (error) throw friendlySchemaError(error.message);
  return ((data ?? []) as PrivateRow[]).map(mapPrivateRow);
}

export async function getGameStorageLimits(): Promise<GameStorageLimits> {
  const defaults: GameStorageLimits = {
    publicArchive: 100_000,
    regionArchive: 1_000,
    privateBoards: 1_000,
  };
  if (!supabase) return defaults;
  const { data, error } = await supabase
    .from("system_settings")
    .select("key,value_int")
    .in("key", ["public_archive_limit", "region_archive_limit", "private_board_limit"]);
  if (error) throw friendlySchemaError(error.message);
  const values = new Map(
    ((data ?? []) as Array<{ key: string; value_int: number | string }>).map((row) => [
      row.key,
      Number(row.value_int),
    ]),
  );
  return {
    publicArchive: values.get("public_archive_limit") ?? defaults.publicArchive,
    regionArchive: values.get("region_archive_limit") ?? defaults.regionArchive,
    privateBoards: values.get("private_board_limit") ?? defaults.privateBoards,
  };
}

export async function createPrivateFolder(
  ownerId: string,
  name: string,
  parentId: string | null,
): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("private_library_items").insert({
    owner_id: ownerId,
    item_type: "folder",
    parent_id: parentId,
    name: name.trim(),
  });
  if (error) throw new Error(error.message);
}

export async function updatePrivateItem(
  id: string,
  patch: { name?: string; parentId?: string | null; trashedAt?: string | null },
): Promise<void> {
  if (!supabase) return;
  const payload: Record<string, unknown> = {};
  if (patch.name !== undefined) payload.name = patch.name.trim();
  if (patch.parentId !== undefined) payload.parent_id = patch.parentId;
  if (patch.trashedAt !== undefined) payload.trashed_at = patch.trashedAt;
  const { error } = await supabase.from("private_library_items").update(payload).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function movePrivateItems(ids: string[], parentId: string | null): Promise<void> {
  if (!supabase || ids.length === 0) return;
  const { error } = await supabase.rpc("move_private_library_items", {
    target_item_ids: ids,
    target_parent_id: parentId,
  });
  if (error) throw friendlySchemaError(error.message);
}

export async function deletePrivateItem(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("private_library_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function copyPrivateGameItem(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc("copy_private_game_item", {
    source_item_id: id,
    target_parent_id: null,
  });
  if (error) throw friendlySchemaError(error.message);
}

export async function saveArchiveToPrivate(
  scope: ArchiveScope,
  gameId: string,
  parentId: string | null = null,
): Promise<string> {
  if (!supabase) throw new Error("Sign in to save games.");
  const { data, error } = await supabase.rpc("save_archive_to_private", {
    target_scope: scope,
    target_game_id: gameId,
    target_parent_id: parentId,
  });
  if (error) throw friendlySchemaError(error.message);
  return String(data);
}

export async function listMyModeStats(): Promise<UserModeStat[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("user_mode_stats")
    .select(
      "profile_id,mode_key,games_created,games_played,wins,losses,draws,solo_score,last_played_at",
    );
  if (error) throw friendlySchemaError(error.message);
  return ((data ?? []) as ModeStatRow[]).map((row) => ({
    profileId: row.profile_id,
    modeKey: row.mode_key,
    gamesCreated: Number(row.games_created),
    gamesPlayed: Number(row.games_played),
    wins: Number(row.wins),
    losses: Number(row.losses),
    draws: Number(row.draws),
    soloScore: Number(row.solo_score),
    lastPlayedAt: row.last_played_at,
  }));
}

export async function getPublicArchiveMoveContext(): Promise<ArchiveMoveContext> {
  if (!supabase) return { canMove: false, regions: [] };
  const { data, error } = await supabase.rpc("get_public_archive_move_context");
  if (error) throw friendlySchemaError(error.message);
  const payload = data as { can_move?: unknown; regions?: unknown } | null;
  const regions = Array.isArray(payload?.regions)
    ? payload.regions.flatMap((region) => {
        if (!region || typeof region !== "object") return [];
        const id = String((region as { id?: unknown }).id ?? "");
        const name = String((region as { name?: unknown }).name ?? "");
        return id && name ? [{ id, name }] : [];
      })
    : [];
  return { canMove: payload?.can_move === true, regions };
}

export async function movePublicArchivesToRegion(
  gameIds: string[],
  regionId: string,
): Promise<void> {
  if (!supabase || gameIds.length === 0) return;
  const { error } = await supabase.rpc("move_public_snapshots_to_region", {
    target_game_ids: [...new Set(gameIds)],
    target_region_id: regionId,
  });
  if (error) throw friendlySchemaError(error.message);
}

type ArchiveRow = {
  game_id: string;
  region_id?: string | null;
  source_owner_id: string | null;
  creator: { display_name: string | null } | Array<{ display_name: string | null }> | null;
  name: string;
  player_a: string;
  player_b: string;
  game_mode: GameMode;
  mode_key: ModeKey;
  turn_number: number;
  score_a: number;
  score_b: number;
  completion_kind: CompletionKind;
  completion_reason: CompletionReason;
  surrendered_side: "A" | "B" | null;
  created_at: string;
  finished_at: string;
  archived_at: string;
};

type PrivateRow = {
  id: string;
  owner_id: string;
  item_type: "folder" | "game";
  parent_id: string | null;
  name: string;
  source_scope: "public" | "region" | "private" | null;
  source_game_id: string | null;
  game_id: string | null;
  game_mode: GameMode | null;
  mode_key: ModeKey | null;
  completion_kind: CompletionKind | null;
  completion_reason: CompletionReason | null;
  turn_number: number | null;
  score_a: number | null;
  score_b: number | null;
  trashed_at: string | null;
  created_at: string;
  updated_at: string;
};

type ModeStatRow = {
  profile_id: string;
  mode_key: ModeKey;
  games_created: number | string;
  games_played: number | string;
  wins: number | string;
  losses: number | string;
  draws: number | string;
  solo_score: number | string;
  last_played_at: string | null;
};

function mapArchiveRow(row: ArchiveRow): ArchiveGame {
  const creator = Array.isArray(row.creator) ? row.creator[0] : row.creator;
  return {
    gameId: row.game_id,
    regionId: row.region_id ?? null,
    creatorName: creator?.display_name ?? null,
    name: row.name,
    playerA: row.player_a,
    playerB: row.player_b,
    gameMode: row.game_mode,
    modeKey: row.mode_key,
    turnNumber: row.turn_number,
    scoreA: row.score_a,
    scoreB: row.score_b,
    completionKind: row.completion_kind,
    completionReason: row.completion_reason,
    surrenderedSide: row.surrendered_side,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    archivedAt: row.archived_at,
  };
}

function mapPrivateRow(row: PrivateRow): PrivateLibraryItem {
  return {
    id: row.id,
    ownerId: row.owner_id,
    itemType: row.item_type,
    parentId: row.parent_id,
    name: row.name,
    sourceScope: row.source_scope,
    sourceGameId: row.source_game_id,
    gameId: row.game_id,
    gameMode: row.game_mode,
    modeKey: row.mode_key,
    completionKind: row.completion_kind,
    completionReason: row.completion_reason,
    turnNumber: row.turn_number,
    scoreA: row.score_a,
    scoreB: row.score_b,
    trashedAt: row.trashed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function friendlySchemaError(message: string): Error {
  if (/does not exist|schema cache|PGRST20/i.test(message)) {
    return new Error(
      "Game archives are not enabled yet. Run supabase/game_archives_migration.sql.",
    );
  }
  return new Error(message);
}
