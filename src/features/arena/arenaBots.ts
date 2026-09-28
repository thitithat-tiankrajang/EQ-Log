import type { Route } from "../../router";

/** One row of `list_bots()`: the catalogue, the only source of bot facts. */
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

/**
 * Where this client sets up a game against each bot it can play. A bot is
 * offered only if the catalogue has it AND there is a setup for it here; a
 * bot added to the catalogue appears once its setup is added to this table.
 * Authur's is the existing bot-room setup (space, then the Pro-Bot panel),
 * which applies the plan, funding and board rules and asks the server again.
 * ArchBot's (catalogue key `stage5b`) is its own free setup (space, then the
 * ArchBot panel), which asks the catalogue again and whether this browser can
 * run it; the server still decides the room.
 */
const SETUP: Record<string, Route> = {
  authur_strong: {
    kind: "create",
    visibility: "public",
    preset: "bot",
    returnTo: { kind: "arena" },
  },
  stage5b: {
    kind: "create",
    visibility: "public",
    preset: "archbot",
    returnTo: { kind: "arena" },
  },
};

export type ArenaBot = {
  key: string;
  name: string;
  /** The catalogue's access tier, shown by its canonical plan name. */
  tier: "Free" | "EQ Plus" | "EQ Pro" | null;
  execution: string;
  setup: Route;
  /** Why it cannot be started now, or null when it can. */
  unavailable: "closed" | "no_server" | null;
};

const TIERS: Record<string, ArenaBot["tier"]> = {
  free: "Free",
  plus: "EQ Plus",
  pro: "EQ Pro",
};

/**
 * The bots Home offers, from the catalogue: active bots this client can set
 * up, in catalogue order. A bot the catalogue has switched off for new games
 * is shown as unavailable; a pending or retired bot is not shown at all.
 */
export function arenaBots(
  catalog: CatalogBot[],
  { serverAvailable }: { serverAvailable: boolean },
): ArenaBot[] {
  return catalog
    .filter((bot) => bot.lifecycle === "active" && bot.bot_key in SETUP)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((bot) => ({
      key: bot.bot_key,
      name: bot.display_name,
      tier: TIERS[bot.access_tier] ?? null,
      execution: bot.execution_type,
      setup: SETUP[bot.bot_key],
      unavailable:
        !bot.enabled || !bot.new_rooms_allowed
          ? "closed"
          : bot.execution_type !== "CLIENT" && !serverAvailable
            ? "no_server"
            : null,
    }));
}
