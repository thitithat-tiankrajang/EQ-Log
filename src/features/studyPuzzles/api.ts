// Study puzzle sets as the admin page and the one-turn preview reach them.
//
// DEV ONLY for now. The server is tools/study-puzzles/server, mounted into the
// dev server at /study-puzzles by vite.config.ts (tools/study-puzzles/DESIGN.md).
// Everything goes through `studyPuzzleSource`, so an online implementation can
// replace this one without the pages noticing.
//
// Two kinds of set live in the archive: v2 sets, made here from authentic
// self-play, and v1 sets made by Codex's Find Best Play prototype (read-only).
import type { StudyBoardCell } from "../study/position";

// ── v2 ───────────────────────────────────────────────────────────────────────
export type MoveLabel = "EXTEND" | "CROSS" | "HOOK";
export type HookSubtype = "HEAD" | "TAIL" | "JOIN";
export type Range = { min: number | null; max: number | null };
export type TileCategory = "digit" | "heavy" | "operator" | "choice" | "equals" | "blank";
export type TileGroup = TileCategory | "arithmetic" | "operatorLike";
export type EquationScope = "MAIN" | "ANY" | "ALL";
export type EquationProperty =
  | "FRACTION_ADD_SUB"
  | "MUL_DIV_ONLY"
  | "FRACTION_RESULT"
  | "LARGE_INTEGER_RESULT"
  | "NEGATIVE_RESULT";
export type ExtendShape = "HEAD_ONLY" | "TAIL_ONLY" | "BOTH";
export type ContactCategory = "DIGIT" | "HEAVY_NUMBER" | "ARITHMETIC_OPERATOR" | "EQUALS";
export type ContactPair = [ContactCategory, ContactCategory]; // (existing anchor, adjacent new extension)
export type ContentFilter = "any" | "arithmetic" | "fraction" | "fraction-sum" | "large";
export type PuzzleOrigin = "AUTHENTIC_SEEDED" | "CONFIG_GUIDED_RACK";

export type StudyPuzzleConfig = {
  target: number;
  label: string;
  seed: number;
  maxPerGame: number;
  parallelGames: number;
  /** Absent only in archived sets from before guided search. */
  search?: { strategy: "AUTHENTIC_ONLY" | "GUIDED"; rackBudget: number };
  position: { boardTiles: Range };
  bestPlay: {
    score: Range;
    tiles: Range;
    equations: Range;
    /** Inclusive: a move carrying ANY selected label matches. Empty = any. */
    moveTypes: MoveLabel[];
    composition: Record<TileCategory, Range> &
      Partial<Record<"arithmetic" | "operatorLike", Range>>;
    specific?: Record<string, Range>;
    content: ContentFilter;
    excludeTrivialZero: boolean;
  };
  answer: { maxNear: number };
  rack: {
    minDifficulty: number | null;
    size?: Range;
    groups?: Partial<Record<TileGroup, Range>>;
    specific?: Record<string, Range>;
  };
  geometry?: {
    extend: { shapes: ExtendShape[]; headContacts: ContactPair[]; tailContacts: ContactPair[] };
  };
  equation?: {
    scope: EquationScope;
    tiles: Range;
    reusedBoardTiles: Range;
    placedParticipating: Range;
    properties: EquationProperty[];
    largeIntegerThreshold: number;
  };
  mobility?: { legalPlacements: Range };
};

export type GeneratorCounters = {
  gamesStarted: number;
  gamesFinished: number;
  gamesAbandoned: number;
  positionsInspected: number;
  positionsAnalyzed: number;
  positionsEligible: number;
  candidatesEvaluated: number;
  matchingPositions?: number;
  matched: number;
  rejectedPositions: number;
  rejections: Record<string, number>;
  positionsGeometryPruned?: number;
  authenticRacksCompositionPruned?: number;
  guidedRacksGenerated?: number;
  guidedRacksCheapPruned?: number;
  stage5bEvaluations?: number;
  sourceStage5bEvaluations?: number;
  guidedStage5bEvaluations?: number;
  stage5bMatches?: number;
  stage5bMs?: number;
  cheapCheckMs?: number;
  acceptedAuthentic?: number;
  acceptedGuided?: number;
  duplicateRacksSkipped?: number;
  engineErrors?: number;
};

export type SetStatus = "running" | "complete" | "stopped" | "failed" | "interrupted";

/** A puzzle's line in its set. Admin-only: it describes the answer. */
export type PuzzleSummary = {
  origin?: PuzzleOrigin;
  id: string;
  file: string;
  game: number;
  turn: number;
  score: number;
  tilesPlaced: number;
  moveTypes: MoveLabel[];
  primaryType: MoveLabel | null;
  hooks: HookSubtype[];
  equations: number;
  pattern: string;
};

export type StudyPuzzleJob = {
  id: string;
  state: SetStatus;
  config: StudyPuzzleConfig;
  target: number;
  startedAt: string;
  finishedAt: string | null;
  elapsedMs: number;
  matched: number;
  counters: GeneratorCounters | null;
  recent: PuzzleSummary[];
  logs: string[];
  error: string | null;
  stopRequested: boolean;
};

