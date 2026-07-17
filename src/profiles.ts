import { supabase } from "./supabaseClient";

export type RegisteredPlayer = {
  id: string;
  username: string;
};

type RegisteredPlayerRow = {
  id?: unknown;
  username?: unknown;
  display_name?: unknown;
};

/** Public player picker data. This function never requests account emails. */
export async function loadRegisteredPlayers(): Promise<RegisteredPlayer[]> {
  if (!supabase) return [];

  const rpcResult = await supabase.rpc("list_registered_players");
  if (!rpcResult.error) return normalizePlayers(rpcResult.data);

  if (!isMissingDirectoryRpc(rpcResult.error)) throw rpcResult.error;

  // Compatibility for projects that have not run user_invites_migration.sql
  // yet. The fallback still selects only public profile fields.
  const { data, error } = await supabase
    .from("profiles")
    .select("id,display_name")
    .not("display_name", "is", null)
    .neq("status", "blocked")
    .order("display_name", { ascending: true });
  if (error) {
    throw new Error(
      "Player directory is not enabled yet. Run supabase/user_invites_migration.sql.",
    );
  }
  return normalizePlayers(data);
}

function normalizePlayers(value: unknown): RegisteredPlayer[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, RegisteredPlayer>();
  for (const entry of value as RegisteredPlayerRow[]) {
    const id = typeof entry.id === "string" ? entry.id.trim() : "";
    const rawName = entry.username ?? entry.display_name;
    const username = typeof rawName === "string" ? rawName.trim() : "";
    if (id && username) byId.set(id, { id, username });
  }
  return [...byId.values()].sort((a, b) =>
    a.username.localeCompare(b.username, undefined, { sensitivity: "base" }),
  );
}

function isMissingDirectoryRpc(error: { code?: string; message?: string }): boolean {
  return /PGRST202|42883|list_registered_players/i.test(`${error.code ?? ""} ${error.message ?? ""}`);
}
