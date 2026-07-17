import {
  BINGO_BONUS,
  BOARD_SIZE,
  DEFAULT_TIMER_MINUTES,
  MIN_TIMER_SECONDS,
  RACK_SIZE,
} from "./constants/gameRules";
import {
  BLANK_ASSIGNMENT_OPTIONS,
  EVALUATOR_MARKS,
  TENS_TOKENS,
  UNIT_TOKENS,
} from "./constants/equationRules";
import {
  AMATH_TOKENS,
  type AmathToken,
  type AmathTokenInfo,
  type TokenType,
} from "./constants/tileDefinitions";
import { BOARD_LAYOUT, type SlotType } from "./constants/boardLayout";

export { AMATH_TOKENS, BLANK_ASSIGNMENT_OPTIONS, BOARD_LAYOUT };
export type { AmathToken, AmathTokenInfo, SlotType, TokenType };

export type Side = "A" | "B";

export type GameMode = "versus" | "solo";
export type TileDrawMode = "manual" | "play";
export type EmailPlayMode = "hosted" | "direct";
export type RoomStage = "waiting" | "playing";
export type SideTimerMinutes = Record<Side, number | null>;


export type TileInstance = {
  id: string;
  token: AmathToken;
  assignedToken?: string;
};

export type PendingExchangeReturnBySide = Partial<Record<Side, TileInstance[]>>;

export type BoardCell = {
  tile: TileInstance;
  placedTurn: number;
  side: Side;
};

export type BoardSnapshot = Array<Array<BoardCell | null>>;

export type PendingPlacement = {
  tile: TileInstance;
  row: number;
  col: number;
  assignedToken?: string;
  cursorDir?: "right" | "down" | "left" | "up";
  rackSlot?: number;
};

export type Phase = "refill" | "choose_action" | "perform_action";
/**
 * Game lifecycle.
 * - "playing"  : actively in progress, clock ticks, actions allowed
 * - "draft"    : owner clicked Save & Exit while mid-game; same data as
 *                 "playing" but timer is paused and actions are blocked until
 *                 the user clicks Resume.
 * - "finished" : owner ended the game (or the natural end-of-game trigger
 *                 fired). Cannot be resumed; only Replay / Result are offered.
 */
export type GameStatus = "playing" | "draft" | "finished";
export type ActionType = "place_equation" | "exchange" | "pass" | "end_game";

export type EquationDetection = {
  direction: "horizontal" | "vertical";
  cells: { row: number; col: number }[];
  expressionText: string;
  leftValue?: number;
  rightValue?: number;
  values?: number[];
  isValid: boolean;
  error?: string;
  score: number;
  /** Equation multiplier applied to this run. */
  multiplier: number;
};

export type PlaceEquationDetail = {
  placedTiles: {
    tileId: string;
    token: AmathToken;
    displayToken: string;
    assignedToken?: string;
    row: number;
    col: number;
  }[];
  equationsDetected: EquationDetection[];
  isMoveValid: boolean;
  errors: string[];
};

export type ExchangeDetail = {
  outgoingTiles: TileInstance[];
  incomingTiles: TileInstance[];
};

export type PassDetail = {
  reason?: string;
};

export type EndGameReason = "rack_out" | "no_score_streak" | "perfect_game" | "manual" | "surrender";

export type EndGameDetail = {
  reason: EndGameReason;
  description: string;
  bonusSide?: Side;
  bonusPoints: number;
  rackPoints?: Record<Side, number>;
  opponentRackPoints?: number;
  tilebagPoints?: number;
  noScoreStreak?: number;
  surrenderedSide?: Side;
};

export type MatchControl = {
  stopRequest?: {
    id: string;
    requestedBy: Side;
    requestedAt: string;
  };
  stopBlockedUntilBySide?: Partial<Record<Side, string>>;
  stoppedBy?: Side | "host";
  surrenderedSide?: Side;
};

export type TurnActionDetail = PlaceEquationDetail | ExchangeDetail | PassDetail | EndGameDetail;

export type TurnLog = {
  id: string;
  turnNumber: number;
  side: Side;
  action: ActionType;
  startedAt: string;
  endedAt: string;
  timerBefore: Record<Side, number>;
  timerAfter: Record<Side, number>;
  rackBefore: TileInstance[];
  rackAfter: TileInstance[];
  boardBefore: BoardSnapshot;
  boardAfter: BoardSnapshot;
  tilebagBefore: TileInstance[];
  tilebagAfter: TileInstance[];
  actionDetail: TurnActionDetail;
  calculatedScore: number;
  manualScore?: number;
  finalScore: number;
  note?: string;
  stars?: number; // self-review rating 0–5 (does not affect the game score)
};

