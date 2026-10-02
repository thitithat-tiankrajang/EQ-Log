// supabase/functions/live-game/index.ts
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
function tryOrdinalOfTileId(id) {
  return ORDINAL_BY_ID.get(id) ?? null;
}
var UnknownTileError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "UnknownTileError";
  }
};
function tokenAcceptsAssignment(token) {
  return token === "?" || token === "+/-" || token === "x//";
}

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
function pushActionSnapshot(game) {
  const history = game.history.slice(0, game.historyIndex + 1);
  const snapshot = makeSnapshot(game);
  history.push(snapshot);
  return {
    ...game,
    history,
    historyIndex: history.length - 1,
    lastSavedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function restoreSnapshot(game, index) {
  const snapshot = game.history[index];
  return {
    ...deepClone(snapshot),
    history: game.history,
    historyIndex: index,
    lastSavedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
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
function calculateGameTotals(game, logs) {
  const opening = game.history[0];
  if (!opening) return calculateTotals(logs);
  const openingLogs = calculateTotals(opening.logs);
  const totals = calculateTotals(logs);
  return {
    A: opening.scores.A - openingLogs.A + totals.A,
    B: opening.scores.B - openingLogs.B + totals.B
  };
}
function updateLogScore(logs, logId, manualScore) {
  return logs.map((log) => {
    if (log.id !== logId) return log;
    const finalScore = manualScore ?? log.calculatedScore;
    return {
      ...log,
      manualScore,
      finalScore
    };
  });
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
function isRackReady(game) {
  return getRack(game, game.activeSide).length >= RACK_SIZE || game.tilebag.length === 0;
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
function activeSideHasActedThisTurn(game) {
  for (let index = game.logs.length - 1; index >= 0; index -= 1) {
    const log = game.logs[index];
    if (log.action === "end_game") continue;
    return log.side === game.activeSide && log.turnNumber === game.turnNumber;
  }
  return false;
}
function finalizeRefillTransition(game) {
  if (activeSideHasActedThisTurn(game)) {
    return advanceToOpponentTurn(game);
  }
  return { ...game, phase: "choose_action", lastSavedAt: (/* @__PURE__ */ new Date()).toISOString() };
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

// src/domain/inventory.ts
var SIDES = ["A", "B"];
var InventoryError = class extends Error {
  details;
  constructor(message, details = []) {
    super(details.length > 0 ? `${message} (${details.join("; ")})` : message);
    this.name = "InventoryError";
    this.details = details;
  }
};
function orderedOrdinals(inventory, match) {
  const entries = [];
  for (const ordinal of ALL_ORDINALS) {
    const placement = inventory[ordinal];
    const seq = placement ? match(placement) : null;
    if (seq !== null) entries.push({ ordinal, seq });
  }
  entries.sort((first, second) => first.seq - second.seq || first.ordinal - second.ordinal);
  return entries.map((entry) => entry.ordinal);
}
function bagOrder(inventory) {
  return orderedOrdinals(inventory, (placement) => placement.at === "bag" ? placement.seq : null);
}
function rackOrder(inventory, side) {
  return orderedOrdinals(
    inventory,
    (placement) => placement.at === "rack" && placement.side === side ? placement.seq : null
  );
}
function pendingReturnOrder(inventory, side) {
  return orderedOrdinals(
    inventory,
    (placement) => placement.at === "pendingReturn" && placement.side === side ? placement.seq : null
  );
}
function normalizeInventory(inventory) {
  const next = inventory.slice();
  const renumber = (ordinals, rewrite) => {
    ordinals.forEach((ordinal, seq) => {
      next[ordinal] = rewrite(seq);
    });
  };
  renumber(bagOrder(inventory), (seq) => ({ at: "bag", seq }));
  for (const side of SIDES) {
    renumber(rackOrder(inventory, side), (seq) => ({ at: "rack", side, seq }));
    renumber(pendingReturnOrder(inventory, side), (seq) => ({ at: "pendingReturn", side, seq }));
  }
  return Object.freeze(next);
}
function inventoryProblems(inventory) {
  const problems = [];
  if (!Array.isArray(inventory) || inventory.length !== TILE_COUNT) {
    problems.push(
      `The inventory must account for exactly ${TILE_COUNT} tiles, found ${Array.isArray(inventory) ? inventory.length : "a non-array value"}.`
    );
    return problems;
  }
  const occupiedSquares = /* @__PURE__ */ new Map();
  const seqSeen = {};
  const counts = {};
  const noteSeq = (bucket, seq, ordinal) => {
    counts[bucket] = (counts[bucket] ?? 0) + 1;
    if (!Number.isInteger(seq) || seq < 0) {
      problems.push(`${tileIdOf(ordinal)} has a non-ordinal position ${seq} in ${bucket}.`);
      return;
    }
    const seen = seqSeen[bucket] ??= /* @__PURE__ */ new Set();
    if (seen.has(seq)) {
      problems.push(`${bucket} has two tiles at position ${seq}; ordering is ambiguous.`);
    }
    seen.add(seq);
  };
  for (const ordinal of ALL_ORDINALS) {
    const placement = inventory[ordinal];
    if (!placement || typeof placement !== "object") {
      problems.push(`${tileIdOf(ordinal)} has no authoritative location.`);
      continue;
    }
    switch (placement.at) {
      case "bag":
        noteSeq("bag", placement.seq, ordinal);
        break;
      case "rack":
        if (placement.side !== "A" && placement.side !== "B") {
          problems.push(`${tileIdOf(ordinal)} is on a rack that is neither A nor B.`);
          break;
        }
        noteSeq(`rack${placement.side}`, placement.seq, ordinal);
        break;
      case "pendingReturn":
        if (placement.side !== "A" && placement.side !== "B") {
          problems.push(`${tileIdOf(ordinal)} is returning to a side that is neither A nor B.`);
          break;
        }
        noteSeq(`pendingReturn${placement.side}`, placement.seq, ordinal);
        break;
      case "board": {
        counts.board = (counts.board ?? 0) + 1;
        const { row, col } = placement;
        if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || col < 0 || row >= BOARD_SIZE || col >= BOARD_SIZE) {
          problems.push(`${tileIdOf(ordinal)} is on a board square (${row}, ${col}) off the board.`);
          break;
        }
        const square = `${row}:${col}`;
        const other = occupiedSquares.get(square);
        if (other !== void 0) {
          problems.push(
            `${tileIdOf(other)} and ${tileIdOf(ordinal)} both occupy board square (${row}, ${col}).`
          );
        }
        occupiedSquares.set(square, ordinal);
        if (placement.by !== "A" && placement.by !== "B") {
          problems.push(`${tileIdOf(ordinal)} was placed by neither A nor B.`);
        }
        if (!Number.isInteger(placement.placedTurn) || placement.placedTurn < 1) {
          problems.push(`${tileIdOf(ordinal)} records an impossible turn ${placement.placedTurn}.`);
        }
        break;
      }
      default:
        problems.push(
          `${tileIdOf(ordinal)} is in "${placement.at}", which is not a location.`
        );
    }
    const assigned = placement.at === "board" ? placement.assigned : void 0;
    if (assigned !== void 0 && !tokenAcceptsAssignment(tokenOfOrdinal(ordinal))) {
      problems.push(
        `${tileIdOf(ordinal)} is a fixed "${tokenOfOrdinal(ordinal)}" tile but claims the face "${assigned}".`
      );
    }
    if (placement.at !== "board" && "assigned" in placement) {
      problems.push(`${tileIdOf(ordinal)} carries a played face while not on the board.`);
    }
  }
  for (const side of SIDES) {
    const rackCount = counts[`rack${side}`] ?? 0;
    if (rackCount > RACK_SIZE) {
      problems.push(`Rack ${side} holds ${rackCount} tiles; a rack holds at most ${RACK_SIZE}.`);
    }
  }
  for (const [bucket, seen] of Object.entries(seqSeen)) {
    const expected = counts[bucket] ?? 0;
    for (let seq = 0; seq < expected; seq += 1) {
      if (!seen.has(seq)) {
        problems.push(`${bucket} skips position ${seq}; its ordering is not dense.`);
        break;
      }
    }
  }
  return problems;
}
function assertInventory(inventory, context = "canonical state") {
  const problems = inventoryProblems(inventory);
  if (problems.length > 0) {
    throw new InventoryError(`The ${context} does not describe the 100-tile set`, problems);
  }
  return inventory;
}

// src/domain/identity.ts
var ORDINALS_BY_TOKEN = (() => {
  const grouped = /* @__PURE__ */ new Map();
  TILE_TOKENS.forEach((token, ordinal) => {
    const bucket = grouped.get(token);
    if (bucket) bucket.push(ordinal);
    else grouped.set(token, [ordinal]);
  });
  return grouped;
})();
function createIdentityAllocator(options = {}) {
  const used = /* @__PURE__ */ new Map();
  const overdrawn = [];
  return {
    /** The next unused physical tile with this face. */
    take(token) {
      const copies = ORDINALS_BY_TOKEN.get(token);
      if (!copies) {
        throw new InventoryError(`"${token}" is not a face in the physical set.`);
      }
      const index = used.get(token) ?? 0;
      used.set(token, index + 1);
      const ordinal = copies[index];
      if (ordinal === void 0) {
        const message = `The saved game claims ${index + 1} "${token}" tiles but the set has ${copies.length}.`;
        if (options.strict !== false) throw new InventoryError(message);
        overdrawn.push(message);
        return copies[copies.length - 1];
      }
      return ordinal;
    },
    /** Total tiles handed out so far. */
    count() {
      let total = 0;
      for (const value of used.values()) total += value;
      return total;
    },
    problems() {
      return overdrawn;
    },
    /** Prove the allocation consumed the whole physical set. */
    assertComplete(context) {
      const handed = this.count();
      if (handed === TILE_COUNT && overdrawn.length === 0) return;
      const problems = [...overdrawn];
      if (handed !== TILE_COUNT) {
        problems.push(`It accounts for ${handed} tiles; the physical set has ${TILE_COUNT}.`);
      }
      throw new InventoryError(`The ${context} does not describe the 100-tile set`, problems);
    }
  };
}

// src/domain/projection.ts
function inventoryFrom(source) {
  const slots = new Array(TILE_COUNT);
  const problems = [];
  const claimedBy = /* @__PURE__ */ new Map();
  const claim = (tile, where, placement) => {
    const ordinal = tryOrdinalOfTileId(tile.id);
    if (ordinal === null) {
      problems.push(`"${tile.id}" in ${where} is not a tile of the physical set.`);
      return;
    }
    if (tokenOfOrdinal(ordinal) !== tile.token) {
      problems.push(
        `${tile.id} in ${where} claims to be "${tile.token}" but that tile is a "${tokenOfOrdinal(ordinal)}".`
      );
      return;
    }
    const previous = claimedBy.get(ordinal);
    if (previous !== void 0) {
      problems.push(`${tile.id} is in both ${previous} and ${where}.`);
      return;
    }
    claimedBy.set(ordinal, where);
    slots[ordinal] = placement;
  };
  source.tilebag.forEach((tile, seq) => claim(tile, "the bag", { at: "bag", seq }));
  source.rackA.forEach((tile, seq) => claim(tile, "rack A", { at: "rack", side: "A", seq }));
  source.rackB.forEach((tile, seq) => claim(tile, "rack B", { at: "rack", side: "B", seq }));
  (source.pendingReturnA ?? []).forEach(
    (tile, seq) => claim(tile, "A's exchanged tiles", { at: "pendingReturn", side: "A", seq })
  );
  (source.pendingReturnB ?? []).forEach(
    (tile, seq) => claim(tile, "B's exchanged tiles", { at: "pendingReturn", side: "B", seq })
  );
  source.board.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      if (!cell) return;
      const assigned = cell.tile.assignedToken;
      const ordinal = tryOrdinalOfTileId(cell.tile.id);
      const keepsFace = assigned !== void 0 && ordinal !== null && tokenAcceptsAssignment(tokenOfOrdinal(ordinal));
      claim(cell.tile, `board square (${rowIndex}, ${colIndex})`, {
        at: "board",
        row: rowIndex,
        col: colIndex,
        placedTurn: cell.placedTurn,
        by: cell.side,
        ...keepsFace ? { assigned } : {}
      });
    });
  });
  const missing = [];
  for (let ordinal = 0; ordinal < TILE_COUNT; ordinal += 1) {
    if (slots[ordinal] === void 0) missing.push(tileIdOf(ordinal));
  }
  if (missing.length > 0) {
    problems.push(
      missing.length > 6 ? `${missing.length} tiles are in no location at all (${missing.slice(0, 6).join(", ")}, \u2026).` : `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} in no location at all.`
    );
  }
  if (problems.length > 0) {
    throw new InventoryError("This game does not describe the 100-tile set", problems);
  }
  return assertInventory(normalizeInventory(slots), "recovered state");
}
function canonicalFromSnapshot(snapshot, revision) {
  const inventory = inventoryFrom({
    tilebag: snapshot.tilebag,
    rackA: snapshot.rackA,
    rackB: snapshot.rackB,
    board: snapshot.board,
    pendingReturnA: snapshot.pendingExchangeReturnBySide?.A ?? [],
    pendingReturnB: snapshot.pendingExchangeReturnBySide?.B ?? []
  });
  return Object.freeze({
    gameId: snapshot.gameId,
    revision,
    inventory,
    gameMode: snapshot.gameMode === "solo" ? "solo" : "versus",
    drawMode: snapshot.tileDrawMode === "play" ? "play" : "manual",
    startingSide: snapshot.startingSide ?? snapshot.activeSide,
    turnNumber: snapshot.turnNumber,
    activeSide: snapshot.activeSide,
    phase: snapshot.phase,
    status: snapshot.status,
    scores: Object.freeze({ ...snapshot.scores }),
    appliedCommands: Object.freeze([])
  });
}
function encodeCanonical(state) {
  return {
    v: 1,
    gameId: state.gameId,
    revision: state.revision,
    gameMode: state.gameMode,
    drawMode: state.drawMode,
    startingSide: state.startingSide,
    turnNumber: state.turnNumber,
    activeSide: state.activeSide,
    phase: state.phase,
    status: state.status,
    scores: { A: state.scores.A, B: state.scores.B },
    appliedCommands: [...state.appliedCommands],
    inventory: normalizeInventory(state.inventory)
  };
}

// src/codec.ts
var LEGACY_TOKENS = [
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
var BOARD_DIM = BOARD_SIZE;
function encodeTile(tile) {
  const ordinal = tryOrdinalOfTileId(tile.id);
  if (ordinal === null) {
    throw new InventoryError(
      `Refusing to store "${tile.id}": it is not a tile of the physical set.`
    );
  }
  if (tokenOfOrdinal(ordinal) !== tile.token) {
    throw new InventoryError(
      `Refusing to store ${tile.id} as a "${tile.token}": that tile is a "${tokenOfOrdinal(ordinal)}".`
    );
  }
  return tile.assignedToken === void 0 ? ordinal : [ordinal, tile.assignedToken];
}
function encodeTiles(tiles) {
  return tiles.map(encodeTile);
}
function readOrdinalTile(code) {
  const [ordinal, face] = Array.isArray(code) ? code : [code, void 0];
  const tile = { id: tileIdOf(ordinal), token: tokenOfOrdinal(ordinal) };
  return face === void 0 ? tile : { ...tile, assignedToken: face };
}
function makeLegacyReader(allocator) {
  return (code) => {
    const [index, face] = Array.isArray(code) ? code : [code, void 0];
    const token = LEGACY_TOKENS[index];
    if (token === void 0) {
      throw new InventoryError(`A saved tile refers to face ${index}, which does not exist.`);
    }
    const ordinal = allocator.take(token);
    const tile = { id: tileIdOf(ordinal), token };
    return face === void 0 ? tile : { ...tile, assignedToken: face };
  };
}
function decodeTiles(codes, read) {
  return codes.map(read);
}
function encodeBoard(board) {
  const out = [];
  for (let r = 0; r < board.length; r += 1) {
    const row = board[r];
    for (let c = 0; c < row.length; c += 1) {
      const cell = row[c];
      if (cell) {
        out.push([
          r * BOARD_DIM + c,
          encodeTile(cell.tile),
          cell.placedTurn,
          cell.side === "A" ? 0 : 1
        ]);
      }
    }
  }
  return out;
}
function decodeBoard(cells, read) {
  const board = Array.from(
    { length: BOARD_DIM },
    () => Array.from({ length: BOARD_DIM }, () => null)
  );
  for (const [cellIndex, tileCode, placedTurn, side] of cells) {
    const r = Math.floor(cellIndex / BOARD_DIM);
    const c = cellIndex % BOARD_DIM;
    board[r][c] = { tile: read(tileCode), placedTurn, side: side === 0 ? "A" : "B" };
  }
  return board;
}
function encodeLog(log) {
  return {
    ...log,
    rackBefore: encodeTiles(log.rackBefore),
    rackAfter: encodeTiles(log.rackAfter),
    boardBefore: encodeBoard(log.boardBefore),
    boardAfter: encodeBoard(log.boardAfter),
    tilebagBefore: encodeTiles(log.tilebagBefore),
    tilebagAfter: encodeTiles(log.tilebagAfter)
  };
}
function decodeLog(log, version) {
  const read = (codes) => decodeTiles(codes, readerFor(version));
  const readBoard = (cells) => decodeBoard(cells, readerFor(version));
  return {
    ...log,
    rackBefore: read(log.rackBefore),
    rackAfter: read(log.rackAfter),
    boardBefore: readBoard(log.boardBefore),
    boardAfter: readBoard(log.boardAfter),
    tilebagBefore: read(log.tilebagBefore),
    tilebagAfter: read(log.tilebagAfter)
  };
}
function readerFor(version) {
  return version === 3 ? readOrdinalTile : makeLegacyReader(createIdentityAllocator({ strict: false }));
}
function encodeSnapshot(snapshot) {
  const pendingBySide = getPendingExchangeReturnBySide(snapshot);
  return {
    commitId: snapshot.commitId,
    gameId: snapshot.gameId,
    revision: snapshot.revision,
    name: snapshot.name,
    gameMode: getGameMode(snapshot),
    players: snapshot.players,
    playerMembers: snapshot.playerMembers,
    playerUserIds: snapshot.playerUserIds,
    playerEmails: snapshot.playerEmails,
    emailPlayMode: snapshot.emailPlayMode,
    emailPlayersCanSeeOpponentRack: snapshot.emailPlayersCanSeeOpponentRack,
    matchControl: snapshot.matchControl,
    roomStage: snapshot.roomStage,
    lobbyReadyBySide: snapshot.lobbyReadyBySide,
    lobbyLaunchAt: snapshot.lobbyLaunchAt,
    startingSide: snapshot.startingSide,
    botSide: snapshot.botSide,
    botEngine: snapshot.botEngine,
    botDifficulty: snapshot.botDifficulty,
    faceDownCount: snapshot.faceDownCount,
    // Which version of the parked lines this position was committed with. Tiny
    // on purpose: the lines themselves live beside the game, not in it.
    timelineRef: snapshot.timelineRef,
    // The versions this game's client-side bot is pinned to. Persisted with the
    // game so the pin survives a reload and reaches a SECOND DEVICE — which is
    // the only way it can stop one match being played by two evaluators.
    superEngineVersion: snapshot.superEngineVersion,
    superWeightsVersion: snapshot.superWeightsVersion,
    tileDrawMode: getTileDrawMode(snapshot),
    turnNumber: snapshot.turnNumber,
    activeSide: snapshot.activeSide,
    phase: snapshot.phase,
    status: snapshot.status,
    boardSize: snapshot.boardSize,
    timers: snapshot.timers,
    scores: snapshot.scores,
    currentTurnStartedAt: snapshot.currentTurnStartedAt,
    createdAt: snapshot.createdAt,
    board: encodeBoard(snapshot.board),
    rackA: encodeTiles(snapshot.rackA),
    rackB: encodeTiles(snapshot.rackB),
    tilebag: encodeTiles(snapshot.tilebag),
    pendingExchangeReturn: aggregatePendingExchangeReturns(pendingBySide).length > 0 ? encodeTiles(aggregatePendingExchangeReturns(pendingBySide)) : void 0,
    pendingExchangeReturnBySide: encodePendingExchangeReturnBySide(pendingBySide),
    logs: snapshot.logs.map(encodeLog)
  };
}
function decodeSnapshot(snapshot, read, logs) {
  const pendingBySide = decodePendingExchangeReturnBySide(snapshot, read);
  return {
    commitId: snapshot.commitId,
    gameId: snapshot.gameId,
    revision: snapshot.revision,
    name: snapshot.name,
    gameMode: getGameMode(snapshot),
    players: snapshot.players,
    playerMembers: snapshot.playerMembers,
    playerUserIds: snapshot.playerUserIds,
    playerEmails: snapshot.playerEmails,
    emailPlayMode: snapshot.emailPlayMode,
    emailPlayersCanSeeOpponentRack: snapshot.emailPlayersCanSeeOpponentRack,
    matchControl: snapshot.matchControl,
    roomStage: snapshot.roomStage,
    lobbyReadyBySide: snapshot.lobbyReadyBySide,
    lobbyLaunchAt: snapshot.lobbyLaunchAt,
    startingSide: snapshot.startingSide ?? snapshot.activeSide,
    botSide: snapshot.botSide,
    botEngine: snapshot.botEngine,
    botDifficulty: snapshot.botDifficulty,
    faceDownCount: snapshot.faceDownCount,
    timelineRef: snapshot.timelineRef,
    // Absent on every game saved before pinning existed, and on every game that
    // never computed a Super move locally. Left absent rather than defaulted:
    // claiming a game was pinned to the current version when it was not is the
    // one thing a reproducibility record must never do.
    superEngineVersion: snapshot.superEngineVersion,
    superWeightsVersion: snapshot.superWeightsVersion,
    tileDrawMode: snapshot.tileDrawMode ?? "manual",
    turnNumber: snapshot.turnNumber,
    activeSide: snapshot.activeSide,
    phase: snapshot.phase,
    status: snapshot.status,
    boardSize: snapshot.boardSize,
    timers: snapshot.timers,
    scores: snapshot.scores,
    currentTurnStartedAt: snapshot.currentTurnStartedAt,
    createdAt: snapshot.createdAt,
    // Order matters for legacy recovery: the bag is dealt first, then the
    // racks, then the board, then tiles waiting to go back. Fixed, so every
    // client recovers the same assignment.
    tilebag: decodeTiles(snapshot.tilebag, read),
    rackA: decodeTiles(snapshot.rackA, read),
    rackB: decodeTiles(snapshot.rackB, read),
    board: decodeBoard(snapshot.board, read),
    pendingExchangeReturn: aggregatePendingExchangeReturns(pendingBySide),
    pendingExchangeReturnBySide: pendingBySide,
    logs
  };
}
function encodePendingExchangeReturnBySide(pendingBySide) {
  const encoded = {};
  if (pendingBySide.A.length > 0) encoded.A = encodeTiles(pendingBySide.A);
  if (pendingBySide.B.length > 0) encoded.B = encodeTiles(pendingBySide.B);
  return encoded.A || encoded.B ? encoded : void 0;
}
function decodePendingExchangeReturnBySide(snapshot, read) {
  if (snapshot.pendingExchangeReturnBySide) {
    const bySide = {
      A: snapshot.pendingExchangeReturnBySide.A ? decodeTiles(snapshot.pendingExchangeReturnBySide.A, read) : [],
      B: snapshot.pendingExchangeReturnBySide.B ? decodeTiles(snapshot.pendingExchangeReturnBySide.B, read) : []
    };
    return { A: bySide.A ?? [], B: bySide.B ?? [] };
  }
  const legacyPending = snapshot.pendingExchangeReturn ? decodeTiles(snapshot.pendingExchangeReturn, read) : [];
  if (legacyPending.length === 0) return { A: [], B: [] };
  const legacySide = snapshot.activeSide === "A" ? "B" : "A";
  return legacySide === "A" ? { A: legacyPending, B: [] } : { A: [], B: legacyPending };
}
function encodeHistorySnapshot(snapshot) {
  const { logs: _logs, ...encoded } = encodeSnapshot(snapshot);
  return { ...encoded, logCount: snapshot.logs.length };
}
function encodeGame(game) {
  const historyLogCatalog = game.history.reduce(
    (longest, snapshot) => snapshot.logs.length > longest.length ? snapshot.logs : longest,
    game.logs
  );
  return {
    v: 3,
    ...encodeSnapshot(game),
    history: game.history.map(encodeHistorySnapshot),
    historyLogs: historyLogCatalog.map(encodeLog),
    historyIndex: game.historyIndex,
    lastSavedAt: game.lastSavedAt
  };
}
function decodeGame(payload) {
  const version = payload.v ?? 1;
  const positionAllocator = version === 3 ? null : createIdentityAllocator();
  const read = positionAllocator ? makeLegacyReader(positionAllocator) : readOrdinalTile;
  const logs = payload.logs.map((log) => decodeLog(log, version));
  const current = decodeSnapshot(payload, read, logs);
  positionAllocator?.assertComplete("saved game");
  assertPhysicalSet(current);
  if (version === 1) {
    const v1 = payload;
    return {
      ...current,
      history: v1.history.map(
        (snapshot) => decodeSnapshot(
          snapshot,
          makeLegacyReader(createIdentityAllocator({ strict: false })),
          snapshot.logs.map((log) => decodeLog(log, version))
        )
      ),
      historyIndex: v1.historyIndex,
      lastSavedAt: v1.lastSavedAt
    };
  }
  const versioned = payload;
  const historyLogs = versioned.historyLogs.map((log) => decodeLog(log, version));
  return {
    ...current,
    history: versioned.history.map((snapshot) => {
      const { logCount, ...encoded } = snapshot;
      const historyRead = version === 3 ? readOrdinalTile : makeLegacyReader(createIdentityAllocator({ strict: false }));
      return decodeSnapshot({ ...encoded, logs: [] }, historyRead, historyLogs.slice(0, logCount));
    }),
    historyIndex: versioned.historyIndex,
    lastSavedAt: versioned.lastSavedAt
  };
}
function assertPhysicalSet(snapshot) {
  inventoryFrom({
    tilebag: snapshot.tilebag,
    rackA: snapshot.rackA,
    rackB: snapshot.rackB,
    board: snapshot.board,
    pendingReturnA: snapshot.pendingExchangeReturnBySide?.A ?? [],
    pendingReturnB: snapshot.pendingExchangeReturnBySide?.B ?? []
  });
}
function encodeTileCodes(tiles) {
  return tiles.map(encodeTile);
}
function decodeTileCodes(codes) {
  return codes.map(readOrdinalTile);
}
function encodeBoardCells(board) {
  return encodeBoard(board);
}
function decodeBoardCells(cells) {
  return decodeBoard(cells, readOrdinalTile);
}
function encodeTurnLog(log) {
  return encodeLog(log);
}
function decodeTurnLog(log) {
  return decodeLog(log, 3);
}
var ORDINAL_TOKEN_TABLE = TILE_TOKENS;

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
function applyRankedAction(game, side, action, now, policy = "ranked") {
  if (game.status !== "playing" || game.roomStage !== "playing" || game.timers.paused)
    throw new Error("Match is not playing.");
  if (game.activeSide !== side && action.kind !== "resign") throw new Error("It is not your turn.");
  const physical = policy === "normal" && game.tileDrawMode === "manual";
  if (physical && game.phase === "refill" && action.kind !== "resign")
    throw new Error("Record the physical refill first.");
  const settled = policy === "ranked" ? settleRankedClock(game, now) : settleNormalClock(game, now);
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
    const incoming = physical ? [] : tilebagBefore.slice(0, outgoing.length);
    rackAfter = [...rackBefore.filter((tile) => !unique.has(tile.id)), ...incoming];
    tilebagAfter = physical ? tilebagBefore : shuffleTilebagQueue([...tilebagBefore.slice(outgoing.length), ...outgoing]);
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
      ...physical && action.kind === "exchange" ? {
        pendingExchangeReturnBySide: {
          ...settled.pendingExchangeReturnBySide,
          [side]: actionDetail.outgoingTiles
        },
        pendingExchangeReturn: actionDetail.outgoingTiles
      } : {},
      logs: nextLogs,
      scores: policy === "ranked" ? calculateTotals(nextLogs) : calculateGameTotals(settled, nextLogs),
      status: autoEnd ? "finished" : "playing",
      timers: autoEnd ? { ...settled.timers, paused: true } : settled.timers
    },
    side,
    rackAfter
  );
  if (!autoEnd) {
    if (physical && (action.kind === "place" || action.kind === "exchange") && tilebagAfter.length > 0)
      next = { ...next, phase: "refill" };
    else {
      if (action.kind === "place" && !physical) next = refillRackFromQueue(next);
      next = advanceToOpponentTurn(next);
    }
  }
  return { ...next, history: [], historyIndex: 0, lastSavedAt: now };
}
function settleNormalClock(game, now) {
  if (game.timers.paused || game.timers.untimed || game.timers.sideUntimed?.[game.activeSide])
    return game;
  const elapsed = Math.max(
    0,
    Math.floor((Date.parse(now) - Date.parse(game.currentTurnStartedAt)) / 1e3)
  );
  if (!Number.isFinite(elapsed)) throw new Error("Invalid clock.");
  return {
    ...game,
    timers: {
      ...game.timers,
      [game.activeSide]: Math.max(game.timers.minSeconds, game.timers[game.activeSide] - elapsed)
    },
    currentTurnStartedAt: now
  };
}
function settleRankedClock(game, now) {
  if (game.status !== "playing" || game.roomStage !== "playing" || game.timers.paused) return game;
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

// src/gameplay/publicTiles.ts
function visibleBoard(board) {
  return board.map(
    (row, r) => row.map(
      (cell, c) => cell ? {
        side: cell.side,
        placedTurn: cell.placedTurn,
        tile: {
          id: `board:${r}:${c}`,
          token: cell.tile.token,
          ...cell.tile.assignedToken ? { assignedToken: cell.tile.assignedToken } : {}
        }
      } : null
    )
  );
}
function ownTiles(tiles) {
  return tiles.map(({ id, token }) => ({ id, token }));
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
    players: { A: game.players.A, B: game.players.B },
    startingSide: game.startingSide ?? "A",
    activeSide: game.activeSide,
    turnNumber: game.turnNumber,
    scores: { A: game.scores.A, B: game.scores.B },
    timers: { A: game.timers.A, B: game.timers.B },
    clockStartedAt: game.currentTurnStartedAt,
    board: visibleBoard(game.board),
    tilebagCount: game.tilebag.length,
    rackCount: { A: game.rackA.length, B: game.rackB.length },
    readyBySide: { A: game.lobbyReadyBySide?.A ?? false, B: game.lobbyReadyBySide?.B ?? false },
    yourSide,
    yourRack: game.roomStage === "playing" ? yourSide === "A" ? ownTiles(game.rackA) : yourSide === "B" ? ownTiles(game.rackB) : [] : [],
    logs: game.logs.map((log) => ({
      id: log.id,
      turnNumber: log.turnNumber,
      side: log.side,
      action: log.action,
      score: log.finalScore,
      exchangedCount: log.action === "exchange" ? log.actionDetail.outgoingTiles.length : 0,
      boardAfter: visibleBoard(log.boardAfter),
      ...yourSide === log.side ? { rackBefore: ownTiles(log.rackBefore), rackAfter: ownTiles(log.rackAfter) } : {}
    })),
    result: resultOf(game)
  };
}

// src/pregame.ts
function createWaitingGame(settings) {
  return resetWaitingGame(createNewGame(settings));
}
function updateWaitingGame(game, settings) {
  const configured = createNewGame(settings);
  return resetWaitingGame({
    ...configured,
    gameId: game.gameId,
    createdAt: game.createdAt
  });
}
function startWaitingGame(game) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const started = {
    ...game,
    roomStage: "playing",
    lobbyLaunchAt: void 0,
    status: "playing",
    timers: { ...game.timers, paused: false },
    currentTurnStartedAt: now,
    lastSavedAt: now
  };
  return {
    ...started,
    history: [makeSnapshot(started)],
    historyIndex: 0
  };
}
function settingsFromWaitingGame(game) {
  const initialSecondsBySide = game.timers.initialSecondsBySide;
  const timerMinutes = {
    A: game.timers.sideUntimed?.A ? null : secondsToMinutes(initialSecondsBySide?.A ?? game.timers.A),
    B: game.timers.sideUntimed?.B ? null : secondsToMinutes(initialSecondsBySide?.B ?? game.timers.B)
  };
  return {
    name: game.name,
    gameMode: getGameMode(game),
    playerA: game.players.A,
    playerB: game.players.B,
    playerAMemberId: game.playerMembers?.A ?? null,
    playerBMemberId: game.playerMembers?.B ?? null,
    playerAUserId: game.playerUserIds?.A ?? null,
    playerBUserId: game.playerUserIds?.B ?? null,
    playerAEmail: game.playerEmails?.A ?? null,
    playerBEmail: game.playerEmails?.B ?? null,
    emailPlayMode: game.emailPlayMode,
    emailPlayersCanSeeOpponentRack: game.emailPlayersCanSeeOpponentRack,
    minutes: timerMinutes.A ?? timerMinutes.B ?? void 0,
    timerMinutes,
    startingSide: game.startingSide ?? "A",
    botSide: game.botSide,
    botEngine: game.botEngine,
    botDifficulty: game.botDifficulty,
    tileDrawMode: getTileDrawMode(game),
    untimed: timerMinutes.A === null && timerMinutes.B === null
  };
}
function resetWaitingGame(game) {
  const waiting = {
    ...game,
    roomStage: "waiting",
    lobbyReadyBySide: {},
    lobbyLaunchAt: void 0,
    status: "draft",
    timers: { ...game.timers, paused: true }
  };
  return {
    ...waiting,
    history: [makeSnapshot(waiting)],
    historyIndex: 0
  };
}
function secondsToMinutes(seconds) {
  return Math.max(1, Math.round(seconds / 60));
}

