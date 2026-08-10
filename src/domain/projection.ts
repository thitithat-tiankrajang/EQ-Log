// ── The seam between canonical truth and the rendered game ───────────────────
//
// The UI, the rules engine and the replay log all speak in `TileInstance`
// objects and a 15×15 board array. Canonical state speaks in ordinals and one
// placement table. This module translates, in one place, in both directions.
//
// The direction that matters most is `canonicalFrom…`: it is where data of
// unknown provenance — a room saved by an older build, a snapshot restored
// from storage — is checked against the physical set. A state that does not
// describe 100 tiles is REPORTED here. It is never rounded off, topped up, or
// deduplicated into something that merely looks plausible, because a game that
// has silently lost a tile is not recoverable by guessing which one.

import { BOARD_SIZE } from "../constants/gameRules";
import type { BoardSnapshot, GameSnapshot, TileInstance } from "../game";
import {
  type Inventory,
  InventoryError,
  type Side,
  type TilePlacement,
  assertInventory,
  bagOrder,
  boardTiles,
  normalizeInventory,
  pendingReturnOrder,
  rackOrder,
} from "./inventory";
import {
  TILE_COUNT,
  type TileOrdinal,
  tileIdOf,
  tokenAcceptsAssignment,
  tokenOfOrdinal,
  tryOrdinalOfTileId,
} from "./tiles";
import type { CanonicalState } from "./canonical";

// ── Canonical → rendered ─────────────────────────────────────────────────────

export function tileInstanceOf(ordinal: TileOrdinal, assigned?: string): TileInstance {
  const tile: TileInstance = { id: tileIdOf(ordinal), token: tokenOfOrdinal(ordinal) };
  return assigned === undefined ? tile : { ...tile, assignedToken: assigned };
}

export function tileInstancesOf(ordinals: readonly TileOrdinal[]): TileInstance[] {
  return ordinals.map((ordinal) => tileInstanceOf(ordinal));
}

export function toBoardSnapshot(inventory: Inventory): BoardSnapshot {
  const board: BoardSnapshot = Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => null),
  );
  for (const tile of boardTiles(inventory)) {
    board[tile.row][tile.col] = {
      tile: tileInstanceOf(tile.ordinal, tile.assigned),
      placedTurn: tile.placedTurn,
      side: tile.by,
    };
  }
  return board;
}

/** Overlay canonical physical truth onto a rendered snapshot, leaving the
 *  non-physical fields (name, timers, logs, match control) untouched. */
export function applyCanonicalToSnapshot<T extends GameSnapshot>(
  snapshot: T,
  canonical: CanonicalState,
): T {
  const pendingA = tileInstancesOf(pendingReturnOrder(canonical.inventory, "A"));
  const pendingB = tileInstancesOf(pendingReturnOrder(canonical.inventory, "B"));
  return {
    ...snapshot,
    gameId: canonical.gameId,
    board: toBoardSnapshot(canonical.inventory),
    rackA: tileInstancesOf(rackOrder(canonical.inventory, "A")),
    rackB: tileInstancesOf(rackOrder(canonical.inventory, "B")),
    tilebag: tileInstancesOf(bagOrder(canonical.inventory)),
    pendingExchangeReturn: [...pendingA, ...pendingB],
    pendingExchangeReturnBySide: { A: pendingA, B: pendingB },
    turnNumber: canonical.turnNumber,
    activeSide: canonical.activeSide,
    phase: canonical.phase,
    status: canonical.status,
    scores: { ...canonical.scores },
    startingSide: canonical.startingSide,
    gameMode: canonical.gameMode,
    tileDrawMode: canonical.drawMode,
  };
}

// ── Rendered → canonical ─────────────────────────────────────────────────────

export type InventorySource = {
  tilebag: readonly TileInstance[];
  rackA: readonly TileInstance[];
  rackB: readonly TileInstance[];
  board: BoardSnapshot;
  pendingReturnA?: readonly TileInstance[];
  pendingReturnB?: readonly TileInstance[];
};

/**
 * Read a rendered game back into the closed inventory.
 *
 * Throws `InventoryError` listing every problem when the source does not
 * describe the physical set: an unknown tile id, the same tile in two places,
 * or a tile that appears nowhere at all.
 */
