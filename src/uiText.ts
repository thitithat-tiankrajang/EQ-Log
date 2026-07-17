import type { ActionType, Phase, SlotType } from "./game";

export const TILE_GROUP_LABELS = {
  lightNumber: "Single Digits",
  heavyNumber: "10-20",
  operator: "Operators",
  choice: "Flexible Operators",
  equals: "Equals",
  Blank: "Blanks",
};

export const ACTION_LABELS: Record<ActionType, string> = {
  place_equation: "Place Equation",
  exchange: "Exchange Tiles",
  pass: "Pass",
  end_game: "End Game",
};

export const PHASE_LABELS: Record<Phase, string> = {
  refill: "Refill",
  choose_action: "Choose Action",
  perform_action: "Action Draft",
};

export const SLOT_LABELS: Record<SlotType, string> = {
  px1: "",
  px2: "2P",
  px3: "3P",
  px3star: "3P",
  ex2: "2E",
  ex3: "3E",
};

/* ── Shared vocabulary (design.md §6–7) ─────────────────────────────────────
   One meaning = one word across every page. Buttons say what happens next;
   options are sentences the user could say about themselves; statuses read
   for outsiders. Keep ALL lobby/pregame copy here so wording stays in sync
   and a future Thai translation is a one-file job. */

export const HOME_TEXT = {
  continueEyebrow: "Continue",
  startEyebrow: "Start",
  newMatch: "New match",
  newMatchSub: "Play or record a real game",
  joinWithCode: "Join with a code",
  joinWithCodeSub: "Enter a code or paste a link",
  practiceAlone: "Practice alone",
  practiceAloneSub: "Just you — the app draws tiles",
  signInSheetTitle: "Sign in to create rooms",
  signInSheetBody: "Your rooms and stats sync to your Google account. Joining with a code works without signing in.",
};

export const PLAY_MODE_TEXT = {
  question: "Who is playing?",
  passPlay: "Pass & play",
  passPlayDesc: "Two players share this phone",
  solo: "Solo practice",
  soloDesc: "Just you; the app draws tiles",
  online: "Online",
  onlineDesc: "Choose registered players — each uses their own device",
  onlineNeedsSetup: "Needs online setup (Supabase) before it can be used",
  roleQuestion: "Your role",
  rolePlayer: "I play one side",
  rolePlayerDesc: "Choose your opponent by username",
  roleHostTwo: "I host two players",
  roleHostTwoDesc: "You referee; two registered players compete",
  roleHostOne: "I host one player",
  roleHostOneDesc: "A solo board you supervise",
} as const;

export const TILE_DRAW_TEXT = {
  label: "Tile draw",
  appDraws: "App draws",
  appDrawsDesc: "Shuffles and deals for you",
  realTiles: "Enter real tiles",
  realTilesDesc: "Record draws from a physical bag",
  hostEnters: "Host enters tiles",
  hostEntersDesc: "You type in what players draw",
  setByMode: "Set by play mode",
} as const;

export const TIMER_TEXT = {
  label: "Time per side",
  tournamentTag: "tournament",
  noTimer: "No timer",
  perSide: "Different per side",
} as const;

export const ROOM_STATUS_TEXT = {
  playing: "Playing",
  waiting: "Waiting", // was "Draft" — it's a room waiting to start, not a document draft
  finished: "Finished",
} as const;

export const CREATE_TEXT = {
  playersHeading: "Players",
  rulesHeading: "Time per side",
  advancedHeading: "Advanced",
  advancedNote: "Defaults are fine for a normal match",
  playsFirst: "plays first",
  swapFirst: (side: string) => `Make Side ${side} play first`,
  linkMember: "Link to member",
  linkMemberHint: "Counts this game in Stats",
  notLinked: "Not linked",
  roomNameLabel: "Room name",
  opponentRack: "Opponent rack",
  rackHidden: "Hidden",
  rackHiddenDesc: "Players see only their own tiles — like a real match",
  rackVisible: "Visible",
  rackVisibleDesc: "Players also see the active player's rack",
  submit: "Create match room",
  submitOnline: "Create room & get invite link",
  submitBusy: "Creating room…",
} as const;

export const WAITING_TEXT = {
  roomCode: "Room code",
  copyCode: "Copy",
  copied: "Copied",
  shareLink: "Share invite link",
  playersHeading: "Players",
  settingsHeading: "Settings",
  edit: "Edit",
  saveChanges: "Save changes",
  startGame: "Start game",
  imReady: "I'm ready",
  readyUndo: "Ready ✓ · tap to undo",
  viewerNote: "You're viewing this room. When the game starts you'll watch live.",
  deleteRoom: "Delete room",
  leaveRoom: "Leave room",
  statusInvited: "Invited",
  statusReady: "Ready",
  statusNotReady: "Joined · not ready",
  statusHost: "Host",
  statusHostBoard: "Plays on host's board",
} as const;
