// What the engine's best play IS (DESIGN.md §5, §6, §9), read off EQ-Lab's own
// move validator — the one /play scores players with and the one that will
// judge a submission. The engines report only totals; `validateMove` reports
// every equation a placement scores, with its cells and its score.
import { validateMove } from "../../survival-generator/.vendor/eqlab-rules.mjs";
import { equationFacts } from "./equation-facts.mjs";

export const SIZE = 15;
const CHOICE_KINDS = new Set(["?", "+/-", "x//"]);
const PLAIN_OPERATORS = new Set(["+", "-", "x", "/"]);
const OPERATOR_KINDS = new Set([...PLAIN_OPERATORS, "+/-", "x//"]);

/** A tile's category by canonical kind — never by the face it shows. */
export function categoryOf(kind) {
  if (kind === "?") return "blank";
  if (kind === "+/-" || kind === "x//") return "choice";
  if (PLAIN_OPERATORS.has(kind)) return "operator";
  if (kind === "=") return "equals";
  if (/^\d$/.test(kind)) return "digit";
  if (/^\d\d$/.test(kind) && Number(kind) >= 10 && Number(kind) <= 20) return "heavy";
  throw new Error(`unknown tile kind: ${kind}`);
}

/** The face as the board shows it: plain operators have one face of their own. */
export function displayFace(kind, face) {
  if (kind === "x" || face === "x") return "×";
  if (kind === "/" || face === "/") return "÷";
  return face ?? kind;
}

/**
 * N / H / O / = for one tile. A blank takes the category of the face it stands
 * for; everything else is read from its kind.
 */
export function symbolOf({ kind, face }) {
  const basis = kind === "?" ? face : kind;
  if (basis === "=") return "=";
  if (/^\d$/.test(basis)) return "N";
  if (/^\d\d$/.test(basis)) return "H";
  return "O";
}

const isNumberSymbol = (symbol) => symbol === "N" || symbol === "H";

/** Tiles in board order → tokens, neighbouring number tiles joined into one. */
function group(tiles, pick, isNumber) {
  const tokens = [];
  let previousNumber = false;
  for (const tile of tiles) {
    const value = pick(tile);
    const number = isNumber(tile);
    if (number && previousNumber) tokens[tokens.length - 1] += value;
    else tokens.push(value);
    previousNumber = number;
  }
  return tokens;
}

/** `N O N = NN`: the construction of an equation, not its value. */
export function patternOf(tiles) {
  return group(tiles, symbolOf, (tile) => isNumberSymbol(symbolOf(tile))).join(" ");
}

/** `5 + 8 = 13`: the equation as it reads, number tiles joined. */
export function numberText(tiles) {
  return group(
    tiles,
    (tile) => displayFace(tile.kind, tile.face),
    (tile) => isNumberSymbol(symbolOf(tile)),
  ).join(" ");
}

/** The position as EQ-Lab's validator reads a board. */
export function eqlabBoard(cells) {
  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  cells.forEach((cell, index) => {
    board[cell.r][cell.c] = {
      tile: {
        id: `b${index}`,
        token: cell.kind,
        ...(CHOICE_KINDS.has(cell.kind) ? { assignedToken: cell.face } : {}),
      },
      placedTurn: cell.turn ?? 1,
      side: cell.side ?? "A",
    };
  });
  return board;
}

// ── content tags (ported from Codex's generate.mjs, over the scored equations) ──
function fractionOf(tokens) {
  const gcd = (a, b) => {
    while (b !== 0n) [a, b] = [b, a % b];
    return a === 0n ? 1n : a;
  };
  const normalize = (num, den) => {
    if (den === 0n) return null;
    const divisor = gcd(num < 0n ? -num : num, den);
    return { num: num / divisor, den: den / divisor };
  };
  let fraction = false;
  let fractionSum = false;
  for (const side of tokens.join(" ").split(" = ")) {
    const parts = side.trim().split(" ");
    let index = 0;
    let sideFractions = 0;
    let summed = false;
    while (index < parts.length) {
      if (parts[index] === "+" || parts[index] === "-") index++;
      if (!/^\d+$/.test(parts[index] ?? "")) return { fraction: false, fractionSum: false };
      let term = { num: BigInt(parts[index++]), den: 1n };
      while (parts[index] === "×" || parts[index] === "÷") {
        const operation = parts[index++];
        if (!/^\d+$/.test(parts[index] ?? "")) return { fraction: false, fractionSum: false };
        const amount = BigInt(parts[index++]);
        term =
          operation === "×"
            ? normalize(term.num * amount, term.den)
            : normalize(term.num, term.den * amount);
        if (!term) return { fraction: false, fractionSum: false };
      }
      if (term.den > 1n) sideFractions++;
      if (parts[index] === "+" || parts[index] === "-") summed = true;
      else if (index < parts.length) return { fraction: false, fractionSum: false };
    }
    fraction ||= sideFractions > 0;
    fractionSum ||= sideFractions >= 2 && summed;
  }
  return { fraction, fractionSum };
}

