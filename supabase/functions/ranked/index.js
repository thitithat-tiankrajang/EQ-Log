// supabase/functions/ranked/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";

// src/constants/gameRules.ts
var BOARD_SIZE = 15;
var RACK_SIZE = 8;
var STOP_REQUEST_BLOCK_MS = 5 * 60 * 1e3;
var BINGO_BONUS = 40;
var EXCHANGE_MIN_RESERVE = 5;
var NO_SCORE_STREAK_LENGTH = 6;
var NO_SCORE_TURNS_PER_SIDE = 3;
var SOLO_NO_SCORE_STREAK_LENGTH = 3;
var PERFECT_GAME_BONUS = 100;
var RACK_OUT_MAX_REMAINING = RACK_SIZE;
var DEFAULT_TIMER_MINUTES = 22;
var MIN_TIMER_SECONDS = -300;

// src/constants/equationRules.ts
var UNIT_TOKENS = /* @__PURE__ */ new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
var TENS_TOKENS = /* @__PURE__ */ new Set([
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
  "20"
]);
var EVALUATOR_MARKS = /* @__PURE__ */ new Set(["=", "+", "-", "*", "/"]);
var BLANK_ASSIGNMENT_OPTIONS = [
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
  "\xD7",
  "\xF7",
  "="
];

// src/constants/tileDefinitions.ts
var AMATH_TOKENS = {
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
  x: { token: "\xD7", count: 4, type: "operator", point: 2 },
  "/": { token: "\xF7", count: 4, type: "operator", point: 2 },
  "+/-": { token: "+/-", count: 5, type: "choice", point: 1 },
  "x//": { token: "x/\xF7", count: 4, type: "choice", point: 1 },
  "=": { token: "=", count: 11, type: "equals", point: 1 },
  "?": { token: "?", count: 4, type: "Blank", point: 0 }
};

// src/constants/boardLayout.ts
var BOARD_LAYOUT = [
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
  ["ex3", "px1", "px1", "px2", "px1", "px1", "px1", "ex3", "px1", "px1", "px1", "px2", "px1", "px1", "ex3"]
];

// src/domain/tiles.ts
var TILE_COUNT = 100;
var TOKEN_ORDER = [
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
  "x",
  "/",
  "+/-",
  "x//",
  "=",
  "?"
];
var TOKEN_ID_PREFIX = {
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
  "?": "blank"
};
function buildManifest() {
  const ids = [];
  const tokens = [];
  for (const token of TOKEN_ORDER) {
    const { count } = AMATH_TOKENS[token];
    for (let copy = 1; copy <= count; copy += 1) {
      ids.push(`${TOKEN_ID_PREFIX[token]}_${copy}`);
      tokens.push(token);
    }
  }
  return { ids, tokens };
}
var MANIFEST = buildManifest();
if (MANIFEST.ids.length !== TILE_COUNT) {
  throw new Error(
    `The tile manifest describes ${MANIFEST.ids.length} tiles but the physical set has ${TILE_COUNT}.`
  );
}
var TILE_IDS = Object.freeze(MANIFEST.ids);
var TILE_TOKENS = Object.freeze(MANIFEST.tokens);
var ORDINAL_BY_ID = new Map(
  TILE_IDS.map((id, ordinal) => [id, ordinal])
);
var ALL_ORDINALS = Object.freeze(
  Array.from({ length: TILE_COUNT }, (_, ordinal) => ordinal)
);
function tileIdOf(ordinal) {
  const id = TILE_IDS[ordinal];
  if (id === void 0) throw new UnknownTileError(`Tile ordinal ${ordinal} is outside the set.`);
  return id;
}
function tokenOfOrdinal(ordinal) {
  const token = TILE_TOKENS[ordinal];
  if (token === void 0) throw new UnknownTileError(`Tile ordinal ${ordinal} is outside the set.`);
  return token;
}
var UnknownTileError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "UnknownTileError";
  }
};

