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
  learn: {
    title: "Learn",
    description: "Examine positions and look back at your games.",
    examine: {
      heading: "Examine a position",
      study: "Study a position",
      studyHint:
        "Set up a board and your tiles, then see the best play. Positions you analyse are kept in Study.",
      inGame: "While you play, you can also analyse your own turn from inside the game.",
    },
    review: {
      heading: "Look back at finished games",
      public: "Public game history",
      publicHint: "Replay finished public games move by move.",
      region: "Region game history",
      regionHint: "Replay finished games from your region.",
      saved: "Your saved games",
      savedHint: "Open the games you saved to your private library.",
    },
    arena: {
      eyebrow: "Arena",
      heading: "Test yourself",
      stage: "Stage",
      stageHint: "Start from a set position and try to finish ahead of Authur.",
    },
  },
  stage: {
    title: "Stage",
    description:
      "Start from a set position and play it out against Authur. Finish with the higher score to win the Stage.",
    unranked: "Stages don't count towards a season ranking yet.",
    listLabel: "Stages",
    level: "Stage {number}",
    won: "You've won this Stage",
    play: "Play Stage {number}",
    playShort: "Play",
    starting: "Getting the Stage ready…",
    notReady: "Not open to play yet",
    empty: "No Stages are open yet.",
    needsServer: "Stage needs the game server to be connected.",
    signIn: "Sign in to play a Stage.",
  },
  ranked: {
    confirm: {
      title: "Join Ranked match",
      loading: "Checking the rating at stake…",
      opponent: "Opponent",
      clock: "{minutes} minutes each",
      current: "Your rating now",
      outcomes: "Your rating after the game",
      win: "Win",
      draw: "Draw",
      loss: "Loss",
      outcomeLabel: "{outcome}: {before} to {after}, {change}",
      note: "Ranked games change your rating. The server checks these numbers again when you join.",
      changed: "The rating at stake has changed. Check the new numbers and confirm again.",
      join: "Join Ranked",
      joining: "Joining…",
      cancel: "Cancel",
      close: "Close",
      failed: "The rating at stake couldn't be loaded.",
      retry: "Try again",
    },
    ready: {
      heading: "At stake for you",
      loading: "Checking the rating at stake…",
      confirm: "Ready — play for rating",
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
      approval_required: "An approved account is needed for this.",
      ranked_already_active: {
        self: "You're already in a Ranked match. Finish it before joining another.",
        seatedPlayer: "One of the players is already in another Ranked match.",
      },
      ranked_room_unavailable:
        "This room's creator is playing another Ranked match right now. Try again later.",
      ranked_room_claimed: "Another player has already taken this Ranked room.",
      ranked_room_expired: "This Ranked room is no longer open.",
      ranked_room_not_found: "This Ranked room doesn't exist any more.",
      ranked_room_finished: "This Ranked match has already finished.",
      ranked_own_room: "This is your own Ranked room.",
      ranked_stakes_changed:
        "The rating at stake has changed since you looked. Check the new stakes and confirm again.",
      ranked_stakes_required: "Confirm the rating at stake before joining.",
      sign_in_required: "Sign in to continue.",
      ranked_invalid_request: "That Ranked request isn't valid.",
      ranked_already_waiting: "You already have a Ranked room waiting for an opponent.",
      ranked_not_a_player: "Only the players can open this Ranked match.",
      ranked_match_started: "This Ranked match has already started.",
      ranked_cannot_ready: "This Ranked match can't be readied now.",
      ranked_position_changed: "The position changed. Refresh the match and try again.",
      ranked_request_failed: "Ranked couldn't complete that request. Please try again.",
      idempotency_conflict:
        "This request was already used with different settings. Please try creating the game again.",
    },
  },
};
