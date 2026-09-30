// supabase/functions/stage-terminal/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";

// src/constants/gameRules.ts
var BOARD_SIZE = 15;
var RACK_SIZE = 8;
var STOP_REQUEST_BLOCK_MS = 5 * 60 * 1e3;
var BINGO_BONUS = 40;
var NO_SCORE_STREAK_LENGTH = 6;
var NO_SCORE_TURNS_PER_SIDE = 3;
var SOLO_NO_SCORE_STREAK_LENGTH = 3;
var PERFECT_GAME_BONUS = 100;
var RACK_OUT_MAX_REMAINING = RACK_SIZE;

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

// src/gameplay/multiverse.ts
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
    completionAuthority: "client-reported",
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

// supabase/functions/stage-terminal/index.ts
var cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
var url = Deno.env.get("SUPABASE_URL");
var serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
var anonKey = Deno.env.get("SUPABASE_ANON_KEY");
var db = createClient(url, serviceKey, { auth: { persistSession: false } });
var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function respond(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);
  try {
    const bearer = request.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
    if (!bearer) return respond({ error: "Sign in required." }, 401);
    const authClient = createClient(url, anonKey, { auth: { persistSession: false } });
    const { data: auth, error: authError } = await authClient.auth.getUser(bearer);
    if (authError || !auth.user) return respond({ error: "Sign in required." }, 401);
    const body = await request.json();
    if (typeof body.gameId !== "string" || !uuid.test(body.gameId) || !body.state || typeof body.state !== "object")
      return respond({ error: "Invalid Stage completion." }, 400);
    const roomId = body.gameId;
    const saved = await db.from("stage_completed_attempts").select("attempt_id,player_id,outcome,record_digest").eq("room_id", roomId).maybeSingle();
    if (saved.error) throw saved.error;
    if (saved.data) {
      if (saved.data.player_id !== auth.user.id)
        return respond({ error: "Stage attempt unavailable." }, 404);
      return respond({
        attemptId: saved.data.attempt_id,
        outcome: saved.data.outcome,
        digest: saved.data.record_digest
      });
    }
    const room = await db.from("room_live").select(
      "room_id,owner_id,room_purpose,archive_policy,revision,state,bot_key,bot_side,bot_config_version,bot_difficulty"
    ).eq("room_id", roomId).maybeSingle();
    if (room.error) throw room.error;
    if (!room.data || room.data.owner_id !== auth.user.id || room.data.room_purpose !== "stage" || room.data.archive_policy !== "none")
      return respond({ error: "Stage attempt unavailable." }, 404);
    const attempt = await db.from("survival_attempts").select("id,player_id,level_id,finished_at").eq("room_id", roomId).maybeSingle();
    if (attempt.error) throw attempt.error;
    if (!attempt.data || attempt.data.player_id !== auth.user.id || attempt.data.finished_at !== null)
      return respond({ error: "Stage attempt unavailable." }, 404);
    const level = await db.from("survival_levels").select("id,seed,start_canonical").eq("id", attempt.data.level_id).single();
    if (level.error) throw level.error;
    const timeline = await db.from("game_timelines").select("version,doc").eq("game_id", roomId).maybeSingle();
    if (timeline.error) throw timeline.error;
    const prepared = await prepareStageTerminal(
      {
        roomId,
        ownerId: auth.user.id,
        levelId: attempt.data.level_id,
        seed: level.data.seed,
        revision: room.data.revision,
        liveState: room.data.state,
        sealedStart: level.data.start_canonical,
        botKey: room.data.bot_key,
        botConfigVersion: room.data.bot_config_version,
        botDifficulty: room.data.bot_difficulty,
        ...timeline.data ? { branches: decodeMultiverse(timeline.data.doc) } : {}
      },
      body.state
    );
    const captured = await db.rpc("capture_stage_terminal", {
      target_game_id: roomId,
      target_player_id: auth.user.id,
      target_expected_revision: room.data.revision,
      target_timeline_version: timeline.data?.version ?? null,
      target_state: prepared.state,
      target_record: prepared.record,
      target_completion_kind: prepared.completion.kind,
      target_completion_reason: prepared.completion.reason,
      target_surrendered_side: prepared.completion.surrenderedSide
    });
    if (captured.error) {
      if (captured.error.code === "40001")
        return respond({ error: "Stage position changed. Reload and retry." }, 409);
      throw captured.error;
    }
    const result = Array.isArray(captured.data) ? captured.data[0] : captured.data;
    return respond({
      attemptId: result.attempt_id,
      outcome: result.outcome,
      digest: result.record_digest
    });
  } catch (error) {
    console.error("stage-terminal failed", error);
    return respond({ error: "Unable to complete Stage attempt." }, 500);
  }
});
