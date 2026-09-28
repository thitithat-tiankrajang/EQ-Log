// ── Can a player start an ArchBot game? ──────────────────────────────────────
//
// The bot catalog decides. `list_bots()` is the server's word on whether ArchBot
// exists for new games, how it is funded and where it runs; this module reads it
// and adds only what the server cannot know — whether THIS browser can run it.
// There is no second catalog here: no row, or a row that says anything but
// "enabled, open to new games, active, CLIENT, free", means ArchBot is not offered.
// (The server re-checks all of it when the room is created.)
import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import { isArchBotSupported } from "./client";
import { ARCHBOT_BOT_KEY } from "./identity";

/** One row of `list_bots()`. */
export type CatalogBot = {
  bot_key: string;
  display_name: string;
  engine_family: string;
  difficulty: string;
  execution_type: string;
  access_tier: string;
  enabled: boolean;
  new_rooms_allowed: boolean;
  lifecycle: string;
  sort_order: number;
};

export type ArchBotOffer =
  | { available: true }
  | { available: false; reason: "loading" | "not_offered" | "unsupported" | "catalog_error" };

/** The decision itself, separate from fetching so it can be tested exactly. */
export function archBotOfferFrom(
  rows: readonly CatalogBot[],
  browserCanRun: boolean,
): ArchBotOffer {
  const row = rows.find((bot) => bot.bot_key === ARCHBOT_BOT_KEY);
  if (
    !row ||
    !row.enabled ||
    !row.new_rooms_allowed ||
    row.lifecycle !== "active" ||
    // The only way this client knows to run ArchBot is on the device, and the only
    // funding it knows for it is none. A catalog that says otherwise is describing
    // a bot this client cannot honestly offer.
    row.execution_type !== "CLIENT" ||
    row.access_tier !== "free"
  ) {
    return { available: false, reason: "not_offered" };
  }
  if (!browserCanRun) return { available: false, reason: "unsupported" };
  return { available: true };
}

export async function fetchCatalogBots(): Promise<CatalogBot[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("list_bots");
  if (error) throw new Error(error.message);
  return (data ?? []) as CatalogBot[];
}

export function useArchBotOffer(): ArchBotOffer {
  const [offer, setOffer] = useState<ArchBotOffer>({ available: false, reason: "loading" });
  useEffect(() => {
    let alive = true;
    fetchCatalogBots()
      .then((rows) => {
        if (alive) setOffer(archBotOfferFrom(rows, isArchBotSupported()));
      })
      .catch(() => {
        if (alive) setOffer({ available: false, reason: "catalog_error" });
      });
    return () => {
      alive = false;
    };
  }, []);
  return offer;
}
