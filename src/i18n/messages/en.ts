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
    back: "Back",
    close: "Close",
  },
  nav: {
    label: "Primary navigation",
    brandHome: "EQ Lab home",
    home: "Home",
    learn: "Learn",
    create: "Create",
    createGame: "Create game",
    ranked: "Ranked",
    account: "Your account: {name}",
    me: "Me",
  },
  create: {
    title: "Create a game",
    intro: "Set up an unranked game, with others or on your own.",
    choices: "What do you want to set up?",
    choice: {
      match: {
        title: "Play another player",
        description: "You take one side. Your opponent plays on their own device.",
      },
      host: {
        title: "Host a game",
        description: "Run the board for one or two players without taking a seat yourself.",
      },
      passplay: {
        title: "Pass & Play / Record",
        description:
          "Both sides on this device. Let the app draw tiles, or enter real tiles to record a game played on a board.",
      },
      solo: {
        title: "Solo practice",
        description: "Just you. Practise and build your score.",
      },
      custom: {
        title: "Custom game",
        description: "Every option, one step at a time.",
      },
    },
    needsOnline: "Needs the online service",
    join: "Have a code? Join a game",
    formSubtitle: "Set up your game.",
    scope: {
      heading: "Who can watch",
      public: "Public",
      publicHint: "Approved members can watch. Replays go to History.",
      region: "Region",
      regionHint: "Your region can watch. Replays stay there.",
      regionUnavailable: "Ask an admin to assign your region",
      private: "Private",
      privateHint: "Invite only. Save or discard when done.",
    },
  },
  me: {
    title: "Me",
    description: "Your account, games and settings",
    account: {
      heading: "Account",
      region: "Region: {region}",
      noRegion: "No region assigned yet",
      admin: "Administrator",
      localOnly: "Playing on this device without an account",
    },
    ranked: {
      heading: "Ranked",
      rating: "{tier} · {rating}",
      games: { one: "{count} ranked game", other: "{count} ranked games" },
      loading: "Loading your rating…",
      unavailable: "Your Ranked rating could not be loaded right now.",
      open: "Open Ranked",
    },
    games: {
      heading: "Your games",
      profile: "Game statistics",
      profileHint: "Your record in every mode",
      saved: "Saved games",
      savedHint: "Your private library and folders",
    },
    live: {
      heading: "Live games",
      public: "Public games",
      publicHint: "Watch or join games open to every member",
      region: "Region games",
      regionHint: "Games in your region",
    },
    settings: {
      heading: "Settings",
    },
    admin: {
      link: "Admin",
      hint: "Approvals, regions, bots and plans",
    },
    signOut: "Sign out",
  },
  analysis: {
    /** A deep-analysis level named after the bot that runs it. */
    botLevel: "{bot} · {depth}-turn deep check",
  },
  study: {
    seeAnswerWith: "See the answer with {bot}",
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