export function contentOf(equations) {
  const tokenLists = equations.map((equation) => equation.text.split(" "));
  const readings = tokenLists.map(fractionOf);
  return {
    arithmetic: tokenLists.some(
      (tokens) =>
        tokens.filter((token) => ["+", "-", "×", "÷"].includes(token)).length >= 2 ||
        tokens.some((token) => token === "×" || token === "÷"),
    ),
    fraction: readings.some((reading) => reading.fraction),
    fractionSum: readings.some((reading) => reading.fractionSum),
    large: tokenLists.some((tokens) =>
      tokens.some((token) => /^\d+$/.test(token) && Number(token) >= 100),
    ),
    trivialZero: tokenLists.some((tokens) =>
      tokens.some(
        (token, index) =>
          (token === "×" && (Number(tokens[index - 1]) === 0 || Number(tokens[index + 1]) === 0)) ||
          (token === "÷" && Number(tokens[index - 1]) === 0),
      ),
    ),
  };
}

/** v1's rough "awkward rack" index (Codex's `rackDifficulty`), unchanged. */
export function rackDifficulty(rack) {
  const counts = new Map();
  for (const kind of rack) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const opCount = rack.filter((kind) => OPERATOR_KINDS.has(kind)).length;
  const duplicates = [...counts.values()].reduce((sum, n) => sum + Math.max(0, n - 1), 0);
  const blanks = counts.get("?") ?? 0;
  const equals = counts.get("=") ?? 0;
  return {
    index: opCount + duplicates + (equals === 0 ? 1 : 0) - blanks * 2,
    opCount,
    duplicates,
    equals,
    blanks,
  };
}

export const MOVE_LABELS = ["EXTEND", "CROSS", "HOOK"];

// Contacts are ordered (existing boundary tile, adjacent newly placed tile).
// Choice and blank tiles use their assigned FACE here because contact is visual
// equation geometry; rack/placed composition still uses physical kind.
export function contactCategory(tile) {
  const face = displayFace(tile.kind, tile.face);
  if (face === "=") return "EQUALS";
  if (["+", "-", "×", "÷"].includes(face)) return "ARITHMETIC_OPERATOR";
  if (/^\d$/.test(face)) return "DIGIT";
  if (/^(1[0-9]|20)$/.test(face)) return "HEAVY_NUMBER";
  throw new Error(`unknown equation face ${face}`);
}

function extendGeometry(tiles) {
  const headContacts = [];
  const tailContacts = [];
  for (let start = 0; start < tiles.length;) {
    if (tiles[start].new) { start++; continue; }
    let end = start;
    while (end + 1 < tiles.length && !tiles[end + 1].new) end++;
    if (end - start + 1 >= 2) {
      if (start > 0) headContacts.push([contactCategory(tiles[start]), contactCategory(tiles[start - 1])]);
      if (end + 1 < tiles.length) tailContacts.push([contactCategory(tiles[end]), contactCategory(tiles[end + 1])]);
    }
    start = end + 1;
  }
  const atHead = headContacts.length > 0;
  const atTail = tailContacts.length > 0;
  if (!atHead && !atTail) return { shape: null, headContact: null, tailContact: null, headContacts, tailContacts };
  return {
    shape: atHead && atTail ? "BOTH" : atHead ? "HEAD_ONLY" : "TAIL_ONLY",
    headContact: headContacts[0] ?? null,
    tailContact: tailContacts[0] ?? null,
    headContacts,
    tailContacts,
  };
}