export type StudyPuzzleStatus = {
  engine: { ready: boolean; dir: string; problems: string[] };
  job: StudyPuzzleJob | null;
};

export type SetSummary = {
  id: string;
  version: 1 | 2;
  label: string | null;
  status: SetStatus;
  createdAt: string;
  finishedAt?: string | null;
  count: number;
  requested: number;
  /** v1 only: the mode Codex's generator was run with. */
  mode: string | null;
  scoreRange: [number, number] | null;
  moveTypes?: MoveLabel[];
};

export type SetManifest = {
  schema: "eqlab-study-puzzle-set-v2";
  id: string;
  label: string;
  status: SetStatus;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  durationMs?: number;
  target: number;
  config: StudyPuzzleConfig;
  engine: Record<string, unknown>;
  counters: GeneratorCounters;
  error: string | null;
  puzzles: PuzzleSummary[];
};

export type PuzzleCell = { r: number; c: number; kind: string; face: string };
export type EquationTile = PuzzleCell & { new: boolean };

export type PuzzleEquation = {
  role: "main" | "hook";
  hookSubtype?: HookSubtype;
  direction: "horizontal" | "vertical";
  tiles: EquationTile[];
  text: string;
  pattern: string;
  score: number;
  multiplier: number;
  tileCount?: number;
  placedParticipating?: number;
  reusedBoardTiles?: number;
  semantics?: {
    result: { numerator: string; denominator: string };
    fractionAddSub: boolean;
    mulDivOnly: boolean;
    fractionResult: boolean;
    negativeResult: boolean;
    operations: string[];
  };
};

export type EngineCandidate = {
  rank: number;
  type: "place" | "exchange" | "pass";
  placements: PuzzleCell[];
  exchange: string[];
  score: number;
  value: number;
  deep?: boolean;
  components: { name: string; points: number }[];
};

/** The whole puzzle — canonical position, source game and the engine's answer. ADMIN ONLY. */
export type PuzzleRecord = {
  schema: "eqlab-study-puzzle-v2";
  id: string;
  setId: string;
  index: number;
  hashes: { position: string; puzzle: string };
  canonical: {
    provenance?: {
      origin: PuzzleOrigin;
      originalRack?: string[];
      constructedRack?: string[];
      sourcePositionHash?: string;
      candidateIndex?: number;
      strategyVersion?: string;
    };
    source: {
      game: number;
      seed: number;
      policy: { engine: string; request: string; topN: number };
      log: {
        format: string;
        sourceSeed: number;
        turns: {
          turn: number;
          side: "A" | "B";
          type: "place" | "exchange" | "pass";
          action: { placements?: { cell: number; kind: string; face: string }[]; kinds?: string[] };
          scoreGained: number;
          scoresAfter: Record<"A" | "B", number>;
        }[];
        puzzle: { turn: number; sideToMove: "A" | "B" };
      };
    };
    position: {
      sideToMove: "A" | "B";
      turnNumber: number;
      board: (PuzzleCell & { side: "A" | "B"; turn: number })[];
      rack: string[];
      scores: { self: number; opponent: number };
      bagCount: number;
      oppRackCount: number;
      noScoreStreak: number;
      unseen: Record<string, number>;
      hidden: { opponentRack: string[]; bag: string[] };
    };
  };
  answer: {
    engine: { solver: string; legalMoves: number | null; candidates: EngineCandidate[] };
    best: {
      placements: PuzzleCell[];
      score: number;
      value: number;
      components: EngineCandidate["components"];
    };
    nearBest: {
      rank: number;
      type: string;
      score: number;
      value: number;
      placements: PuzzleCell[];
    }[];
    equations: PuzzleEquation[];
    bingoBonus: number;
    moveTypes: MoveLabel[];
    primaryType: MoveLabel | null;
    moveFacts: {
      equationCount: number;
      main: { direction: string; tiles: number; placed: number; reusedSegments: number[] };
      hooks: { subtype: HookSubtype; direction: string; before: number; after: number }[];
    };
    geometry?: {
      extend: {
        shape: ExtendShape | null;
        headContact: ContactPair | null;
        tailContact: ContactPair | null;
        headContacts?: ContactPair[];
        tailContacts?: ContactPair[];
      } | null;
    };
    placedKinds?: string[];
    composition: Record<TileCategory, number> & { total: number };
    patterns: { main: string; hooks: string[] };
    content: {
      arithmetic: boolean;
      fraction: boolean;
      fractionSum: boolean;
      large: boolean;
      trivialZero: boolean;
    };
    checks: { stage5b: number; eqlab: number; amathCli: number };
  };
  features: Record<string, unknown>;
};

export type AttemptRecord = {
  id: string;
  submittedAt: string;
  by: { kind: "admin-preview" | "player" };
  move: { placements: PuzzleCell[] };
  validation: {
    valid: boolean;
    score: number;
    equations: { text: string; score: number }[];
    errors: string[];
  };
  grade: {
    comparable: boolean;
    sameAsBest?: boolean;
    withinNearBest?: boolean;
    engineRank?: number | null;
    scoreRatio?: number | null;
  };
};

