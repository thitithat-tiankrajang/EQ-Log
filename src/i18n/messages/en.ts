/**
 * English: the default catalogue and the source of the catalogue's shape. The
 * Thai catalogue must have exactly the same keys (checked by the compiler).
 *
 * Canonical product names stay as they are in every language and are never
 * keys here: EQ Lab, Authur, ArchBot, Pro-Bot, the plan names (Free, EQ Plus,
 * EQ Pro) and the Ranked tier names (Bronze, Silver, Gold, Platinum, Diamond,
 * Master). Copy around them is translated; the names themselves are not.
 *
 * Server refusals are keyed by the database's own lowercase `snake_code:`
 * prefix under `errors.server` — see `serverErrors.ts`.
 *
 * A plural message is `{ one, other }`, chosen with `Intl.PluralRules` from the
 * `count` parameter. Placeholders are `{name}`.
 */
export const en = {
  common: {
    language: {
      label: "Language",
      en: "English",
      th: "ไทย",
    },
  },
  errors: {
    generic: "Something went wrong. Please try again.",
    server: {
      funding_required:
        "Choose how to pay for this Authur game first: your Pro-Bot allowance or 1 Credit.",
      funding_not_applicable: "This bot is free to play and needs no allowance or Credits.",
      allowance_free_plan:
        "The Free plan has no Pro-Bot allowance. You can use 1 Credit instead if you have one.",
      allowance_not_configured: "Your plan's Pro-Bot allowance hasn't been set up yet.",
      allowance_weekly_cap:
        "You've used this week's Pro-Bot allowance. It resets on Monday at 00:00 Thailand time.",
      allowance_empty:
        "Your Pro-Bot allowance is used up for now. It refills by 1 every 30 minutes.",
      insufficient_credits: "You don't have enough Pro-Bot Credits.",
      active_board_limit: {
        self: "You already have the maximum number of active boards. Finish or cancel one before starting another.",
        seatedPlayer: "A seated player already has the maximum number of active boards.",
      },
      active_board_limit_unconfigured:
        "New games can't start because the active-board limit isn't configured on the server. Please tell an administrator.",
      bot_pending: "This bot isn't available to play yet.",
      bot_disabled:
        "An administrator has temporarily disabled this bot. The game can continue once it's re-enabled.",
      bot_closed: "This bot no longer accepts new games.",
      stage_level_not_sealed:
        "This Stage isn't ready to play yet: its starting position hasn't been confirmed.",
      stage_level_unavailable: "This Stage isn't open to play.",
      stage_start_mismatch: "This Stage's starting position doesn't match the one set for it.",
      stage_board_rewrite:
        "In a Stage game, tiles already on the board can't be taken back or changed.",
      idempotency_conflict:
        "This request was already used with different settings. Please try creating the game again.",
    },
  },
};