// src/gameplay/multiverse.ts
var EMPTY_MULTIVERSE = { version: 0, lines: [] };
var MULTIVERSE_LIMITS = { lines: 40, parkedTurns: 600 };
function buildTree(activeLogs, multiverse) {
  const nodes = /* @__PURE__ */ new Map();
  const rootChildIds = [];
  const problems = [];
  const attach = (node) => {
    nodes.set(node.id, node);
    if (node.parentId === null) rootChildIds.push(node.id);
    else nodes.get(node.parentId).childIds.push(node.id);
  };
  activeLogs.forEach((log, index) => {
    if (nodes.has(log.id)) {
      problems.push(`Turn ${log.id} appears twice in the line being played.`);
      return;
    }
    const parentId = index === 0 ? null : activeLogs[index - 1].id;
    attach({ id: log.id, log, parentId, childIds: [], depth: index, lineId: null, index });
  });
  let pending = multiverse.lines.slice();
  let progressed = true;
  while (pending.length > 0 && progressed) {
    progressed = false;
    const waiting = [];
    for (const line of pending) {
      if (line.from !== null && !nodes.has(line.from)) {
        waiting.push(line);
        continue;
      }
      progressed = true;
      let parentId = line.from;
      for (let index = 0; index < line.logs.length; index += 1) {
        const log = line.logs[index];
        if (nodes.has(log.id)) {
          problems.push(`Parked line ${line.id} repeats turn ${log.id}; the rest of it is hidden.`);
          break;
        }
        const depth = parentId === null ? 0 : nodes.get(parentId).depth + 1;
        attach({ id: log.id, log, parentId, childIds: [], depth, lineId: line.id, index });
        parentId = log.id;
      }
    }
    pending = waiting;
  }
  for (const line of pending) {
    problems.push(`Parked line ${line.id} continues from a turn this game does not have.`);
  }
  return {
    nodes,
    rootChildIds,
    activeIds: activeLogs.map((log) => log.id),
    problems
  };
}
function pathTo(tree, nodeId) {
  const chain = [];
  let cursor = nodeId;
  while (cursor !== null) {
    const node = tree.nodes.get(cursor);
    if (!node) break;
    chain.push(node.log);
    cursor = node.parentId;
  }
  return chain.reverse();
}
function childrenOf(tree, nodeId) {
  if (nodeId === null) return tree.rootChildIds;
  return tree.nodes.get(nodeId)?.childIds ?? [];
}
function positionOf(snapshot) {
  const pending = getPendingExchangeReturnBySide(snapshot);
  return {
    board: snapshot.board,
    rackA: snapshot.rackA,
    rackB: snapshot.rackB,
    tilebag: snapshot.tilebag,
    pendingExchangeReturnBySide: { A: pending.A, B: pending.B },
    timers: { A: snapshot.timers.A, B: snapshot.timers.B },
    scores: snapshot.scores,
    turnNumber: snapshot.turnNumber,
    activeSide: snapshot.activeSide,
    phase: snapshot.phase,
    status: snapshot.status,
    ...snapshot.faceDownCount ? { faceDownCount: snapshot.faceDownCount } : {}
  };
}
function committedPosition(history, logs, index) {
  const id = logs[index]?.id;
  if (id === void 0) return null;
  for (const snapshot of history) {
    if (snapshot.logs.length === index + 1 && snapshot.logs[index]?.id === id) {
      return positionOf(snapshot);
    }
  }
  return null;
}
function startPosition(game) {
  const first = game.history[0];
  return first && first.logs.length === 0 ? positionOf(first) : null;
}
function lineById(multiverse, id) {
  return multiverse.lines.find((line) => line.id === id);
}
function positionAfter(game, multiverse, tree, nodeId) {
  if (nodeId === null) return startPosition(game);
  const node = tree.nodes.get(nodeId);
  if (!node) return null;
  if (node.lineId === null) {
    return node.index === game.logs.length - 1 ? positionOf(game) : committedPosition(game.history, game.logs, node.index);
  }
  const line = lineById(multiverse, node.lineId);
  if (!line) return null;
  return node.index === line.logs.length - 1 ? line.tip : line.after[node.index] ?? null;
}
function positionBefore(game, multiverse, tree, nodeId) {
  const node = tree.nodes.get(nodeId);
  if (!node || node.log.action === "end_game") return null;
  let committed;
  if (node.lineId === null) {
    committed = committedPosition(game.history, game.logs, node.index) ?? (node.index === game.logs.length - 1 ? positionOf(game) : null);
  } else {
    const line = lineById(multiverse, node.lineId);
    committed = line?.after[node.index] ?? (line && node.index === line.logs.length - 1 ? line.tip : null);
  }
  if (!committed) return null;
  return revertTurn(committed, node.log, calculateGameTotals(game, pathTo(tree, node.parentId)));
}
function revertTurn(committed, log, scoresBefore) {
  const side = log.side;
  const pending = {
    A: [...committed.pendingExchangeReturnBySide.A],
    B: [...committed.pendingExchangeReturnBySide.B]
  };
  if (log.action === "exchange") {
    const outgoing = new Set(log.actionDetail.outgoingTiles.map((t) => t.id));
    pending[side] = pending[side].filter((tile) => !outgoing.has(tile.id));
  }
  const rack = log.rackBefore.map(clearTileAssignment);
  const position = {
    ...committed,
    board: log.boardBefore,
    rackA: side === "A" ? rack : committed.rackA,
    rackB: side === "B" ? rack : committed.rackB,
    tilebag: log.tilebagBefore,
    pendingExchangeReturnBySide: pending,
    timers: { A: log.timerBefore.A, B: log.timerBefore.B },
    scores: scoresBefore,
    turnNumber: log.turnNumber,
    activeSide: side,
    phase: "choose_action",
    status: "playing"
  };
  return isPhysicalSet(position) ? position : null;
}
function isPhysicalSet(position) {
  try {
    inventoryFrom({
      tilebag: position.tilebag,
      rackA: position.rackA,
      rackB: position.rackB,
      board: position.board,
      pendingReturnA: position.pendingExchangeReturnBySide.A,
      pendingReturnB: position.pendingExchangeReturnBySide.B
    });
    return true;
  } catch {
    return false;
  }
}
function continueFrom(game, multiverse, target, options = {}) {
  if (game.status === "finished") return fail("\u0E40\u0E01\u0E21\u0E19\u0E35\u0E49\u0E08\u0E1A\u0E41\u0E25\u0E49\u0E27 \u0E40\u0E25\u0E48\u0E19\u0E15\u0E48\u0E2D\u0E08\u0E32\u0E01\u0E15\u0E33\u0E41\u0E2B\u0E19\u0E48\u0E07\u0E40\u0E01\u0E48\u0E32\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49");
  const tree = buildTree(game.logs, multiverse);
  let anchorId;
  let position;
  if (target.phase === "before") {
    if (target.nodeId === null) return fail("\u0E44\u0E21\u0E48\u0E21\u0E35\u0E15\u0E32\u0E01\u0E48\u0E2D\u0E19\u0E40\u0E23\u0E34\u0E48\u0E21\u0E40\u0E01\u0E21");
    const node = tree.nodes.get(target.nodeId);
    if (!node) return fail("\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E15\u0E32\u0E19\u0E35\u0E49\u0E43\u0E19\u0E40\u0E01\u0E21\u0E41\u0E25\u0E49\u0E27");
    anchorId = node.parentId;
    position = positionBefore(game, multiverse, tree, target.nodeId);
  } else {
    if (target.nodeId !== null && !tree.nodes.has(target.nodeId))
      return fail("\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E15\u0E32\u0E19\u0E35\u0E49\u0E43\u0E19\u0E40\u0E01\u0E21\u0E41\u0E25\u0E49\u0E27");
    anchorId = target.nodeId;
    position = positionAfter(game, multiverse, tree, target.nodeId);
  }
  if (!position) return fail("\u0E15\u0E32\u0E19\u0E35\u0E49\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E15\u0E33\u0E41\u0E2B\u0E19\u0E48\u0E07\u0E44\u0E27\u0E49\u0E04\u0E23\u0E1A\u0E1E\u0E2D\u0E08\u0E30\u0E40\u0E25\u0E48\u0E19\u0E15\u0E48\u0E2D \u0E14\u0E39\u0E44\u0E14\u0E49\u0E2D\u0E22\u0E48\u0E32\u0E07\u0E40\u0E14\u0E35\u0E22\u0E27");
  if (position.status === "finished") return fail("\u0E15\u0E33\u0E41\u0E2B\u0E19\u0E48\u0E07\u0E19\u0E35\u0E49\u0E08\u0E1A\u0E40\u0E01\u0E21\u0E44\u0E1B\u0E41\u0E25\u0E49\u0E27");
  const path = pathTo(tree, anchorId);
  let common = 0;
  while (common < path.length && common < game.logs.length && path[common].id === game.logs[common].id) {
    common += 1;
  }
  const liveTail = game.logs.slice(common);
  const isLiveAlready = target.phase === "after" && liveTail.length === 0 && common === path.length;
  if (isLiveAlready) {
    return { ok: true, changed: false, game, multiverse, parkedLineId: null };
  }
  const now = options.now ?? (/* @__PURE__ */ new Date()).toISOString();
  const takenIds = new Set(multiverse.lines.map((line) => line.id));
  const newLineId = options.newLineId ?? (() => {
    let id;
    do
      id = crypto.randomUUID().slice(0, 8);
    while (takenIds.has(id));
    return id;
  });
  let lines = multiverse.lines.slice();
  let parkedLineId = null;
  if (liveTail.length > 0) {
    parkedLineId = newLineId();
    takenIds.add(parkedLineId);
    lines.push({
      id: parkedLineId,
      from: common > 0 ? game.logs[common - 1].id : null,
      logs: liveTail,
      after: liveTail.map(
        (_, offset) => committedPosition(game.history, game.logs, common + offset)
      ),
      tip: positionOf(game),
      parkedAt: now
    });
  }
  const restored = [];
  let cursor = common;
  while (cursor < path.length) {
    const node = tree.nodes.get(path[cursor].id);
    const line = node?.lineId ? lines.find((candidate) => candidate.id === node.lineId) : void 0;
    if (!node || !line || line.logs[0]?.id !== node.id) {
      return fail("\u0E40\u0E2A\u0E49\u0E19\u0E17\u0E32\u0E07\u0E17\u0E35\u0E48\u0E40\u0E01\u0E47\u0E1A\u0E44\u0E27\u0E49\u0E44\u0E21\u0E48\u0E15\u0E48\u0E2D\u0E40\u0E19\u0E37\u0E48\u0E2D\u0E07 \u0E25\u0E2D\u0E07\u0E42\u0E2B\u0E25\u0E14\u0E43\u0E2B\u0E21\u0E48");
    }
    let taken = 0;
    while (cursor + taken < path.length && taken < line.logs.length && line.logs[taken].id === path[cursor + taken].id) {
      restored.push({ log: line.logs[taken], after: line.after[taken] ?? null });
      taken += 1;
    }
    lines = lines.filter((candidate) => candidate.id !== line.id);
    if (taken < line.logs.length) {
      lines.push({
        ...line,
        from: line.logs[taken - 1].id,
        logs: line.logs.slice(taken),
        after: line.after.slice(taken)
      });
    }
    cursor += taken;
  }
  const logs = [...game.logs.slice(0, common), ...restored.map((entry) => entry.log)];
  const parkedTurns = lines.reduce((total, line) => total + line.logs.length, 0);
  if (lines.length > MULTIVERSE_LIMITS.lines || parkedTurns > MULTIVERSE_LIMITS.parkedTurns) {
    return fail(
      `\u0E40\u0E01\u0E47\u0E1A\u0E40\u0E2A\u0E49\u0E19\u0E17\u0E32\u0E07\u0E44\u0E27\u0E49\u0E40\u0E15\u0E47\u0E21\u0E41\u0E25\u0E49\u0E27 (${MULTIVERSE_LIMITS.lines} \u0E40\u0E2A\u0E49\u0E19) \u2014 \u0E25\u0E1A\u0E40\u0E2A\u0E49\u0E19\u0E17\u0E35\u0E48\u0E44\u0E21\u0E48\u0E43\u0E0A\u0E49\u0E41\u0E25\u0E49\u0E27\u0E43\u0E19\u0E41\u0E1C\u0E19\u0E17\u0E35\u0E48\u0E01\u0E48\u0E2D\u0E19`
    );
  }
  const version = multiverse.version + 1;
  const pendingBySide = position.pendingExchangeReturnBySide;
  const live = {
    ...game,
    board: position.board,
    rackA: position.rackA,
    rackB: position.rackB,
    tilebag: position.tilebag,
    pendingExchangeReturnBySide: pendingBySide,
    pendingExchangeReturn: aggregatePendingExchangeReturns(pendingBySide),
    timers: { ...game.timers, A: position.timers.A, B: position.timers.B },
    scores: position.scores,
    turnNumber: position.turnNumber,
    activeSide: position.activeSide,
    phase: position.phase,
    status: "playing",
    faceDownCount: position.faceDownCount,
    logs,
    // The clock restarts from here. Restoring the anchor too would charge the time spent away
    // from this position a second time.
    currentTurnStartedAt: now,
    lastSavedAt: now,
    timelineRef: { version, lines: lines.length }
  };
  if (!isPhysicalSet(positionOf(live))) {
    return fail("\u0E15\u0E33\u0E41\u0E2B\u0E19\u0E48\u0E07\u0E19\u0E35\u0E49\u0E40\u0E1A\u0E35\u0E49\u0E22\u0E44\u0E21\u0E48\u0E04\u0E23\u0E1A 100 \u0E15\u0E31\u0E27 \u0E40\u0E25\u0E48\u0E19\u0E15\u0E48\u0E2D\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49");
  }
  const identity = { ...live };
  const history = game.history.filter(
    (snapshot) => snapshot.logs.length <= common && snapshot.logs.every((log, index) => log.id === logs[index]?.id)
  );
  restored.forEach((entry, offset) => {
    if (!entry.after) return;
    history.push(
      makeSnapshot({
        ...identity,
        ...snapshotFields(entry.after, game.timers),
        logs: logs.slice(0, common + offset + 1)
      })
    );
  });
  history.push(makeSnapshot(identity));
  return {
    ok: true,
    changed: true,
    game: { ...live, history, historyIndex: history.length - 1 },
    multiverse: { version, lines },
    parkedLineId
  };
}
function snapshotFields(position, timers) {
  const pendingBySide = position.pendingExchangeReturnBySide;
  return {
    timers: { ...timers, A: position.timers.A, B: position.timers.B },
    board: position.board,
    rackA: position.rackA,
    rackB: position.rackB,
    tilebag: position.tilebag,
    pendingExchangeReturnBySide: pendingBySide,
    pendingExchangeReturn: aggregatePendingExchangeReturns(pendingBySide),
    scores: position.scores,
    turnNumber: position.turnNumber,
    activeSide: position.activeSide,
    phase: position.phase,
    status: position.status,
    faceDownCount: position.faceDownCount
  };
}
function fail(reason) {
  return { ok: false, reason };
}
function pruneLine(multiverse, lineId) {
  const doomed = /* @__PURE__ */ new Set([lineId]);
  let grew = true;
  while (grew) {
    grew = false;
    const doomedTurns = new Set(
      multiverse.lines.filter((line) => doomed.has(line.id)).flatMap((line) => line.logs.map((log) => log.id))
    );
    for (const line of multiverse.lines) {
      if (!doomed.has(line.id) && line.from !== null && doomedTurns.has(line.from)) {
        doomed.add(line.id);
        grew = true;
      }
    }
  }
  return {
    version: multiverse.version + 1,
    lines: multiverse.lines.filter((line) => !doomed.has(line.id))
  };
}
function equivalentParkedChild(tree, parentId, log) {
  for (const childId of childrenOf(tree, parentId)) {
    const child = tree.nodes.get(childId);
    if (child && child.lineId !== null && sameMove(child.log, log)) return child.id;
  }
  return null;
}
function sameMove(a, b) {
  if (a.action !== b.action || a.side !== b.side) return false;
  switch (a.action) {
    case "pass":
      return true;
    case "exchange":
      return moveKey(a.actionDetail.outgoingTiles.map((t) => t.token)) === moveKey(b.actionDetail.outgoingTiles.map((t) => t.token));
    case "place_equation":
      return placementKey(a) === placementKey(b);
    default:
      return false;
  }
}
function placementKey(log) {
  return moveKey(
    log.actionDetail.placedTiles.map(
      (tile) => `${tile.row}:${tile.col}:${tile.token}:${tile.assignedToken ?? ""}`
    )
  );
}
function moveKey(parts) {
  return [...parts].sort().join("|");
}