export function aggregatePendingExchangeReturns(pending: PendingExchangeReturnBySide | undefined): TileInstance[] {
  return [...(pending?.A ?? []), ...(pending?.B ?? [])];
}

export function getPendingExchangeReturnBySide(game: {
  activeSide: Side;
  pendingExchangeReturn?: TileInstance[];
  pendingExchangeReturnBySide?: PendingExchangeReturnBySide;
}): Record<Side, TileInstance[]> {
  if (game.pendingExchangeReturnBySide) {
    return {
      A: game.pendingExchangeReturnBySide.A ?? [],
      B: game.pendingExchangeReturnBySide.B ?? [],
    };
  }

  const legacyPending = game.pendingExchangeReturn ?? [];
  if (legacyPending.length === 0) return { A: [], B: [] };

  // Legacy saves only had one shared pending bucket, created by the side that
  // just exchanged before the turn switched.
  const legacySide = otherSide(game.activeSide);
  return legacySide === "A" ? { A: legacyPending, B: [] } : { A: [], B: legacyPending };
}

export type GameSnapshot = {
  commitId: string;
  gameId: string;
  name: string;
  /** versus alternates A/B; solo keeps every turn, score, and timer on A. */
  gameMode?: GameMode;
  players: Record<Side, string>;
  /** Optional pointer to an organization member id per side. */
  playerMembers?: Partial<Record<Side, string>>;
  /**
   * Player email per side (kept in lowercase). Email modes assign each side
   * to a separate signed-in account.
   */
  playerEmails?: Partial<Record<Side, string>>;
  /** hosted = creator manages two remote players; direct = creator is one player. */
  emailPlayMode?: EmailPlayMode;
  /** Whether email players may see the active opponent's rack while waiting. */
  emailPlayersCanSeeOpponentRack?: boolean;
  /** Pause consensus and surrender metadata; synchronized with the room state. */
  matchControl?: MatchControl;
  /** Pre-game navigation state. Legacy saves without this field are already playing. */
  roomStage?: RoomStage;
  /** Ready state belongs to the waiting room and does not affect game turns. */
  lobbyReadyBySide?: Partial<Record<Side, boolean>>;
  /** The side that went first this game; used for "starting position" filters. */
  startingSide?: Side;
  /** manual = record a physical bag; play = app draws from a shuffled queue. */
  tileDrawMode?: TileDrawMode;
  turnNumber: number;
  activeSide: Side;
  phase: Phase;
  status: GameStatus;
  boardSize: number;
  board: BoardSnapshot;
  rackA: TileInstance[];
  rackB: TileInstance[];
  tilebag: TileInstance[];
  pendingExchangeReturn: TileInstance[];
  pendingExchangeReturnBySide?: PendingExchangeReturnBySide;
  timers: {
    A: number;
    B: number;
    initialSeconds: number;
    initialSecondsBySide?: Record<Side, number>;
    sideUntimed?: Partial<Record<Side, boolean>>;
    paused: boolean;
    minSeconds: number;
    untimed?: boolean;
  };
  scores: Record<Side, number>;
  logs: TurnLog[];
  currentTurnStartedAt: string;
  createdAt: string;
};

export type GameState = GameSnapshot & {
  history: GameSnapshot[];
  historyIndex: number;
  lastSavedAt: string;
};

export type NewGameSettings = {
  name: string;
  gameMode?: GameMode;
  playerA: string;
  playerB: string;
  playerAMemberId?: string | null;
  playerBMemberId?: string | null;
  /**
   * Player email per side. Both email modes require two different addresses;
   * direct mode includes the creator, hosted mode excludes the creator.
   */
  playerAEmail?: string | null;
  playerBEmail?: string | null;
  emailPlayMode?: EmailPlayMode;
  emailPlayersCanSeeOpponentRack?: boolean;
  minutes?: number;
  timerMinutes?: SideTimerMinutes;
  startingSide: Side;
  tileDrawMode?: TileDrawMode;
  untimed?: boolean;
};

export type MoveValidation = {
  isValid: boolean;
  errors: string[];
  equations: EquationDetection[];
  /** total move score = Σ equation scores + bingoBonus */
  score: number;
  /** +40 when all 8 tiles are placed in one turn, else 0 */
  bingoBonus: number;
};

// ── A-Math equation rules (ported from solution.js: Condition + Check_Equation) ──
// Display token to evaluator token; numbers, +, -, and = stay as-is.
function toEvalToken(token: string): string {
  if (token === "×") return "*";
  if (token === "÷") return "/";
  return token;
}

