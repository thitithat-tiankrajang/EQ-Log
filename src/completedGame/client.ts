import { supabase } from "../supabaseClient";
import type { SafeArchiveReplay } from "./archiveRead";

/** The browser receives only the allowlisted replay, never an archive row. */
export async function readSafeArchiveReplay(gameId: string): Promise<SafeArchiveReplay> {
  if (!supabase) throw new Error("Sign in to open a saved replay.");
  const { data, error } = await supabase.functions.invoke("archive-replay", {
    body: { gameId },
  });
  if (error) throw new Error("This replay is unavailable or you do not have access to it.");
  if (!data?.replay || data.replay.format !== 1 || !Array.isArray(data.replay.positions))
    throw new Error("The replay response was incomplete.");
  return data as SafeArchiveReplay;
}