/**
 * EXTEND / CROSS / HOOK — structural LABELS of a placement, read off its scored
 * runs (DESIGN.md §5). A move carries every label that applies.
 *
 * `runs` are the scored equations — `{ direction, tiles: [{ r, c, new }] }`, tiles
 * in reading order, `new` for a tile this move placed — and `placements` the
 * tiles placed: the shape of the canonical generator's `mainRun` + `crossRuns`
 * (each run's `placed` / `reused` cells) and of the canonical scorer's breakdown.
 *
 *   main    the run along the line of the placed tiles; for a single tile, its
 *           longer run (horizontal on a tie)
 *   hooks   every other scored run. The rules make each one a run through
 *           exactly ONE new tile, whose other tiles were already on the board
 *           and touch it: HEAD (the new tile starts it), TAIL (ends it) or JOIN
 *           (board tiles on both sides — two pieces joined into one equation).
 *
 *   EXTEND  the main line reads through two or more board tiles next to each
 *           other along it: an equation already on that line, lengthened (or
 *           joined) at its head or tail. A lone tile on the end of an equation
 *           is EXTEND.
 *   CROSS   the main line reads through a board tile that stands alone along
 *           it: a perpendicular line it passes through.
 *   HOOK    at least one hook: the same placement also completes / extends
 *           something already on the board into another scored equation.
 *
 * `primaryType` (HOOK > EXTEND > CROSS) is display metadata only. `facts` keep
 * the raw structure — the main line's board-tile segments and every hook's
 * sides — so the labels can be recomputed under a different rule.
 */
export function classifyMove(runs, placements) {
  const rows = new Set(placements.map((placement) => placement.r)).size;
  const axis = placements.length > 1 ? (rows === 1 ? "horizontal" : "vertical") : null;
  const main = axis
    ? runs.find((run) => run.direction === axis)
    : [...runs].sort(
        (a, b) =>
          b.tiles.length - a.tiles.length ||
          (a.direction === "horizontal" ? -1 : 1) - (b.direction === "horizontal" ? -1 : 1),
      )[0];
  if (!main) throw new Error("a placement without a main run");

  // Board tiles along the main line, as maximal runs of neighbours: [5] is an
  // equation it extends, [1, 1] two lines it crosses.
  const segments = [];
  let length = 0;
  for (const tile of main.tiles) {
    if (tile.new) {
      if (length > 0) segments.push(length);
      length = 0;
    } else {
      length += 1;
    }
  }
  if (length > 0) segments.push(length);

  const hooks = runs
    .filter((run) => run !== main)
    .map((run) => {
      const fresh = run.tiles.filter((tile) => tile.new);
      if (fresh.length !== 1) throw new Error(`a second run with ${fresh.length} new tiles`);
      const before = run.tiles.findIndex((tile) => tile.new);
      const after = run.tiles.length - 1 - before;
      const subtype = before === 0 ? "HEAD" : after === 0 ? "TAIL" : "JOIN";
      return { run, subtype, before, after };
    });

  const moveTypes = [];
  if (segments.some((count) => count >= 2)) moveTypes.push("EXTEND");
  if (segments.some((count) => count === 1)) moveTypes.push("CROSS");
  if (hooks.length > 0) moveTypes.push("HOOK");
  const primaryType = ["HOOK", "EXTEND", "CROSS"].find((type) => moveTypes.includes(type)) ?? null;
  const extension = moveTypes.includes("EXTEND") ? extendGeometry(main.tiles) : null;
  return {
    moveTypes,
    primaryType,
    main,
    hooks,
    geometry: { extend: extension },
    facts: {
      equationCount: runs.length,
      main: {
        direction: main.direction,
        tiles: main.tiles.length,
        placed: main.tiles.filter((tile) => tile.new).length,
        reusedSegments: segments,
      },
      hooks: hooks.map(({ run, subtype, before, after }) => ({
        subtype,
        direction: run.direction,
        before,
        after,
      })),
    },
  };
}

/**
 * Everything about one placement on one board.
 *
 * `boardCells` is the board BEFORE the move ({ r, c, kind, face }); `placements`
 * the tiles placed ({ r, c, kind, face }). Returns `{ valid: false, errors }` for
 * a placement EQ-Lab refuses.
 */