export function slotTypeAt(row: number, col: number): SlotType {
  return BOARD_LAYOUT[row]?.[col] ?? "px1";
}

export function otherSide(side: Side): Side {
  return side === "A" ? "B" : "A";
}

export function getGameMode(game: { gameMode?: GameMode }): GameMode {
  return game.gameMode === "solo" ? "solo" : "versus";
}

export function createBoard(size = BOARD_SIZE): BoardSnapshot {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}

export function getTileDrawMode(game: { tileDrawMode?: TileDrawMode }): TileDrawMode {
  return game.tileDrawMode ?? "manual";
}

export function createInitialTilebag(options: { shuffleForPlay?: boolean } = {}): TileInstance[] {
  const tiles = (Object.keys(AMATH_TOKENS) as AmathToken[]).flatMap((token) => {
    const info = AMATH_TOKENS[token];
    return Array.from({ length: info.count }, (_, index) => ({
      id: `${tokenIdPrefix(token)}_${index + 1}`,
      token,
    }));
  });
  return options.shuffleForPlay ? shuffleTilebagQueue(tiles) : tiles;
}

export function shuffleTilebagQueue(tilebag: TileInstance[]): TileInstance[] {
  if (tilebag.length <= 1) return tilebag.slice();

  const total = tilebag.length;
  const groups = new Map<AmathToken, TileInstance[]>();
  for (const tile of tilebag) {
    const group = groups.get(tile.token);
    if (group) group.push(tile);
    else groups.set(tile.token, [tile]);
  }

  const positioned = Array.from(groups.values()).flatMap((group) => {
    const shuffledGroup = shuffleArray(group);
    const spacing = total / shuffledGroup.length;
    const offset = Math.random() * spacing;
    return shuffledGroup.map((tile, index) => ({
      tile,
      position: (offset + index * spacing + (Math.random() - 0.5) * spacing * 0.45 + total) % total,
      tieBreaker: Math.random(),
    }));
  });

  return positioned
    .sort((a, b) => a.position - b.position || a.tieBreaker - b.tieBreaker)
    .map((item) => item.tile);
}