// src/game.ts
function aggregatePendingExchangeReturns(pending) {
  return [...pending?.A ?? [], ...pending?.B ?? []];
}
function getPendingExchangeReturnBySide(game) {
  if (game.pendingExchangeReturnBySide) {
    return {
      A: game.pendingExchangeReturnBySide.A ?? [],
      B: game.pendingExchangeReturnBySide.B ?? []
    };
  }
  const legacyPending = game.pendingExchangeReturn ?? [];
  if (legacyPending.length === 0) return { A: [], B: [] };
  const legacySide = otherSide(game.activeSide);
  return legacySide === "A" ? { A: legacyPending, B: [] } : { A: [], B: legacyPending };
}
function toEvalToken(token) {
  if (token === "\xD7") return "*";
  if (token === "\xF7") return "/";
  return token;
}
function slotTypeAt(row, col) {
  return BOARD_LAYOUT[row]?.[col] ?? "px1";
}
function otherSide(side) {
  return side === "A" ? "B" : "A";
}
function getGameMode(game) {
  return game.gameMode === "solo" ? "solo" : "versus";
}
function createBoard(size = BOARD_SIZE) {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}
function getTileDrawMode(game) {
  return game.tileDrawMode ?? "manual";
}
function createInitialTilebag(options = {}) {
  const tiles = ALL_ORDINALS.map((ordinal) => ({
    id: tileIdOf(ordinal),
    token: tokenOfOrdinal(ordinal)
  }));
  return options.shuffleForPlay ? shuffleTilebagQueue(tiles) : tiles;
}
function shuffleTilebagQueue(tilebag) {
  return shuffleArray(tilebag);
}
function randomInt(bound) {
  if (bound <= 1) return 0;
  const limit = Math.floor(4294967296 / bound) * bound;
  const buffer = new Uint32Array(1);
  for (; ; ) {
    crypto.getRandomValues(buffer);
    const draw = buffer[0];
    if (draw < limit) return draw % bound;
  }
}
function shuffleArray(items) {
  const next = items.slice();
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}
function displayToken(tile) {
  if (tile.assignedToken) return normalizeDisplayToken(tile.assignedToken);
  return AMATH_TOKENS[tile.token].token;
}
function normalizeDisplayToken(token) {
  if (token === "/") return "\xF7";
  if (token === "x//" || token === "\xD7/\xF7") return "x/\xF7";
  return token;
}
function tilePoint(tile) {
  return AMATH_TOKENS[tile.token].point;
}
function getRack(game, side) {
  return side === "A" ? game.rackA : game.rackB;
}
function setRack(game, side, rack) {
  return side === "A" ? { ...game, rackA: rack } : { ...game, rackB: rack };
}
function createNewGame(settings) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const gameMode = settings.gameMode ?? "versus";
  const isSolo = gameMode === "solo";
  const rawEmailA = normalizeEmail(settings.playerAEmail);
  const rawEmailB = normalizeEmail(settings.playerBEmail);
  const rawUserIdA = normalizeUserId(settings.playerAUserId);
  const rawUserIdB = normalizeUserId(settings.playerBUserId);
  const userIdA = rawUserIdA;
  const userIdB = isSolo ? null : rawUserIdB;
  const hasRegisteredPlayers = Boolean(userIdA || userIdB);
  const emailPlayMode = hasRegisteredPlayers || rawEmailA || !isSolo && rawEmailB ? isSolo ? "hosted" : settings.emailPlayMode ?? "hosted" : void 0;
  const emailA = rawEmailA;
  const emailB = isSolo ? null : rawEmailB;
  const hasEmailPlayers = Boolean(emailA || emailB);
  const hasOnlinePlayers = hasRegisteredPlayers || hasEmailPlayers;
  const configuredTimerMinutes = normalizeTimerMinutes(settings);
  const timerMinutes = isSolo ? { A: configuredTimerMinutes.A, B: null } : configuredTimerMinutes;
  const secondsBySide = {
    A: minutesToSeconds(timerMinutes.A),
    B: minutesToSeconds(timerMinutes.B)
  };
  const sideUntimed = {
    A: timerMinutes.A === null,
    B: timerMinutes.B === null
  };
  const allUntimed = sideUntimed.A === true && sideUntimed.B === true;
  const initialSeconds = Math.max(secondsBySide.A, secondsBySide.B, 1);
  const tileDrawMode = emailPlayMode === "direct" || isSolo && !hasOnlinePlayers ? "play" : settings.tileDrawMode ?? "manual";
  const isPlayDraw = tileDrawMode === "play";
  const startSide = isSolo ? "A" : settings.startingSide;
  const initialQueue = createInitialTilebag({ shuffleForPlay: isPlayDraw });
  const startingRack = isPlayDraw ? initialQueue.slice(0, RACK_SIZE) : [];
  const opponentRack = isPlayDraw && !isSolo ? initialQueue.slice(RACK_SIZE, RACK_SIZE * 2) : [];
  const initialTilebag = isPlayDraw ? shuffleTilebagQueue(initialQueue.slice(startingRack.length + opponentRack.length)) : initialQueue;
  const rackForA = isSolo ? startingRack : startSide === "A" ? startingRack : opponentRack;
  const rackForB = isSolo ? [] : startSide === "B" ? startingRack : opponentRack;
  const playerMembers = {};
  if (settings.playerAMemberId) playerMembers.A = settings.playerAMemberId;
  if (settings.playerBMemberId) playerMembers.B = settings.playerBMemberId;
  const playerEmails = {};
  if (emailA) playerEmails.A = emailA;
  if (emailB) playerEmails.B = emailB;
  const playerUserIds = {};
  if (userIdA) playerUserIds.A = userIdA;
  if (userIdB) playerUserIds.B = userIdB;
  const base = {
    commitId: crypto.randomUUID(),
    gameId: crypto.randomUUID(),
    name: settings.name.trim() || "EQuation Math",
    gameMode,
    players: {
      A: settings.playerA.trim() || "A",
      B: isSolo ? "" : settings.playerB.trim() || "B"
    },
    playerMembers: isSolo ? playerMembers.A ? { A: playerMembers.A } : void 0 : Object.keys(playerMembers).length > 0 ? playerMembers : void 0,
    playerUserIds: hasRegisteredPlayers ? playerUserIds : void 0,
    playerEmails: hasEmailPlayers ? playerEmails : void 0,
    emailPlayMode,
    emailPlayersCanSeeOpponentRack: !isSolo && hasOnlinePlayers ? settings.emailPlayersCanSeeOpponentRack ?? false : void 0,
    roomStage: "playing",
    lobbyReadyBySide: {},
    startingSide: isSolo ? "A" : settings.startingSide,
    botSide: isSolo ? void 0 : settings.botSide,
    botEngine: isSolo || !settings.botSide ? void 0 : settings.botEngine ?? "authur",
    botDifficulty: isSolo ? void 0 : settings.botDifficulty,
    tileDrawMode,
    turnNumber: 1,
    activeSide: startSide,
    phase: isPlayDraw ? "choose_action" : "refill",
    status: "playing",
    boardSize: BOARD_SIZE,
    board: createBoard(BOARD_SIZE),
    rackA: rackForA,
    rackB: rackForB,
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
      untimed: Boolean(settings.untimed) || allUntimed
    },
    scores: { A: 0, B: 0 },
    logs: [],
    currentTurnStartedAt: now,
    createdAt: now
  };
  const snapshot = makeSnapshot(base);
  return {
    ...base,
    history: [snapshot],
    historyIndex: 0,
    lastSavedAt: now
  };
}
function normalizeTimerMinutes(settings) {
  if (settings.timerMinutes) {
    return {
      A: normalizeTimerMinute(settings.timerMinutes.A),
      B: normalizeTimerMinute(settings.timerMinutes.B)
    };
  }
  if (settings.untimed) return { A: null, B: null };
  const minutes = normalizeTimerMinute(settings.minutes ?? DEFAULT_TIMER_MINUTES) ?? DEFAULT_TIMER_MINUTES;
  return { A: minutes, B: minutes };
}
function normalizeTimerMinute(value) {
  if (value === null) return null;
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return DEFAULT_TIMER_MINUTES;
  return minutes;
}
function minutesToSeconds(minutes) {
  return minutes === null ? 0 : Math.max(1, Math.round(minutes * 60));
}
function normalizeEmail(value) {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed ? trimmed : null;
}
function normalizeUserId(value) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed || null;
}
function makeSnapshot(game) {
  return deepClone({
    commitId: crypto.randomUUID(),
    gameId: game.gameId,
    revision: game.revision,
    name: game.name,
    gameMode: getGameMode(game),
    players: game.players,
    playerMembers: game.playerMembers,
    playerUserIds: game.playerUserIds,
    playerEmails: game.playerEmails,
    emailPlayMode: game.emailPlayMode,
    emailPlayersCanSeeOpponentRack: game.emailPlayersCanSeeOpponentRack,
    matchControl: game.matchControl,
    roomStage: game.roomStage,
    lobbyReadyBySide: game.lobbyReadyBySide,
    lobbyLaunchAt: game.lobbyLaunchAt,
    startingSide: game.startingSide,
    botSide: game.botSide,
    botEngine: game.botEngine,
    botDifficulty: game.botDifficulty,
    superEngineVersion: game.superEngineVersion,
    superWeightsVersion: game.superWeightsVersion,
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
    createdAt: game.createdAt
  });
}
function calculateTotals(logs) {
  return logs.reduce(
    (totals, log) => {
      totals[log.side] += log.finalScore;
      return totals;
    },
    { A: 0, B: 0 }
  );
}
function getAssignmentOptions(token) {
  if (token === "+/-") return ["+", "-"];
  if (token === "x//") return ["\xD7", "\xF7"];
  if (token === "?") return BLANK_ASSIGNMENT_OPTIONS;
  return [];
}
function tileNeedsAssignment(token) {
  return token === "+/-" || token === "x//" || token === "?";
}
function validateMove(board, pendingPlacements) {
  const errors = [];
  if (pendingPlacements.length === 0) {
    return {
      isValid: false,
      errors: ["Place at least one tile."],
      equations: [],
      score: 0,
      bingoBonus: 0
    };
  }
  const size = board.length;
  const pendingMap = /* @__PURE__ */ new Map();
  for (const placement of pendingPlacements) {
    if (placement.row < 0 || placement.row >= size || placement.col < 0 || placement.col >= size) {
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
    const values = pendingPlacements.map(
      (placement) => axis === "row" ? placement.col : placement.row
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
    const touchesExisting = pendingPlacements.some(
      (placement) => neighbors(placement.row, placement.col, size).some(([row, col]) => Boolean(board[row][col]))
    );
    if (!touchesExisting) {
      errors.push("New tiles must connect to existing board tiles.");
    }
  } else {
    const center = Math.floor(size / 2);
    const coversCenterStar = pendingPlacements.some(
      (placement) => placement.row === center && placement.col === center
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
  const bingoBonus = pendingPlacements.length >= RACK_SIZE ? BINGO_BONUS : 0;
  const score = equationScore + bingoBonus;
  return {
    isValid: errors.length === 0 && equations.every((equation) => equation.isValid),
    errors: Array.from(new Set(errors)),
    equations,
    score,
    bingoBonus
  };
}
function boardWithPending(board, pendingPlacements, turnNumber, side) {
  const nextBoard = deepClone(board);
  for (const placement of pendingPlacements) {
    const assignedTile = {
      ...placement.tile,
      assignedToken: placement.assignedToken
    };
    nextBoard[placement.row][placement.col] = {
      tile: assignedTile,
      placedTurn: turnNumber,
      side
    };
  }
  return nextBoard;
}
function createPlaceDetail(validation, pendingPlacements) {
  return {
    placedTiles: pendingPlacements.map((placement) => ({
      tileId: placement.tile.id,
      token: placement.tile.token,
      displayToken: placement.assignedToken ?? displayToken(placement.tile),
      assignedToken: placement.assignedToken,
      row: placement.row,
      col: placement.col
    })),
    equationsDetected: validation.equations,
    isMoveValid: validation.isValid,
    errors: validation.errors
  };
}
function phaseForNextSide(game) {
  return getRack(game, game.activeSide).length >= RACK_SIZE || game.tilebag.length === 0 ? "choose_action" : "refill";
}
function advanceToOpponentTurn(game) {
  const nextSide = getGameMode(game) === "solo" ? "A" : otherSide(game.activeSide);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const switched = {
    ...game,
    activeSide: nextSide,
    turnNumber: game.turnNumber + 1,
    phase: "choose_action",
    currentTurnStartedAt: now,
    lastSavedAt: now
  };
  return { ...switched, phase: phaseForNextSide(switched) };
}
function detectEquations(board, pendingPlacements) {
  const size = board.length;
  const pendingMap = /* @__PURE__ */ new Map();
  pendingPlacements.forEach((placement) => {
    pendingMap.set(cellKey(placement.row, placement.col), placement);
  });
  const seen = /* @__PURE__ */ new Set();
  const equations = [];
  for (const placement of pendingPlacements) {
    for (const direction of ["horizontal", "vertical"]) {
      const delta = direction === "horizontal" ? [0, 1] : [1, 0];
      let startRow = placement.row;
      let startCol = placement.col;
      while (inBounds(startRow - delta[0], startCol - delta[1], size) && tileAt(board, pendingMap, startRow - delta[0], startCol - delta[1])) {
        startRow -= delta[0];
        startCol -= delta[1];
      }
      const cells = [];
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
      const tiles = cells.map((cell) => tileAt(board, pendingMap, cell.row, cell.col));
      const tokens = tiles.map(displayToken);
      const result = validateEquationTokens(tokens);
      const scored = result.isValid ? scoreEquationCells(cells, tiles, pendingMap) : { score: 0, multiplier: 1 };
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
        multiplier: scored.multiplier
      });
    }
  }
  return equations;
}
function validateEquationTokens(tokens) {
  const seq = tokens.map(toEvalToken);
  const reason = conditionReason(seq, tokens);
  if (reason) return { isValid: false, error: reason };
  const parts = [];
  let current = [];
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
  const nums = values;
  const first = nums[0];
  const allEqual = nums.every((value) => Math.abs(value - first) < 1e-9);
  if (!allEqual) {
    return {
      isValid: false,
      values: nums,
      error: `${tokens.join(" ")} is not balanced (${nums.map(formatValue).join(" != ")})`
    };
  }
  return { isValid: true, values: nums };
}
function conditionReason(seq, display) {
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
    if (TENS_TOKENS.has(a) && TENS_TOKENS.has(b))
      return `${text}: 10-20 tiles cannot touch each other.`;
    if (UNIT_TOKENS.has(a) && TENS_TOKENS.has(b))
      return `${text}: 10-20 tiles cannot touch single-digit tiles.`;
    if (TENS_TOKENS.has(a) && UNIT_TOKENS.has(b))
      return `${text}: 10-20 tiles cannot touch single-digit tiles.`;
    if (a === "/" && b === "0") return `${text}: this position cannot divide by 0.`;
    if (a === "-" && b === "0" && (i === 0 || seq[i - 1] === "=")) {
      return `${text}: 0 cannot be marked as negative.`;
    }
  }
  let run = 0;
  for (const token of seq) {
    if (UNIT_TOKENS.has(token)) {
      run += 1;
      if (run > 3) return `${text}: numbers cannot exceed 3 digits.`;
    } else {
      run = 0;
    }
  }
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
function safeEvalFlat(expression) {
  if (!expression) return null;
  const text = expression[0] === "-" ? `0${expression}` : expression;
  const numbers = [];
  const operators = [];
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
  const reducedNumbers = [numbers[0]];
  const reducedOps = [];
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
  let value = reducedNumbers[0];
  for (let i = 0; i < reducedOps.length; i += 1) {
    value = reducedOps[i] === "+" ? value + reducedNumbers[i + 1] : value - reducedNumbers[i + 1];
  }
  return value;
}
function scoreEquationCells(cells, tiles, pendingMap) {
  let sum = 0;
  let multiplier = 1;
  cells.forEach((cell, index) => {
    const point = tilePoint(tiles[index]);
    const isNew = pendingMap.has(cellKey(cell.row, cell.col));
    const slot = isNew ? slotTypeAt(cell.row, cell.col) : "px1";
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
function formatValue(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}
function tileAt(board, pendingMap, row, col) {
  const pending = pendingMap.get(cellKey(row, col));
  if (pending) {
    return {
      ...pending.tile,
      assignedToken: pending.assignedToken
    };
  }
  return board[row]?.[col]?.tile;
}
function cellKey(row, col) {
  return `${row}:${col}`;
}
function inBounds(row, col, size) {
  return row >= 0 && row < size && col >= 0 && col < size;
}
function neighbors(row, col, size) {
  return [
    [row - 1, col],
    [row + 1, col],
    [row, col - 1],
    [row, col + 1]
  ].filter(([nextRow, nextCol]) => inBounds(nextRow, nextCol, size));
}
function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

// src/gameplay/endGame.ts
function createAutomaticEndGameLog({
  boardAfter,
  game,
  logs,
  normalLog,
  rackAfter,
  tilebagAfter
}) {
  const activeSide = game.activeSide;
  const isSolo = getGameMode(game) === "solo";
  const opponentSide = otherSide(activeSide);
  const opponentRack = getRack(game, opponentSide);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (isSolo && normalLog.action === "place_equation" && rackAfter.length === 0 && tilebagAfter.length === 0) {
    return createEndGameLog({
      boardAfter,
      detail: {
        reason: "perfect_game",
        description: `${game.players.A} played every tile. Perfect Game +${PERFECT_GAME_BONUS} points.`,
        bonusSide: "A",
        bonusPoints: PERFECT_GAME_BONUS
      },
      endedAt: now,
      game,
      rack: rackAfter,
      side: "A",
      tilebagAfter
    });
  }
  if (!isSolo && normalLog.action === "place_equation" && rackAfter.length === 0) {
    const remainingOpponentAndBag = opponentRack.length + tilebagAfter.length;
    if (remainingOpponentAndBag <= RACK_OUT_MAX_REMAINING) {
      const opponentRackPoints = sumTilePoints(opponentRack);
      const tilebagPoints = sumTilePoints(tilebagAfter);
      const bonusPoints = (opponentRackPoints + tilebagPoints) * 2;
      return createEndGameLog({
        boardAfter,
        detail: {
          reason: "rack_out",
          description: `${game.players[activeSide]} emptied the rack. ${game.players[opponentSide]}'s rack and the tilebag contain ${remainingOpponentAndBag} tile(s).`,
          bonusSide: activeSide,
          bonusPoints,
          opponentRackPoints,
          tilebagPoints
        },
        endedAt: now,
        game,
        rack: rackAfter,
        side: activeSide,
        tilebagAfter
      });
    }
  }
  if (isSolo && hasSoloGameStarted(logs) && hasSoloNoScoreStreak(logs)) {
    return createEndGameLog({
      boardAfter,
      detail: {
        reason: "no_score_streak",
        description: `${SOLO_NO_SCORE_STREAK_LENGTH} consecutive non-scoring turns. Solo game complete.`,
        bonusSide: void 0,
        bonusPoints: 0,
        noScoreStreak: SOLO_NO_SCORE_STREAK_LENGTH
      },
      endedAt: now,
      game,
      rack: rackAfter,
      side: "A",
      tilebagAfter
    });
  }
  const openingPlacementCompleted = logs.some((log) => log.action === "place_equation");
  if (!isSolo && openingPlacementCompleted && isNoScoreAction(normalLog.action) && hasNoScoreStreak(logs)) {
    const rackBySide = {
      A: activeSide === "A" ? rackAfter : getRack(game, "A"),
      B: activeSide === "B" ? rackAfter : getRack(game, "B")
    };
    const rackPoints = {
      A: sumTilePoints(rackBySide.A),
      B: sumTilePoints(rackBySide.B)
    };
    const bonusSide = rackPoints.A === rackPoints.B ? void 0 : rackPoints.A < rackPoints.B ? "A" : "B";
    const bonusPoints = bonusSide ? Math.abs(rackPoints.A - rackPoints.B) : 0;
    const scoringSide = bonusSide ?? activeSide;
    return createEndGameLog({
      boardAfter,
      detail: {
        reason: "no_score_streak",
        description: bonusSide ? `${NO_SCORE_STREAK_LENGTH} consecutive non-scoring turns. ${game.players[bonusSide]} has the lower rack total and receives ${bonusPoints} point(s).` : `${NO_SCORE_STREAK_LENGTH} consecutive non-scoring turns. Rack totals are tied, so no bonus is awarded.`,
        bonusSide,
        bonusPoints,
        rackPoints,
        noScoreStreak: NO_SCORE_STREAK_LENGTH
      },
      endedAt: now,
      game,
      rack: rackBySide[scoringSide],
      side: scoringSide,
      tilebagAfter
    });
  }
  return null;
}
function createSurrenderEndGameLog(game, surrenderedSide) {
  const winner = otherSide(surrenderedSide);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return createEndGameLog({
    boardAfter: game.board,
    detail: {
      reason: "surrender",
      description: `${game.players[surrenderedSide]} surrendered. ${game.players[winner]} wins the match.`,
      bonusPoints: 0,
      surrenderedSide
    },
    endedAt: now,
    game,
    rack: getRack(game, surrenderedSide),
    side: surrenderedSide,
    tilebagAfter: game.tilebag
  });
}
function hasSoloGameStarted(logs) {
  return logs.filter((log) => log.action !== "end_game").reduce((total, log) => total + log.finalScore, 0) !== 0;
}
function hasSoloNoScoreStreak(logs) {
  const playableLogs = logs.filter((log) => log.action !== "end_game");
  const recent = playableLogs.slice(-SOLO_NO_SCORE_STREAK_LENGTH);
  return recent.length === SOLO_NO_SCORE_STREAK_LENGTH && recent.every((log) => log.side === "A" && log.finalScore === 0);
}
function isNoScoreAction(action) {
  return action === "pass" || action === "exchange";
}
function hasNoScoreStreak(logs) {
  const recent = logs.slice(-NO_SCORE_STREAK_LENGTH);
  if (recent.length < NO_SCORE_STREAK_LENGTH) return false;
  if (!recent.every((log) => isNoScoreAction(log.action))) return false;
  const counts = recent.reduce(
    (total, log) => ({ ...total, [log.side]: total[log.side] + 1 }),
    { A: 0, B: 0 }
  );
  return counts.A === NO_SCORE_TURNS_PER_SIDE && counts.B === NO_SCORE_TURNS_PER_SIDE;
}
function sumTilePoints(tiles) {
  return tiles.reduce((sum, tile) => sum + tilePoint(tile), 0);
}
function createEndGameLog({
  boardAfter,
  detail,
  endedAt,
  game,
  rack,
  side,
  tilebagAfter
}) {
  return {
    id: crypto.randomUUID(),
    turnNumber: game.turnNumber,
    side,
    action: "end_game",
    startedAt: endedAt,
    endedAt,
    timerBefore: { A: game.timers.A, B: game.timers.B },
    timerAfter: { A: game.timers.A, B: game.timers.B },
    rackBefore: deepClone(rack),
    rackAfter: deepClone(rack),
    boardBefore: deepClone(boardAfter),
    boardAfter: deepClone(boardAfter),
    tilebagBefore: deepClone(tilebagAfter),
    tilebagAfter: deepClone(tilebagAfter),
    actionDetail: detail,
    calculatedScore: detail.bonusPoints,
    finalScore: detail.bonusPoints
  };
}

// src/gameplay/tiles.ts
function clearTileAssignment(tile) {
  return { ...tile, assignedToken: void 0 };
}

// src/gameplay/tilebag.ts
function refillRackFromQueue(game) {
  const rack = getRack(game, game.activeSide);
  const pendingBySide = getPendingExchangeReturnBySide(game);
  const needed = Math.max(0, RACK_SIZE - rack.length);
  const drawnTiles = game.tilebag.slice(0, needed).map(clearTileAssignment);
  const remainingQueue = game.tilebag.slice(drawnTiles.length);
  const rackAfter = [...rack, ...drawnTiles];
  const pendingReturn = pendingBySide[game.activeSide].map(clearTileAssignment);
  const nextPendingBySide = { ...pendingBySide, [game.activeSide]: [] };
  const rackReady = rackAfter.length >= RACK_SIZE || remainingQueue.length === 0;
  const tilebagAfter = shuffleTilebagQueue([...remainingQueue, ...pendingReturn]);
  return setRack(
    {
      ...game,
      tilebag: tilebagAfter,
      pendingExchangeReturn: aggregatePendingExchangeReturns(nextPendingBySide),
      pendingExchangeReturnBySide: nextPendingBySide,
      phase: rackReady ? "choose_action" : "refill",
      lastSavedAt: (/* @__PURE__ */ new Date()).toISOString()
    },
    game.activeSide,
    rackAfter
  );
}
function getExchangeRule(game) {
  if (getGameMode(game) === "solo") {
    const reserve2 = game.tilebag.length;
    if (reserve2 >= EXCHANGE_MIN_RESERVE) return { allowed: true, reserve: reserve2 };
    return {
      allowed: false,
      reserve: reserve2,
      reason: `Exchange locked: tilebag (${game.tilebag.length}) = ${reserve2}; minimum is ${EXCHANGE_MIN_RESERVE}.`
    };
  }
  const opponentRackCount = getRack(game, otherSide(game.activeSide)).length;
  const reserve = game.tilebag.length + opponentRackCount - RACK_SIZE;
  if (reserve >= EXCHANGE_MIN_RESERVE) return { allowed: true, reserve };
  return {
    allowed: false,
    reserve,
    reason: `Exchange locked: tilebag (${game.tilebag.length}) + opponent rack (${opponentRackCount}) - ${RACK_SIZE} = ${reserve}; minimum is ${EXCHANGE_MIN_RESERVE}.`
  };
}

// src/features/ranked/rules.ts
var RANKED_TIME_OPTIONS = [10, 15, 20, 30];
function createRankedGame(creatorId, creatorName, minutesA, minutesB, startingSide) {
  if (!isRankedTime(minutesA) || minutesA !== minutesB)
    throw new Error("Ranked clocks must match.");
  const game = createNewGame({
    name: "Ranked match",
    gameMode: "versus",
    playerA: creatorName,
    playerB: "Waiting for opponent",
    playerAUserId: creatorId,
    playerBUserId: null,
    emailPlayMode: "direct",
    emailPlayersCanSeeOpponentRack: false,
    timerMinutes: { A: minutesA, B: minutesB },
    startingSide,
    tileDrawMode: "play"
  });
  return {
    ...game,
    roomStage: "waiting",
    status: "draft",
    timers: { ...game.timers, paused: true },
    history: []
  };
}
function isRankedTime(value) {
  return RANKED_TIME_OPTIONS.includes(value);
}
function applyRankedAction(game, side, action, now) {
  if (game.status !== "playing" || game.roomStage !== "playing")
    throw new Error("Match is not playing.");
  if (game.activeSide !== side && action.kind !== "resign") throw new Error("It is not your turn.");
  const settled = settleRankedClock(game, now);
  if (settled.status === "finished") return settled;
  if (action.kind === "resign")
    return finishRankedGame(settled, { winner: otherSide(side), reason: "resign" }, now, side);
  const rackBefore = getRack(settled, side);
  const boardBefore = settled.board;
  const tilebagBefore = settled.tilebag;
  let boardAfter = boardBefore;
  let rackAfter = rackBefore;
  let tilebagAfter = tilebagBefore;
  let score = 0;
  let actionDetail;
  let logAction;
  if (action.kind === "place") {
    if (action.placements.length < 1 || action.placements.length > rackBefore.length)
      throw new Error("Invalid placement count.");
    const used = /* @__PURE__ */ new Set();
    const placements = action.placements.map((item) => {
      if (used.has(item.tileId)) throw new Error("A tile was used twice.");
      used.add(item.tileId);
      const tile = rackBefore.find((candidate) => candidate.id === item.tileId);
      if (!tile) throw new Error("Tile is not in your rack.");
      if (!Number.isInteger(item.row) || !Number.isInteger(item.col))
        throw new Error("Invalid board square.");
      const options = getAssignmentOptions(tile.token);
      if (options.length > 0 && !options.includes(item.assignedToken ?? ""))
        throw new Error("Invalid tile assignment.");
      if (options.length === 0 && item.assignedToken)
        throw new Error("This tile cannot be reassigned.");
      return { tile, row: item.row, col: item.col, assignedToken: item.assignedToken };
    });
    const validation = validateMove(boardBefore, placements);
    if (!validation.isValid) throw new Error(validation.errors.join(" "));
    boardAfter = boardWithPending(boardBefore, placements, settled.turnNumber, side);
    rackAfter = rackBefore.filter((tile) => !used.has(tile.id));
    score = validation.score;
    actionDetail = createPlaceDetail(validation, placements);
    logAction = "place_equation";
  } else if (action.kind === "exchange") {
    const rule = getExchangeRule(settled);
    if (!rule.allowed) throw new Error(rule.reason ?? "Exchange is unavailable.");
    const unique = new Set(action.tileIds);
    if (!unique.size || unique.size !== action.tileIds.length || unique.size > rackBefore.length)
      throw new Error("Invalid exchange selection.");
    const outgoing = action.tileIds.map((id) => {
      const tile = rackBefore.find((candidate) => candidate.id === id);
      if (!tile) throw new Error("Tile is not in your rack.");
      return tile;
    });
    if (tilebagBefore.length < outgoing.length) throw new Error("Not enough tiles to exchange.");
    const incoming = tilebagBefore.slice(0, outgoing.length);
    rackAfter = [...rackBefore.filter((tile) => !unique.has(tile.id)), ...incoming];
    tilebagAfter = shuffleTilebagQueue([...tilebagBefore.slice(outgoing.length), ...outgoing]);
    actionDetail = { outgoingTiles: outgoing, incomingTiles: incoming };
    logAction = "exchange";
  } else {
    actionDetail = {};
    logAction = "pass";
  }
  const log = {
    id: crypto.randomUUID(),
    turnNumber: settled.turnNumber,
    side,
    action: logAction,
    startedAt: game.currentTurnStartedAt,
    endedAt: now,
    timerBefore: { A: game.timers.A, B: game.timers.B },
    timerAfter: { A: settled.timers.A, B: settled.timers.B },
    rackBefore,
    rackAfter,
    boardBefore,
    boardAfter,
    tilebagBefore,
    tilebagAfter,
    actionDetail,
    calculatedScore: score,
    finalScore: score
  };
  const logs = [...settled.logs, log];
  const autoEnd = createAutomaticEndGameLog({
    boardAfter,
    game: settled,
    logs,
    normalLog: log,
    rackAfter,
    tilebagAfter
  });
  const nextLogs = autoEnd ? [...logs, autoEnd] : logs;
  let next = setRack(
    {
      ...settled,
      board: boardAfter,
      tilebag: tilebagAfter,
      logs: nextLogs,
      scores: calculateTotals(nextLogs),
      status: autoEnd ? "finished" : "playing",
      timers: autoEnd ? { ...settled.timers, paused: true } : settled.timers
    },
    side,
    rackAfter
  );
  if (!autoEnd) {
    if (action.kind === "place") next = refillRackFromQueue(next);
    next = advanceToOpponentTurn(next);
  }
  return { ...next, history: [], historyIndex: 0, lastSavedAt: now };
}
function settleRankedClock(game, now) {
  if (game.status !== "playing" || game.roomStage !== "playing") return game;
  const elapsed = Math.max(
    0,
    Math.floor((Date.parse(now) - Date.parse(game.currentTurnStartedAt)) / 1e3)
  );
  if (!Number.isFinite(elapsed) || elapsed < 1) return game;
  const side = game.activeSide;
  const remaining = Math.max(0, game.timers[side] - elapsed);
  const next = {
    ...game,
    timers: { ...game.timers, [side]: remaining },
    currentTurnStartedAt: now
  };
  return remaining === 0 ? finishRankedGame(next, { winner: otherSide(side), reason: "timeout" }, now, side) : next;
}
function resultOf(game) {
  if (game.status !== "finished") return null;
  const last = game.logs.at(-1);
  const detail = last?.action === "end_game" ? last.actionDetail : null;
  if (detail?.reason === "timeout")
    return {
      winner: detail.surrenderedSide ? otherSide(detail.surrenderedSide) : null,
      reason: "timeout"
    };
  if (detail?.reason === "surrender")
    return {
      winner: detail.surrenderedSide ? otherSide(detail.surrenderedSide) : null,
      reason: "resign"
    };
  return {
    winner: game.scores.A === game.scores.B ? null : game.scores.A > game.scores.B ? "A" : "B",
    reason: "score"
  };
}
function finishRankedGame(game, result, now, losingSide) {
  const surrenderLog = createSurrenderEndGameLog(game, losingSide);
  const finalLog = result.reason === "timeout" ? {
    ...surrenderLog,
    actionDetail: {
      ...surrenderLog.actionDetail,
      reason: "timeout",
      description: `${game.players[losingSide]} ran out of time.`
    }
  } : surrenderLog;
  return {
    ...game,
    logs: [...game.logs, finalLog],
    status: "finished",
    timers: { ...game.timers, paused: true },
    lastSavedAt: now
  };
}

// src/features/ranked/publicView.ts
function rankedPublicView(id, revision, game, viewerId) {
  const yourSide = game.playerUserIds?.A === viewerId ? "A" : game.playerUserIds?.B === viewerId ? "B" : null;
  return {
    id,
    revision,
    status: game.roomStage === "waiting" ? game.playerUserIds?.B ? "matched" : "waiting" : game.status === "finished" ? "finished" : "playing",
    playerAId: game.playerUserIds?.A ?? "",
    playerBId: game.playerUserIds?.B ?? null,
    players: game.players,
    startingSide: game.startingSide ?? "A",
    activeSide: game.activeSide,
    turnNumber: game.turnNumber,
    scores: game.scores,
    timers: { A: game.timers.A, B: game.timers.B },
    clockStartedAt: game.currentTurnStartedAt,
    board: game.board,
    tilebagCount: game.tilebag.length,
    rackCount: { A: game.rackA.length, B: game.rackB.length },
    readyBySide: { A: game.lobbyReadyBySide?.A ?? false, B: game.lobbyReadyBySide?.B ?? false },
    yourSide,
    yourRack: game.roomStage === "playing" ? yourSide === "A" ? game.rackA : yourSide === "B" ? game.rackB : [] : [],
    logs: game.logs.map((log) => ({
      id: log.id,
      turnNumber: log.turnNumber,
      side: log.side,
      action: log.action,
      score: log.finalScore,
      exchangedCount: log.action === "exchange" ? log.actionDetail.outgoingTiles.length : 0,
      boardAfter: log.boardAfter,
      ...yourSide === log.side ? { rackBefore: log.rackBefore, rackAfter: log.rackAfter } : {}
    })),
    result: resultOf(game)
  };
}

// supabase/functions/ranked/index.ts
var cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
var url = Deno.env.get("SUPABASE_URL");
var serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
var anonKey = Deno.env.get("SUPABASE_ANON_KEY");
var db = createClient(url, serviceKey, { auth: { persistSession: false } });
function respond(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}
async function getMatch(id) {
  const { data, error } = await db.from("ranked_matches").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Ranked room not found.");
  return data;
}
async function commit(id, revision, game) {
  const result = resultOf(game);
  const { data, error } = await db.rpc("ranked_commit_match", {
    target_match_id: id,
    target_revision: revision,
    target_state: game,
    target_winner: result ? result.winner ?? "draw" : null,
    target_reason: result?.reason ?? null
  });
  if (error) throw error;
  return data === true;
}
async function viewFor(id, revision, game, userId) {
  const view = rankedPublicView(id, revision, game, userId);
  if (game.status !== "finished") return view;
  const { data, error } = await db.from("ranked_results").select("rating_a_before,rating_a_after,rating_b_before,rating_b_after").eq("match_id", id).maybeSingle();
  if (error) throw error;
  if (!data || !view.yourSide) return view;
  return {
    ...view,
    ratingChange: view.yourSide === "A" ? { before: data.rating_a_before, after: data.rating_a_after } : { before: data.rating_b_before, after: data.rating_b_after }
  };
}
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const authorization = request.headers.get("Authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) return respond({ error: "Sign in required." }, 401);
    const authClient = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(
      authorization.slice(7)
    );
    if (authError || !authData.user) return respond({ error: "Sign in required." }, 401);
    const userId = authData.user.id;
    const { data: profile, error: profileError } = await db.from("profiles").select("display_name,status").eq("id", userId).maybeSingle();
    if (profileError) throw profileError;
    if (profile?.status !== "approved")
      return respond({ error: "Approved account required." }, 403);
    const name = profile.display_name?.trim() || "Player";
    const body = request.method === "POST" ? await request.json() : {};
    const operation = String(body.operation ?? "");
    if (operation === "list") {
      const { data: open, error: openError } = await db.from("ranked_matches").select("id,player_a_id,minutes_a,created_at").eq("status", "waiting").gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1e3).toISOString()).order("created_at", { ascending: false }).limit(50);
      if (openError) throw openError;
      const ids = (open ?? []).map((room) => room.player_a_id);
      const { data: profiles } = ids.length ? await db.from("profiles").select("id,display_name").in("id", ids) : { data: [] };
      const names = new Map((profiles ?? []).map((item) => [item.id, item.display_name]));
      const { data: mine, error: mineError } = await db.from("ranked_matches").select("id,player_a_id,player_b_id,status,created_at").or(`player_a_id.eq.${userId},player_b_id.eq.${userId}`).order("created_at", { ascending: false }).limit(20);
      if (mineError) throw mineError;
      return respond({
        open: (open ?? []).map((room) => ({
          id: room.id,
          creatorId: room.player_a_id,
          creator: names.get(room.player_a_id) ?? "Player",
          minutesA: room.minutes_a,
          createdAt: room.created_at
        })),
        mine
      });
    }
    if (operation === "leaderboard") {
      const { data: ratings, error } = await db.from("ranked_ratings").select("player_id,rating,games,wins,losses,draws").gte("games", 10).order("rating", { ascending: false }).order("wins", { ascending: false }).limit(100);
      if (error) throw error;
      const ids = (ratings ?? []).map((row) => row.player_id);
      const { data: profiles } = ids.length ? await db.from("profiles").select("id,display_name").in("id", ids) : { data: [] };
      const names = new Map((profiles ?? []).map((item) => [item.id, item.display_name]));
      const { data: own } = await db.from("ranked_ratings").select("rating,games,wins,losses,draws").eq("player_id", userId).maybeSingle();
      return respond({
        rows: (ratings ?? []).map((row, index) => ({
          ...row,
          place: index + 1,
          name: names.get(row.player_id) ?? "Player"
        })),
        own: own ?? { rating: 1e3, games: 0, wins: 0, losses: 0, draws: 0 }
      });
    }
    if (operation === "create") {
      const minutesA = Number(body.minutesA);
      const minutesB = Number(body.minutesB);
      if (!isRankedTime(minutesA) || minutesA !== minutesB)
        return respond({ error: "Choose the same 10, 15, 20 or 30 minutes for both sides." }, 400);
      const game = createRankedGame(
        userId,
        name,
        minutesA,
        minutesB,
        crypto.getRandomValues(new Uint8Array(1))[0] % 2 === 0 ? "A" : "B"
      );
      const { data, error } = await db.from("ranked_matches").insert({
        player_a_id: userId,
        status: "waiting",
        minutes_a: minutesA,
        minutes_b: minutesB,
        state: game
      }).select("id,revision").single();
      if (error?.code === "23505")
        return respond({ error: "You already have a waiting ranked room." }, 409);
      if (error) throw error;
      return respond({ match: await viewFor(data.id, data.revision, game, userId) });
    }
    const id = String(body.id ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id))
      return respond({ error: "Invalid room id." }, 400);
    if (operation === "join") {
      const { data, error } = await db.rpc("ranked_claim_match", {
        target_match_id: id,
        target_player_id: userId,
        target_player_name: name,
        target_now: (/* @__PURE__ */ new Date()).toISOString()
      });
      if (error) throw error;
      if (!data) return respond({ error: "This room is no longer open." }, 409);
    }
    const match = await getMatch(id);
    if (match.player_a_id !== userId && match.player_b_id !== userId)
      return respond({ error: "Only players can open this match." }, 403);
    if (operation === "cancel") {
      if (match.status !== "waiting" && match.status !== "matched" || match.status === "waiting" && match.player_a_id !== userId)
        return respond({ error: "This match has already started." }, 403);
      const { data, error } = await db.from("ranked_matches").delete().eq("id", id).in("status", ["waiting", "matched"]).select("id");
      if (error) throw error;
      if (!data?.length) return respond({ error: "This room has already started." }, 409);
      return respond({ cancelled: true });
    }
    if (operation === "ready") {
      const { data, error } = await db.rpc("ranked_ready_match", {
        target_match_id: id,
        target_player_id: userId,
        target_now: (/* @__PURE__ */ new Date()).toISOString()
      });
      if (error) throw error;
      if (!data) return respond({ error: "This match cannot be readied." }, 409);
      const updated = await getMatch(id);
      return respond({ match: await viewFor(id, updated.revision, updated.state, userId) });
    }
    if (operation === "read" || operation === "join") {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const settled = settleRankedClock(match.state, now);
      if (settled.status === "finished" && match.status === "playing") {
        if (!await commit(id, match.revision, settled))
          return respond({ error: "Position changed; refresh the match." }, 409);
        return respond({ match: await viewFor(id, match.revision + 1, settled, userId) });
      }
      return respond({ match: await viewFor(id, match.revision, settled, userId) });
    }
    if (operation === "action") {
      if (match.revision !== body.revision)
        return respond({ error: "Position changed; refresh the match." }, 409);
      const side = match.player_a_id === userId ? "A" : "B";
      const action = body.action;
      if (!action || !["place", "exchange", "pass", "resign"].includes(action.kind))
        return respond({ error: "Unknown action." }, 400);
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const next = applyRankedAction(match.state, side, action, now);
      if (!await commit(id, match.revision, next))
        return respond({ error: "Position changed; refresh the match." }, 409);
      return respond({ match: await viewFor(id, match.revision + 1, next, userId) });
    }
    return respond({ error: "Unknown operation." }, 400);
  } catch (error) {
    return respond(
      { error: error instanceof Error ? error.message : "Ranked request failed." },
      400
    );
  }
});