/** What a player receives: the position, and that one placement is due. */
export type PlayerPuzzle = {
  format: "study-puzzle-player-v1";
  setId: string;
  puzzleId: string;
  positionHash: string;
  position: {
    board: PuzzleCell[];
    rack: string[];
    scores: { self: number; opponent: number };
    turnNumber: number;
    bagCount: number;
    oppRackCount: number;
    unseen: Record<string, number>;
  };
  rules: { move: "place" };
};

/** The reply to a submission: the player's own move, scored. Never the answer. */
export type SubmissionResult = {
  attemptId: string;
  valid: true;
  score: number;
  yourEquations: { text: string; score: number }[];
};

export type VerifyResult = {
  ok: boolean;
  origin?: PuzzleOrigin;
  checks?: Record<string, { ok: boolean; error?: string; score?: number }>;
  modes: Record<"seed" | "log", { ok: boolean; turns?: number; error?: string }>;
};

// ── v1 (Codex's Find Best Play sets, read-only) ─────────────────────────────
export type LegacyMode =
  "any" | "bingo" | "cross" | "arithmetic" | "fraction" | "fraction-sum" | "large";

export type LegacyMove = { score: number; value: number; placements: StudyBoardCell[] };

export type LegacyPuzzle = {
  id: string;
  board: StudyBoardCell[];
  rack: string[];
  scores: { self: number; opponent: number };
  bagCount: number;
  source: { game: number; turn: number; profile: string };
  difficulty: {
    index: number;
    opCount: number;
    duplicates: number;
    equals: number;
    blanks: number;
  };
  features: {
    bingo: boolean;
    cross: number;
    arithmetic: boolean;
    fraction: boolean;
    fractionSum: boolean;
    large: boolean;
    main: { text: string; length: number; newTiles: number };
  };
  answer: LegacyMove & { type: "place"; components?: { name: string; points: number }[] };
  alternative: (LegacyMove & { type: "place" }) | null;
  nearBest: LegacyMove[];
  search: { solver: string; legalMoves: number; deepTop: number };
};

export type LegacySet = SetSummary & {
  version: 1;
  config: { seed?: number; label?: string } | null;
  durationMs: number | null;
  scanned: number | null;
  errors: number;
  puzzles: LegacyPuzzle[];
};

export type SetV2 = SetSummary & { version: 2; manifest: SetManifest };
export type AnySet = SetV2 | LegacySet;
export type LegacyFile = "student.html" | "teacher.html" | "puzzles.json";

export type StudyPuzzleSource = {
  status(): Promise<StudyPuzzleStatus>;
  sets(): Promise<SetSummary[]>;
  set(id: string): Promise<AnySet>;
  puzzle(
    setId: string,
    puzzleId: string,
  ): Promise<{ puzzle: PuzzleRecord; attempts: AttemptRecord[] }>;
  verify(setId: string, puzzleId: string): Promise<VerifyResult>;
  play(setId: string, puzzleId: string): Promise<PlayerPuzzle>;
  submit(setId: string, puzzleId: string, placements: PuzzleCell[]): Promise<SubmissionResult>;
  generate(config: StudyPuzzleConfig): Promise<{ id: string }>;
  cancel(): Promise<void>;
  /** A v1 set's own classroom files. */
  fileUrl(id: string, file: LegacyFile): string;
};

const BASE = "/study-puzzles/api";

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string; errors?: string[] };
  if (!response.ok) {
    throw new Error(
      data.error ??
        data.errors?.join(" · ") ??
        `Study puzzle server: ${response.status} ${response.statusText}`,
    );
  }
  return data as T;
}

const at = (setId: string, puzzleId: string) =>
  `/sets/${encodeURIComponent(setId)}/puzzles/${encodeURIComponent(puzzleId)}`;

export const studyPuzzleSource: StudyPuzzleSource = {
  status: () => call<StudyPuzzleStatus>("GET", "/status"),
  sets: async () => (await call<{ sets: SetSummary[] }>("GET", "/sets")).sets,
  set: (id) => call<AnySet>("GET", `/sets/${encodeURIComponent(id)}`),
  puzzle: (setId, puzzleId) => call("GET", at(setId, puzzleId)),
  verify: (setId, puzzleId) => call<VerifyResult>("POST", `${at(setId, puzzleId)}/verify`),
  play: (setId, puzzleId) => call<PlayerPuzzle>("GET", `${at(setId, puzzleId)}/play`),
  submit: (setId, puzzleId, placements) =>
    call<SubmissionResult>("POST", `${at(setId, puzzleId)}/attempts`, { placements }),
  generate: (config) => call<{ id: string }>("POST", "/generate", { config }),
  cancel: async () => {
    await call("POST", "/cancel");
  },
  fileUrl: (id, file) => `${BASE}/sets/${encodeURIComponent(id)}/${file}`,
};