function shuffleArray<T>(items: T[]): T[] {
  const next = items.slice();
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

export function displayToken(tile: TileInstance): string {
  if (tile.assignedToken) return normalizeDisplayToken(tile.assignedToken);
  return AMATH_TOKENS[tile.token].token;
}

function normalizeDisplayToken(token: string): string {
  if (token === "/") return "÷";
  if (token === "x//" || token === "×/÷") return "x/÷";
  return token;
}

export function tilePoint(tile: TileInstance): number {
  return AMATH_TOKENS[tile.token].point;
}

export function getTileType(tile: TileInstance): TokenType {
  return AMATH_TOKENS[tile.token].type;
}

export function getRack(game: GameState | GameSnapshot, side: Side): TileInstance[] {
  return side === "A" ? game.rackA : game.rackB;
}

export function setRack<T extends GameState | GameSnapshot>(
  game: T,
  side: Side,
  rack: TileInstance[],
): T {
  return side === "A" ? { ...game, rackA: rack } : { ...game, rackB: rack };
}

export function createNewGame(settings: NewGameSettings): GameState {
  const now = new Date().toISOString();
  const gameMode = settings.gameMode ?? "versus";
  const isSolo = gameMode === "solo";
  const rawEmailA = normalizeEmail(settings.playerAEmail);
  const rawEmailB = normalizeEmail(settings.playerBEmail);
  const emailPlayMode: EmailPlayMode | undefined =
    rawEmailA || (!isSolo && rawEmailB)
      ? isSolo
        ? "hosted"
        : settings.emailPlayMode ?? "hosted"
      : undefined;
  const emailA = rawEmailA;
  const emailB = isSolo ? null : rawEmailB;
  const hasEmailPlayers = Boolean(emailA || emailB);
  const configuredTimerMinutes = normalizeTimerMinutes(settings);
  const timerMinutes: SideTimerMinutes = isSolo
    ? { A: configuredTimerMinutes.A, B: null }
    : configuredTimerMinutes;
  const secondsBySide: Record<Side, number> = {
    A: minutesToSeconds(timerMinutes.A),
    B: minutesToSeconds(timerMinutes.B),
  };
  const sideUntimed: Partial<Record<Side, boolean>> = {
    A: timerMinutes.A === null,
    B: timerMinutes.B === null,
  };
  const allUntimed = sideUntimed.A === true && sideUntimed.B === true;
  const initialSeconds = Math.max(secondsBySide.A, secondsBySide.B, 1);
  const tileDrawMode: TileDrawMode =
    emailPlayMode === "direct" || (isSolo && !hasEmailPlayers)
      ? "play"
      : settings.tileDrawMode ?? "manual";
  const initialQueue = createInitialTilebag({ shuffleForPlay: tileDrawMode === "play" });
  const initialRack = tileDrawMode === "play" ? initialQueue.slice(0, RACK_SIZE) : [];
  const initialTilebag =
    tileDrawMode === "play" ? shuffleTilebagQueue(initialQueue.slice(initialRack.length)) : initialQueue;
  const playerMembers: Partial<Record<Side, string>> = {};
  if (settings.playerAMemberId) playerMembers.A = settings.playerAMemberId;
  if (settings.playerBMemberId) playerMembers.B = settings.playerBMemberId;
  const playerEmails: Partial<Record<Side, string>> = {};
  if (emailA) playerEmails.A = emailA;
  if (emailB) playerEmails.B = emailB;
  const base: Omit<GameState, "history" | "historyIndex" | "lastSavedAt"> = {
    commitId: crypto.randomUUID(),
    gameId: crypto.randomUUID(),
    name: settings.name.trim() || "EQuation Math",
    gameMode,
    players: {
      A: settings.playerA.trim() || "A",
      B: isSolo ? "" : settings.playerB.trim() || "B",
    },
    playerMembers: isSolo
      ? playerMembers.A
        ? { A: playerMembers.A }
        : undefined
      : Object.keys(playerMembers).length > 0
        ? playerMembers
        : undefined,
    playerEmails: hasEmailPlayers ? playerEmails : undefined,
    emailPlayMode,
    emailPlayersCanSeeOpponentRack: !isSolo && hasEmailPlayers
      ? settings.emailPlayersCanSeeOpponentRack ?? false
      : undefined,
    roomStage: "playing",
    lobbyReadyBySide: {},
    startingSide: isSolo ? "A" : settings.startingSide,
    tileDrawMode,
    turnNumber: 1,
    activeSide: isSolo ? "A" : settings.startingSide,
    phase: tileDrawMode === "play" ? "choose_action" : "refill",
    status: "playing",
    boardSize: BOARD_SIZE,
    board: createBoard(BOARD_SIZE),
    rackA: isSolo || settings.startingSide === "A" ? initialRack : [],
    rackB: !isSolo && settings.startingSide === "B" ? initialRack : [],
    tilebag: initialTilebag,
    pendingExchangeReturn: [],
    pendingExchangeReturnBySide: { A: [], B: [] },
    timers: {
      A: secondsBySide.A,
      B: secondsBySide.B,
      initialSeconds,
      initialSecondsBySide: secondsBySide,
      sideUntimed,
      paused: false,
      minSeconds: MIN_TIMER_SECONDS,
      untimed: Boolean(settings.untimed) || allUntimed,
    },
    scores: { A: 0, B: 0 },
    logs: [],
    currentTurnStartedAt: now,
    createdAt: now,
  };
  const snapshot = makeSnapshot(base);
  return {
    ...base,
    history: [snapshot],
    historyIndex: 0,
    lastSavedAt: now,
  };
}

function normalizeTimerMinutes(settings: NewGameSettings): SideTimerMinutes {
  if (settings.timerMinutes) {
    return {
      A: normalizeTimerMinute(settings.timerMinutes.A),
      B: normalizeTimerMinute(settings.timerMinutes.B),
    };
  }
  if (settings.untimed) return { A: null, B: null };
  const minutes = normalizeTimerMinute(settings.minutes ?? DEFAULT_TIMER_MINUTES) ?? DEFAULT_TIMER_MINUTES;
  return { A: minutes, B: minutes };
}

function normalizeTimerMinute(value: number | null | undefined): number | null {
  if (value === null) return null;
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return DEFAULT_TIMER_MINUTES;
  return minutes;
}

function minutesToSeconds(minutes: number | null): number {
  return minutes === null ? 0 : Math.max(1, Math.round(minutes * 60));
}

export function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

export function makeSnapshot(game: Omit<GameState, "history" | "historyIndex" | "lastSavedAt">): GameSnapshot;
export function makeSnapshot(game: GameState): GameSnapshot;
export function makeSnapshot(game: GameState | Omit<GameState, "history" | "historyIndex" | "lastSavedAt">): GameSnapshot {
  return deepClone({
    commitId: crypto.randomUUID(),
    gameId: game.gameId,
    name: game.name,
    gameMode: getGameMode(game),
    players: game.players,
    playerMembers: game.playerMembers,
    playerEmails: game.playerEmails,
    emailPlayMode: game.emailPlayMode,
    emailPlayersCanSeeOpponentRack: game.emailPlayersCanSeeOpponentRack,
    matchControl: game.matchControl,
    roomStage: game.roomStage,
    lobbyReadyBySide: game.lobbyReadyBySide,
    startingSide: game.startingSide,
    tileDrawMode: getTileDrawMode(game),
    turnNumber: game.turnNumber,
    activeSide: game.activeSide,
    phase: game.phase,
    status: game.status,
    boardSize: game.boardSize,
    board: game.board,
    rackA: game.rackA,
    rackB: game.rackB,
    tilebag: game.tilebag,
    pendingExchangeReturn: aggregatePendingExchangeReturns(getPendingExchangeReturnBySide(game)),
    pendingExchangeReturnBySide: getPendingExchangeReturnBySide(game),
    timers: game.timers,
    scores: game.scores,
    logs: game.logs,
    currentTurnStartedAt: game.currentTurnStartedAt,
    createdAt: game.createdAt,
  });
}

export function pushActionSnapshot(game: GameState): GameState {
  const history = game.history.slice(0, game.historyIndex + 1);
  const snapshot = makeSnapshot(game);
  history.push(snapshot);
  return {
    ...game,
    history,
    historyIndex: history.length - 1,
    lastSavedAt: new Date().toISOString(),
  };
}

export function restoreSnapshot(game: GameState, index: number): GameState {
  const snapshot = game.history[index];
  return {
    ...deepClone(snapshot),
    history: game.history,
    historyIndex: index,
    lastSavedAt: new Date().toISOString(),
  };
}

export function calculateTotals(logs: TurnLog[]): Record<Side, number> {
  return logs.reduce<Record<Side, number>>(
    (totals, log) => {
      totals[log.side] += log.finalScore;
      return totals;
    },
    { A: 0, B: 0 },
  );
}

export function updateLogScore(
  logs: TurnLog[],
  logId: string,
  manualScore?: number,
): TurnLog[] {
  return logs.map((log) => {
    if (log.id !== logId) return log;
    const finalScore = manualScore ?? log.calculatedScore;
    return {
      ...log,
      manualScore,
      finalScore,
    };
  });
}

export function updateLogNote(logs: TurnLog[], logId: string, note: string): TurnLog[] {
  return logs.map((log) => (log.id === logId ? { ...log, note } : log));
}

export function formatSeconds(seconds: number): string {
  const sign = seconds < 0 ? "-" : "";
  const absolute = Math.abs(seconds);
  const minutes = Math.floor(absolute / 60);
  const secs = absolute % 60;
  return `${sign}${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function getDefaultAssignment(token: AmathToken): string | undefined {
  if (token === "+/-") return "+";
  if (token === "x//") return "×";
  if (token === "?") return "0";
  return undefined;
}

export function getAssignmentOptions(token: AmathToken): readonly string[] {
  if (token === "+/-") return ["+", "-"];
  if (token === "x//") return ["×", "÷"];
  if (token === "?") return BLANK_ASSIGNMENT_OPTIONS;
  return [];
}

export function tileNeedsAssignment(token: AmathToken): boolean {
  return token === "+/-" || token === "x//" || token === "?";
}

export function validateMove(
  board: BoardSnapshot,
  pendingPlacements: PendingPlacement[],
): MoveValidation {
  const errors: string[] = [];
  if (pendingPlacements.length === 0) {
    return {
      isValid: false,
      errors: ["Place at least one tile."],
      equations: [],
      score: 0,
      bingoBonus: 0,
    };
  }

  const size = board.length;
  const pendingMap = new Map<string, PendingPlacement>();
  for (const placement of pendingPlacements) {
    if (
      placement.row < 0 ||
      placement.row >= size ||
      placement.col < 0 ||
      placement.col >= size
    ) {
      errors.push("A tile is outside the board.");
      continue;
    }
    if (board[placement.row]?.[placement.col]) {
      errors.push("A new tile overlaps an occupied cell.");
    }
    const key = cellKey(placement.row, placement.col);
    if (pendingMap.has(key)) {
      errors.push("More than one new tile is in the same cell.");
    }
    pendingMap.set(key, placement);
    if (tileNeedsAssignment(placement.tile.token) && !placement.assignedToken) {
      errors.push(`Assign a value for ${AMATH_TOKENS[placement.tile.token].token}.`);
    }
  }

  const rows = new Set(pendingPlacements.map((placement) => placement.row));
  const cols = new Set(pendingPlacements.map((placement) => placement.col));
  const sameRow = rows.size === 1;
  const sameCol = cols.size === 1;
  if (!sameRow && !sameCol) {
    errors.push("Tiles placed in one turn must be in a single line.");
  }

  if (sameRow || sameCol) {
    const row = pendingPlacements[0].row;
    const col = pendingPlacements[0].col;
    const axis = sameRow ? "row" : "col";
    const values = pendingPlacements.map((placement) =>
      axis === "row" ? placement.col : placement.row,
    );
    const min = Math.min(...values);
    const max = Math.max(...values);
    for (let value = min; value <= max; value += 1) {
      const scanRow = axis === "row" ? row : value;
      const scanCol = axis === "row" ? value : col;
      if (!board[scanRow][scanCol] && !pendingMap.has(cellKey(scanRow, scanCol))) {
        errors.push("Placed tiles must be continuous with no gaps.");
        break;
      }
    }
  }

  const boardHasTile = board.some((row) => row.some(Boolean));
  if (boardHasTile) {
    const touchesExisting = pendingPlacements.some((placement) =>
      neighbors(placement.row, placement.col, size).some(([row, col]) => Boolean(board[row][col])),
    );
    if (!touchesExisting) {
      errors.push("New tiles must connect to existing board tiles.");
    }
  } else {
    const center = Math.floor(size / 2);
    const coversCenterStar = pendingPlacements.some(
      (placement) => placement.row === center && placement.col === center,
    );
    if (!coversCenterStar) {
      errors.push("The first equation must cover the center star.");
    }
  }

  const equations = detectEquations(board, pendingPlacements);
  if (equations.length === 0) {
    errors.push("The move must create at least one equation.");
  }

  const invalidEquation = equations.find((equation) => !equation.isValid);
  if (invalidEquation?.error) {
    errors.push(invalidEquation.error);
  }

  const equationScore = equations.reduce((total, equation) => total + equation.score, 0);
  // Bingo: placing all 8 rack tiles in one turn earns +40.
  const bingoBonus = pendingPlacements.length >= RACK_SIZE ? BINGO_BONUS : 0;
  const score = equationScore + bingoBonus;
  return {
    isValid: errors.length === 0 && equations.every((equation) => equation.isValid),
    errors: Array.from(new Set(errors)),
    equations,
    score,
    bingoBonus,
  };
}

export function boardWithPending(
  board: BoardSnapshot,
  pendingPlacements: PendingPlacement[],
  turnNumber: number,
  side: Side,
): BoardSnapshot {
  const nextBoard = deepClone(board);
  for (const placement of pendingPlacements) {
    const assignedTile = {
      ...placement.tile,
      assignedToken: placement.assignedToken,
    };
    nextBoard[placement.row][placement.col] = {
      tile: assignedTile,
      placedTurn: turnNumber,
      side,
    };
  }
  return nextBoard;
}

export function createPlaceDetail(
  validation: MoveValidation,
  pendingPlacements: PendingPlacement[],
): PlaceEquationDetail {
  return {
    placedTiles: pendingPlacements.map((placement) => ({
      tileId: placement.tile.id,
      token: placement.tile.token,
      displayToken: placement.assignedToken ?? displayToken(placement.tile),
      assignedToken: placement.assignedToken,
      row: placement.row,
      col: placement.col,
    })),
    equationsDetected: validation.equations,
    isMoveValid: validation.isValid,
    errors: validation.errors,
  };
}

export function isRackReady(game: GameState): boolean {
  return getRack(game, game.activeSide).length >= RACK_SIZE || game.tilebag.length === 0;
}

export function phaseForNextSide(game: GameState): Phase {
  return getRack(game, game.activeSide).length >= RACK_SIZE || game.tilebag.length === 0
    ? "choose_action"
    : "refill";
}

export function groupedTilebag(tilebag: TileInstance[]): Record<TokenType, TileInstance[]> {
  return tilebag.reduce<Record<TokenType, TileInstance[]>>(
    (groups, tile) => {
      groups[getTileType(tile)].push(tile);
      return groups;
    },
    {
      lightNumber: [],
      heavyNumber: [],
      operator: [],
      choice: [],
      equals: [],
      Blank: [],
    },
  );
}

function detectEquations(
  board: BoardSnapshot,
  pendingPlacements: PendingPlacement[],
): EquationDetection[] {
  const size = board.length;
  const pendingMap = new Map<string, PendingPlacement>();
  pendingPlacements.forEach((placement) => {
    pendingMap.set(cellKey(placement.row, placement.col), placement);
  });
  const seen = new Set<string>();
  const equations: EquationDetection[] = [];

  for (const placement of pendingPlacements) {
    for (const direction of ["horizontal", "vertical"] as const) {
      const delta = direction === "horizontal" ? [0, 1] : [1, 0];
      let startRow = placement.row;
      let startCol = placement.col;
      while (
        inBounds(startRow - delta[0], startCol - delta[1], size) &&
        tileAt(board, pendingMap, startRow - delta[0], startCol - delta[1])
      ) {
        startRow -= delta[0];
        startCol -= delta[1];
      }

      const cells: { row: number; col: number }[] = [];
      let row = startRow;
      let col = startCol;
      while (inBounds(row, col, size) && tileAt(board, pendingMap, row, col)) {
        cells.push({ row, col });
        row += delta[0];
        col += delta[1];
      }

      if (cells.length < 2) continue;
      const key = `${direction}:${cells.map((cell) => cellKey(cell.row, cell.col)).join("|")}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const tiles = cells.map((cell) => tileAt(board, pendingMap, cell.row, cell.col)!);
      const tokens = tiles.map(displayToken);
      const result = validateEquationTokens(tokens);
      const scored = result.isValid
        ? scoreEquationCells(cells, tiles, pendingMap)
        : { score: 0, multiplier: 1 };
      equations.push({
        direction,
        cells,
        expressionText: tokens.join(" "),
        leftValue: result.values?.[0],
        rightValue: result.values?.[1],
        values: result.values,
        isValid: result.isValid,
        error: result.error,
        score: scored.score,
        multiplier: scored.multiplier,
      });
    }
  }

  return equations;
}

