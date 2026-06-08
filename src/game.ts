export type Side = "A" | "B";

export type AmathToken =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "11"
  | "12"
  | "13"
  | "14"
  | "15"
  | "16"
  | "17"
  | "18"
  | "19"
  | "20"
  | "+"
  | "-"
  | "x"
  | "/"
  | "+/-"
  | "x//"
  | "="
  | "?";

export type TokenType =
  | "lightNumber"
  | "heavyNumber"
  | "operator"
  | "choice"
  | "equals"
  | "Blank";

export type AmathTokenInfo = {
  token: string;
  count: number;
  type: TokenType;
  point: number;
};

export const AMATH_TOKENS = {
  "0": { token: "0", count: 5, type: "lightNumber", point: 1 },
  "1": { token: "1", count: 6, type: "lightNumber", point: 1 },
  "2": { token: "2", count: 6, type: "lightNumber", point: 1 },
  "3": { token: "3", count: 5, type: "lightNumber", point: 1 },
  "4": { token: "4", count: 5, type: "lightNumber", point: 2 },
  "5": { token: "5", count: 4, type: "lightNumber", point: 2 },
  "6": { token: "6", count: 4, type: "lightNumber", point: 2 },
  "7": { token: "7", count: 4, type: "lightNumber", point: 2 },
  "8": { token: "8", count: 4, type: "lightNumber", point: 2 },
  "9": { token: "9", count: 4, type: "lightNumber", point: 2 },
  "10": { token: "10", count: 2, type: "heavyNumber", point: 3 },
  "11": { token: "11", count: 1, type: "heavyNumber", point: 4 },
  "12": { token: "12", count: 2, type: "heavyNumber", point: 3 },
  "13": { token: "13", count: 1, type: "heavyNumber", point: 6 },
  "14": { token: "14", count: 1, type: "heavyNumber", point: 4 },
  "15": { token: "15", count: 1, type: "heavyNumber", point: 4 },
  "16": { token: "16", count: 1, type: "heavyNumber", point: 4 },
  "17": { token: "17", count: 1, type: "heavyNumber", point: 6 },
  "18": { token: "18", count: 1, type: "heavyNumber", point: 4 },
  "19": { token: "19", count: 1, type: "heavyNumber", point: 7 },
  "20": { token: "20", count: 1, type: "heavyNumber", point: 5 },
  "+": { token: "+", count: 4, type: "operator", point: 2 },
  "-": { token: "-", count: 4, type: "operator", point: 2 },
  x: { token: "×", count: 4, type: "operator", point: 2 },
  "/": { token: "÷", count: 4, type: "operator", point: 2 },
  "+/-": { token: "+/-", count: 5, type: "choice", point: 1 },
  "x//": { token: "×/÷", count: 4, type: "choice", point: 1 },
  "=": { token: "=", count: 11, type: "equals", point: 1 },
  "?": { token: "?", count: 4, type: "Blank", point: 0 },
} satisfies Record<AmathToken, AmathTokenInfo>;

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
};

export type Phase = "refill" | "choose_action" | "perform_action";
export type GameStatus = "playing" | "finished";
export type ActionType = "place_equation" | "exchange" | "pass";

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
  actionDetail: PlaceEquationDetail | ExchangeDetail | PassDetail;
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
  players: Record<Side, string>;
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
  playerA: string;
  playerB: string;
  minutes: number;
  startingSide: Side;
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

export type SlotType = "px1" | "px2" | "px3" | "px3star" | "ex2" | "ex3";

// ── A-Math equation rules (ported from solution.js: Condition + Check_Equation) ──
const UNIT_SET = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
const TENS_SET = new Set([
  "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
]);
// Marks in evaluator notation.
const MARKS_SET = new Set(["=", "+", "-", "*", "/"]);

// Display token to evaluator token; numbers, +, -, and = stay as-is.
function toEvalToken(token: string): string {
  if (token === "×") return "*";
  if (token === "÷") return "/";
  return token;
}

export const BLANK_ASSIGNMENT_OPTIONS = [
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "20",
  "+",
  "-",
  "×",
  "÷",
  "=",
];

