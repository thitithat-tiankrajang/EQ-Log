import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

/**
 * Which bot a player is told they are dealing with.
 *
 * The server's `bot_catalog.display_name` (read through `list_bots`) is the one
 * source of a bot's player-facing name. Analysis, Study and room modes only
 * carry internal engine identities (`stage5b`, `stage5b64`, `stage5b_standard`);
 * this module maps those IDENTIFIERS to the catalogue bot they belong to and
 * asks the catalogue for the name. It never renames an identifier: requests,
 * stored records and provenance keep them exactly.
 */

/** The catalogue bot behind the Stage 5B engine and its Stage 5A value model. */
export const ARCHBOT_BOT_KEY = "stage5b";

const BOT_KEY_BY_INTERNAL_ID = {
  stage5b: ARCHBOT_BOT_KEY, // analysis / Study solver
  stage5b64: ARCHBOT_BOT_KEY, // analysis / Study level, catalogue difficulty
  stage5b_standard: ARCHBOT_BOT_KEY, // room mode
} as const;

/** An internal identifier known to belong to a catalogue bot. */
export type InternalBotId = keyof typeof BOT_KEY_BY_INTERNAL_ID;

/**
 * Used ONLY when the catalogue cannot be read at all: local-only builds, a
 * signed-out or unapproved viewer (`list_bots` returns nothing to them), or a
 * failed request. Must match the catalogue row.
 */
const NAME_WHEN_CATALOGUE_UNAVAILABLE: Readonly<Record<string, string>> = {
  [ARCHBOT_BOT_KEY]: "ArchBot",
};

export type BotNames = ReadonlyMap<string, string>;

/** The catalogue bot an internal engine, level or mode identifier belongs to. */
export function catalogBotKeyFor(internalId: string | null | undefined): string | null {
  if (!internalId || !Object.hasOwn(BOT_KEY_BY_INTERNAL_ID, internalId)) return null;
  return BOT_KEY_BY_INTERNAL_ID[internalId as InternalBotId];
}

/** Resolves an internal identifier to the name players see. */
export type BotNameResolver = {
  (internalId: InternalBotId): string;
  (internalId: string | null | undefined): string | null;
};

/** The player-facing name for an internal identifier, or `null` if it names no catalogue bot. */
export function botDisplayName(internalId: InternalBotId, names: BotNames | null): string;
export function botDisplayName(
  internalId: string | null | undefined,
  names: BotNames | null,
): string | null;
export function botDisplayName(
  internalId: string | null | undefined,
  names: BotNames | null,
): string | null {
  const botKey = catalogBotKeyFor(internalId);
  if (!botKey) return null;
  return names?.get(botKey)?.trim() || NAME_WHEN_CATALOGUE_UNAVAILABLE[botKey] || null;
}

let cached: BotNames | null = null;
let pending: Promise<BotNames> | null = null;

async function fetchBotNames(): Promise<BotNames> {
  if (!supabase) return new Map();
  const { data, error } = await supabase.rpc("list_bots");
  if (error) throw error;
  const rows = (data ?? []) as Array<{ bot_key?: unknown; display_name?: unknown }>;
  return new Map(
    rows
      .filter((row) => typeof row.bot_key === "string" && typeof row.display_name === "string")
      .map((row) => [row.bot_key as string, row.display_name as string]),
  );
}

/** The catalogue's names, read once per tab. A failed read is retried by the next caller. */
export function loadBotNames(): Promise<BotNames> {
  if (cached) return Promise.resolve(cached);
  pending ??= fetchBotNames()
    .then((names) => {
      cached = names;
      return names;
    })
    .catch(() => new Map<string, string>())
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Forget the cached catalogue (tests, and after an account change). */
export function resetBotNames(): void {
  cached = null;
  pending = null;
}

/** A resolver from internal identifier to player-facing bot name, kept current with the catalogue. */
export function useBotNames(): BotNameResolver {
  const [names, setNames] = useState<BotNames | null>(cached);
  useEffect(() => {
    if (cached) return;
    let alive = true;
    void loadBotNames().then((loaded) => {
      if (alive) setNames(loaded);
    });
    return () => {
      alive = false;
    };
  }, []);
  return ((internalId: string | null | undefined) =>
    botDisplayName(internalId, names)) as BotNameResolver;
}
