// supabase/functions/migrate-saved-legacy/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";

// src/constants/gameRules.ts
var BOARD_SIZE = 15;
var RACK_SIZE = 8;
var STOP_REQUEST_BLOCK_MS = 5 * 60 * 1e3;

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

// src/codec.ts
var STORAGE_PREFIX = "c1:";
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
function deserializeGame(raw) {
  let parsed;
  try {
    parsed = raw.startsWith(STORAGE_PREFIX) ? JSON.parse(raw.slice(STORAGE_PREFIX.length)) : JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (!("v" in parsed)) return parsed;
  return decodeGame(parsed);
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
async function readCompletedGame(raw, legacyBranches) {
  if (typeof raw !== "string") {
    const result = await readCompletedGameRecord(raw);
    return { kind: "compact", ...result, fullyBranchable: true };
  }
  let candidate;
  try {
    candidate = JSON.parse(raw.startsWith(STORAGE_PREFIX) ? raw.slice(STORAGE_PREFIX.length) : raw);
  } catch {
    throw new Error("Unreadable stored game payload.");
  }
  if (candidate && typeof candidate === "object" && "format" in candidate) {
    const result = await readCompletedGameRecord(candidate);
    return { kind: "compact", ...result, fullyBranchable: true };
  }
  if (candidate && typeof candidate === "object" && "v" in candidate && ![1, 2, 3].includes(candidate.v)) {
    throw new Error(`Unknown legacy-game format ${String(candidate.v)}.`);
  }
  const legacy = deserializeGame(raw);
  if (!legacy) throw new Error("Unreadable legacy game.");
  inventoryFrom({
    ...legacy,
    pendingReturnA: legacy.pendingExchangeReturnBySide?.A ?? [],
    pendingReturnB: legacy.pendingExchangeReturnBySide?.B ?? []
  });
  if (candidate && typeof candidate === "object" && "v" in candidate && [1, 2].includes(candidate.v)) {
    return {
      kind: "legacy",
      game: legacy,
      branches: legacyBranches ?? null,
      fullyBranchable: false,
      reason: "Face-only legacy storage omitted physical tile identities; canonical recovery is readable but not a lossless original event record."
    };
  }
  if (legacy.logs.some((log) => log.note !== void 0 || log.stars !== void 0) || legacyBranches?.lines.some(
    (line) => line.logs.some((log) => log.note !== void 0 || log.stars !== void 0)
  )) {
    return {
      kind: "legacy",
      game: legacy,
      branches: legacyBranches ?? null,
      fullyBranchable: false,
      reason: "Historic annotations remain readable in their original legacy record."
    };
  }
  try {
    const record = await buildCompletedGameRecord(legacy, legacyBranches);
    const result = await readCompletedGameRecord(record);
    return { kind: "compact", ...result, fullyBranchable: true };
  } catch (error) {
    return {
      kind: "legacy",
      game: legacy,
      branches: legacyBranches ?? null,
      fullyBranchable: false,
      reason: error instanceof Error ? error.message : "Incomplete historic reconstruction facts."
    };
  }
}

// src/completedGame/projection.ts
var PUBLIC_BOT_NAMES = {
  authur: "Authur",
  authur_strong: "Authur",
  stage5b: "ArchBot"
};
function publicBoard(board) {
  const cells = [];
  for (let row = 0; row < board.length; row++) {
    for (let col = 0; col < board[row].length; col++) {
      const cell = board[row][col];
      if (cell)
        cells.push({
          row,
          col,
          kind: cell.tile.token,
          face: displayToken(cell.tile),
          side: cell.side,
          turn: cell.placedTurn
        });
    }
  }
  return cells;
}
function authorizeCompletedReplay(access, viewer) {
  const userId = viewer.userId;
  if (!userId) return false;
  if (access.scope === "private") return userId === access.ownerId;
  if (access.scope === "ranked")
    return access.participantIds.includes(userId) || access.published && viewer.approved;
  if (access.scope === "stage")
    return userId === access.ownerId || access.published && viewer.approved;
  if (!access.published || !viewer.approved && !viewer.admin) return false;
  if (access.scope === "region")
    return viewer.admin || Boolean(access.regionId && viewer.regionIds.includes(access.regionId));
  return access.scope === "public";
}
async function projectCompletedGame(record, access, viewer) {
  if (!authorizeCompletedReplay(access, viewer)) throw new Error("Replay access denied.");
  if (access.scope === "ranked" && record.provenance.mode !== "ranked" || access.scope === "stage" && record.provenance.mode !== "stage" || record.provenance.mode === "ranked" && access.scope !== "ranked" || record.provenance.mode === "stage" && access.scope !== "stage")
    throw new Error("Replay scope does not match game provenance.");
  const { game, branches } = await readCompletedGameRecord(record);
  return projectDecodedGame(game, access, viewer, record.provenance, branches);
}
async function projectStoredCompletedGame(stored, access, viewer) {
  if (!authorizeCompletedReplay(access, viewer)) throw new Error("Replay access denied.");
  if (stored && typeof stored === "object" && "format" in stored)
    return projectCompletedGame(stored, access, viewer);
  const raw = typeof stored === "string" ? stored : JSON.stringify(stored);
  const storedObject = stored && typeof stored === "object" ? stored : null;
  const timeline = storedObject && "timeline" in storedObject ? storedObject.timeline : null;
  const read = await readCompletedGame(raw, timeline ? decodeMultiverse(timeline) : void 0);
  return projectDecodedGame(
    read.game,
    access,
    viewer,
    read.kind === "compact" ? read.provenance : void 0,
    read.branches
  );
}
function projectDecodedGame(game, access, viewer, provenance, branches) {
  if (!authorizeCompletedReplay(access, viewer)) throw new Error("Replay access denied.");
  if (game.status !== "finished") throw new Error("Only finished games may be projected.");
  const bot = provenance?.bot;
  const mode = provenance?.mode ?? (game.gameMode === "solo" ? "solo" : game.botSide ? "bot" : "standard");
  const history = game.history.length ? game.history : [game];
  const visiblePositions = history.map((position) => ({
    board: publicBoard(position.board),
    scores: { A: position.scores.A, B: position.scores.B },
    clocks: { A: position.timers.A, B: position.timers.B },
    turn: position.turnNumber,
    side: position.activeSide
  }));
  visiblePositions.push({
    board: publicBoard(game.board),
    scores: { A: game.scores.A, B: game.scores.B },
    clocks: { A: game.timers.A, B: game.timers.B },
    turn: game.turnNumber,
    side: game.activeSide
  });
  const projectedPositions = visiblePositions.filter(
    (position, index) => index === 0 || JSON.stringify(position) !== JSON.stringify(visiblePositions[index - 1])
  );
  const forkPositions = /* @__PURE__ */ new Map();
  for (const log of game.logs) {
    const saved = history.find((position) => position.logs.at(-1)?.id === log.id);
    forkPositions.set(log.id, {
      board: publicBoard(saved?.board ?? log.boardAfter),
      scores: saved ? { A: saved.scores.A, B: saved.scores.B } : null,
      clocks: saved ? { A: saved.timers.A, B: saved.timers.B } : { A: log.timerAfter.A, B: log.timerAfter.B },
      turn: log.turnNumber
    });
  }
  for (const line of branches?.lines ?? [])
    line.logs.forEach((log, index) => {
      const saved = line.after[index];
      forkPositions.set(log.id, {
        board: publicBoard(saved?.board ?? log.boardAfter),
        scores: saved ? { A: saved.scores.A, B: saved.scores.B } : null,
        clocks: saved ? { A: saved.timers.A, B: saved.timers.B } : { A: log.timerAfter.A, B: log.timerAfter.B },
        turn: log.turnNumber
      });
    });
  return {
    format: 1,
    mode,
    status: "finished",
    players: { A: game.players.A, B: game.players.B },
    startingBoard: publicBoard(history[0].board),
    finalBoard: publicBoard(game.board),
    finalScores: { A: game.scores.A, B: game.scores.B },
    finalRacks: {
      A: game.rackA.map(displayToken).sort(),
      B: game.rackB.map(displayToken).sort()
    },
    clocks: {
      initial: { A: history[0].timers.A, B: history[0].timers.B },
      final: { A: game.timers.A, B: game.timers.B }
    },
    ...bot && game.botSide ? {
      bot: {
        displayName: PUBLIC_BOT_NAMES[bot.catalogId] ?? "Bot",
        version: bot.catalogVersion,
        ...bot.catalogId !== "stage5b" && bot.difficulty ? { difficulty: bot.difficulty } : {},
        ...bot.catalogId !== "stage5b" && bot.modelLevel ? { modelLevel: bot.modelLevel } : {}
      }
    } : {},
    ...provenance?.mode === "stage" && provenance.stage ? { stage: { levelId: provenance.stage.levelId } } : {},
    positions: projectedPositions,
    ...branches?.lines.length ? {
      branches: branches.lines.map((line) => {
        const fork = line.from ? forkPositions.get(line.from) : {
          board: publicBoard(history[0].board),
          scores: { A: history[0].scores.A, B: history[0].scores.B },
          clocks: { A: history[0].timers.A, B: history[0].timers.B },
          turn: history[0].turnNumber
        };
        return {
          fromTurn: fork?.turn ?? null,
          positions: [
            ...fork ? [fork] : [],
            ...line.logs.map((log) => forkPositions.get(log.id))
          ]
        };
      })
    } : {},
    turns: game.logs.map((log) => ({
      turn: log.turnNumber,
      side: log.side,
      action: log.action,
      score: log.finalScore,
      board: publicBoard(log.boardAfter),
      clockBefore: { A: log.timerBefore.A, B: log.timerBefore.B },
      clockAfter: { A: log.timerAfter.A, B: log.timerAfter.B },
      startedAt: log.startedAt,
      endedAt: log.endedAt
    }))
  };
}

// supabase/functions/migrate-saved-legacy/index.ts
var url = Deno.env.get("SUPABASE_URL");
var serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
var db = createClient(url, serviceKey, { auth: { persistSession: false } });
var uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function respond(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
Deno.serve(async (request) => {
  if (request.method !== "POST") return respond({ error: "Method not allowed." }, 405);
  if (request.headers.get("Authorization") !== `Bearer ${serviceKey}`)
    return respond({ error: "Service authorization required." }, 403);
  try {
    const body = await request.json();
    const userId = body.userId;
    const limit = body.limit === void 0 ? 25 : body.limit;
    const cursor = body.cursor;
    const dryRun = body.dryRun !== false;
    if (typeof userId !== "string" || !uuid.test(userId) || typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 50 || cursor && (typeof cursor.at !== "string" || !Number.isFinite(Date.parse(cursor.at)) || typeof cursor.id !== "string" || !uuid.test(cursor.id) || dryRun && (!Number.isInteger(cursor.activeAfter) || Number(cursor.activeAfter) < 0 || !Number.isInteger(cursor.capacity))))
      return respond({ error: "Invalid migration page." }, 400);
    const candidates = await db.rpc("list_private_migration_candidates", {
      p_user_id: userId,
      p_after_at: cursor?.at ?? null,
      p_after_id: cursor?.id ?? null,
      p_limit: limit
    });
    if (candidates.error) throw candidates.error;
    const context = await db.rpc("saved_migration_context", { p_user_id: userId });
    if (context.error) throw context.error;
    const capacity = Number(context.data?.[0]?.capacity);
    if (dryRun && cursor && cursor.capacity !== capacity)
      return respond({ error: "Saved capacity changed; restart the dry run." }, 409);
    let simulatedActive = dryRun && cursor ? Number(cursor.activeAfter) : Number(context.data?.[0]?.active_count ?? 0);
    const counts = {
      eligible: 0,
      active: 0,
      overflow: 0,
      trashed: 0,
      inProgressExcluded: cursor ? 0 : Number(context.data?.[0]?.in_progress_count ?? 0),
      ambiguousExcluded: 0,
      duplicateSkipped: 0,
      alreadyProcessed: 0
    };
    for (const row of candidates.data ?? []) {
      if (row.ledger_outcome) {
        counts.alreadyProcessed++;
        continue;
      }
      if (row.saved_state) {
        counts.duplicateSkipped++;
        continue;
      }
      if (row.source_scope !== "private" || row.source_id !== row.game_id || !row.participant_side || !row.snapshot || row.snapshot.v !== 3 || row.snapshot.status !== "finished") {
        counts.ambiguousExcluded++;
        continue;
      }
      try {
        const decoded = await readCompletedGame(JSON.stringify(row.snapshot));
        if (decoded.game.status !== "finished") throw new Error("not a complete v3 replay");
        const side = row.participant_side;
        const other = side === "A" ? "B" : "A";
        if (row.score_for !== null && decoded.game.scores[side] !== row.score_for || row.score_against !== null && decoded.game.scores[other] !== row.score_against)
          throw new Error("result mismatch");
        await projectStoredCompletedGame(
          row.snapshot,
          { scope: "private", ownerId: userId, participantIds: [], published: false },
          { userId, regionIds: [], approved: false, admin: false }
        );
      } catch {
        counts.ambiguousExcluded++;
        continue;
      }
      counts.eligible++;
      if (dryRun) {
        if (row.trashed_at) counts.trashed++;
        else if (simulatedActive < capacity) {
          counts.active++;
          simulatedActive++;
        } else counts.overflow++;
      } else {
        const migrated = await db.rpc("migrate_validated_private_item", {
          p_item_id: row.item_id,
          p_digest: row.source_digest
        });
        if (migrated.error) throw migrated.error;
        const outcome = migrated.data?.[0]?.outcome;
        if (outcome === "active" || outcome === "overflow" || outcome === "trashed")
          counts[outcome]++;
        else counts.duplicateSkipped++;
      }
    }
    const rows = candidates.data ?? [];
    const last = rows.at(-1);
    return respond({
      dryRun,
      counts,
      capacity,
      nextCursor: rows.length === limit && last ? { at: last.created_at, id: last.item_id, activeAfter: simulatedActive, capacity } : null
    });
  } catch (error) {
    console.error("Saved legacy migration failed", error);
    return respond({ error: "Migration page failed; no later page was run." }, 500);
  }
});
