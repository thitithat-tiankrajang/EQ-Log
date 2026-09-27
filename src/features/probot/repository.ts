import type { ProBotStatus } from "../../bot/catalog";
import { supabase } from "../../supabaseClient";

/**
 * The signed-in account's Pro-Bot allowance, weekly usage, Credits and active
 * boards, as the server computes them. The client never recomputes any of it.
 */
export async function getMyProBotStatus(): Promise<ProBotStatus | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_my_probot_status");
  if (error) throw error;
  return (data as ProBotStatus | null) ?? null;
}