function validateEquationTokens(tokens: string[]): {
  isValid: boolean;
  values?: number[];
  error?: string;
} {
  const seq = tokens.map(toEvalToken);

  const reason = conditionReason(seq, tokens);
  if (reason) return { isValid: false, error: reason };

  // Split on "=" and evaluate every side (Check_Equation).
  const parts: string[][] = [];
  let current: string[] = [];
  for (const token of seq) {
    if (token === "=") {
      parts.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  parts.push(current);

  const values = parts.map((part) => safeEvalFlat(part.join("")));
  if (values.some((value) => value === null || !Number.isFinite(value))) {
    return { isValid: false, error: `${tokens.join(" ")} cannot be evaluated.` };
  }
  const nums = values as number[];
  const first = nums[0];
  const allEqual = nums.every((value) => Math.abs(value - first) < 1e-9);
  if (!allEqual) {
    return {
      isValid: false,
      values: nums,
      error: `${tokens.join(" ")} is not balanced (${nums.map(formatValue).join(" != ")})`,
    };
  }
  return { isValid: true, values: nums };
}

// Structural validity of an A-Math line (ported from solution.js Condition).
// Returns an English reason when invalid, or null when OK.
// `seq` uses evaluator notation; `display` is for messages.
function conditionReason(seq: string[], display: string[]): string | null {
  const text = display.join(" ");
  if (!seq.includes("=")) return `${text}: missing =.`;

  const first = seq[0];
  const last = seq[seq.length - 1];
  if (EVALUATOR_MARKS.has(first) && first !== "-") return `${text}: cannot start with an operator.`;
  if (EVALUATOR_MARKS.has(last)) return `${text}: cannot end with an operator.`;

  for (let i = 0; i < seq.length - 1; i += 1) {
    const a = seq[i];
    const b = seq[i + 1];
    if (EVALUATOR_MARKS.has(a) && EVALUATOR_MARKS.has(b) && !(a === "=" && b === "-")) {
      return `${text}: adjacent operators are not allowed.`;
    }
    if (TENS_TOKENS.has(a) && TENS_TOKENS.has(b)) return `${text}: 10-20 tiles cannot touch each other.`;
    if (UNIT_TOKENS.has(a) && TENS_TOKENS.has(b)) return `${text}: 10-20 tiles cannot touch single-digit tiles.`;
    if (TENS_TOKENS.has(a) && UNIT_TOKENS.has(b)) return `${text}: 10-20 tiles cannot touch single-digit tiles.`;
    if (a === "/" && b === "0") return `${text}: this position cannot divide by 0.`;
    if (a === "-" && b === "0" && (i === 0 || seq[i - 1] === "=")) {
      return `${text}: 0 cannot be marked as negative.`;
    }
  }

  // No 4+ digit number (max 3 consecutive single digits).
  let run = 0;
  for (const token of seq) {
    if (UNIT_TOKENS.has(token)) {
      run += 1;
      if (run > 3) return `${text}: numbers cannot exceed 3 digits.`;
    } else {
      run = 0;
    }
  }

  // No multi-digit number with a leading zero.
  let buffer = "";
  for (const token of seq) {
    if (!EVALUATOR_MARKS.has(token)) {
      buffer += token;
    } else {
      if (buffer.length >= 2 && buffer[0] === "0") return `${text}: numbers cannot start with 0.`;
      buffer = "";
    }
  }
  if (buffer.length >= 2 && buffer[0] === "0") return `${text}: numbers cannot start with 0.`;

  return null;
}

// Safe flat-expression evaluator (replaces eval() used by solution.js).
// Numbers may be multi-digit (adjacent digit tiles); supports + - * / with
// standard precedence and a single leading unary minus.
function safeEvalFlat(expression: string): number | null {
  if (!expression) return null;
  const text = expression[0] === "-" ? `0${expression}` : expression;

  const numbers: number[] = [];
  const operators: string[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char >= "0" && char <= "9") {
      let digits = "";
      while (index < text.length && text[index] >= "0" && text[index] <= "9") {
        digits += text[index];
        index += 1;
      }
      numbers.push(Number(digits));
    } else if (char === "+" || char === "-" || char === "*" || char === "/") {
      operators.push(char);
      index += 1;
    } else {
      return null;
    }
  }
  if (numbers.length !== operators.length + 1) return null;

  // Pass 1: multiplication and division.
  const reducedNumbers = [numbers[0]];
  const reducedOps: string[] = [];
  for (let i = 0; i < operators.length; i += 1) {
    const op = operators[i];
    const right = numbers[i + 1];
    if (op === "*") {
      reducedNumbers[reducedNumbers.length - 1] *= right;
    } else if (op === "/") {
      reducedNumbers[reducedNumbers.length - 1] /= right;
    } else {
      reducedOps.push(op);
      reducedNumbers.push(right);
    }
  }
  // Pass 2: addition and subtraction.
  let value = reducedNumbers[0];
  for (let i = 0; i < reducedOps.length; i += 1) {
    value = reducedOps[i] === "+" ? value + reducedNumbers[i + 1] : value - reducedNumbers[i + 1];
  }
  return value;
}

// Premium-aware score for one equation run. Premium squares (px2/px3/ex2/ex3)
// apply ONLY to tiles newly placed this turn (those in pendingMap).
function scoreEquationCells(
  cells: { row: number; col: number }[],
  tiles: TileInstance[],
  pendingMap: Map<string, PendingPlacement>,
): { score: number; multiplier: number } {
  let sum = 0;
  let multiplier = 1;
  cells.forEach((cell, index) => {
    const point = tilePoint(tiles[index]);
    const isNew = pendingMap.has(cellKey(cell.row, cell.col));
    const slot: SlotType = isNew ? slotTypeAt(cell.row, cell.col) : "px1";
    if (slot === "px2") sum += point * 2;
    else if (slot === "px3" || slot === "px3star") sum += point * 3;
    else if (slot === "ex2") {
      sum += point;
      multiplier *= 2;
    } else if (slot === "ex3") {
      sum += point;
      multiplier *= 3;
    } else {
      sum += point;
    }
  });
  return { score: sum * multiplier, multiplier };
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}

function tokenIdPrefix(token: AmathToken): string {
  const prefixes: Record<AmathToken, string> = {
    "0": "n0",
    "1": "n1",
    "2": "n2",
    "3": "n3",
    "4": "n4",
    "5": "n5",
    "6": "n6",
    "7": "n7",
    "8": "n8",
    "9": "n9",
    "10": "n10",
    "11": "n11",
    "12": "n12",
    "13": "n13",
    "14": "n14",
    "15": "n15",
    "16": "n16",
    "17": "n17",
    "18": "n18",
    "19": "n19",
    "20": "n20",
    "+": "plus",
    "-": "minus",
    x: "mul",
    "/": "div",
    "+/-": "plusminus",
    "x//": "muldiv",
    "=": "eq",
    "?": "blank",
  };
  return prefixes[token];
}

function tileAt(
  board: BoardSnapshot,
  pendingMap: Map<string, PendingPlacement>,
  row: number,
  col: number,
): TileInstance | undefined {
  const pending = pendingMap.get(cellKey(row, col));
  if (pending) {
    return {
      ...pending.tile,
      assignedToken: pending.assignedToken,
    };
  }
  return board[row]?.[col]?.tile;
}

function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function inBounds(row: number, col: number, size: number): boolean {
  return row >= 0 && row < size && col >= 0 && col < size;
}

function neighbors(row: number, col: number, size: number): Array<[number, number]> {
  return [
    [row - 1, col],
    [row + 1, col],
    [row, col - 1],
    [row, col + 1],
  ].filter(([nextRow, nextCol]) => inBounds(nextRow, nextCol, size)) as Array<[number, number]>;
}

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