// Standard A-Math 15×15 premium-square layout.
//   px1 = normal, px2 = piece x2, px3 = piece x3, px3star = center piece x3
//   ex2 = equation x2, ex3 = equation x3
export const BOARD_LAYOUT: SlotType[][] = [
  ["ex3", "px1", "px1", "px2", "px1", "px1", "px1", "ex3", "px1", "px1", "px1", "px2", "px1", "px1", "ex3"],
  ["px1", "ex2", "px1", "px1", "px1", "px3", "px1", "px1", "px1", "px3", "px1", "px1", "px1", "ex2", "px1"],
  ["px1", "px1", "ex2", "px1", "px1", "px1", "px2", "px1", "px2", "px1", "px1", "px1", "ex2", "px1", "px1"],
  ["px2", "px1", "px1", "ex2", "px1", "px1", "px1", "px2", "px1", "px1", "px1", "ex2", "px1", "px1", "px2"],
  ["px1", "px1", "px1", "px1", "px3", "px1", "px1", "px1", "px1", "px1", "px3", "px1", "px1", "px1", "px1"],
  ["px1", "px3", "px1", "px1", "px1", "px3", "px1", "px1", "px1", "px3", "px1", "px1", "px1", "px3", "px1"],
  ["px1", "px1", "px2", "px1", "px1", "px1", "px2", "px1", "px2", "px1", "px1", "px1", "px2", "px1", "px1"],
  ["ex3", "px1", "px1", "px2", "px1", "px1", "px1", "px3star", "px1", "px1", "px1", "px2", "px1", "px1", "ex3"],
  ["px1", "px1", "px2", "px1", "px1", "px1", "px2", "px1", "px2", "px1", "px1", "px1", "px2", "px1", "px1"],
  ["px1", "px3", "px1", "px1", "px1", "px3", "px1", "px1", "px1", "px3", "px1", "px1", "px1", "px3", "px1"],
  ["px1", "px1", "px1", "px1", "px3", "px1", "px1", "px1", "px1", "px1", "px3", "px1", "px1", "px1", "px1"],
  ["px2", "px1", "px1", "ex2", "px1", "px1", "px1", "px2", "px1", "px1", "px1", "ex2", "px1", "px1", "px2"],
  ["px1", "px1", "ex2", "px1", "px1", "px1", "px2", "px1", "px2", "px1", "px1", "px1", "ex2", "px1", "px1"],
  ["px1", "ex2", "px1", "px1", "px1", "px3", "px1", "px1", "px1", "px3", "px1", "px1", "px1", "ex2", "px1"],
  ["ex3", "px1", "px1", "px2", "px1", "px1", "px1", "ex3", "px1", "px1", "px1", "px2", "px1", "px1", "ex3"],
];

export function slotTypeAt(row: number, col: number): SlotType {
  return BOARD_LAYOUT[row]?.[col] ?? "px1";
}

export function otherSide(side: Side): Side {
  return side === "A" ? "B" : "A";
}

export function createBoard(size = 15): BoardSnapshot {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}

export function createInitialTilebag(): TileInstance[] {
  return (Object.keys(AMATH_TOKENS) as AmathToken[]).flatMap((token) => {
    const info = AMATH_TOKENS[token];
    return Array.from({ length: info.count }, (_, index) => ({
      id: `${tokenIdPrefix(token)}_${index + 1}`,
      token,
    }));
  });
}

export function displayToken(tile: TileInstance): string {
  if (tile.assignedToken) return tile.assignedToken;
  return AMATH_TOKENS[tile.token].token;
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
  const seconds = Math.max(1, Math.round(settings.minutes * 60));
  const base: Omit<GameState, "history" | "historyIndex" | "lastSavedAt"> = {
    commitId: crypto.randomUUID(),
    gameId: crypto.randomUUID(),
    name: settings.name.trim() || "EQuation Math",
    players: {
      A: settings.playerA.trim() || "A",
      B: settings.playerB.trim() || "B",
    },
    turnNumber: 1,
    activeSide: settings.startingSide,
    phase: "refill",
    status: "playing",
    boardSize: 15,
    board: createBoard(15),
    rackA: [],
    rackB: [],
    tilebag: createInitialTilebag(),
    pendingExchangeReturn: [],
    pendingExchangeReturnBySide: { A: [], B: [] },
    timers: {
      A: seconds,
      B: seconds,
      initialSeconds: seconds,
      paused: false,
      minSeconds: -300,
      untimed: Boolean(settings.untimed),
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

export function makeSnapshot(game: Omit<GameState, "history" | "historyIndex" | "lastSavedAt">): GameSnapshot;
export function makeSnapshot(game: GameState): GameSnapshot;
export function makeSnapshot(game: GameState | Omit<GameState, "history" | "historyIndex" | "lastSavedAt">): GameSnapshot {
  return deepClone({
    commitId: crypto.randomUUID(),
    gameId: game.gameId,
    name: game.name,
    players: game.players,
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

export function getAssignmentOptions(token: AmathToken): string[] {
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
  const bingoBonus = pendingPlacements.length >= 8 ? 40 : 0;
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
  return getRack(game, game.activeSide).length >= 8 || game.tilebag.length === 0;
}

export function phaseForNextSide(game: GameState): Phase {
  return getRack(game, game.activeSide).length >= 8 || game.tilebag.length === 0
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
  if (MARKS_SET.has(first) && first !== "-") return `${text}: cannot start with an operator.`;
  if (MARKS_SET.has(last)) return `${text}: cannot end with an operator.`;

  for (let i = 0; i < seq.length - 1; i += 1) {
    const a = seq[i];
    const b = seq[i + 1];
    if (MARKS_SET.has(a) && MARKS_SET.has(b) && !(a === "=" && b === "-")) {
      return `${text}: adjacent operators are not allowed.`;
    }
    if (TENS_SET.has(a) && TENS_SET.has(b)) return `${text}: 10-20 tiles cannot touch each other.`;
    if (UNIT_SET.has(a) && TENS_SET.has(b)) return `${text}: 10-20 tiles cannot touch single-digit tiles.`;
    if (TENS_SET.has(a) && UNIT_SET.has(b)) return `${text}: 10-20 tiles cannot touch single-digit tiles.`;
    if ((a === "/" || a === "-") && b === "0") return `${text}: this position cannot divide or subtract by 0.`;
  }

  // No 4+ digit number (max 3 consecutive single digits).
  let run = 0;
  for (const token of seq) {
    if (UNIT_SET.has(token)) {
      run += 1;
      if (run > 3) return `${text}: numbers cannot exceed 3 digits.`;
    } else {
      run = 0;
    }
  }

  // No multi-digit number with a leading zero.
  let buffer = "";
  for (const token of seq) {
    if (!MARKS_SET.has(token)) {
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