// src/liveGame/controls.ts
var waitingKinds = /* @__PURE__ */ new Set(["configure", "ready", "launch", "start"]);
var pauseKinds = /* @__PURE__ */ new Set([
  "request-pause",
  "respond-pause",
  "acknowledge-pause",
  "resume-direct"
]);
function canControlLive(facts2, game, caps, actor, kind) {
  if (game.status === "finished" || facts2.authorityProtocol !== "server-v1") return false;
  if (waitingKinds.has(kind))
    return game.roomStage === "waiting" && (kind === "ready" ? Boolean(caps.side) : caps.configure);
  if (game.roomStage === "waiting") return false;
  if (kind === "rename") return actor === facts2.ownerId;
  if (kind === "save-exit") return caps.administer && !game.emailPlayMode;
  if (pauseKinds.has(kind))
    return game.emailPlayMode === "direct" && !game.botSide && Boolean(caps.side);
  return ["undo", "redo", "annotate", "continue", "prune"].includes(kind) && caps.editHistory;
}
function requiredReadySides(facts2, game) {
  return ["A", "B"].filter(
    (side) => !(game.gameMode === "solo" && side === "B") && side !== game.botSide && Boolean(facts2.seats[side]) && facts2.seats[side] !== facts2.ownerId
  );
}
function launchReady(facts2, game) {
  const filled = facts2.mode === "local_versus" || game.gameMode === "solo" || game.botSide || facts2.seats.A && facts2.seats.B;
  return Boolean(
    filled && requiredReadySides(facts2, game).every((side) => game.lobbyReadyBySide?.[side])
  );
}
function validName(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 160;
}
function applyLiveControl(game, timeline, facts2, caps, action, now) {
  if (action.kind === "configure") {
    const settings = action.settings;
    if (!settings || Object.keys(settings).some(
      (key) => ![
        "name",
        "playerA",
        "playerB",
        "playerAUserId",
        "playerBUserId",
        "startingSide",
        "timerMinutes"
      ].includes(key)
    ) || !validName(settings.name) || !validName(settings.playerA) || !(game.gameMode === "solo" ? typeof settings.playerB === "string" && settings.playerB.length <= 160 : validName(settings.playerB)) || !["A", "B"].includes(settings.startingSide ?? "") || !settings.timerMinutes || ["A", "B"].some((side) => {
      const minutes = settings.timerMinutes[side];
      return minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440);
    }))
      throw new Error("Invalid waiting settings");
    if (game.botSide || facts2.mode === "local_versus") {
      if ((settings.playerAUserId ?? null) !== (facts2.seats.A ?? null) || (settings.playerBUserId ?? null) !== (facts2.seats.B ?? null))
        throw new Error("Fixed seats");
    }
    const next = updateWaitingGame(game, {
      ...settingsFromWaitingGame(game),
      name: settings.name,
      playerA: settings.playerA,
      playerB: settings.playerB,
      playerAUserId: settings.playerAUserId,
      playerBUserId: settings.playerBUserId,
      startingSide: settings.startingSide,
      timerMinutes: { A: settings.timerMinutes.A, B: settings.timerMinutes.B },
      playerAEmail: null,
      playerBEmail: null
    });
    return {
      game: {
        ...next,
        emailPlayMode: game.emailPlayMode,
        currentTurnStartedAt: now,
        lastSavedAt: now
      }
    };
  }
  if (action.kind === "ready") {
    if (typeof action.ready !== "boolean" || !caps.side) throw new Error("Invalid Ready");
    return {
      game: {
        ...game,
        lobbyReadyBySide: { ...game.lobbyReadyBySide, [caps.side]: action.ready },
        lobbyLaunchAt: action.ready ? game.lobbyLaunchAt : void 0,
        lastSavedAt: now
      }
    };
  }
  if (action.kind === "launch" || action.kind === "start") {
    if (!launchReady(facts2, game)) throw new Error("Players are not ready");
    if (action.kind === "launch")
      return {
        game: {
          ...game,
          lobbyLaunchAt: game.lobbyLaunchAt ?? new Date(Date.parse(now) + 3e3).toISOString(),
          lastSavedAt: now
        }
      };
    if (!game.lobbyLaunchAt || Date.parse(now) < Date.parse(game.lobbyLaunchAt))
      throw new Error("Countdown pending");
    return { game: { ...startWaitingGame(game), currentTurnStartedAt: now, lastSavedAt: now } };
  }
  if (action.kind === "rename") {
    if (!validName(action.name)) throw new Error("Invalid name");
    return { game: { ...game, name: action.name.trim(), lastSavedAt: now } };
  }
  if (["request-pause", "respond-pause", "acknowledge-pause", "resume-direct"].includes(action.kind)) {
    const side = caps.side;
    const control = { ...game.matchControl };
    let next = settleNormalClock(game, now);
    if (action.kind === "request-pause") {
      if (game.status !== "playing" || control.stopRequest || Date.parse(control.stopBlockedUntilBySide?.[side] ?? "") > Date.parse(now))
        throw new Error("Pause request unavailable");
      control.stopRequest = { id: crypto.randomUUID(), requestedBy: side, requestedAt: now };
      control.stopResponse = void 0;
    } else if (action.kind === "respond-pause") {
      const request = control.stopRequest;
      if (!request || request.id !== action.requestId || request.requestedBy === side || typeof action.accept !== "boolean" || game.status !== "playing")
        throw new Error("Invalid pause response");
      control.stopResponse = {
        id: crypto.randomUUID(),
        requestId: request.id,
        requestedBy: request.requestedBy,
        respondedBy: side,
        accepted: action.accept,
        respondedAt: now,
        ...action.blockFiveMinutes && !action.accept ? { blockedForMs: 3e5 } : {}
      };
      control.stopRequest = void 0;
      if (action.accept) {
        control.stoppedBy = side;
        next = { ...next, status: "draft", timers: { ...next.timers, paused: true } };
      } else if (action.blockFiveMinutes)
        control.stopBlockedUntilBySide = {
          ...control.stopBlockedUntilBySide,
          [request.requestedBy]: new Date(Date.parse(now) + 3e5).toISOString()
        };
    } else if (action.kind === "acknowledge-pause") {
      if (!control.stopResponse || control.stopResponse.id !== action.responseId || control.stopResponse.requestedBy !== side)
        throw new Error("Invalid acknowledgement");
      control.stopResponse = void 0;
    } else {
      if (game.status !== "draft") throw new Error("Game is not paused");
      control.stoppedBy = void 0;
      next = { ...next, status: "playing", timers: { ...next.timers, paused: false } };
    }
    return {
      game: { ...next, matchControl: control, currentTurnStartedAt: now, lastSavedAt: now }
    };
  }
  if (action.kind === "save-exit") {
    const next = settleNormalClock(game, now);
    return {
      game: {
        ...next,
        status: "draft",
        timers: { ...next.timers, paused: true },
        currentTurnStartedAt: now,
        lastSavedAt: now
      }
    };
  }
  if (action.kind === "undo" || action.kind === "redo") {
    const index = game.historyIndex + (action.kind === "undo" ? -1 : 1);
    if (index < 0 || index >= game.history.length || game.history[index].status === "finished" || game.history[index].roomStage === "waiting")
      throw new Error("History boundary");
    const restored = restoreSnapshot(game, index), settled = settleNormalClock(game, now);
    return {
      game: {
        ...game,
        board: restored.board,
        rackA: restored.rackA,
        rackB: restored.rackB,
        tilebag: restored.tilebag,
        pendingExchangeReturn: restored.pendingExchangeReturn,
        pendingExchangeReturnBySide: restored.pendingExchangeReturnBySide,
        faceDownCount: restored.faceDownCount,
        scores: restored.scores,
        turnNumber: restored.turnNumber,
        activeSide: restored.activeSide,
        phase: restored.phase,
        logs: restored.logs,
        historyIndex: index,
        timers: settled.timers,
        currentTurnStartedAt: now,
        lastSavedAt: now
      }
    };
  }
  if (action.kind === "annotate") {
    if (typeof action.logId !== "string" || typeof action.note !== "string" || action.note.length > 4e3 || !Number.isInteger(action.stars) || action.stars < 0 || action.stars > 5 || ![...game.logs, ...timeline.lines.flatMap((line) => line.logs)].some(
      (log) => log.id === action.logId
    ))
      throw new Error("Invalid annotation");
    const apply = (log) => log.id === action.logId ? { ...log, note: action.note, stars: action.stars } : log;
    const changed = timeline.lines.some((line) => line.logs.some((log) => log.id === action.logId));
    const branches = changed ? {
      version: timeline.version + 1,
      lines: timeline.lines.map((line) => ({ ...line, logs: line.logs.map(apply) }))
    } : void 0;
    return {
      game: {
        ...game,
        logs: game.logs.map(apply),
        history: game.history.map((snapshot) => ({ ...snapshot, logs: snapshot.logs.map(apply) })),
        ...branches ? { timelineRef: { version: branches.version, lines: branches.lines.length } } : {},
        lastSavedAt: now
      },
      timeline: branches
    };
  }
  if (action.kind === "continue") {
    if (!action.target || !["before", "after"].includes(action.target.phase) || action.target.nodeId !== null && typeof action.target.nodeId !== "string")
      throw new Error("Invalid history reference");
    const result = continueFrom(game, timeline, action.target, { now });
    if (!result.ok) throw new Error("Position unavailable");
    return { game: result.game, ...result.changed ? { timeline: result.multiverse } : {} };
  }
  if (action.kind === "prune") {
    if (!timeline.lines.some((line) => line.id === action.lineId))
      throw new Error("Unknown parked line");
    const branches = pruneLine(timeline, action.lineId);
    return {
      game: {
        ...game,
        timelineRef: { version: branches.version, lines: branches.lines.length },
        lastSavedAt: now
      },
      timeline: branches
    };
  }
  throw new Error("Invalid control");
}
function ensureHistory(game) {
  return game.history.length ? game : { ...game, history: [makeSnapshot(game)], historyIndex: 0 };
}