export function analyzePlacement(boardCells, placements) {
  const pending = placements.map((placement, index) => ({
    tile: { id: `n${index}`, token: placement.kind },
    row: placement.r,
    col: placement.c,
    ...(CHOICE_KINDS.has(placement.kind) ? { assignedToken: placement.face } : {}),
  }));
  const validation = validateMove(eqlabBoard(boardCells), pending);
  if (!validation.isValid) return { valid: false, errors: validation.errors, score: 0 };

  const placed = new Map(
    placements.map((placement) => [`${placement.r}:${placement.c}`, placement]),
  );
  const existing = new Map(boardCells.map((cell) => [`${cell.r}:${cell.c}`, cell]));
  const equations = validation.equations.map((equation) => {
    const tiles = equation.cells.map(({ row, col }) => {
      const key = `${row}:${col}`;
      const fresh = placed.get(key);
      const tile = fresh ?? existing.get(key);
      return {
        r: row,
        c: col,
        kind: tile.kind,
        face: displayFace(tile.kind, tile.face),
        new: Boolean(fresh),
      };
    });
    return {
      direction: equation.direction,
      tiles,
      text: numberText(tiles),
      pattern: patternOf(tiles),
      score: equation.score,
      multiplier: equation.multiplier,
      tileCount: tiles.length,
      placedParticipating: tiles.filter((tile) => tile.new).length,
      reusedBoardTiles: tiles.filter((tile) => !tile.new).length,
      semantics: equationFacts(tiles),
    };
  });

  const classified = classifyMove(equations, placements);
  const ordered = [
    { ...classified.main, role: "main" },
    ...classified.hooks.map(({ run, subtype }) => ({ ...run, role: "hook", hookSubtype: subtype })),
  ];

  const composition = {
    digit: 0,
    heavy: 0,
    operator: 0,
    choice: 0,
    equals: 0,
    blank: 0,
    total: placements.length,
  };
  for (const placement of placements) composition[categoryOf(placement.kind)] += 1;

  return {
    valid: true,
    score: validation.score,
    bingoBonus: validation.bingoBonus,
    equations: ordered,
    moveTypes: classified.moveTypes,
    primaryType: classified.primaryType,
    moveFacts: classified.facts,
    geometry: classified.geometry,
    composition,
    placedKinds: placements.map((placement) => placement.kind),
    patterns: {
      main: ordered[0].pattern,
      hooks: ordered.slice(1).map((equation) => equation.pattern),
    },
    content: contentOf(ordered),
  };
}

/** Engine candidates within 0.5 value of the best — v1's "near-best", unchanged. */
export function nearBestOf(candidates) {
  const best = candidates[0];
  if (!best) return [];
  return candidates
    .filter((candidate) => best.value - candidate.value <= 0.5)
    .slice(0, 12)
    .map((candidate, index) => ({
      rank: index + 1,
      type: candidate.type,
      score: candidate.score,
      value: candidate.value,
      placements: (candidate.placements ?? []).map((placement) => ({
        r: placement.r,
        c: placement.c,
        kind: placement.kind,
        face: placement.token,
      })),
      exchange: candidate.exchange ?? [],
    }));
}

/** Raw difficulty-related facts (DESIGN.md §9). Measured, not judged. */
export function difficultyFeatures({ position, candidates, legalMoves, analysis, nearBest }) {
  const [best, second, third] = candidates;
  const scores = candidates.map((candidate) => candidate.score);
  const highest = Math.max(...scores);
  const mainTokens = analysis.patterns.main.split(" ");
  return {
    version: "study-difficulty-features-v1",
    legalMoves,
    candidatesReturned: candidates.length,
    bestScore: best.score,
    bestValue: best.value,
    secondScore: second?.score ?? null,
    secondValue: second?.value ?? null,
    thirdValue: third?.value ?? null,
    valueGapToSecond: second ? best.value - second.value : null,
    valueGapToThird: third ? best.value - third.value : null,
    scoreGapToSecond: second ? best.score - second.score : null,
    nearBestCount: nearBest.length,
    highestCandidateScore: highest,
    bestIsHighestScoring: best.score === highest,
    highestScoringRank: scores.indexOf(highest) + 1,
    tilesPlaced: analysis.composition.total,
    equationCount: analysis.moveFacts.equationCount,
    moveTypes: analysis.moveTypes,
    hookSubtypes: analysis.moveFacts.hooks.map((hook) => hook.subtype),
    composition: analysis.composition,
    mainPatternTokens: mainTokens.length,
    longestNumberTiles: Math.max(
      ...mainTokens.filter((token) => /^[NH]+$/.test(token)).map((token) => token.length),
      0,
    ),
    usesBlank: analysis.composition.blank > 0,
    usesChoice: analysis.composition.choice > 0,
    bingo: analysis.composition.total === 8,
    boardTiles: position.board.length,
    bagCount: position.bagCount,
    turnNumber: position.turnNumber,
    scoreDiff: position.scores.self - position.scores.opponent,
    rackIndex: rackDifficulty(position.rack).index,
    candidateValues: candidates.slice(0, 10).map((candidate) => candidate.value),
    candidateScores: candidates.slice(0, 10).map((candidate) => candidate.score),
  };
}
