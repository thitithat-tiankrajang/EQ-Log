import { getActiveLocale, type Locale } from "./locale";
import { hasMessage, translate } from "./translate";

/**
 * Server refusals the product explains in the player's language.
 *
 * The database states WHY it refused with a stable lowercase code at the start
 * of the exception message (`active_board_limit: you have 3 …`), and the
 * Ranked Edge Function forwards the same code as `{ error, code }`. That is
 * the one error-code architecture; this module only reads it. The server
 * stays the authority: nothing here decides whether an action is allowed.
 */
export const SERVER_ERROR_CODES = [
  "funding_required",
  "funding_not_applicable",
  "allowance_free_plan",
  "allowance_not_configured",
  "allowance_weekly_cap",
  "allowance_empty",
  "insufficient_credits",
  "active_board_limit",
  "active_board_limit_unconfigured",
  "bot_pending",
  "bot_disabled",
  "bot_closed",
  "stage_level_not_sealed",
  "stage_level_unavailable",
  "stage_start_mismatch",
  "stage_board_rewrite",
  "idempotency_conflict",
  "approval_required",
  "ranked_already_active",
  "ranked_room_unavailable",
  "ranked_room_claimed",
  "ranked_room_expired",
  "ranked_room_not_found",
  "ranked_room_finished",
  "ranked_own_room",
  "ranked_stakes_changed",
  "ranked_stakes_required",
] as const;

export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number];

function describe(input: unknown): { message: string | null; code: string | null } {
  if (typeof input === "string") return { message: input, code: null };
  if (input !== null && typeof input === "object") {
    const record = input as { message?: unknown; error?: unknown; code?: unknown };
    const message =
      typeof record.message === "string"
        ? record.message
        : typeof record.error === "string"
          ? record.error
          : null;
    return { message, code: typeof record.code === "string" ? record.code : null };
  }
  return { message: null, code: null };
}

function prefixPattern(codes: readonly string[]): RegExp {
  // Longest first, so `active_board_limit_unconfigured:` is never read as its prefix.
  const alternatives = [...codes].sort((a, b) => b.length - a.length).join("|");
  return new RegExp(`\\b(${alternatives}):`);
}

const ALL_CODES_PATTERN = prefixPattern(SERVER_ERROR_CODES);

/**
 * The server's code for a refusal, from a raw message, an `Error`, a Supabase
 * error or an Edge Function body. Only codes in `allowed` are recognised; any
 * other text yields `null`, never a guess.
 */
export function serverErrorCode(
  input: unknown,
  allowed: readonly ServerErrorCode[] = SERVER_ERROR_CODES,
): ServerErrorCode | null {
  const { message, code } = describe(input);
  if (code && (allowed as readonly string[]).includes(code)) return code as ServerErrorCode;
  if (!message) return null;
  const pattern = allowed === SERVER_ERROR_CODES ? ALL_CODES_PATTERN : prefixPattern(allowed);
  return (pattern.exec(message)?.[1] as ServerErrorCode | undefined) ?? null;
}

/**
 * What the player is told for a recognised refusal, in `locale`; `null` when the
 * refusal is not one the product explains, so the caller keeps its own fallback.
 */
export function serverErrorNotice(
  input: unknown,
  locale: Locale = getActiveLocale(),
  allowed?: readonly ServerErrorCode[],
): string | null {
  const code = serverErrorCode(input, allowed);
  if (!code) return null;
  if (code === "active_board_limit") {
    // The database names whose limit it is; the Ranked function rewrites the
    // message but keeps the distinction ("The other player …").
    const { message } = describe(input);
    const theirs = /a seated player|the other player/i.test(message ?? "");
    return translate(
      locale,
      theirs
        ? "errors.server.active_board_limit.seatedPlayer"
        : "errors.server.active_board_limit.self",
    );
  }
  if (code === "ranked_already_active") {
    // Seen by the claimant through the stakes-aware claim ("you are"); through
    // the older claim the database only knows that a seated player is busy.
    const { message } = describe(input);
    return translate(
      locale,
      /\byou are\b/i.test(message ?? "")
        ? "errors.server.ranked_already_active.self"
        : "errors.server.ranked_already_active.seatedPlayer",
    );
  }
  const key = `errors.server.${code}`;
  return hasMessage(key) ? translate(locale, key) : null;
}