export function inventoryFrom(source: InventorySource): Inventory {
  const slots = new Array<TilePlacement | undefined>(TILE_COUNT);
  const problems: string[] = [];
  const claimedBy = new Map<TileOrdinal, string>();

  const claim = (tile: TileInstance, where: string, placement: TilePlacement) => {
    const ordinal = tryOrdinalOfTileId(tile.id);
    if (ordinal === null) {
      problems.push(`"${tile.id}" in ${where} is not a tile of the physical set.`);
      return;
    }
    if (tokenOfOrdinal(ordinal) !== tile.token) {
      problems.push(
        `${tile.id} in ${where} claims to be "${tile.token}" but that tile is a "${tokenOfOrdinal(ordinal)}".`,
      );
      return;
    }
    const previous = claimedBy.get(ordinal);
    if (previous !== undefined) {
      problems.push(`${tile.id} is in both ${previous} and ${where}.`);
      return;
    }
    claimedBy.set(ordinal, where);
    slots[ordinal] = placement;
  };

  source.tilebag.forEach((tile, seq) => claim(tile, "the bag", { at: "bag", seq }));
  source.rackA.forEach((tile, seq) => claim(tile, "rack A", { at: "rack", side: "A", seq }));
  source.rackB.forEach((tile, seq) => claim(tile, "rack B", { at: "rack", side: "B", seq }));
  (source.pendingReturnA ?? []).forEach((tile, seq) =>
    claim(tile, "A's exchanged tiles", { at: "pendingReturn", side: "A", seq }),
  );
  (source.pendingReturnB ?? []).forEach((tile, seq) =>
    claim(tile, "B's exchanged tiles", { at: "pendingReturn", side: "B", seq }),
  );

  source.board.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      if (!cell) return;
      const assigned = cell.tile.assignedToken;
      const ordinal = tryOrdinalOfTileId(cell.tile.id);
      const keepsFace =
        assigned !== undefined &&
        ordinal !== null &&
        tokenAcceptsAssignment(tokenOfOrdinal(ordinal));
      claim(cell.tile, `board square (${rowIndex}, ${colIndex})`, {
        at: "board",
        row: rowIndex,
        col: colIndex,
        placedTurn: cell.placedTurn,
        by: cell.side as Side,
        ...(keepsFace ? { assigned } : {}),
      });
    });
  });

  const missing: string[] = [];
  for (let ordinal = 0; ordinal < TILE_COUNT; ordinal += 1) {
    if (slots[ordinal] === undefined) missing.push(tileIdOf(ordinal));
  }
  if (missing.length > 0) {
    problems.push(
      missing.length > 6
        ? `${missing.length} tiles are in no location at all (${missing.slice(0, 6).join(", ")}, …).`
        : `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} in no location at all.`,
    );
  }

  if (problems.length > 0) {
    throw new InventoryError("This game does not describe the 100-tile set", problems);
  }

  return assertInventory(normalizeInventory(slots as Inventory), "recovered state");
}

/**
 * Recover canonical state from a rendered snapshot — the migration path for a
 * live game that predates revisions. `revision` is supplied by the caller,
 * since a rendered snapshot has no position of its own.
 */
export function canonicalFromSnapshot(
  snapshot: GameSnapshot,
  revision: number,
): CanonicalState {
  const inventory = inventoryFrom({
    tilebag: snapshot.tilebag,
    rackA: snapshot.rackA,
    rackB: snapshot.rackB,
    board: snapshot.board,
    pendingReturnA: snapshot.pendingExchangeReturnBySide?.A ?? [],
    pendingReturnB: snapshot.pendingExchangeReturnBySide?.B ?? [],
  });
  return Object.freeze({
    gameId: snapshot.gameId,
    revision,
    inventory,
    gameMode: snapshot.gameMode === "solo" ? "solo" : "versus",
    drawMode: snapshot.tileDrawMode === "play" ? "play" : "manual",
    startingSide: (snapshot.startingSide ?? snapshot.activeSide) as Side,
    turnNumber: snapshot.turnNumber,
    activeSide: snapshot.activeSide,
    phase: snapshot.phase,
    status: snapshot.status,
    scores: Object.freeze({ ...snapshot.scores }),
    appliedCommands: Object.freeze([]),
  });
}

// ── Wire form ────────────────────────────────────────────────────────────────

/** Canonical state is already plain data; this only fixes key order so two
 *  writers of the same state produce the same bytes. */
export function encodeCanonical(state: CanonicalState): Record<string, unknown> {
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
    inventory: normalizeInventory(state.inventory),
  };
}

/**
 * Read canonical state off the wire, proving it is a lawful 100-tile placement
 * before anything is allowed to render or build on it.
 */
export function decodeCanonical(payload: unknown): CanonicalState {
  if (!payload || typeof payload !== "object") {
    throw new InventoryError("Canonical state is missing.");
  }
  const raw = payload as Record<string, unknown>;
  const inventory = raw.inventory;
  if (!Array.isArray(inventory)) {
    throw new InventoryError("Canonical state carries no tile placements.");
  }
  const scores = (raw.scores ?? {}) as Record<string, unknown>;
  return Object.freeze({
    gameId: String(raw.gameId ?? ""),
    revision: Number(raw.revision ?? 0),
    // Proven lawful BEFORE it is normalized: normalizing an inventory that is
    // not the physical set would be interpreting data we have not accepted.
    inventory: normalizeInventory(
      assertInventory(inventory as Inventory, "state received from the server"),
    ),
    gameMode: raw.gameMode === "solo" ? "solo" : "versus",
    drawMode: raw.drawMode === "play" ? "play" : "manual",
    startingSide: raw.startingSide === "B" ? "B" : "A",
    turnNumber: Number(raw.turnNumber ?? 1),
    activeSide: raw.activeSide === "B" ? "B" : "A",
    phase: (raw.phase ?? "choose_action") as CanonicalState["phase"],
    status: (raw.status ?? "playing") as CanonicalState["status"],
    scores: Object.freeze({ A: Number(scores.A ?? 0), B: Number(scores.B ?? 0) }),
    appliedCommands: Object.freeze(
      Array.isArray(raw.appliedCommands) ? raw.appliedCommands.map(String) : [],
    ),
  });
}