// src/bot/superRequest.ts
function seedFor(roomId, revision) {
  const text = `${roomId}:${revision}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2147483647 || 1;
}

// src/bot/archbot/request.ts
var ARCHBOT_TOP_N = 24;
function noScoreStreakOf(game) {
  let streak = 0;
  for (let index = game.logs.length - 1; index >= 0; index -= 1) {
    const action = game.logs[index].action;
    if (action === "end_game") continue;
    if (action === "pass" || action === "exchange") {
      streak += 1;
      continue;
    }
    break;
  }
  return streak;
}
function buildArchBotRequest(game, roomId, revision) {
  const seat = game.botSide;
  if (!seat) throw new Error("ArchBot needs a bot seat");
  if (game.activeSide !== seat) throw new Error("It is not ArchBot's turn");
  const opponent = otherSide(seat);
  const pending = game.pendingExchangeReturnBySide;
  const inventory = inventoryFrom({
    tilebag: game.tilebag,
    rackA: game.rackA,
    rackB: game.rackB,
    board: game.board,
    pendingReturnA: pending?.A ?? [],
    pendingReturnB: pending?.B ?? []
  });
  const board = [];
  const rack = [];
  let bag = 0;
  let pendingReturn = 0;
  let opponentRack = 0;
  inventory.forEach((placement, ordinal) => {
    const kind = tokenOfOrdinal(ordinal);
    switch (placement.at) {
      case "board":
        board.push({
          r: placement.row,
          c: placement.col,
          kind,
          token: placement.assigned ?? kind,
          by: placement.by === seat ? "A" : "B",
          placedTurn: placement.placedTurn
        });
        break;
      case "rack":
        if (placement.side === seat) rack.push({ seq: placement.seq, kind });
        else opponentRack += 1;
        break;
      case "bag":
        bag += 1;
        break;
      case "pendingReturn":
        pendingReturn += 1;
        break;
    }
  });
  board.sort((first, second) => first.r - second.r || first.c - second.c);
  rack.sort((first, second) => first.seq - second.seq);
  if (opponentRack !== getRack(game, opponent).length) {
    throw new Error("ArchBot's view of the opponent's rack size is inconsistent");
  }
  return {
    board,
    rack: rack.map((entry) => entry.kind),
    bagCount: bag + pendingReturn,
    oppRackCount: opponentRack,
    myScore: game.scores[seat],
    oppScore: game.scores[opponent],
    noScoreStreak: noScoreStreakOf(game),
    exchangeAllowed: getExchangeRule(game).allowed,
    seed: seedFor(roomId, revision),
    topN: ARCHBOT_TOP_N,
    turnNumber: game.turnNumber
  };
}

// src/liveGame/projection.ts
function projectLiveGame(id, revision, game, viewerSide, mode, canAdminister = false, continuationBlocked = false, capabilities, timeline, facts2) {
  const viewer = viewerSide ? `seat:${viewerSide}` : "spectator";
  const view = rankedPublicView(
    id,
    revision,
    {
      ...game,
      playerUserIds: {
        A: "seat:A",
        ...game.playerUserIds?.B || game.botSide || mode === "local_versus" ? { B: "seat:B" } : {}
      }
    },
    viewer
  );
  const tree = buildTree(game.logs, timeline ?? { version: 0, lines: [] });
  const projectLog = (log, opponentCount) => {
    const preceding = pathTo(tree, tree.nodes.get(log.id)?.parentId ?? null);
    let noScoreStreak = 0;
    for (const prior of [...preceding].reverse()) {
      if (prior.finalScore > 0) break;
      noScoreStreak++;
    }
    return {
      ...liveLog(log, viewerSide),
      ...viewerSide === log.side ? {
        analysisContext: {
          bagCount: log.tilebagBefore.length,
          oppRackCount: opponentCount,
          scores: calculateGameTotals(game, preceding),
          noScoreStreak
        }
      } : {}
    };
  };
  return {
    ...view,
    status: game.roomStage === "waiting" ? mode === "local_versus" || game.gameMode === "solo" || game.botSide || game.playerUserIds?.A && game.playerUserIds?.B ? "matched" : "waiting" : view.status,
    name: mode === "stage" ? "Stage attempt" : game.name,
    mode,
    botSide: game.botSide,
    botTurn: game.status === "playing" && !game.timers.paused && game.activeSide === game.botSide,
    ...facts2?.purpose === "normal" && mode === "stage5b_standard" && game.botEngine === "stage5b" && game.botDifficulty === "stage5b64" && facts2.ownerId === facts2.seats[viewerSide ?? "A"] && viewerSide && game.status === "playing" && !game.timers.paused && game.activeSide === game.botSide ? { practiceBot: { side: game.botSide, request: buildArchBotRequest(game, id, revision) } } : {},
    paused: game.status === "draft" || game.timers.paused,
    canAdminister,
    continuationBlocked,
    phase: game.phase,
    tileDrawMode: game.tileDrawMode ?? "play",
    localHandoff: capabilities?.localHandoff ?? false,
    canHandoff: capabilities?.localController ?? false,
    localConfirmed: capabilities?.localConfirmed ?? false,
    canConfigure: capabilities?.configure ?? false,
    canLaunch: Boolean(capabilities?.configure && facts2 && launchReady(facts2, game)),
    canRename: Boolean(
      capabilities?.configure || capabilities?.editHistory || canAdminister || facts2 && facts2.ownerId === facts2.seats[viewerSide ?? "A"] && viewerSide
    ),
    canEditHistory: capabilities?.editHistory ?? false,
    canUndo: Boolean(
      capabilities?.editHistory && game.historyIndex > 0 && game.history[game.historyIndex - 1]?.roomStage !== "waiting"
    ),
    canRedo: Boolean(capabilities?.editHistory && game.historyIndex < game.history.length - 1),
    canSaveExit: Boolean(capabilities?.administer && !game.emailPlayMode),
    directPause: Boolean(
      game.emailPlayMode === "direct" && !game.botSide && viewerSide && !continuationBlocked
    ),
    matchControl: game.matchControl ? {
      stopRequest: game.matchControl.stopRequest,
      stopResponse: game.matchControl.stopResponse,
      stopBlockedUntilBySide: game.matchControl.stopBlockedUntilBySide,
      stoppedBy: game.matchControl.stoppedBy,
      surrenderedSide: game.matchControl.surrenderedSide
    } : void 0,
    launchAt: game.lobbyLaunchAt,
    ...capabilities?.configure ? {
      waitingSettings: {
        name: game.name,
        playerA: game.players.A,
        playerB: game.players.B,
        playerAUserId: game.playerUserIds?.A,
        playerBUserId: game.playerUserIds?.B,
        startingSide: game.startingSide ?? "A",
        timerMinutes: {
          A: game.timers.untimed || game.timers.sideUntimed?.A ? null : (game.timers.initialSecondsBySide?.A ?? game.timers.initialSeconds) / 60,
          B: game.timers.untimed || game.timers.sideUntimed?.B ? null : (game.timers.initialSecondsBySide?.B ?? game.timers.initialSeconds) / 60
        }
      }
    } : {},
    ...capabilities?.editHistory && timeline ? {
      timeline: {
        version: timeline.version,
        lines: timeline.lines.map((line) => ({
          id: line.id,
          from: line.from,
          logs: line.logs.map(
            (log, index) => projectLog(
              log,
              line.after[index]?.[viewerSide === "A" ? "rackB" : "rackA"].length ?? 8
            )
          )
        }))
      }
    } : {},
    ...capabilities?.physicalHost && game.roomStage !== "waiting" ? { hostRacks: { A: ownTiles(game.rackA), B: ownTiles(game.rackB) } } : {},
    clockPolicy: {
      minSeconds: game.timers.minSeconds,
      untimed: {
        A: Boolean(game.timers.untimed || game.timers.sideUntimed?.A),
        B: Boolean(game.timers.untimed || game.timers.sideUntimed?.B)
      }
    },
    playerAId: game.playerUserIds?.A ?? "",
    playerBId: game.playerUserIds?.B ?? null,
    board: visibleBoard(game.board),
    yourRack: viewerSide && game.roomStage !== "waiting" ? ownTiles(viewerSide === "A" ? game.rackA : game.rackB) : [],
    logs: game.logs.map(
      (log, index) => projectLog(
        log,
        game.history.find((snapshot) => snapshot.logs.length === index + 1)?.[viewerSide === "A" ? "rackB" : "rackA"].length ?? 8
      )
    )
  };
}
function liveLog(log, viewerSide) {
  return {
    id: log.id,
    turnNumber: log.turnNumber,
    side: log.side,
    action: log.action,
    score: log.finalScore,
    exchangedCount: log.action === "exchange" ? log.actionDetail.outgoingTiles?.length ?? 0 : 0,
    boardAfter: visibleBoard(log.boardAfter),
    boardBefore: visibleBoard(log.boardBefore),
    note: log.note,
    stars: log.stars,
    ...viewerSide === log.side ? { rackBefore: ownTiles(log.rackBefore), rackAfter: ownTiles(log.rackAfter) } : {}
  };
}

// src/liveGame/hostedAdmin.ts
function applyHostedAction(game, action, now) {
  if (game.emailPlayMode !== "hosted" && game.gameMode !== "solo" && game.emailPlayMode !== void 0 || game.botSide || game.roomStage !== "playing" || game.status === "finished")
    throw new Error("Hosted administration unavailable");
  let next = settleNormalClock(game, now);
  if (action.kind === "pause") {
    next = { ...next, status: "draft", timers: { ...next.timers, paused: true } };
  } else if (action.kind === "resume") {
    if (game.status !== "draft") throw new Error("Game is not paused");
    next = { ...next, status: "playing", timers: { ...next.timers, paused: false } };
  } else if (action.kind === "finish") {
    next = { ...next, status: "finished", timers: { ...next.timers, paused: true } };
  } else if (action.kind === "correct-score") {
    if (game.status !== "draft" || !Number.isInteger(action.score) || Math.abs(action.score) > 1e4 || !game.logs.some((log) => log.id === action.logId && log.action !== "end_game"))
      throw new Error("Invalid score correction");
    const logs = updateLogScore(game.logs, action.logId, action.score);
    next = { ...next, logs, scores: calculateGameTotals(game, logs) };
  } else throw new Error("Invalid administration action");
  return { ...next, currentTurnStartedAt: now, lastSavedAt: now };
}

// src/liveGame/capabilities.ts
function resolveLiveCapabilities(facts2, game, actorId, handoffToken, trustedBot = false) {
  const secure = facts2.authorityProtocol === "server-v1";
  const owner = facts2.ownerId === actorId && !trustedBot;
  const normal = facts2.purpose !== "stage" && !game.botSide;
  const localHandoff = facts2.mode === "local_versus" && normal && secure;
  const localController = localHandoff && owner;
  const localConfirmed = Boolean(
    localController && facts2.localClaim && facts2.localClaim.token === handoffToken && facts2.localClaim.revision === facts2.revision && facts2.localClaim.side === game.activeSide
  );
  const physicalHost = Boolean(
    secure && owner && normal && game.emailPlayMode === "hosted" && game.tileDrawMode === "manual"
  );
  const archBotPractice = facts2.purpose === "normal" && facts2.mode === "stage5b_standard" && game.botEngine === "stage5b";
  const bagless = game.tilebag.length === 0 && game.history.every((snapshot) => snapshot.tilebag.length === 0);
  const replaySafe = game.botSide ? archBotPractice || bagless : game.emailPlayMode === void 0 || game.emailPlayMode === "hosted" && game.tileDrawMode === "manual";
  const side = trustedBot ? facts2.ownerId === actorId ? game.botSide ?? null : null : localHandoff ? localController && game.roomStage === "waiting" ? "A" : localConfirmed ? game.activeSide : null : facts2.seats.A === actorId ? "A" : facts2.seats.B === actorId ? "B" : null;
  return {
    side,
    physicalHost,
    localController,
    localHandoff,
    localConfirmed,
    administer: Boolean(
      secure && owner && normal && (game.emailPlayMode === "hosted" || game.gameMode === "solo" || localController)
    ),
    configure: Boolean(secure && owner && game.roomStage === "waiting"),
    editHistory: Boolean(secure && owner && replaySafe)
  };
}

// src/liveGame/physical.ts
function applyPhysicalAction(game, action) {
  if (game.tileDrawMode !== "manual" || game.roomStage !== "playing" || game.status === "finished")
    throw new Error("Physical administration unavailable");
  if (action.side !== "A" && action.side !== "B") throw new Error("Invalid side");
  if (game.gameMode === "solo" && action.side !== "A") throw new Error("Invalid Solo side");
  const original = getRack(game, action.side);
  let rack = [...original], bag = [...game.tilebag];
  if (action.kind === "return-tile") {
    if (game.status !== "draft" && (game.phase !== "refill" || game.activeSide !== action.side))
      throw new Error("Pause before correcting a recorded rack");
    const tile = rack.find((t) => t.id === action.tileId);
    if (!tile) throw new Error("Invalid physical tile");
    rack = rack.filter((t) => t.id !== tile.id);
    bag.push({ id: tile.id, token: tile.token });
  } else {
    if (!Array.isArray(action.tokens) || action.tokens.length > 8 || !action.tokens.every((t) => typeof t === "string"))
      throw new Error("Invalid physical intake");
    if (action.kind === "correct-rack") {
      if (game.status !== "draft") throw new Error("Pause before correcting a recorded rack");
      bag.push(...rack.map(({ id, token }) => ({ id, token })));
      rack = [];
    }
    if (rack.length + action.tokens.length > 8) throw new Error("Rack capacity exceeded");
    const drawn = action.tokens.map((token) => {
      const index = bag.findIndex((tile2) => tile2.token === token);
      if (index < 0) throw new Error("Physical intake unavailable");
      const tile = bag.splice(index, 1)[0];
      return { id: tile.id, token: tile.token };
    });
    rack.push(...drawn);
  }
  let next = setRack({ ...game, tilebag: bag }, action.side, rack);
  if (game.activeSide === action.side && game.phase === "refill" && isRackReady(next)) {
    if (activeSideHasActedThisTurn(game)) {
      const last = next.logs.length - 1;
      const pending = game.pendingExchangeReturnBySide?.[action.side] ?? [];
      bag = [...bag, ...pending];
      const pendingBySide = { ...game.pendingExchangeReturnBySide, [action.side]: [] };
      next = {
        ...next,
        tilebag: bag,
        pendingExchangeReturnBySide: pendingBySide,
        pendingExchangeReturn: [...pendingBySide.A ?? [], ...pendingBySide.B ?? []],
        logs: next.logs.map(
          (log, i) => i === last ? {
            ...log,
            rackAfter: rack,
            tilebagAfter: bag,
            ...log.action === "exchange" ? {
              actionDetail: {
                ...log.actionDetail,
                incomingTiles: rack.filter(
                  (t) => !log.rackBefore.some((old) => old.id === t.id)
                )
              }
            } : {}
          } : log
        )
      };
    }
    next = finalizeRefillTransition(next);
  }
  return next;
}

// src/liveGame/botAction.ts
function botActionFor(game, move) {
  if (!game.botSide || game.activeSide !== game.botSide) throw new Error("Not a bot turn");
  const remaining = [...getRack(game, game.botSide)];
  const take = (kind) => {
    const index = remaining.findIndex((tile) => tile.token === kind);
    if (index < 0) throw new Error("Invalid bot proposal");
    return remaining.splice(index, 1)[0];
  };
  if (move.type === "pass") return { kind: "pass" };
  if (move.type === "exchange")
    return { kind: "exchange", tileIds: (move.exchange ?? []).map((kind) => take(kind).id) };
  if (move.type !== "place") throw new Error("Invalid bot proposal");
  return {
    kind: "place",
    placements: (move.placements ?? []).map((placed) => {
      const tile = take(placed.kind);
      return {
        tileId: tile.id,
        row: placed.r,
        col: placed.c,
        ...getAssignmentOptions(tile.token).length ? { assignedToken: placed.token } : {}
      };
    })
  };
}

// supabase/functions/live-game/handler.ts
async function handleLiveGame(request, store, trustedBot = false) {
  const token = request.authorization?.match(/^Bearer (.+)$/i)?.[1];
  const actorId = token ? await store.authenticate(token) : null;
  if (!actorId) return { status: 401, body: { error: "Sign in required." } };
  const body = request.body;
  if (!body || typeof body.id !== "string" || !["read", "action", "admin", "physical", "control", "practice-bot"].includes(
    String(body.operation)
  ))
    return { status: 400, body: { error: "Invalid live request." } };
  const source = await store.read(body.id, actorId);
  if (!source) return { status: 404, body: { error: "Live game unavailable." } };
  const prior = { ...decodeGame(source.state), playerUserIds: source.seats };
  const capabilities = resolveLiveCapabilities(
    source,
    prior,
    actorId,
    body.handoffToken,
    trustedBot
  );
  const side = capabilities.side;
  const host = capabilities.administer;
  const view = () => projectLiveGame(
    source.id,
    source.revision,
    prior,
    side,
    source.mode,
    host,
    source.authorityProtocol !== "server-v1",
    capabilities,
    source.timeline,
    source
  );
  if (body.operation === "read") return { status: 200, body: { match: view() } };
  if (source.authorityProtocol !== "server-v1")
    return {
      status: 409,
      body: { error: "This game cannot accept moves. Please start a new game." }
    };
  const control = body.operation === "control";
  const practiceBot = body.operation === "practice-bot";
  if (practiceBot && !(source.ownerId === actorId && source.purpose === "normal" && source.mode === "stage5b_standard" && prior.botEngine === "stage5b" && prior.botDifficulty === "stage5b64" && prior.botSide))
    return { status: 403, body: { error: "ArchBot practice controller required." } };
  if (body.operation === "admin" && !host)
    return { status: 403, body: { error: "Only the tournament host may administer this game." } };
  if (body.operation === "physical" && !(capabilities.physicalHost || capabilities.localController && prior.tileDrawMode === "manual"))
    return { status: 403, body: { error: "Physical controller required." } };
  if (body.operation === "action" && !side && !capabilities.localController)
    return { status: 403, body: { error: "Only a seated player may act." } };
  if (typeof body.commandId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.commandId))
    return { status: 400, body: { error: "A stable command ID is required." } };
  if (await store.committed(source.id, body.commandId, actorId))
    return { status: 200, body: { match: view() } };
  if (control && !canControlLive(
    source,
    prior,
    capabilities,
    actorId,
    String(body.action?.kind)
  ))
    return { status: 403, body: { error: "This control is unavailable for your role." } };
  if (body.operation === "physical" && !capabilities.physicalHost && !capabilities.localConfirmed)
    return { status: 403, body: { error: "Confirm the active local player first." } };
  if (body.operation === "action" && !side)
    return { status: 403, body: { error: "Confirm the active local player first." } };
  if (body.revision !== source.revision)
    return { status: 409, body: { error: "Game changed. Reload and retry.", match: view() } };
  try {
    const action = practiceBot ? botActionFor(prior, body.action) : body.action;
    const administration = body.operation === "admin";
    const physical = body.operation === "physical";
    const recording = administration && action?.kind === "record";
    if (!action || !control && !(physical ? ["refill", "correct-rack", "return-tile"] : administration ? ["pause", "resume", "finish", "correct-score", "record"] : ["place", "exchange", "pass", "resign"]).includes(action.kind))
      return { status: 400, body: { error: "Invalid live action." } };
    if (recording && !capabilities.physicalHost)
      return { status: 403, body: { error: "Physical host required." } };
    if (recording && (!action.side || !["A", "B"].includes(action.side) || !["place", "exchange", "pass", "resign"].includes(
      action.move?.kind
    )))
      return { status: 400, body: { error: "Invalid recorded action." } };
    if (physical && !capabilities.physicalHost && action.side !== side)
      return { status: 403, body: { error: "Only the active local rack may be recorded." } };
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const controlled = control ? applyLiveControl(
      ensureHistory(prior),
      source.timeline ?? EMPTY_MULTIVERSE,
      source,
      capabilities,
      action,
      now
    ) : null;
    const next = controlled ? controlled.game : physical ? applyPhysicalAction(prior, action) : recording ? applyRankedAction(
      prior,
      action.side,
      action.move,
      now,
      "normal"
    ) : administration ? applyHostedAction(prior, action, now) : applyRankedAction(
      prior,
      practiceBot ? prior.botSide : side,
      action,
      now,
      "normal"
    );
    if (action.kind === "resign")
      next.matchControl = { ...next.matchControl, surrenderedSide: side };
    let game = {
      ...next,
      revision: source.revision + 1
    };
    let timeline = controlled?.timeline;
    if (!control)
      game = pushActionSnapshot({
        ...game,
        history: prior.history.length ? prior.history : [makeSnapshot(prior)],
        historyIndex: prior.history.length ? prior.historyIndex : 0
      });
    if (!control && game.logs.length > prior.logs.length && source.timeline?.lines.length && capabilities.editHistory) {
      const twin = equivalentParkedChild(
        buildTree(prior.logs, source.timeline),
        prior.logs.at(-1)?.id ?? null,
        game.logs.at(-1)
      );
      if (twin) {
        const followed = continueFrom(
          prior,
          source.timeline,
          { nodeId: twin, phase: "after" },
          { now }
        );
        if (followed.ok && followed.changed) {
          game = { ...followed.game, revision: source.revision + 1 };
          timeline = followed.multiverse;
        }
      }
    }
    if (!await store.commit(
      source,
      actorId,
      body.commandId,
      practiceBot ? prior.botSide : control || administration || physical && capabilities.physicalHost ? "host" : side,
      action,
      game,
      timeline
    ))
      return { status: 409, body: { error: "Game changed. Reload and retry." } };
    const nextFacts = {
      ...source,
      revision: game.revision,
      seats: game.playerUserIds ?? source.seats,
      localClaim: void 0
    };
    const nextCapabilities = resolveLiveCapabilities(
      nextFacts,
      game,
      actorId,
      void 0,
      trustedBot
    );
    return {
      status: 200,
      body: {
        match: projectLiveGame(
          source.id,
          game.revision,
          game,
          nextCapabilities.side,
          source.mode,
          nextCapabilities.administer,
          false,
          nextCapabilities,
          timeline ?? source.timeline,
          nextFacts
        )
      }
    };
  } catch {
    return { status: 400, body: { error: "Move refused. Reload and check your move." } };
  }
}

// src/gameplay/multiverseCodec.ts
var MULTIVERSE_FORMAT = 1;
function encodeMultiverse(multiverse) {
  return {
    v: MULTIVERSE_FORMAT,
    version: multiverse.version,
    lines: multiverse.lines.map(encodeLine)
  };
}
function encodeLine(line) {
  const logs = [];
  let previousAfter = null;
  for (const log of line.logs) {
    const full = encodeTurnLog(log);
    const { boardBefore: before, boardAfter, tilebagAfter, ...rest } = full;
    const beforeKey = JSON.stringify(before);
    const entry = { ...rest };
    if (beforeKey !== previousAfter) entry.boardBefore = before;
    const delta = boardDelta(before, boardAfter);
    if (delta.add.length > 0) entry.boardAdd = delta.add;
    if (delta.drop.length > 0) entry.boardDrop = delta.drop;
    if (JSON.stringify(tilebagAfter) !== JSON.stringify(full.tilebagBefore)) {
      entry.tilebagAfter = tilebagAfter;
    }
    logs.push(entry);
    previousAfter = JSON.stringify(boardAfter);
  }
  const after = line.after.map(
    (position, index) => position ? encodePosition(position, line.logs[index].boardAfter) : 0
  );
  const lastBoard = line.logs[line.logs.length - 1].boardAfter;
  const tip = encodePosition(line.tip, lastBoard);
  const lastAfter = after[after.length - 1];
  return {
    id: line.id,
    from: line.from,
    at: line.parkedAt,
    logs,
    after,
    tip: lastAfter && JSON.stringify(lastAfter) === JSON.stringify(tip) ? "last" : tip
  };
}
function boardDelta(before, after) {
  const beforeByCell = new Map(before.map((cell) => [cell[0], JSON.stringify(cell)]));
  const afterCells = new Set(after.map((cell) => cell[0]));
  return {
    add: after.filter((cell) => beforeByCell.get(cell[0]) !== JSON.stringify(cell)),
    drop: before.map((cell) => cell[0]).filter((index) => !afterCells.has(index))
  };
}
function encodePosition(position, turnBoard) {
  const encoded = {
    t: position.turnNumber,
    s: position.activeSide,
    p: position.phase,
    st: position.status,
    a: encodeTileCodes(position.rackA),
    b: encodeTileCodes(position.rackB),
    bag: encodeTileCodes(position.tilebag),
    tm: [position.timers.A, position.timers.B],
    sc: [position.scores.A, position.scores.B]
  };
  const pending = position.pendingExchangeReturnBySide;
  if (pending.A.length > 0 || pending.B.length > 0) {
    encoded.pr = {};
    if (pending.A.length > 0) encoded.pr.A = encodeTileCodes(pending.A);
    if (pending.B.length > 0) encoded.pr.B = encodeTileCodes(pending.B);
  }
  if (position.faceDownCount) encoded.fd = position.faceDownCount;
  const board = encodeBoardCells(position.board);
  if (JSON.stringify(board) !== JSON.stringify(encodeBoardCells(turnBoard))) encoded.bd = board;
  return encoded;
}
function decodeMultiverse(raw) {
  if (!raw || typeof raw !== "object") throw new Error("The parked lines are not a document.");
  const doc = raw;
  if (doc.v !== MULTIVERSE_FORMAT) {
    throw new Error(`The parked lines use format ${String(doc.v)}, which this app cannot read.`);
  }
  if (!Array.isArray(doc.lines)) throw new Error("The parked lines have no line list.");
  return {
    version: Number.isFinite(doc.version) ? Number(doc.version) : 0,
    lines: doc.lines.map(decodeLine)
  };
}
function decodeLine(line) {
  if (!Array.isArray(line.logs) || line.logs.length === 0) {
    throw new Error(`Parked line ${line.id} has no turns.`);
  }
  const logs = [];
  let previousAfter = null;
  for (const entry of line.logs) {
    const { boardAdd, boardDrop, ...rest } = entry;
    const before = entry.boardBefore ?? previousAfter;
    if (!before) throw new Error(`Parked line ${line.id} starts without a board.`);
    const dropped = new Set(boardDrop ?? []);
    const added = new Map((boardAdd ?? []).map((cell) => [cell[0], cell]));
    const after2 = [
      ...before.filter((cell) => !dropped.has(cell[0]) && !added.has(cell[0])),
      ...added.values()
    ].sort((left, right) => left[0] - right[0]);
    logs.push(
      decodeTurnLog({
        ...rest,
        boardBefore: before,
        boardAfter: after2,
        tilebagAfter: entry.tilebagAfter ?? entry.tilebagBefore
      })
    );
    previousAfter = after2;
  }
  const after = line.logs.map((_, index) => {
    const position = line.after?.[index];
    return position ? decodePosition(position, logs[index].boardAfter) : null;
  });
  const last = after[after.length - 1];
  let tip;
  if (line.tip === "last") {
    if (!last) throw new Error(`Parked line ${line.id} points its tip at a missing position.`);
    tip = last;
  } else {
    tip = decodePosition(line.tip, logs[logs.length - 1].boardAfter);
  }
  return { id: String(line.id), from: line.from ?? null, logs, after, tip, parkedAt: line.at };
}
function decodePosition(position, turnBoard) {
  return {
    board: position.bd ? decodeBoardCells(position.bd) : turnBoard,
    rackA: decodeTileCodes(position.a),
    rackB: decodeTileCodes(position.b),
    tilebag: decodeTileCodes(position.bag),
    pendingExchangeReturnBySide: {
      A: position.pr?.A ? decodeTileCodes(position.pr.A) : [],
      B: position.pr?.B ? decodeTileCodes(position.pr.B) : []
    },
    timers: { A: position.tm[0], B: position.tm[1] },
    scores: { A: position.sc[0], B: position.sc[1] },
    turnNumber: position.t,
    activeSide: position.s,
    phase: position.p,
    status: position.st,
    ...position.fd ? { faceDownCount: position.fd } : {}
  };
}

// src/completedGame/historicRules.ts
var COMPLETED_RULES_VERSION = "eq-lab-840ef0e";
function historicRulesFor(version, activeRulesVersion = COMPLETED_RULES_VERSION) {
  switch (version) {
    case COMPLETED_RULES_VERSION:
      return {
        version,
        observedScore: (log) => log.finalScore,
        mayUseActiveValidator: activeRulesVersion === version
      };
    default:
      throw new Error(`Unknown rules version ${String(version)}.`);
  }
}

// src/completedGame/record.ts
var COMPLETED_GAME_FORMAT = 1;
var META_KEYS = [
  "gameId",
  "name",
  "gameMode",
  "players",
  "playerMembers",
  "playerUserIds",
  "playerEmails",
  "emailPlayMode",
  "emailPlayersCanSeeOpponentRack",
  "matchControl",
  "roomStage",
  "startingSide",
  "botSide",
  "botEngine",
  "botDifficulty",
  "superEngineVersion",
  "superWeightsVersion",
  "tileDrawMode",
  "faceDownCount",
  "turnNumber",
  "activeSide",
  "phase",
  "status",
  "boardSize",
  "timers",
  "scores",
  "currentTurnStartedAt",
  "createdAt"
];
function rejectUnknownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`Unknown ${label} field ${key}.`);
  }
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== void 0).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
var canonicalCompletedJSON = stable;
async function sha256(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stable(value)));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
function same(a, b) {
  return stable(a) === stable(b);
}
function metaOf(snapshot) {
  const meta = {};
  for (const key of META_KEYS) {
    if (snapshot[key] !== void 0) meta[key] = snapshot[key];
  }
  const matchControl = snapshot.matchControl;
  if (matchControl) {
    const outcome = {
      ...matchControl.stoppedBy ? { stoppedBy: matchControl.stoppedBy } : {},
      ...matchControl.surrenderedSide ? { surrenderedSide: matchControl.surrenderedSide } : {}
    };
    if (Object.keys(outcome).length) meta.matchControl = outcome;
    else delete meta.matchControl;
  }
  return meta;
}
function physicalOf(snapshot) {
  const pending = getPendingExchangeReturnBySide(snapshot);
  return {
    board: encodeBoardCells(snapshot.board),
    rackA: encodeTileCodes(snapshot.rackA),
    rackB: encodeTileCodes(snapshot.rackB),
    bag: encodeTileCodes(snapshot.tilebag),
    pendingA: encodeTileCodes(pending.A),
    pendingB: encodeTileCodes(pending.B)
  };
}
function frameOf(snapshot) {
  return { meta: metaOf(snapshot), physical: physicalOf(snapshot) };
}
function diffMeta(before, after) {
  return META_KEYS.filter((key) => !same(before[key], after[key])).map((key) => [
    key,
    after[key] ?? null
  ]);
}
function splice(before, after) {
  if (same(before, after)) return void 0;
  let start = 0;
  while (start < before.length && start < after.length && same(before[start], after[start]))
    start++;
  let suffix = 0;
  while (suffix < before.length - start && suffix < after.length - start && same(before[before.length - suffix - 1], after[after.length - suffix - 1]))
    suffix++;
  return [start, before.length - start - suffix, after.slice(start, after.length - suffix)];
}
function boardDiff(before, after) {
  const old = new Map(before.map((cell) => [cell[0], cell]));
  const next = new Set(after.map((cell) => cell[0]));
  const boardSet = after.filter((cell) => !same(old.get(cell[0]), cell));
  const boardDrop = before.map((cell) => cell[0]).filter((index) => !next.has(index));
  return {
    ...boardSet.length ? { boardSet } : {},
    ...boardDrop.length ? { boardDrop } : {}
  };
}
function diffPhysical(before, after) {
  const delta = boardDiff(before.board, after.board);
  for (const key of ["rackA", "rackB", "bag", "pendingA", "pendingB"]) {
    const change = splice(before[key], after[key]);
    if (change) delta[key] = change;
  }
  return delta;
}
function applySplice(before, change) {
  if (!change) return before;
  const [start, remove, insert] = change;
  if (!Number.isInteger(start) || !Number.isInteger(remove) || start < 0 || remove < 0 || start + remove > before.length || !Array.isArray(insert)) {
    throw new Error("Malformed tile sequence change.");
  }
  return [...before.slice(0, start), ...insert, ...before.slice(start + remove)];
}
function applyBoard(before, set, drop) {
  const cells = new Map(before.map((cell) => [cell[0], cell]));
  const seenSet = /* @__PURE__ */ new Set();
  for (const index of drop ?? []) {
    if (!cells.delete(index)) throw new Error("Board removal refers to an empty square.");
  }
  for (const cell of set ?? []) {
    if (!Array.isArray(cell) || !Number.isInteger(cell[0]) || cell[0] < 0 || cell[0] >= 225 || !Number.isInteger(cell[2]) || ![0, 1].includes(cell[3]) || seenSet.has(cell[0]))
      throw new Error("Malformed board cell.");
    seenSet.add(cell[0]);
    cells.set(cell[0], cell);
  }
  return [...cells.values()].sort((a, b) => a[0] - b[0]);
}
function applyPhysical(before, delta = {}) {
  return {
    board: applyBoard(before.board, delta.boardSet, delta.boardDrop),
    rackA: applySplice(before.rackA, delta.rackA),
    rackB: applySplice(before.rackB, delta.rackB),
    bag: applySplice(before.bag, delta.bag),
    pendingA: applySplice(before.pendingA, delta.pendingA),
    pendingB: applySplice(before.pendingB, delta.pendingB)
  };
}
function logPhysical(log, when) {
  return {
    board: encodeBoardCells(log[`board${when}`]),
    rack: encodeTileCodes(log[`rack${when}`]),
    bag: encodeTileCodes(log[`tilebag${when}`])
  };
}
function logBase(frame, side) {
  return {
    board: frame.physical.board,
    rack: frame.physical[side === "A" ? "rackA" : "rackB"],
    bag: frame.physical.bag
  };
}
function diffLog(before, after) {
  return {
    ...boardDiff(before.board, after.board),
    ...splice(before.rack, after.rack) ? { rack: splice(before.rack, after.rack) } : {},
    ...splice(before.bag, after.bag) ? { bag: splice(before.bag, after.bag) } : {}
  };
}
function applyLog(before, delta = {}) {
  return {
    board: applyBoard(before.board, delta.boardSet, delta.boardDrop),
    rack: applySplice(before.rack, delta.rack),
    bag: applySplice(before.bag, delta.bag)
  };
}
function coreOf(log) {
  const core = { ...log };
  delete core.rackBefore;
  delete core.rackAfter;
  delete core.boardBefore;
  delete core.boardAfter;
  delete core.tilebagBefore;
  delete core.tilebagAfter;
  return core;
}
function withoutUserAnnotations(log) {
  const clean = { ...log };
  delete clean.note;
  delete clean.stars;
  return clean;
}
function withoutNewAnnotations(snapshot) {
  return { ...snapshot, logs: snapshot.logs.map(withoutUserAnnotations) };
}
function encodeTurn(log, frame) {
  const base = logBase(frame, log.side);
  const before = logPhysical(log, "Before");
  const after = logPhysical(log, "After");
  const beforeDelta = diffLog(base, before);
  const afterDelta = diffLog(before, after);
  const core = { ...coreOf(log) };
  if (core.startedAt === frame.meta.currentTurnStartedAt) delete core.startedAt;
  if (same(core.timerBefore, { A: frame.meta.timers.A, B: frame.meta.timers.B }))
    delete core.timerBefore;
  if (core.turnNumber === frame.meta.turnNumber) delete core.turnNumber;
  if (core.side === frame.meta.activeSide) delete core.side;
  return {
    core,
    ...Object.keys(beforeDelta).length ? { before: beforeDelta } : {},
    ...Object.keys(afterDelta).length ? { after: afterDelta } : {}
  };
}
function decodeTurn(turn, frame) {
  if (!turn?.core) throw new Error("Malformed completed turn.");
  const core = {
    startedAt: frame.meta.currentTurnStartedAt,
    timerBefore: { A: frame.meta.timers.A, B: frame.meta.timers.B },
    turnNumber: frame.meta.turnNumber,
    side: frame.meta.activeSide,
    ...turn.core
  };
  if (!["place_equation", "exchange", "pass", "end_game"].includes(core.action) || !["A", "B"].includes(core.side) || !core.id || !Number.isInteger(core.turnNumber) || !Number.isFinite(core.calculatedScore) || !Number.isFinite(core.finalScore) || !Number.isFinite(core.timerBefore?.A) || !Number.isFinite(core.timerBefore?.B) || !Number.isFinite(core.timerAfter?.A) || !Number.isFinite(core.timerAfter?.B) || !core.actionDetail || typeof core.actionDetail !== "object")
    throw new Error("Malformed completed turn.");
  const before = applyLog(logBase(frame, core.side), turn.before);
  const after = applyLog(before, turn.after);
  return {
    ...core,
    rackBefore: decodeTileCodes(before.rack),
    rackAfter: decodeTileCodes(after.rack),
    boardBefore: decodeBoardCells(before.board),
    boardAfter: decodeBoardCells(after.board),
    tilebagBefore: decodeTileCodes(before.bag),
    tilebagAfter: decodeTileCodes(after.bag)
  };
}
function snapshotOf(frame, logs, commitId = "completed-record") {
  if (!frame?.meta || !frame.physical || typeof frame.physical !== "object")
    throw new Error("Malformed completed position.");
  rejectUnknownKeys(
    frame.physical,
    ["board", "rackA", "rackB", "bag", "pendingA", "pendingB"],
    "completed physical position"
  );
  if (Object.keys(frame.meta).some((key) => !META_KEYS.includes(key)) || typeof frame.meta.gameId !== "string" || !frame.meta.gameId || typeof frame.meta.name !== "string" || !["A", "B"].includes(frame.meta.activeSide) || !["playing", "draft", "finished"].includes(frame.meta.status) || !["refill", "choose_action", "perform_action"].includes(frame.meta.phase) || !Number.isInteger(frame.meta.turnNumber) || frame.meta.turnNumber < 1 || frame.meta.boardSize !== 15 || !Number.isFinite(frame.meta.scores?.A) || !Number.isFinite(frame.meta.scores?.B) || !Number.isFinite(frame.meta.timers?.A) || !Number.isFinite(frame.meta.timers?.B)) {
    throw new Error("Malformed completed position metadata.");
  }
  const p = frame.physical;
  const indexes = p.board.map((cell) => cell[0]);
  if (indexes.some(
    (index, at) => !Number.isInteger(index) || index < 0 || index >= 225 || at > 0 && index <= indexes[at - 1]
  )) {
    throw new Error("Malformed or repeated completed board cell.");
  }
  const pendingExchangeReturnBySide = {
    A: decodeTileCodes(p.pendingA),
    B: decodeTileCodes(p.pendingB)
  };
  const snapshot = {
    ...frame.meta,
    commitId,
    board: decodeBoardCells(p.board),
    rackA: decodeTileCodes(p.rackA),
    rackB: decodeTileCodes(p.rackB),
    tilebag: decodeTileCodes(p.bag),
    pendingExchangeReturnBySide,
    pendingExchangeReturn: aggregatePendingExchangeReturns(pendingExchangeReturnBySide),
    logs
  };
  inventoryFrom({
    ...snapshot,
    pendingReturnA: pendingExchangeReturnBySide.A,
    pendingReturnB: pendingExchangeReturnBySide.B
  });
  return snapshot;
}
function eventOf(before, beforeLogs, after, sequence) {
  if (after.logs.length < beforeLogs.length)
    throw new Error("A completed active line cannot erase turns.");
  const append = after.logs.slice(beforeLogs.length).map((log) => encodeTurn(log, before));
  const amend = [];
  for (let index = 0; index < beforeLogs.length; index++) {
    const previous = beforeLogs[index];
    const updated = after.logs[index];
    if (!same(logPhysical(previous, "Before"), logPhysical(updated, "Before")) || !same(logPhysical(previous, "After"), logPhysical(updated, "After"))) {
      throw new Error("A saved history entry changed a past turn's physical facts.");
    }
    if (!same(coreOf(previous), coreOf(updated))) amend.push([index, coreOf(updated)]);
  }
  const next = frameOf(after);
  const meta = diffMeta(before.meta, next.meta);
  const position = diffPhysical(before.physical, next.physical);
  const kind = append.length ? "turn" : amend.length && !meta.length && !Object.keys(position).length ? "annotation" : "edit";
  return {
    sequence,
    kind,
    ...meta.length ? { meta } : {},
    ...Object.keys(position).length ? { position } : {},
    ...append.length ? { append } : {},
    ...amend.length ? { amend } : {}
  };
}
function applyEvent(frame, logs, event, expected) {
  if (!event || typeof event !== "object") throw new Error("Malformed completed event.");
  rejectUnknownKeys(
    event,
    ["sequence", "kind", "meta", "position", "append", "amend"],
    "completed event"
  );
  if (event.position)
    rejectUnknownKeys(
      event.position,
      ["boardSet", "boardDrop", "rackA", "rackB", "bag", "pendingA", "pendingB"],
      "completed position change"
    );
  for (const turn of event.append ?? []) {
    rejectUnknownKeys(turn, ["core", "before", "after"], "completed turn");
    if (turn.before)
      rejectUnknownKeys(
        turn.before,
        ["boardSet", "boardDrop", "rack", "bag"],
        "turn-before change"
      );
    if (turn.after)
      rejectUnknownKeys(turn.after, ["boardSet", "boardDrop", "rack", "bag"], "turn-after change");
  }
  if (event.sequence !== expected || !["turn", "annotation", "edit"].includes(event.kind))
    throw new Error("Completed event order or kind is invalid.");
  if (event.kind === "turn" !== Boolean(event.append?.length))
    throw new Error("Turn event has no complete turn facts.");
  if (event.kind === "annotation" && (event.meta || event.position || !event.amend?.length))
    throw new Error("Annotation event contains non-annotation facts.");
  const nextLogs = [...logs];
  for (const [index, core] of event.amend ?? []) {
    if (!Number.isInteger(index) || index < 0 || index >= nextLogs.length)
      throw new Error("Log amendment index is invalid.");
    nextLogs[index] = { ...nextLogs[index], ...core };
  }
  for (const turn of event.append ?? []) {
    if (nextLogs.some((log) => log.id === turn.core.id))
      throw new Error("Duplicate turn identity.");
    nextLogs.push(decodeTurn(turn, frame));
  }
  const meta = { ...frame.meta };
  const touched = /* @__PURE__ */ new Set();
  for (const [key, value] of event.meta ?? []) {
    if (!META_KEYS.includes(key) || touched.has(key))
      throw new Error("Invalid or repeated metadata field.");
    touched.add(key);
    if (value === null) delete meta[key];
    else meta[key] = value;
  }
  const next = {
    meta,
    physical: applyPhysical(frame.physical, event.position)
  };
  snapshotOf(next, nextLogs);
  return { frame: next, logs: nextLogs };
}
function replayFrames(record) {
  const frames = [record.genesis];
  let logs = [];
  const snapshots = [snapshotOf(record.genesis, logs, `completed:${record.digest}:0`)];
  for (let index = 0; index < record.events.length; index++) {
    const next = applyEvent(frames.at(-1), logs, record.events[index], index + 1);
    frames.push(next.frame);
    logs = next.logs;
    snapshots.push(snapshotOf(next.frame, logs, `completed:${record.digest}:${index + 1}`));
  }
  return { frames, snapshots };
}
function digestInput(record) {
  return record;
}
async function buildCompletedGameRecord(game, branches, provenance = {
  mode: game.gameMode === "solo" ? "solo" : game.botSide ? "bot" : game.emailPlayMode === "hosted" ? "hosted" : "standard"
}) {
  if (game.history.length === 0 || game.history[0].logs.length !== 0 || game.historyIndex !== game.history.length - 1) {
    throw new Error(
      "Complete active history is required; keep this legacy game readable instead of inventing genesis."
    );
  }
  const genesis = frameOf(game.history[0]);
  snapshotOf(genesis, []);
  const events = [];
  let previous = genesis;
  let previousLogs = [];
  for (const rawSnapshot of game.history.slice(1)) {
    const snapshot = withoutNewAnnotations(rawSnapshot);
    const event = eventOf(previous, previousLogs, snapshot, events.length + 1);
    events.push(event);
    previous = frameOf(snapshot);
    previousLogs = snapshot.logs;
  }
  const cleanFinal = withoutNewAnnotations(game);
  const finalEvent = eventOf(previous, previousLogs, cleanFinal, events.length + 1);
  if (finalEvent.meta || finalEvent.position || finalEvent.append || finalEvent.amend) {
    events.push(finalEvent);
  }
  const partial = {
    format: COMPLETED_GAME_FORMAT,
    rules: COMPLETED_RULES_VERSION,
    tileManifestDigest: await sha256(ORDINAL_TOKEN_TABLE),
    provenance: {
      ...provenance,
      completionAuthority: provenance.completionAuthority ?? "client-reported"
    },
    genesis,
    events,
    ...branches?.lines.length ? {
      branches: encodeMultiverse({
        ...branches,
        lines: branches.lines.map((line) => ({
          ...line,
          logs: line.logs.map(withoutUserAnnotations)
        }))
      })
    } : {},
    finalStateDigest: await sha256({
      frame: frameOf(cleanFinal),
      logs: cleanFinal.logs.map(coreOf)
    })
  };
  const record = { ...partial, digest: await sha256(digestInput(partial)) };
  await validateCompletedGameRecord(record);
  return record;
}
async function validateCompletedGameRecord(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Completed record is not an object.");
  const record = raw;
  rejectUnknownKeys(
    record,
    [
      "format",
      "rules",
      "tileManifestDigest",
      "provenance",
      "genesis",
      "events",
      "branches",
      "finalStateDigest",
      "digest"
    ],
    "completed record"
  );
  if (record.format !== COMPLETED_GAME_FORMAT)
    throw new Error(`Unknown completed-game format ${String(record.format)}.`);
  historicRulesFor(record.rules);
  if (record.tileManifestDigest !== await sha256(ORDINAL_TOKEN_TABLE))
    throw new Error("Completed record tile manifest is not supported by this decoder.");
  if (!record.provenance || !["standard", "solo", "hosted", "bot", "ranked", "stage"].includes(record.provenance.mode))
    throw new Error("Completed mode identity is missing.");
  if (!["client-reported", "server-reduced"].includes(record.provenance.completionAuthority))
    throw new Error("Missing or unknown completion authority.");
  if (record.provenance.stage && record.provenance.mode !== "stage")
    throw new Error("Stage identity has inconsistent mode provenance.");
  if (record.provenance.bot && !["bot", "stage"].includes(record.provenance.mode))
    throw new Error("Bot identity has inconsistent mode provenance.");
  if ((record.provenance.mode === "bot" || record.genesis?.meta?.botSide) && (!record.provenance.bot?.catalogId || !record.provenance.bot.catalogVersion))
    throw new Error("Bot catalog identity/version is missing.");
  if (record.provenance.mode === "bot" && !record.genesis?.meta?.botSide)
    throw new Error("Bot mode has no bot side.");
  if (record.provenance.bot?.executionType && !["CLIENT", "SERVER", "HYBRID"].includes(record.provenance.bot.executionType))
    throw new Error("Unknown bot execution type.");
  if (record.genesis?.meta?.botSide && !["bot", "stage"].includes(record.provenance.mode))
    throw new Error("Bot game has inconsistent mode provenance.");
  if (record.provenance.mode === "stage" && (!record.provenance.stage?.levelId || !record.provenance.stage.sealedStartDigest))
    throw new Error("Stage start identity is missing.");
  if (!record.genesis || !Array.isArray(record.events) || typeof record.digest !== "string")
    throw new Error("Malformed completed record.");
  const partial = { ...record };
  delete partial.digest;
  if (await sha256(digestInput(partial)) !== record.digest)
    throw new Error("Completed record digest mismatch.");
  const { snapshots } = replayFrames(record);
  const last = snapshots.at(-1);
  if (await sha256({ frame: frameOf(last), logs: last.logs.map(coreOf) }) !== record.finalStateDigest) {
    throw new Error("Final canonical state digest mismatch.");
  }
  if (record.branches) {
    const branches = decodeMultiverse(record.branches);
    const tree = buildTree(last.logs, branches);
    if (tree.problems.length) throw new Error(`Invalid branch tree: ${tree.problems.join(" ")}`);
    const ids = new Set(last.logs.map((log) => log.id));
    for (const line of branches.lines) {
      if (line.after.length !== line.logs.length) {
        throw new Error("Branch positions do not align with branch turns.");
      }
      if (line.from && !ids.has(line.from) && !branches.lines.some((parent) => parent.logs.some((log) => log.id === line.from))) {
        throw new Error("Branch parent turn does not exist.");
      }
      for (const position of [...line.after, line.tip]) {
        if (!position) continue;
        inventoryFrom({
          ...position,
          pendingReturnA: position.pendingExchangeReturnBySide.A,
          pendingReturnB: position.pendingExchangeReturnBySide.B
        });
      }
    }
  }
  return record;
}
async function readCompletedGameRecord(record) {
  await validateCompletedGameRecord(record);
  const { snapshots } = replayFrames(record);
  const final = snapshots.at(-1);
  return {
    game: {
      ...final,
      history: snapshots,
      historyIndex: snapshots.length - 1,
      lastSavedAt: final.createdAt
    },
    branches: record.branches ? decodeMultiverse(record.branches) : null,
    provenance: record.provenance
  };
}

// src/i18n/serverErrors.ts
var SERVER_ERROR_CODES = [
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
  // Refusals the Ranked Edge Function makes itself.
  "sign_in_required",
  "ranked_invalid_request",
  "ranked_already_waiting",
  "ranked_not_a_player",
  "ranked_match_started",
  "ranked_cannot_ready",
  "ranked_position_changed",
  "ranked_request_failed"
];
function prefixPattern(codes) {
  const alternatives = [...codes].sort((a, b) => b.length - a.length).join("|");
  return new RegExp(`\\b(${alternatives}):`);
}
var ALL_CODES_PATTERN = prefixPattern(SERVER_ERROR_CODES);

// src/bot/catalog.ts
function botKeyFor(bot) {
  if (bot.botEngine === "stage5b") return "stage5b";
  if ((bot.botEngine ?? "authur") === "authur") return "authur_strong";
  return `aether_${bot.botDifficulty ?? "medium"}`;
}

// src/features/survival/reference-endgame.json
var reference_endgame_default = {
  seed: 5093,
  board: [
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    {
      tileId: "0#2",
      kind: "0",
      face: "0",
      side: "A",
      turn: 15
    },
    null,
    null,
    null,
    {
      tileId: "1#4",
      kind: "1",
      face: "1",
      side: "B",
      turn: 8
    },
    null,
    {
      tileId: "4#2",
      kind: "4",
      face: "4",
      side: "B",
      turn: 14
    },
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    {
      tileId: "x#0",
      kind: "x",
      face: "\xD7",
      side: "A",
      turn: 15
    },
    null,
    {
      tileId: "6#2",
      kind: "6",
      face: "6",
      side: "A",
      turn: 13
    },
    null,
    {
      tileId: "9#3",
      kind: "9",
      face: "9",
      side: "B",
      turn: 8
    },
    null,
    {
      tileId: "+/-#1",
      kind: "+/-",
      face: "-",
      side: "B",
      turn: 14
    },
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    {
      tileId: "19#0",
      kind: "19",
      face: "19",
      side: "A",
      turn: 15
    },
    null,
    {
      tileId: "x#1",
      kind: "x",
      face: "\xD7",
      side: "A",
      turn: 13
    },
    null,
    {
      tileId: "=#5",
      kind: "=",
      face: "=",
      side: "B",
      turn: 8
    },
    null,
    {
      tileId: "4#3",
      kind: "4",
      face: "4",
      side: "B",
      turn: 14
    },
    null,
    {
      tileId: "1#1",
      kind: "1",
      face: "1",
      side: "B",
      turn: 4
    },
    null,
    null,
    null,
    null,
    null,
    null,
    {
      tileId: "-#3",
      kind: "-",
      face: "-",
      side: "B",
      turn: 6
    },
    null,
    {
      tileId: "1#3",
      kind: "1",
      face: "1",
      side: "A",
      turn: 13
    },
    null,
    {
      tileId: "6#0",
      kind: "6",
      face: "6",
      side: "B",
      turn: 8
    },
    null,
    {
      tileId: "+#0",
      kind: "+",
      face: "+",
      side: "B",
      turn: 14
    },
    null,
    {
      tileId: "5#3",
      kind: "5",
      face: "5",
      side: "B",
      turn: 4
    },
    null,
    null,
    null,
    null,
    null,
    null,
    {
      tileId: "18#0",
      kind: "18",
      face: "18",
      side: "B",
      turn: 6
    },
    null,
    {
      tileId: "8#3",
      kind: "8",
      face: "8",
      side: "A",
      turn: 13
    },
    null,
    {
      tileId: "0#3",
      kind: "0",
      face: "0",
      side: "B",
      turn: 8
    },
    null,
    {
      tileId: "15#0",
      kind: "15",
      face: "15",
      side: "A",
      turn: 11
    },
    null,
    {
      tileId: "4#0",
      kind: "4",
      face: "4",
      side: "B",
      turn: 4
    },
    null,
    null,
    null,
    null,
    null,
    null,
    {
      tileId: "/#3",
      kind: "/",
      face: "\xF7",
      side: "B",
      turn: 6
    },
    null,
    {
      tileId: "-#0",
      kind: "-",
      face: "-",
      side: "A",
      turn: 13
    },
    null,
    {
      tileId: "8#2",
      kind: "8",
      face: "8",
      side: "B",
      turn: 8
    },
    null,
    {
      tileId: "=#9",
      kind: "=",
      face: "=",
      side: "A",
      turn: 11
    },
    null,
    {
      tileId: "x//#2",
      kind: "x//",
      face: "\xF7",
      side: "B",
      turn: 4
    },
    null,
    null,
    null,
    null,
    null,
    null,
    {
      tileId: "6#3",
      kind: "6",
      face: "6",
      side: "B",
      turn: 6
    },
    null,
    {
      tileId: "16#0",
      kind: "16",
      face: "16",
      side: "A",
      turn: 13
    },
    null,
    {
      tileId: "?#3",
      kind: "?",
      face: "\xF7",
      side: "B",
      turn: 8
    },
    {
      tileId: "2#0",
      kind: "2",
      face: "2",
      side: "B",
      turn: 10
    },
    {
      tileId: "7#2",
      kind: "7",
      face: "7",
      side: "B",
      turn: 10
    },
    {
      tileId: "+/-#0",
      kind: "+/-",
      face: "-",
      side: "B",
      turn: 10
    },
    {
      tileId: "14#0",
      kind: "14",
      face: "14",
      side: "B",
      turn: 4
    },
    {
      tileId: "=#4",
      kind: "=",
      face: "=",
      side: "B",
      turn: 10
    },
    {
      tileId: "10#1",
      kind: "10",
      face: "10",
      side: "A",
      turn: 7
    },
    {
      tileId: "?#1",
      kind: "?",
      face: "+",
      side: "A",
      turn: 7
    },
    {
      tileId: "10#0",
      kind: "10",
      face: "10",
      side: "B",
      turn: 2
    },
    {
      tileId: "x#2",
      kind: "x",
      face: "\xD7",
      side: "A",
      turn: 7
    },
    {
      tileId: "2#2",
      kind: "2",
      face: "2",
      side: "A",
      turn: 7
    },
    {
      tileId: "-#2",
      kind: "-",
      face: "-",
      side: "B",
      turn: 6
    },
    {
      tileId: "17#0",
      kind: "17",
      face: "17",
      side: "A",
      turn: 7
    },
    {
      tileId: "=#2",
      kind: "=",
      face: "=",
      side: "A",
      turn: 7
    },
    {
      tileId: "1#0",
      kind: "1",
      face: "1",
      side: "A",
      turn: 7
    },
    {
      tileId: "3#2",
      kind: "3",
      face: "3",
      side: "A",
      turn: 7
    },
    null,
    {
      tileId: "?#2",
      kind: "?",
      face: "-",
      side: "A",
      turn: 11
    },
    null,
    {
      tileId: "=#8",
      kind: "=",
      face: "=",
      side: "B",
      turn: 4
    },
    null,
    null,
    null,
    {
      tileId: "+#2",
      kind: "+",
      face: "+",
      side: "B",
      turn: 2
    },
    null,
    null,
    {
      tileId: "2#1",
      kind: "2",
      face: "2",
      side: "B",
      turn: 6
    },
    null,
    {
      tileId: "9#1",
      kind: "9",
      face: "9",
      side: "A",
      turn: 13
    },
    null,
    {
      tileId: "2#3",
      kind: "2",
      face: "2",
      side: "B",
      turn: 8
    },
    null,
    {
      tileId: "11#0",
      kind: "11",
      face: "11",
      side: "A",
      turn: 11
    },
    null,
    {
      tileId: "8#1",
      kind: "8",
      face: "8",
      side: "B",
      turn: 4
    },
    null,
    null,
    null,
    {
      tileId: "2#5",
      kind: "2",
      face: "2",
      side: "B",
      turn: 2
    },
    null,
    null,
    {
      tileId: "=#0",
      kind: "=",
      face: "=",
      side: "B",
      turn: 6
    },
    null,
    {
      tileId: "2#4",
      kind: "2",
      face: "2",
      side: "A",
      turn: 13
    },
    null,
    {
      tileId: "+/-#2",
      kind: "+/-",
      face: "+",
      side: "A",
      turn: 9
    },
    null,
    {
      tileId: "+#3",
      kind: "+",
      face: "+",
      side: "A",
      turn: 11
    },
    null,
    {
      tileId: "+/-#3",
      kind: "+/-",
      face: "+",
      side: "B",
      turn: 4
    },
    null,
    null,
    null,
    {
      tileId: "=#6",
      kind: "=",
      face: "=",
      side: "B",
      turn: 2
    },
    null,
    null,
    {
      tileId: "-#1",
      kind: "-",
      face: "-",
      side: "B",
      turn: 6
    },
    null,
    null,
    null,
    {
      tileId: "3#4",
      kind: "3",
      face: "3",
      side: "A",
      turn: 9
    },
    null,
    {
      tileId: "5#1",
      kind: "5",
      face: "5",
      side: "A",
      turn: 3
    },
    {
      tileId: "/#1",
      kind: "/",
      face: "\xF7",
      side: "A",
      turn: 3
    },
    {
      tileId: "3#1",
      kind: "3",
      face: "3",
      side: "A",
      turn: 3
    },
    {
      tileId: "?#0",
      kind: "?",
      face: "=",
      side: "A",
      turn: 3
    },
    {
      tileId: "20#0",
      kind: "20",
      face: "20",
      side: "A",
      turn: 3
    },
    {
      tileId: "/#2",
      kind: "/",
      face: "\xF7",
      side: "A",
      turn: 3
    },
    {
      tileId: "12#1",
      kind: "12",
      face: "12",
      side: "B",
      turn: 2
    },
    {
      tileId: "=#10",
      kind: "=",
      face: "=",
      side: "A",
      turn: 5
    },
    {
      tileId: "1#2",
      kind: "1",
      face: "1",
      side: "A",
      turn: 5
    },
    {
      tileId: "5#2",
      kind: "5",
      face: "5",
      side: "A",
      turn: 5
    },
    {
      tileId: "x//#1",
      kind: "x//",
      face: "\xF7",
      side: "A",
      turn: 5
    },
    {
      tileId: "9#0",
      kind: "9",
      face: "9",
      side: "A",
      turn: 5
    },
    null,
    {
      tileId: "7#0",
      kind: "7",
      face: "7",
      side: "A",
      turn: 9
    },
    null,
    {
      tileId: "7#3",
      kind: "7",
      face: "7",
      side: "A",
      turn: 11
    },
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    {
      tileId: "0#0",
      kind: "0",
      face: "0",
      side: "A",
      turn: 9
    },
    null,
    {
      tileId: "/#0",
      kind: "/",
      face: "\xF7",
      side: "A",
      turn: 11
    },
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    {
      tileId: "x#3",
      kind: "x",
      face: "\xD7",
      side: "A",
      turn: 9
    },
    null,
    {
      tileId: "3#0",
      kind: "3",
      face: "3",
      side: "A",
      turn: 11
    },
    null,
    null,
    {
      tileId: "1#5",
      kind: "1",
      face: "1",
      side: "B",
      turn: 16
    },
    {
      tileId: "x//#0",
      kind: "x//",
      face: "\xD7",
      side: "B",
      turn: 16
    },
    {
      tileId: "13#0",
      kind: "13",
      face: "13",
      side: "B",
      turn: 12
    },
    {
      tileId: "=#7",
      kind: "=",
      face: "=",
      side: "B",
      turn: 12
    },
    {
      tileId: "6#1",
      kind: "6",
      face: "6",
      side: "B",
      turn: 12
    },
    {
      tileId: "0#1",
      kind: "0",
      face: "0",
      side: "B",
      turn: 12
    },
    {
      tileId: "3#3",
      kind: "3",
      face: "3",
      side: "B",
      turn: 12
    },
    {
      tileId: "+/-#4",
      kind: "+/-",
      face: "-",
      side: "B",
      turn: 12
    },
    {
      tileId: "5#0",
      kind: "5",
      face: "5",
      side: "B",
      turn: 12
    },
    {
      tileId: "9#2",
      kind: "9",
      face: "9",
      side: "B",
      turn: 12
    },
    {
      tileId: "0#4",
      kind: "0",
      face: "0",
      side: "A",
      turn: 9
    }
  ],
  racks: {
    A: [
      "8#0",
      "4#4",
      "=#1",
      "x//#3",
      "=#3"
    ],
    B: [
      "4#1",
      "7#1",
      "12#0",
      "+#1"
    ]
  },
  bag: [],
  scores: {
    A: 481,
    B: 500
  },
  activeSide: "A",
  turnNumber: 17,
  noScoreTail: [],
  hasPlacement: true,
  rngStep: 18
};

// src/features/survival/seededGame.ts
function random(seed) {
  let n = seed >>> 0;
  return () => {
    n = n + 1831565813 >>> 0;
    let t = n;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function kindOf(id) {
  return id.slice(0, id.lastIndexOf("#"));
}
function createSurvivalTestGame(seed, playerName, userId) {
  if (!Number.isSafeInteger(seed) || seed < 0)
    throw new Error("Stage seed must be a whole number.");
  const game = createNewGame({
    name: `Survival test \xB7 seed ${seed}`,
    playerA: playerName,
    playerB: "Authur",
    ...userId ? { playerAUserId: userId } : {},
    startingSide: "A",
    botSide: "B",
    botEngine: "authur",
    botDifficulty: "super",
    tileDrawMode: "play",
    untimed: true
  });
  const copies = /* @__PURE__ */ new Map();
  for (const tile of createInitialTilebag()) {
    const list = copies.get(tile.token) ?? [];
    list.push(tile);
    copies.set(tile.token, list);
  }
  const take = (kind, face) => {
    const tile = copies.get(kind)?.shift();
    if (!tile) throw new Error(`Stage inventory mismatch: ${kind}`);
    return tileNeedsAssignment(kind) ? { ...tile, assignedToken: face } : tile;
  };
  game.board = reference_endgame_default.board.reduce((board, placed, cell) => {
    if (placed) {
      board[Math.floor(cell / 15)][cell % 15] = {
        tile: take(placed.kind, placed.face),
        side: placed.side,
        placedTurn: placed.turn
      };
    }
    return board;
  }, game.board);
  const remaining = [...reference_endgame_default.racks.A, ...reference_endgame_default.racks.B].map(kindOf);
  const next = random(seed);
  for (let index = remaining.length - 1; index > 0; index--) {
    const swap = Math.floor(next() * (index + 1));
    [remaining[index], remaining[swap]] = [remaining[swap], remaining[index]];
  }
  game.rackA = remaining.slice(0, reference_endgame_default.racks.A.length).map((kind) => take(kind));
  game.rackB = remaining.slice(reference_endgame_default.racks.A.length).map((kind) => take(kind));
  if ([...copies.values()].some((tiles) => tiles.length > 0)) {
    throw new Error("Stage did not allocate all 100 tiles.");
  }
  game.tilebag = [];
  game.scores = { A: reference_endgame_default.scores.A, B: reference_endgame_default.scores.B };
  game.turnNumber = reference_endgame_default.turnNumber;
  game.activeSide = "A";
  game.phase = "choose_action";
  game.history = [makeSnapshot(game)];
  game.historyIndex = 0;
  return game;
}

// src/features/survival/sealedStart.ts
function stageStartCanonical(seed) {
  const canonical = encodeCanonical(
    canonicalFromSnapshot(createSurvivalTestGame(seed, "Player"), 1)
  );
  return {
    inventory: canonical.inventory,
    scores: canonical.scores,
    activeSide: canonical.activeSide,
    turnNumber: canonical.turnNumber,
    startingSide: canonical.startingSide
  };
}

// src/features/gameRecords/domain.ts
var NATURAL_REASONS = /* @__PURE__ */ new Set(["rack_out", "no_score_streak", "perfect_game"]);
function deriveCompletion(game) {
  const endLog = [...game.logs].reverse().find((log) => log.action === "end_game");
  const detail = endLog?.actionDetail;
  const surrenderedSide = detail?.surrenderedSide ?? game.matchControl?.surrenderedSide ?? null;
  const rawReason = surrenderedSide ? "surrender" : detail?.reason;
  const reason = isCompletionReason(rawReason) ? rawReason : "manual";
  return {
    kind: NATURAL_REASONS.has(reason) ? "natural" : "terminated",
    reason,
    surrenderedSide
  };
}
function isCompletionReason(value) {
  return typeof value === "string" && [
    "rack_out",
    "no_score_streak",
    "perfect_game",
    "surrender",
    "manual",
    "admin",
    "timeout",
    "disconnect",
    "legacy_finished",
    "other"
  ].includes(value);
}

// src/completedGame/adapters.ts
function canonicalStageStart(game) {
  const encoded = encodeCanonical(canonicalFromSnapshot(game.history[0], 1));
  return {
    inventory: encoded.inventory,
    scores: encoded.scores,
    activeSide: encoded.activeSide,
    turnNumber: encoded.turnNumber,
    startingSide: encoded.startingSide
  };
}
async function buildStageCompletedGameRecord(game, source) {
  if (game.status !== "finished" || !game.history.length)
    throw new Error("Stage completion and its first position are required.");
  const actual = canonicalStageStart(game);
  if (canonicalCompletedJSON(actual) !== canonicalCompletedJSON(source.sealedStart))
    throw new Error("Stage genesis differs from the server-sealed start.");
  const earned = calculateTotals(game.logs);
  if (game.scores.A !== game.history[0].scores.A + earned.A || game.scores.B !== game.history[0].scores.B + earned.B)
    throw new Error("Stage completion lost its sealed score baseline.");
  const digestBytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalCompletedJSON(source.sealedStart))
  );
  const sealedStartDigest = Array.from(
    new Uint8Array(digestBytes),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
  return buildCompletedGameRecord(game, source.branches, {
    mode: "stage",
    completionAuthority: source.completionAuthority ?? "client-reported",
    stage: {
      levelId: source.levelId,
      seed: source.seed,
      sealedStartDigest,
      sourceVersion: "stage-seal-v1"
    },
    bot: source.bot
  });
}

// src/completedGame/stageTerminal.ts
function equal(a, b) {
  return canonicalCompletedJSON(a) === canonicalCompletedJSON(b);
}
function facts(game) {
  const canonical = encodeCanonical(canonicalFromSnapshot(game, 0));
  return {
    inventory: canonical.inventory,
    scores: canonical.scores,
    turnNumber: canonical.turnNumber,
    activeSide: canonical.activeSide,
    status: canonical.status
  };
}
async function prepareStageTerminal(source, state) {
  if (state.v !== 3 || source.liveState.v !== 3)
    throw new Error("Stage capture requires identity-preserving live format v3.");
  const prior = decodeGame(source.liveState);
  const final = decodeGame(state);
  if (!prior.gameId || final.gameId !== prior.gameId || prior.playerUserIds?.A !== source.ownerId || final.playerUserIds?.A !== source.ownerId || final.status !== "finished" || prior.status === "finished" || source.revision < 1 || final.revision !== source.revision + 1)
    throw new Error("Stage terminal state or revision is invalid.");
  if (final.logs.length < prior.logs.length || !equal(final.logs.slice(0, prior.logs.length), prior.logs) || final.history.length < prior.history.length || !equal(final.history.slice(0, prior.history.length), prior.history))
    throw new Error("Stage terminal rewrote committed play.");
  const added = final.logs.slice(prior.logs.length);
  if (added.length > 2 || added[0] && added[0].side !== prior.activeSide)
    throw new Error("Stage terminal does not follow the committed turn.");
  if (added[0]) {
    const rack = added[0].side === "A" ? prior.rackA : prior.rackB;
    if (!equal(added[0].boardBefore, prior.board) || !equal(added[0].rackBefore, rack) || !equal(added[0].tilebagBefore, prior.tilebag))
      throw new Error("Stage terminal action does not start at the committed position.");
  } else if (!equal(facts(final), { ...facts(prior), status: "finished" })) {
    throw new Error("Stage terminal changed position without an action.");
  }
  const completion = deriveCompletion(final);
  if (completion.kind === "natural") {
    const normal = added[0];
    const end = added[1];
    if (added.length !== 2 || !normal || !end || end.action !== "end_game" || !["place_equation", "pass", "exchange"].includes(normal.action))
      throw new Error("Natural Stage completion needs its triggering action.");
    if (normal.turnNumber !== prior.turnNumber || normal.side !== prior.activeSide || prior.tilebag.length !== 0)
      throw new Error("Stage terminal turn or sealed empty bag is invalid.");
    if (normal.action === "place_equation") {
      const detail = normal.actionDetail;
      const used = /* @__PURE__ */ new Set();
      const rack = getRack(prior, prior.activeSide);
      const placements = (detail.placedTiles ?? []).map((item) => {
        const tile = rack.find((candidate) => candidate.id === item.tileId);
        if (!tile || used.has(item.tileId) || tile.token !== item.token)
          throw new Error("Stage terminal used an unavailable tile.");
        const choices = getAssignmentOptions(tile.token);
        if (choices.length ? !choices.includes(item.assignedToken ?? "") : Boolean(item.assignedToken))
          throw new Error("Stage terminal used an invalid tile assignment.");
        used.add(item.tileId);
        return { tile, row: item.row, col: item.col, assignedToken: item.assignedToken };
      });
      const checked = validateMove(prior.board, placements);
      if (!checked.isValid || normal.manualScore !== void 0 || normal.calculatedScore !== checked.score || normal.finalScore !== checked.score || !equal(
        normal.boardAfter,
        boardWithPending(prior.board, placements, prior.turnNumber, prior.activeSide)
      ) || !equal(
        normal.rackAfter,
        rack.filter((tile) => !used.has(tile.id))
      ) || !equal(normal.tilebagAfter, prior.tilebag))
        throw new Error("Stage terminal placement or score is not rules-derived.");
    } else if (normal.action === "pass") {
      if (normal.calculatedScore !== 0 || normal.finalScore !== 0 || normal.manualScore !== void 0 || !equal(normal.boardAfter, prior.board) || !equal(normal.rackAfter, getRack(prior, prior.activeSide)) || !equal(normal.tilebagAfter, prior.tilebag))
        throw new Error("Stage terminal pass changed the position or score.");
    } else {
      throw new Error("Stage's sealed empty bag cannot support an exchange.");
    }
    const expected = createAutomaticEndGameLog({
      boardAfter: normal.boardAfter,
      game: prior,
      logs: [...prior.logs, normal],
      normalLog: normal,
      rackAfter: normal.rackAfter,
      tilebagAfter: normal.tilebagAfter
    });
    if (!expected || !equal(end.actionDetail, expected.actionDetail) || end.finalScore !== expected.finalScore || end.side !== expected.side || !equal(end.boardAfter, normal.boardAfter) || !equal(final.board, normal.boardAfter) || !equal(final.tilebag, normal.tilebagAfter) || !equal(getRack(final, prior.activeSide), normal.rackAfter))
      throw new Error("Stage terminal reason does not follow the saved game rules.");
  } else if (completion.reason === "surrender") {
    if (completion.surrenderedSide !== "A" || added.length !== 1 || added[0]?.action !== "end_game" || !equal(final.scores, prior.scores))
      throw new Error("Invalid Stage surrender.");
  } else if (added.length !== 0) {
    throw new Error("A manual Stage ending cannot append gameplay actions.");
  }
  const record = await buildStageCompletedGameRecord(final, {
    levelId: source.levelId,
    seed: source.seed,
    sealedStart: source.sealedStart,
    branches: source.branches,
    completionAuthority: source.completionAuthority,
    bot: {
      catalogId: source.botKey,
      catalogVersion: String(source.botConfigVersion),
      difficulty: source.botDifficulty
    }
  });
  const replay = await readCompletedGameRecord(record);
  if (!equal(facts(replay.game), facts(final)) || replay.game.logs.length !== final.logs.length || replay.game.history.length !== final.history.length)
    throw new Error("Stage Compact replay does not reproduce its terminal position.");
  const outcome = completion.kind !== "natural" || completion.surrenderedSide === "A" ? "loss" : final.scores.A > final.scores.B ? "win" : final.scores.A < final.scores.B ? "loss" : "tie";
  return {
    record,
    state,
    completion,
    outcome,
    scores: { A: final.scores.A, B: final.scores.B }
  };
}

// docs/survival-poc-results.json
var survival_poc_results_default = {
  measuredAt: "2026-09-24T12:47:53.505Z",
  serverBenchmark: [
    {
      name: "endgame",
      wallMs: 89,
      engineMs: 43,
      nodes: 0,
      candidates: 1
    },
    {
      name: "midgame",
      wallMs: 2619,
      engineMs: 2467,
      nodes: 3142183,
      candidates: 4
    }
  ],
  levels: [
    {
      level: 1,
      seed: 5117,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 20,
      distinctWinningPaths: 4,
      immediateWinningMoves: 0,
      minimumSurvivalTurns: 5,
      observedWinRate: 1,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 5
        },
        greedy: {
          trials: 5,
          wins: 5
        },
        top5: {
          trials: 5,
          wins: 5
        },
        top20: {
          trials: 5,
          wins: 5
        }
      },
      authurDecisionMs: {
        p50: 55,
        p95: 112,
        count: 80
      },
      status: "awaiting_admin_approval",
      winningReplays: [
        {
          policy: "strong",
          trial: 4,
          scores: {
            A: 509,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "eabb179e07929262",
              type: "place",
              score: 14,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 82,
                    tileId: "12#0",
                    kind: "12",
                    face: "12"
                  },
                  {
                    cell: 97,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "9cd4325f13beabbe",
              type: "place",
              score: 9,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 79,
                    tileId: "=#3",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 80,
                    tileId: "4#1",
                    kind: "4",
                    face: "4"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        },
        {
          policy: "greedy",
          trial: 4,
          scores: {
            A: 509,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "eabb179e07929262",
              type: "place",
              score: 14,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 82,
                    tileId: "12#0",
                    kind: "12",
                    face: "12"
                  },
                  {
                    cell: 97,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "9cd4325f13beabbe",
              type: "place",
              score: 9,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 79,
                    tileId: "=#3",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 80,
                    tileId: "4#1",
                    kind: "4",
                    face: "4"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        },
        {
          policy: "top20",
          trial: 4,
          scores: {
            A: 505,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "37f1f3d6c7f0c3f7",
              type: "place",
              score: 5,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 17,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 18,
                    tileId: "4#1",
                    kind: "4",
                    face: "4"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "eabb179e07929262",
              type: "place",
              score: 14,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 82,
                    tileId: "12#0",
                    kind: "12",
                    face: "12"
                  },
                  {
                    cell: 97,
                    tileId: "=#3",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        }
      ]
    },
    {
      level: 2,
      seed: 5125,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 20,
      distinctWinningPaths: 5,
      immediateWinningMoves: 0,
      minimumSurvivalTurns: 5,
      observedWinRate: 1,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 5
        },
        greedy: {
          trials: 5,
          wins: 5
        },
        top5: {
          trials: 5,
          wins: 5
        },
        top20: {
          trials: 5,
          wins: 5
        }
      },
      authurDecisionMs: {
        p50: 53,
        p95: 89,
        count: 80
      },
      status: "awaiting_admin_approval",
      winningReplays: [
        {
          policy: "strong",
          trial: 4,
          scores: {
            A: 509,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "eabb179e07929262",
              type: "place",
              score: 14,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 82,
                    tileId: "12#0",
                    kind: "12",
                    face: "12"
                  },
                  {
                    cell: 97,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "9cd4325f13beabbe",
              type: "place",
              score: 9,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 79,
                    tileId: "=#3",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 80,
                    tileId: "4#4",
                    kind: "4",
                    face: "4"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        },
        {
          policy: "greedy",
          trial: 4,
          scores: {
            A: 509,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "eabb179e07929262",
              type: "place",
              score: 14,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 82,
                    tileId: "12#0",
                    kind: "12",
                    face: "12"
                  },
                  {
                    cell: 97,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "9cd4325f13beabbe",
              type: "place",
              score: 9,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 79,
                    tileId: "=#3",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 80,
                    tileId: "4#4",
                    kind: "4",
                    face: "4"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        },
        {
          policy: "top20",
          trial: 4,
          scores: {
            A: 509,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "9cd4325f13beabbe",
              type: "place",
              score: 9,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 79,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 80,
                    tileId: "4#4",
                    kind: "4",
                    face: "4"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "eabb179e07929262",
              type: "place",
              score: 14,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 82,
                    tileId: "12#0",
                    kind: "12",
                    face: "12"
                  },
                  {
                    cell: 97,
                    tileId: "=#3",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        }
      ]
    },
    {
      level: 3,
      seed: 5129,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 20,
      distinctWinningPaths: 4,
      immediateWinningMoves: 0,
      minimumSurvivalTurns: 5,
      observedWinRate: 1,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 5
        },
        greedy: {
          trials: 5,
          wins: 5
        },
        top5: {
          trials: 5,
          wins: 5
        },
        top20: {
          trials: 5,
          wins: 5
        }
      },
      authurDecisionMs: {
        p50: 53,
        p95: 92,
        count: 80
      },
      status: "awaiting_admin_approval",
      winningReplays: [
        {
          policy: "strong",
          trial: 4,
          scores: {
            A: 509,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "eabb179e07929262",
              type: "place",
              score: 14,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 82,
                    tileId: "12#0",
                    kind: "12",
                    face: "12"
                  },
                  {
                    cell: 97,
                    tileId: "=#3",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "9cd4325f13beabbe",
              type: "place",
              score: 9,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 79,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 80,
                    tileId: "4#1",
                    kind: "4",
                    face: "4"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        },
        {
          policy: "top20",
          trial: 0,
          scores: {
            A: 509,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "eabb179e07929262",
              type: "place",
              score: 14,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 82,
                    tileId: "12#0",
                    kind: "12",
                    face: "12"
                  },
                  {
                    cell: 97,
                    tileId: "=#3",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "9cd4325f13beabbe",
              type: "place",
              score: 9,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 79,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 80,
                    tileId: "4#1",
                    kind: "4",
                    face: "4"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        },
        {
          policy: "top20",
          trial: 1,
          scores: {
            A: 505,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "37f1f3d6c7f0c3f7",
              type: "place",
              score: 5,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 17,
                    tileId: "=#3",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 18,
                    tileId: "4#1",
                    kind: "4",
                    face: "4"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "eabb179e07929262",
              type: "place",
              score: 14,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 82,
                    tileId: "12#0",
                    kind: "12",
                    face: "12"
                  },
                  {
                    cell: 97,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        }
      ]
    },
    {
      level: 4,
      seed: 5131,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 20,
      distinctWinningPaths: 6,
      immediateWinningMoves: 0,
      minimumSurvivalTurns: 5,
      observedWinRate: 1,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 5
        },
        greedy: {
          trials: 5,
          wins: 5
        },
        top5: {
          trials: 5,
          wins: 5
        },
        top20: {
          trials: 5,
          wins: 5
        }
      },
      authurDecisionMs: {
        p50: 56,
        p95: 92,
        count: 61
      },
      status: "awaiting_admin_approval",
      winningReplays: [
        {
          policy: "strong",
          trial: 4,
          scores: {
            A: 507,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "2ef38fd18ba851c2",
              type: "place",
              score: 19,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 52,
                    tileId: "4#1",
                    kind: "4",
                    face: "4"
                  },
                  {
                    cell: 67,
                    tileId: "+#1",
                    kind: "+",
                    face: "+"
                  },
                  {
                    cell: 82,
                    tileId: "8#0",
                    kind: "8",
                    face: "8"
                  },
                  {
                    cell: 97,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        },
        {
          policy: "top20",
          trial: 3,
          scores: {
            A: 507,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "2ef38fd18ba851c2",
              type: "place",
              score: 19,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 52,
                    tileId: "4#1",
                    kind: "4",
                    face: "4"
                  },
                  {
                    cell: 67,
                    tileId: "+#1",
                    kind: "+",
                    face: "+"
                  },
                  {
                    cell: 82,
                    tileId: "8#0",
                    kind: "8",
                    face: "8"
                  },
                  {
                    cell: 97,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        },
        {
          policy: "top5",
          trial: 4,
          scores: {
            A: 507,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "71fa34dde75a6b8a",
              type: "place",
              score: 19,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 52,
                    tileId: "8#0",
                    kind: "8",
                    face: "8"
                  },
                  {
                    cell: 67,
                    tileId: "+#1",
                    kind: "+",
                    face: "+"
                  },
                  {
                    cell: 82,
                    tileId: "4#1",
                    kind: "4",
                    face: "4"
                  },
                  {
                    cell: 97,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        }
      ]
    },
    {
      level: 5,
      seed: 5139,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 20,
      distinctWinningPaths: 3,
      immediateWinningMoves: 0,
      minimumSurvivalTurns: 5,
      observedWinRate: 1,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 5
        },
        greedy: {
          trials: 5,
          wins: 5
        },
        top5: {
          trials: 5,
          wins: 5
        },
        top20: {
          trials: 5,
          wins: 5
        }
      },
      authurDecisionMs: {
        p50: 52,
        p95: 89,
        count: 80
      },
      status: "awaiting_admin_approval",
      winningReplays: [
        {
          policy: "strong",
          trial: 4,
          scores: {
            A: 509,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "eabb179e07929262",
              type: "place",
              score: 14,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 82,
                    tileId: "12#0",
                    kind: "12",
                    face: "12"
                  },
                  {
                    cell: 97,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "79c8bb1048edad7e",
              type: "place",
              score: 9,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 139,
                    tileId: "=#3",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 140,
                    tileId: "8#0",
                    kind: "8",
                    face: "8"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        },
        {
          policy: "top20",
          trial: 3,
          scores: {
            A: 509,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "eabb179e07929262",
              type: "place",
              score: 14,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 82,
                    tileId: "12#0",
                    kind: "12",
                    face: "12"
                  },
                  {
                    cell: 97,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "79c8bb1048edad7e",
              type: "place",
              score: 9,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 139,
                    tileId: "=#3",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 140,
                    tileId: "8#0",
                    kind: "8",
                    face: "8"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        },
        {
          policy: "top20",
          trial: 4,
          scores: {
            A: 509,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "79c8bb1048edad7e",
              type: "place",
              score: 9,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 139,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 140,
                    tileId: "8#0",
                    kind: "8",
                    face: "8"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "eabb179e07929262",
              type: "place",
              score: 14,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 82,
                    tileId: "12#0",
                    kind: "12",
                    face: "12"
                  },
                  {
                    cell: 97,
                    tileId: "=#3",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        }
      ]
    },
    {
      level: 6,
      seed: 5093,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 14,
      distinctWinningPaths: 2,
      immediateWinningMoves: 0,
      minimumSurvivalTurns: 5,
      observedWinRate: 0.7,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 5
        },
        greedy: {
          trials: 5,
          wins: 5
        },
        top5: {
          trials: 5,
          wins: 2
        },
        top20: {
          trials: 5,
          wins: 2
        }
      },
      authurDecisionMs: {
        p50: 53,
        p95: 89,
        count: 54
      },
      status: "awaiting_admin_approval",
      winningReplays: [
        {
          policy: "strong",
          trial: 4,
          scores: {
            A: 512,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "a419da34d11383a7",
              type: "place",
              score: 24,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 53,
                    tileId: "4#1",
                    kind: "4",
                    face: "4"
                  },
                  {
                    cell: 54,
                    tileId: "7#1",
                    kind: "7",
                    face: "7"
                  },
                  {
                    cell: 56,
                    tileId: "4#4",
                    kind: "4",
                    face: "4"
                  },
                  {
                    cell: 58,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        },
        {
          policy: "top20",
          trial: 3,
          scores: {
            A: 512,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "a419da34d11383a7",
              type: "place",
              score: 24,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 53,
                    tileId: "4#1",
                    kind: "4",
                    face: "4"
                  },
                  {
                    cell: 54,
                    tileId: "7#1",
                    kind: "7",
                    face: "7"
                  },
                  {
                    cell: 56,
                    tileId: "4#4",
                    kind: "4",
                    face: "4"
                  },
                  {
                    cell: 58,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        },
        {
          policy: "strong",
          trial: 0,
          scores: {
            A: 512,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "a419da34d11383a7",
              type: "place",
              score: 24,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 53,
                    tileId: "4#1",
                    kind: "4",
                    face: "4"
                  },
                  {
                    cell: 54,
                    tileId: "7#1",
                    kind: "7",
                    face: "7"
                  },
                  {
                    cell: 56,
                    tileId: "4#4",
                    kind: "4",
                    face: "4"
                  },
                  {
                    cell: 58,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        }
      ]
    },
    {
      level: 7,
      seed: 5134,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 14,
      distinctWinningPaths: 2,
      immediateWinningMoves: 0,
      minimumSurvivalTurns: 5,
      observedWinRate: 0.7,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 5
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 4
        },
        top20: {
          trials: 5,
          wins: 5
        }
      },
      authurDecisionMs: {
        p50: 34,
        p95: 137,
        count: 41
      },
      status: "awaiting_admin_approval",
      winningReplays: [
        {
          policy: "top20",
          trial: 4,
          scores: {
            A: 507,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "9cd4325f13beabbe",
              type: "place",
              score: 9,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 79,
                    tileId: "=#3",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 80,
                    tileId: "4#1",
                    kind: "4",
                    face: "4"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "79c8bb1048edad7e",
              type: "place",
              score: 9,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 139,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 140,
                    tileId: "8#0",
                    kind: "8",
                    face: "8"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        },
        {
          policy: "top20",
          trial: 2,
          scores: {
            A: 503,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "37f1f3d6c7f0c3f7",
              type: "place",
              score: 5,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 17,
                    tileId: "=#3",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 18,
                    tileId: "4#1",
                    kind: "4",
                    face: "4"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "79c8bb1048edad7e",
              type: "place",
              score: 9,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 139,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 140,
                    tileId: "8#0",
                    kind: "8",
                    face: "8"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        },
        {
          policy: "top5",
          trial: 3,
          scores: {
            A: 507,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "9cd4325f13beabbe",
              type: "place",
              score: 9,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 79,
                    tileId: "=#3",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 80,
                    tileId: "4#1",
                    kind: "4",
                    face: "4"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "79c8bb1048edad7e",
              type: "place",
              score: 9,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 139,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 140,
                    tileId: "8#0",
                    kind: "8",
                    face: "8"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        }
      ]
    },
    {
      level: 8,
      seed: 5109,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 12,
      distinctWinningPaths: 2,
      immediateWinningMoves: 0,
      minimumSurvivalTurns: 5,
      observedWinRate: 0.6,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 5
        },
        greedy: {
          trials: 5,
          wins: 5
        },
        top5: {
          trials: 5,
          wins: 1
        },
        top20: {
          trials: 5,
          wins: 1
        }
      },
      authurDecisionMs: {
        p50: 50,
        p95: 95,
        count: 68
      },
      status: "awaiting_admin_approval",
      winningReplays: [
        {
          policy: "strong",
          trial: 4,
          scores: {
            A: 512,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "a419da34d11383a7",
              type: "place",
              score: 24,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 53,
                    tileId: "4#4",
                    kind: "4",
                    face: "4"
                  },
                  {
                    cell: 54,
                    tileId: "7#1",
                    kind: "7",
                    face: "7"
                  },
                  {
                    cell: 56,
                    tileId: "4#1",
                    kind: "4",
                    face: "4"
                  },
                  {
                    cell: 58,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        },
        {
          policy: "top20",
          trial: 1,
          scores: {
            A: 512,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "a419da34d11383a7",
              type: "place",
              score: 24,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 53,
                    tileId: "4#4",
                    kind: "4",
                    face: "4"
                  },
                  {
                    cell: 54,
                    tileId: "7#1",
                    kind: "7",
                    face: "7"
                  },
                  {
                    cell: 56,
                    tileId: "4#1",
                    kind: "4",
                    face: "4"
                  },
                  {
                    cell: 58,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        },
        {
          policy: "strong",
          trial: 0,
          scores: {
            A: 512,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "a419da34d11383a7",
              type: "place",
              score: 24,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 53,
                    tileId: "4#4",
                    kind: "4",
                    face: "4"
                  },
                  {
                    cell: 54,
                    tileId: "7#1",
                    kind: "7",
                    face: "7"
                  },
                  {
                    cell: 56,
                    tileId: "4#1",
                    kind: "4",
                    face: "4"
                  },
                  {
                    cell: 58,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        }
      ]
    },
    {
      level: 9,
      seed: 5126,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 11,
      distinctWinningPaths: 3,
      immediateWinningMoves: 0,
      minimumSurvivalTurns: 5,
      observedWinRate: 0.55,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 5
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 3
        },
        top20: {
          trials: 5,
          wins: 3
        }
      },
      authurDecisionMs: {
        p50: 59,
        p95: 123,
        count: 87
      },
      status: "awaiting_admin_approval",
      winningReplays: [
        {
          policy: "strong",
          trial: 4,
          scores: {
            A: 523,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "14a657829050ffff",
              type: "place",
              score: 14,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 79,
                    tileId: "+#1",
                    kind: "+",
                    face: "+"
                  },
                  {
                    cell: 80,
                    tileId: "8#0",
                    kind: "8",
                    face: "8"
                  },
                  {
                    cell: 81,
                    tileId: "=#3",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 82,
                    tileId: "12#0",
                    kind: "12",
                    face: "12"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "6caa6f57ef3d6b46",
              type: "place",
              score: 14,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 97,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            }
          ]
        },
        {
          policy: "top20",
          trial: 1,
          scores: {
            A: 509,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "eabb179e07929262",
              type: "place",
              score: 14,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 82,
                    tileId: "12#0",
                    kind: "12",
                    face: "12"
                  },
                  {
                    cell: 97,
                    tileId: "=#3",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "79c8bb1048edad7e",
              type: "place",
              score: 9,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 139,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 140,
                    tileId: "8#0",
                    kind: "8",
                    face: "8"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        },
        {
          policy: "top20",
          trial: 4,
          scores: {
            A: 509,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "79c8bb1048edad7e",
              type: "place",
              score: 9,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 139,
                    tileId: "=#3",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 140,
                    tileId: "8#0",
                    kind: "8",
                    face: "8"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "eabb179e07929262",
              type: "place",
              score: 14,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 82,
                    tileId: "12#0",
                    kind: "12",
                    face: "12"
                  },
                  {
                    cell: 97,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        }
      ]
    },
    {
      level: 10,
      seed: 5116,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 10,
      distinctWinningPaths: 2,
      immediateWinningMoves: 0,
      minimumSurvivalTurns: 5,
      observedWinRate: 0.5,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 5
        },
        greedy: {
          trials: 5,
          wins: 5
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 39,
        p95: 97,
        count: 70
      },
      status: "awaiting_admin_approval",
      winningReplays: [
        {
          policy: "strong",
          trial: 4,
          scores: {
            A: 512,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "df6f6ec68a9673b2",
              type: "place",
              score: 24,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 6,
                    tileId: "4#4",
                    kind: "4",
                    face: "4"
                  },
                  {
                    cell: 7,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 8,
                    tileId: "4#1",
                    kind: "4",
                    face: "4"
                  },
                  {
                    cell: 9,
                    tileId: "+#1",
                    kind: "+",
                    face: "+"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        },
        {
          policy: "greedy",
          trial: 4,
          scores: {
            A: 512,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "df6f6ec68a9673b2",
              type: "place",
              score: 24,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 6,
                    tileId: "4#4",
                    kind: "4",
                    face: "4"
                  },
                  {
                    cell: 7,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 8,
                    tileId: "4#1",
                    kind: "4",
                    face: "4"
                  },
                  {
                    cell: 9,
                    tileId: "+#1",
                    kind: "+",
                    face: "+"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "pass",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        },
        {
          policy: "strong",
          trial: 0,
          scores: {
            A: 512,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "df6f6ec68a9673b2",
              type: "place",
              score: 24,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 6,
                    tileId: "4#4",
                    kind: "4",
                    face: "4"
                  },
                  {
                    cell: 7,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 8,
                    tileId: "4#1",
                    kind: "4",
                    face: "4"
                  },
                  {
                    cell: 9,
                    tileId: "+#1",
                    kind: "+",
                    face: "+"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            }
          ]
        }
      ]
    },
    {
      level: 11,
      seed: 5106,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 7,
      distinctWinningPaths: 1,
      immediateWinningMoves: 0,
      minimumSurvivalTurns: 5,
      observedWinRate: 0.35,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 5
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 1
        },
        top20: {
          trials: 5,
          wins: 1
        }
      },
      authurDecisionMs: {
        p50: 62,
        p95: 122,
        count: 95
      },
      status: "awaiting_admin_approval",
      winningReplays: [
        {
          policy: "strong",
          trial: 4,
          scores: {
            A: 523,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "14a657829050ffff",
              type: "place",
              score: 14,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 79,
                    tileId: "+#1",
                    kind: "+",
                    face: "+"
                  },
                  {
                    cell: 80,
                    tileId: "8#0",
                    kind: "8",
                    face: "8"
                  },
                  {
                    cell: 81,
                    tileId: "=#3",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 82,
                    tileId: "12#0",
                    kind: "12",
                    face: "12"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "6caa6f57ef3d6b46",
              type: "place",
              score: 14,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 97,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            }
          ]
        },
        {
          policy: "strong",
          trial: 0,
          scores: {
            A: 523,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "14a657829050ffff",
              type: "place",
              score: 14,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 79,
                    tileId: "+#1",
                    kind: "+",
                    face: "+"
                  },
                  {
                    cell: 80,
                    tileId: "8#0",
                    kind: "8",
                    face: "8"
                  },
                  {
                    cell: 81,
                    tileId: "=#3",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 82,
                    tileId: "12#0",
                    kind: "12",
                    face: "12"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "6caa6f57ef3d6b46",
              type: "place",
              score: 14,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 97,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            }
          ]
        },
        {
          policy: "strong",
          trial: 1,
          scores: {
            A: 523,
            B: 500
          },
          actions: [
            {
              side: "A",
              id: "14a657829050ffff",
              type: "place",
              score: 14,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 79,
                    tileId: "+#1",
                    kind: "+",
                    face: "+"
                  },
                  {
                    cell: 80,
                    tileId: "8#0",
                    kind: "8",
                    face: "8"
                  },
                  {
                    cell: 81,
                    tileId: "=#3",
                    kind: "=",
                    face: "="
                  },
                  {
                    cell: 82,
                    tileId: "12#0",
                    kind: "12",
                    face: "12"
                  }
                ]
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "B",
              id: "03b4240debc883f8",
              type: "pass",
              score: 0,
              move: {
                type: "pass"
              }
            },
            {
              side: "A",
              id: "6caa6f57ef3d6b46",
              type: "place",
              score: 14,
              move: {
                type: "place",
                placements: [
                  {
                    cell: 97,
                    tileId: "=#1",
                    kind: "=",
                    face: "="
                  }
                ]
              }
            }
          ]
        }
      ]
    },
    {
      level: 12,
      seed: 5112,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 18,
      distinctWinningPaths: 0,
      immediateWinningMoves: 4,
      minimumSurvivalTurns: 5,
      observedWinRate: 0.9,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 5
        },
        greedy: {
          trials: 5,
          wins: 5
        },
        top5: {
          trials: 5,
          wins: 5
        },
        top20: {
          trials: 5,
          wins: 3
        }
      },
      authurDecisionMs: {
        p50: 4,
        p95: 4,
        count: 2
      },
      status: "needs_multi_turn_evidence",
      winningReplays: []
    },
    {
      level: 13,
      seed: 5128,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 17,
      distinctWinningPaths: 0,
      immediateWinningMoves: 12,
      minimumSurvivalTurns: 5,
      observedWinRate: 0.85,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 5
        },
        greedy: {
          trials: 5,
          wins: 5
        },
        top5: {
          trials: 5,
          wins: 5
        },
        top20: {
          trials: 5,
          wins: 2
        }
      },
      authurDecisionMs: {
        p50: 265,
        p95: 333,
        count: 18
      },
      status: "needs_multi_turn_evidence",
      winningReplays: []
    },
    {
      level: 14,
      seed: 5114,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 15,
      distinctWinningPaths: 0,
      immediateWinningMoves: 12,
      minimumSurvivalTurns: 5,
      observedWinRate: 0.75,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 5
        },
        greedy: {
          trials: 5,
          wins: 5
        },
        top5: {
          trials: 5,
          wins: 3
        },
        top20: {
          trials: 5,
          wins: 2
        }
      },
      authurDecisionMs: {
        p50: 39,
        p95: 302,
        count: 26
      },
      status: "needs_multi_turn_evidence",
      winningReplays: []
    },
    {
      level: 15,
      seed: 5121,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 14,
      distinctWinningPaths: 0,
      immediateWinningMoves: 1,
      minimumSurvivalTurns: 5,
      observedWinRate: 0.7,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 5
        },
        greedy: {
          trials: 5,
          wins: 5
        },
        top5: {
          trials: 5,
          wins: 3
        },
        top20: {
          trials: 5,
          wins: 1
        }
      },
      authurDecisionMs: {
        p50: 41,
        p95: 370,
        count: 34
      },
      status: "needs_multi_turn_evidence",
      winningReplays: []
    },
    {
      level: 16,
      seed: 5099,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 12,
      distinctWinningPaths: 0,
      immediateWinningMoves: 1,
      minimumSurvivalTurns: 5,
      observedWinRate: 0.6,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 5
        },
        greedy: {
          trials: 5,
          wins: 5
        },
        top5: {
          trials: 5,
          wins: 1
        },
        top20: {
          trials: 5,
          wins: 1
        }
      },
      authurDecisionMs: {
        p50: 38,
        p95: 366,
        count: 42
      },
      status: "needs_multi_turn_evidence",
      winningReplays: []
    },
    {
      level: 17,
      seed: 5123,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 11,
      distinctWinningPaths: 0,
      immediateWinningMoves: 1,
      minimumSurvivalTurns: 5,
      observedWinRate: 0.55,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 5
        },
        greedy: {
          trials: 5,
          wins: 5
        },
        top5: {
          trials: 5,
          wins: 1
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 25,
        p95: 221,
        count: 42
      },
      status: "needs_multi_turn_evidence",
      winningReplays: []
    },
    {
      level: 18,
      seed: 5130,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 11,
      distinctWinningPaths: 0,
      immediateWinningMoves: 1,
      minimumSurvivalTurns: 5,
      observedWinRate: 0.55,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 5
        },
        greedy: {
          trials: 5,
          wins: 5
        },
        top5: {
          trials: 5,
          wins: 1
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 26,
        p95: 364,
        count: 42
      },
      status: "needs_multi_turn_evidence",
      winningReplays: []
    },
    {
      level: 19,
      seed: 5104,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 10,
      distinctWinningPaths: 0,
      immediateWinningMoves: 3,
      minimumSurvivalTurns: 5,
      observedWinRate: 0.5,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 5
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 4
        },
        top20: {
          trials: 5,
          wins: 1
        }
      },
      authurDecisionMs: {
        p50: 42,
        p95: 393,
        count: 56
      },
      status: "needs_multi_turn_evidence",
      winningReplays: []
    },
    {
      level: 20,
      seed: 5115,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 10,
      distinctWinningPaths: 0,
      immediateWinningMoves: 1,
      minimumSurvivalTurns: 5,
      observedWinRate: 0.5,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 5
        },
        greedy: {
          trials: 5,
          wins: 5
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 101,
        p95: 165,
        count: 25
      },
      status: "needs_multi_turn_evidence",
      winningReplays: []
    },
    {
      level: 21,
      seed: 5132,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 9,
      distinctWinningPaths: 0,
      immediateWinningMoves: 3,
      minimumSurvivalTurns: 5,
      observedWinRate: 0.45,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 5
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 2
        },
        top20: {
          trials: 5,
          wins: 2
        }
      },
      authurDecisionMs: {
        p50: 165,
        p95: 369,
        count: 66
      },
      status: "needs_multi_turn_evidence",
      winningReplays: []
    },
    {
      level: 22,
      seed: 5094,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 163,
        p95: 225,
        count: 64
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 23,
      seed: 5095,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 45,
        p95: 599,
        count: 114
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 24,
      seed: 5096,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 5,
        p95: 6,
        count: 60
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 25,
      seed: 5097,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 176,
        p95: 363,
        count: 58
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 26,
      seed: 5098,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 42,
        p95: 405,
        count: 118
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 27,
      seed: 5100,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 39,
        p95: 551,
        count: 116
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 28,
      seed: 5101,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 21,
        p95: 41,
        count: 80
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 29,
      seed: 5102,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 42,
        p95: 562,
        count: 116
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 30,
      seed: 5103,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 21,
        p95: 44,
        count: 80
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 31,
      seed: 5105,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 38,
        p95: 160,
        count: 112
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 32,
      seed: 5107,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 38,
        p95: 432,
        count: 114
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 33,
      seed: 5108,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 42,
        p95: 137,
        count: 67
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 34,
      seed: 5110,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 5,
        p95: 8,
        count: 80
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 35,
      seed: 5111,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 52,
        p95: 351,
        count: 98
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 36,
      seed: 5113,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 35,
        p95: 425,
        count: 110
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 37,
      seed: 5118,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      distinctWinningPaths: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 33,
        p95: 433,
        count: 112
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 38,
      seed: 5119,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      distinctWinningPaths: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 174,
        p95: 382,
        count: 120
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 39,
      seed: 5120,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      distinctWinningPaths: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 29,
        p95: 46,
        count: 80
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 40,
      seed: 5122,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      distinctWinningPaths: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 4,
        p95: 6,
        count: 60
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 41,
      seed: 5124,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      distinctWinningPaths: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 4,
        p95: 6,
        count: 60
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 42,
      seed: 5127,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      distinctWinningPaths: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 30,
        p95: 48,
        count: 80
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 43,
      seed: 5133,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      distinctWinningPaths: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 42,
        p95: 513,
        count: 127
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 44,
      seed: 5135,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      distinctWinningPaths: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 33,
        p95: 52,
        count: 60
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 45,
      seed: 5136,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      distinctWinningPaths: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 155,
        p95: 361,
        count: 44
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 46,
      seed: 5137,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      distinctWinningPaths: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 4,
        p95: 5,
        count: 60
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 47,
      seed: 5138,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      distinctWinningPaths: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 326,
        p95: 420,
        count: 102
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    },
    {
      level: 48,
      seed: 5140,
      positionSource: "authur-endgame fixture, seeded redistribution of the nine unplayed tiles",
      samplePolicy: "five trials each: Authur, greedy score, random top five score, random top twenty score",
      trials: 20,
      wins: 0,
      distinctWinningPaths: 0,
      observedWinRate: 0,
      byPolicy: {
        strong: {
          trials: 5,
          wins: 0
        },
        greedy: {
          trials: 5,
          wins: 0
        },
        top5: {
          trials: 5,
          wins: 0
        },
        top20: {
          trials: 5,
          wins: 0
        }
      },
      authurDecisionMs: {
        p50: 154,
        p95: 386,
        count: 40
      },
      status: "needs_more_winning_replays",
      winningReplays: []
    }
  ]
};

// src/bot/authur/request.ts
function buildAuthurRequest(game, roomId, revision) {
  const side = game.botSide;
  if (!side || game.botEngine !== "authur") throw new Error("Not an Authur game");
  const opponent = otherSide(side);
  const board = [];
  for (let row = 0; row < game.board.length; row += 1) {
    for (let col = 0; col < game.board[row].length; col += 1) {
      const placed = game.board[row][col];
      if (!placed) continue;
      board.push({
        cell: row * game.boardSize + col,
        kind: placed.tile.token,
        face: displayToken(placed.tile),
        side: placed.side,
        turn: placed.placedTurn
      });
    }
  }
  const noScoreTail = [];
  for (let index = game.logs.length - 1; index >= 0 && noScoreTail.length < 6; index -= 1) {
    const log = game.logs[index];
    if (log.action === "end_game") continue;
    if (log.finalScore > 0) break;
    noScoreTail.unshift(log.side);
  }
  return {
    roomId,
    revision,
    seed: seedFor(roomId, revision),
    side,
    board,
    rack: getRack(game, side).map((tile) => tile.token),
    ownPending: (game.pendingExchangeReturnBySide?.[side] ?? []).map((tile) => tile.token),
    opponentRackCount: getRack(game, opponent).length,
    opponentPendingCount: game.pendingExchangeReturnBySide?.[opponent]?.length ?? 0,
    bagCount: game.tilebag.length,
    scores: { A: game.scores.A, B: game.scores.B },
    turnNumber: game.turnNumber,
    noScoreTail
  };
}

// supabase/functions/live-game/index.ts
var url = Deno.env.get("SUPABASE_URL");
var db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false }
});
var anonKey = Deno.env.get("SUPABASE_ANON_KEY");
var cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function respond(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);
  let authorization = request.headers.get("Authorization");
  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authorization ?? "" } }
  });
  try {
    let body = await request.json();
    let trustedActor = null;
    let jobLeaseToken = null;
    let trustedJob = null;
    if (["bot-result", "bot-observation"].includes(String(body.operation))) {
      const secret = Deno.env.get("LIVE_BOT_SECRET");
      if (!secret || secret.length < 32 || request.headers.get("X-Live-Bot-Secret") !== secret || authorization !== `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`)
        return respond({ error: "Trusted worker required." }, 401);
      const job = await db.from("live_bot_jobs").select("*").eq("id", body.jobId).maybeSingle();
      if (job.error || !job.data || job.data.lease_token !== body.leaseToken)
        return respond({ error: "Bot job unavailable." }, 409);
      if (job.data.status === "done") return respond({ ok: true });
      if (job.data.status !== "running" || Date.parse(job.data.lease_expires_at) < Date.now())
        return respond({ error: "Bot lease expired." }, 409);
      jobLeaseToken = body.leaseToken;
      trustedJob = job.data;
      trustedActor = job.data.actor_id;
      const live = await db.from("room_live").select("state,revision").eq("room_id", job.data.room_id).maybeSingle();
      if (!live.data) {
        const completed = await db.from("game_history").select("source_id").eq("source_id", job.data.room_id).limit(1);
        if (completed.data?.length) {
          await db.from("live_bot_jobs").update({ status: "done" }).eq("id", job.data.id);
          return respond({ ok: true });
        }
        return respond({ error: "Bot game unavailable." }, 409);
      }
      const committed = await db.from("live_game_events").select("actor_id").eq("game_id", job.data.room_id).eq("command_id", job.data.id).maybeSingle();
      if (committed.data?.actor_id === job.data.actor_id) {
        await db.from("live_bot_jobs").update({ status: "done" }).eq("id", job.data.id).eq("lease_token", body.leaseToken);
        return respond({ ok: true });
      }
      if (live.data.revision !== job.data.revision)
        return respond({ error: "Bot revision changed." }, 409);
      if (body.operation === "bot-observation") {
        const game = decodeGame(live.data.state);
        if (game.botEngine !== "authur" || game.status !== "playing" || game.timers.paused || game.activeSide !== game.botSide)
          return respond({ error: "Bot turn unavailable." }, 409);
        return respond({
          engine: "authur",
          request: buildAuthurRequest(game, job.data.room_id, job.data.revision)
        });
      }
      body = {
        operation: "action",
        id: job.data.room_id,
        revision: job.data.revision,
        commandId: job.data.id,
        action: botActionFor(decodeGame(live.data.state), body.move)
      };
      authorization = `Bearer ${trustedActor}`;
    }
    if (["create", "create-stage", "stage-admin", "cancel", "bot-turn", "handoff"].includes(
      String(body.operation)
    )) {
      const { data: auth, error: authError } = await userClient.auth.getUser();
      if (authError || !auth.user) return respond({ error: "Sign in required." }, 401);
      if (body.operation === "stage-admin") {
        const profile = await db.from("profiles").select("is_admin").eq("id", auth.user.id).single();
        if (profile.error || !profile.data.is_admin)
          return respond({ error: "Administrator required." }, 403);
        if (body.action === "import") {
          const rows = survival_poc_results_default.levels.filter(
            (level2) => level2.status === "awaiting_admin_approval" && "immediateWinningMoves" in level2 && level2.immediateWinningMoves === 0
          ).slice(0, 10).map((level2) => ({
            season_key: "2026-09-poc",
            level_no: level2.level,
            seed: level2.seed,
            reference_key: "endgame-v1",
            sample_policy: level2.samplePolicy,
            sample_count: level2.trials,
            win_count: level2.wins,
            immediate_winning_moves: "immediateWinningMoves" in level2 ? level2.immediateWinningMoves : -1,
            shortest_winning_replay_turns: Math.min(
              ...level2.winningReplays.map((replay) => replay.actions.length)
            ),
            bot_latency_ms: level2.authurDecisionMs,
            winning_replays: level2.winningReplays,
            status: "draft"
          }));
          const imported = await db.from("survival_levels").insert(rows);
          if (imported.error) return respond({ error: "Unable to import Stage drafts." }, 409);
          return respond({ ok: true });
        }
        if (typeof body.levelId !== "string" || !["seal", "approve"].includes(String(body.action)))
          return respond({ error: "Invalid Stage request." }, 400);
        const level = await db.from("survival_levels").select("seed,winning_replays,immediate_winning_moves,shortest_winning_replay_turns").eq("id", body.levelId).single();
        if (level.error) return respond({ error: "Stage unavailable." }, 404);
        if (body.action === "approve" && (typeof body.note !== "string" || !body.note.trim() || level.data.winning_replays.length < 3 || level.data.immediate_winning_moves !== 0 || level.data.shortest_winning_replay_turns < 5))
          return respond({ error: "Stage does not meet approval requirements." }, 400);
        const sealed = await db.rpc("trusted_admin_stage", {
          p_actor_id: auth.user.id,
          p_level_id: body.levelId,
          p_start: stageStartCanonical(level.data.seed),
          p_note: body.action === "approve" ? body.note : null
        });
        if (sealed.error) return respond({ error: "Stage could not be approved or sealed." }, 409);
        return respond({ ok: true });
      }
      if (["create", "create-stage"].includes(String(body.operation)) && (Deno.env.get("LIVE_GAME_CREATION_ENABLED") === "false" || body.operation === "create-stage" && Deno.env.get("STAGE_CREATION_ENABLED") === "false"))
        return respond({ error: "New game creation is temporarily unavailable." }, 503);
      if (body.operation === "create-stage") {
        if ((Deno.env.get("LIVE_BOT_SECRET")?.length ?? 0) < 32)
          return respond({ error: "Trusted Stage execution is unavailable." }, 503);
        if (typeof body.levelId !== "string" || typeof body.requestId !== "string")
          return respond({ error: "Invalid Stage request." }, 400);
        const allowed = await userClient.from("survival_levels").select("id").eq("id", body.levelId).maybeSingle();
        if (allowed.error || !allowed.data) return respond({ error: "Stage unavailable." }, 404);
        const level = await db.from("survival_levels").select("seed").eq("id", body.levelId).single();
        if (level.error) throw level.error;
        const game = createSurvivalTestGame(
          level.data.seed,
          typeof body.playerName === "string" ? body.playerName.slice(0, 80) : "Player",
          auth.user.id
        );
        game.name = "Stage attempt";
        const created = await db.rpc("trusted_create_stage", {
          p_actor_id: auth.user.id,
          p_level_id: body.levelId,
          p_request_id: body.requestId,
          p_state: encodeGame(game),
          p_canonical: encodeCanonical(canonicalFromSnapshot(game, 1))
        });
        if (created.error) return respond({ error: "Unable to start Stage attempt." }, 409);
        return respond({ id: created.data.room_id });
      }
      if (body.operation === "create") {
        const input = body.settings;
        if (!input || typeof input.name !== "string" || input.name.length > 160)
          return respond({ error: "Invalid room settings." }, 400);
        const local = !input.emailPlayMode && !input.botSide && input.gameMode !== "solo" && !input.playerAUserId && !input.playerBUserId && !input.playerAEmail && !input.playerBEmail;
        const settings = {
          name: input.name,
          gameMode: input.gameMode,
          playerA: input.playerA,
          playerB: input.playerB,
          playerAUserId: input.playerAUserId,
          playerBUserId: input.playerBUserId,
          playerAEmail: input.playerAEmail,
          playerBEmail: input.playerBEmail,
          startingSide: input.startingSide === "B" ? "B" : "A",
          timerMinutes: input.timerMinutes,
          untimed: input.untimed,
          botSide: input.botSide,
          botEngine: input.botEngine,
          botDifficulty: input.botDifficulty,
          tileDrawMode: input.botSide || input.emailPlayMode === "direct" ? "play" : input.tileDrawMode ?? "play",
          emailPlayMode: input.emailPlayMode === "hosted" ? "hosted" : local || input.gameMode === "solo" && !input.emailPlayMode ? void 0 : "direct",
          emailPlayersCanSeeOpponentRack: false
        };
        if (settings.botSide) {
          if (!(settings.botEngine === "authur" && settings.botDifficulty === "super" || settings.botEngine === "stage5b" && settings.botDifficulty === "stage5b64"))
            return respond({ error: "This bot has no secure live execution path yet." }, 400);
          if (settings.botEngine === "authur" && (Deno.env.get("LIVE_BOT_SECRET")?.length ?? 0) < 32)
            return respond({ error: "Trusted Authur execution is unavailable." }, 503);
          settings.playerAUserId = settings.botSide === "A" ? null : auth.user.id;
          settings.playerBUserId = settings.botSide === "B" ? null : auth.user.id;
          settings.playerAEmail = null;
          settings.playerBEmail = null;
        } else if (!settings.playerAUserId && !settings.playerBUserId && !settings.playerAEmail && !settings.playerBEmail) {
          settings.playerAUserId = auth.user.id;
        }
        const game = createWaitingGame(settings);
        if (local || input.gameMode === "solo" && !input.emailPlayMode) {
          game.emailPlayMode = void 0;
          game.history = [makeSnapshot(game)];
        }
        const { data, error } = await db.rpc("trusted_create_live_game", {
          p_actor_id: auth.user.id,
          p_state: encodeGame(game),
          p_policy: local ? { ...body.policy, joinPolicy: "invite_only" } : body.policy,
          p_request_id: body.requestId,
          p_bot_key: game.botSide ? botKeyFor(game) : null,
          p_bot_side: game.botSide ?? null,
          p_funding: body.funding ?? null
        });
        if (error) return respond({ error: error.message }, 400);
        return respond({ id: data.room_id, roomCode: data.room_code });
      }
      if (typeof body.id !== "string") return respond({ error: "Invalid game ID." }, 400);
      if (body.operation === "handoff") {
        const visible = await userClient.from("room_live").select("room_id").eq("room_id", body.id).maybeSingle();
        if (visible.error || !visible.data)
          return respond({ error: "Live game unavailable." }, 404);
        const claim = await db.rpc("claim_local_turn", {
          p_actor_id: auth.user.id,
          p_room_id: body.id,
          p_revision: body.revision,
          p_side: body.side
        });
        if (claim.error)
          return respond({ error: "Local handoff unavailable. Reload and retry." }, 409);
        body.handoffToken = claim.data;
        body.operation = "read";
      } else if (body.operation === "bot-turn") {
        const allowed = await userClient.from("room_live").select("room_id").eq("room_id", body.id).maybeSingle();
        if (!allowed.data) return respond({ error: "Live game unavailable." }, 404);
        const live = await db.from("room_live").select("state,revision,owner_id").eq("room_id", body.id).single();
        if (live.error || live.data.owner_id !== auth.user.id)
          return respond({ error: "Bot controller required." }, 403);
        const queued = await db.rpc("enqueue_live_bot", {
          p_room_id: body.id,
          p_revision: body.revision,
          p_actor_id: auth.user.id,
          p_request: decodeGame(live.data.state).botEngine === "stage5b" ? {} : buildAuthurRequest(decodeGame(live.data.state), body.id, live.data.revision)
        });
        if (queued.error) return respond({ error: "Bot turn unavailable. Reload and retry." }, 409);
        body.operation = "read";
      } else {
        if (body.operation === "cancel") {
          const result2 = await userClient.rpc("cancel_live_game", { target_game_id: body.id });
          if (result2.error) return respond({ error: "Unable to cancel room." }, 403);
          return respond({ cancelled: true });
        }
      }
    }
    const result = await handleLiveGame(
      { authorization, body },
      {
        authenticate: async (token) => {
          if (trustedActor) return token === trustedActor ? trustedActor : null;
          const { data, error } = await userClient.auth.getUser(token);
          return error ? null : data.user?.id ?? null;
        },
        read: async (id, _actorId) => {
          const visible = await userClient.from("room_live").select("room_id").eq("room_id", id).maybeSingle();
          if (!trustedActor && (visible.error || !visible.data)) return null;
          if (trustedJob && trustedJob.room_id !== id) return null;
          const { data, error } = await db.from("room_live").select(
            "room_id,owner_id,player_a_user_id,player_b_user_id,revision,mode_key,room_purpose,authority_protocol,state,bot_key,bot_config_version,bot_difficulty,local_claim_token,local_claim_side,local_claim_revision"
          ).eq("room_id", id).maybeSingle();
          if (error) throw error;
          if (!data) return null;
          const timeline = await db.from("game_timelines").select("version,doc").eq("game_id", id).maybeSingle();
          if (timeline.error) throw timeline.error;
          return {
            id,
            ownerId: data.owner_id,
            seats: { A: data.player_a_user_id, B: data.player_b_user_id },
            revision: data.revision,
            mode: data.room_purpose === "stage" ? "stage" : data.mode_key,
            purpose: data.room_purpose,
            authorityProtocol: data.authority_protocol,
            ...data.local_claim_token ? {
              localClaim: {
                token: data.local_claim_token,
                side: data.local_claim_side,
                revision: data.local_claim_revision
              }
            } : {},
            ...data.bot_key ? {
              bot: {
                catalogId: data.bot_key,
                catalogVersion: String(data.bot_config_version),
                difficulty: data.bot_difficulty
              }
            } : {},
            state: data.state,
            timeline: timeline.data ? { ...decodeMultiverse(timeline.data.doc), version: timeline.data.version } : EMPTY_MULTIVERSE
          };
        },
        committed: async (id, commandId, actorId) => {
          const { data, error } = await db.from("live_game_events").select("actor_id").eq("game_id", id).eq("command_id", commandId).maybeSingle();
          if (error) throw error;
          return data?.actor_id === actorId;
        },
        commit: async (source, actorId, commandId, side, action, game, changedTimeline) => {
          if (game.status === "finished") {
            const timeline = await db.from("game_timelines").select("version,doc").eq("game_id", source.id).maybeSingle();
            if (timeline.error) throw timeline.error;
            const branches = timeline.data ? decodeMultiverse(timeline.data.doc) : void 0;
            if (source.purpose === "stage") {
              const attempt = await db.from("survival_attempts").select("level_id").eq("room_id", source.id).single();
              if (attempt.error) throw attempt.error;
              const level = await db.from("survival_levels").select("seed,start_canonical").eq("id", attempt.data.level_id).single();
              if (level.error) throw level.error;
              const room = await db.from("room_live").select("bot_key,bot_config_version,bot_difficulty").eq("room_id", source.id).single();
              if (room.error) throw room.error;
              const prepared = await prepareStageTerminal(
                {
                  roomId: source.id,
                  ownerId: source.ownerId,
                  levelId: attempt.data.level_id,
                  seed: level.data.seed,
                  revision: source.revision,
                  liveState: source.state,
                  sealedStart: level.data.start_canonical,
                  completionAuthority: "server-reduced",
                  botKey: room.data.bot_key,
                  botConfigVersion: room.data.bot_config_version,
                  botDifficulty: room.data.bot_difficulty,
                  branches
                },
                encodeGame(game)
              );
              const captured = await db.rpc("capture_stage_terminal", {
                target_game_id: source.id,
                target_player_id: source.ownerId,
                target_expected_revision: source.revision,
                target_timeline_version: timeline.data?.version ?? null,
                target_state: prepared.state,
                target_record: prepared.record,
                target_completion_kind: prepared.completion.kind,
                target_completion_reason: prepared.completion.reason,
                target_surrendered_side: prepared.completion.surrenderedSide
              });
              if (captured.error) throw captured.error;
              return true;
            }
            const completion = deriveCompletion(game);
            const record = await buildCompletedGameRecord(game, branches, {
              mode: game.botSide ? "bot" : "standard",
              completionAuthority: "server-reduced",
              ...source.bot ? { bot: source.bot } : {}
            });
            const { error: error2 } = await db.rpc("capture_normal_terminal", {
              p_room_id: source.id,
              p_actor_id: actorId,
              p_expected_revision: source.revision,
              p_timeline_version: timeline.data?.version ?? null,
              p_state: encodeGame(game),
              p_record: record,
              p_completion_kind: completion.kind,
              p_completion_reason: completion.reason,
              p_surrendered_side: completion.surrenderedSide
            });
            if (error2) throw error2;
            return true;
          }
          if (body.operation === "practice-bot" && !changedTimeline) {
            const { data: data2, error: error2 } = await db.rpc("trusted_commit_practice_bot", {
              p_actor_id: actorId,
              p_room_id: source.id,
              p_revision: source.revision,
              p_command_id: commandId,
              p_action: action,
              p_canonical: encodeCanonical(canonicalFromSnapshot(game, game.revision)),
              p_state: encodeGame(game)
            });
            if (error2) throw error2;
            return data2 === "committed" || data2 === "duplicate";
          }
          if (body.operation === "control" || changedTimeline) {
            const { data: data2, error: error2 } = await db.rpc("trusted_commit_live_capability", {
              p_actor_id: actorId,
              p_room_id: source.id,
              p_revision: source.revision,
              p_command_id: commandId,
              p_action: action,
              p_canonical: encodeCanonical(canonicalFromSnapshot(game, game.revision)),
              p_state: encodeGame(game),
              p_timeline: changedTimeline ? encodeMultiverse(changedTimeline) : null,
              p_timeline_version: source.timeline?.version ?? 0
            });
            if (error2) throw error2;
            return data2 === "committed" || data2 === "duplicate";
          }
          const { data, error } = await db.rpc("trusted_commit_live_game", {
            p_actor_id: actorId,
            p_room_id: source.id,
            p_revision: source.revision,
            p_command_id: commandId,
            p_side: side,
            p_action: action,
            p_canonical: encodeCanonical(canonicalFromSnapshot(game, game.revision)),
            p_state: encodeGame(game)
          });
          if (error) throw error;
          return data === "committed" || data === "duplicate";
        }
      },
      Boolean(trustedActor)
    );
    if (trustedJob) {
      await db.from("live_bot_jobs").update({
        status: result.status === 200 ? "done" : result.status === 409 ? "cancelled" : "failed"
      }).eq("id", trustedJob.id).eq("lease_token", jobLeaseToken);
      return respond(
        result.status === 200 ? { ok: true } : { error: "Bot result refused." },
        result.status
      );
    }
    if (result.status === 200 && result.body.match?.botTurn && result.body.match.yourSide && result.body.match.mode !== "stage5b_standard") {
      const live = await db.from("room_live").select("state,revision,owner_id,authority_protocol").eq("room_id", result.body.match.id).maybeSingle();
      if (live.data && live.data.authority_protocol === "server-v1" && live.data.revision === result.body.match.revision) {
        const queued = await db.rpc("enqueue_live_bot", {
          p_room_id: result.body.match.id,
          p_revision: live.data.revision,
          p_actor_id: live.data.owner_id,
          p_request: decodeGame(live.data.state).botEngine === "stage5b" ? {} : buildAuthurRequest(
            decodeGame(live.data.state),
            result.body.match.id,
            live.data.revision
          )
        });
        if (queued.error) console.error("Trusted bot enqueue failed; owner read will retry.");
      }
    }
    return respond(
      body.handoffToken && body.operation === "read" && result.body.match?.localConfirmed ? { ...result.body, handoffToken: body.handoffToken } : result.body,
      result.status
    );
  } catch {
    return respond({ error: "Live game unavailable." }, 500);
  }
});
