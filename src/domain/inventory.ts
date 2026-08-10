// ── The closed physical inventory ────────────────────────────────────────────
//
// The whereabouts of all 100 physical tiles is ONE value: a fixed-length table
// indexed by tile ordinal, where every entry is that tile's single authoritative
// location.
//
//   inventory[ordinal] = where physical tile `ordinal` currently is
//
// Choosing this representation (rather than "a bag list, a rack list, a board
// grid" that must be kept mutually consistent) makes the hard requirements
// structural rather than checked:
//
//   • exactly 100 tiles              — the table has exactly 100 slots
//   • all ids unique                 — the index IS the identity
//   • exactly one location per tile  — one slot holds one location
//   • never lost / never duplicated  — a move overwrites a slot; it cannot
//                                      add or remove one
//   • intrinsic type never mutates   — the token is derived from the index
//
// What remains genuinely checkable — and is checked on every committed
// transition by `assertInventory` — is the well-formedness of the locations
// themselves: no two tiles on one board square, ordering keys dense and
// distinct, racks within size, assigned faces only where the rules allow one.
//
// The physical invariant in the vocabulary of this domain is therefore:
//
//   bag ⊎ rackA ⊎ rackB ⊎ pendingReturnA ⊎ pendingReturnB ⊎ board
//     = exactly the 100 tiles of the manifest, each in exactly one place.
//
// `pendingReturn` is a real physical location, not a bookkeeping artifact: an
// exchanged-out tile has left the player's rack and has not yet re-entered the
// bag (it re-enters only once that side's next draw completes, so it cannot be
// drawn back immediately). Omitting it from the invariant is what allows tiles
// to appear to vanish mid-exchange.

import { BOARD_SIZE, RACK_SIZE } from "../constants/gameRules";
import {
  ALL_ORDINALS,
  TILE_COUNT,
  type TileOrdinal,
  tileIdOf,
  tokenAcceptsAssignment,
  tokenOfOrdinal,
} from "./tiles";

export type Side = "A" | "B";

export const SIDES: readonly Side[] = ["A", "B"];

/** Where one physical tile is. Exactly one of these per tile, always. */
export type TilePlacement =
  | { at: "bag"; seq: number }
  | { at: "rack"; side: Side; seq: number }
  | { at: "pendingReturn"; side: Side; seq: number }
  | {
      at: "board";
      row: number;
      col: number;
      placedTurn: number;
      by: Side;
      /** The face a blank/choice tile was played as. Belongs to the placement:
       *  it describes how the tile is being used, not what the tile is. */
      assigned?: string;
    };

export type PlacementKind = TilePlacement["at"];

/** The whole physical set. Always exactly TILE_COUNT entries; index = ordinal. */
export type Inventory = readonly TilePlacement[];

/** Raised when a canonical state would violate the physical invariant. Carries
 *  enough detail to diagnose without guessing — we never silently repair. */
export class InventoryError extends Error {
  readonly details: readonly string[];

  constructor(message: string, details: readonly string[] = []) {
    super(details.length > 0 ? `${message} (${details.join("; ")})` : message);
    this.name = "InventoryError";
    this.details = details;
  }
}

// ── Construction ─────────────────────────────────────────────────────────────

/**
 * Every tile in the bag, in the given draw order.
 *
 * `bagOrder` must be a permutation of all 100 ordinals: a game that does not
 * start from the complete physical set can never satisfy the invariant later.
 */
export function createInventory(bagOrder: readonly TileOrdinal[]): Inventory {
  if (bagOrder.length !== TILE_COUNT) {
    throw new InventoryError(
      `A new game must start from all ${TILE_COUNT} tiles, received ${bagOrder.length}.`,
    );
  }
  const inventory = new Array<TilePlacement | undefined>(TILE_COUNT);
  bagOrder.forEach((ordinal, seq) => {
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= TILE_COUNT) {
      throw new InventoryError(`Bag order contains ${ordinal}, which is not a tile ordinal.`);
    }
    if (inventory[ordinal] !== undefined) {
      throw new InventoryError(`Bag order lists ${tileIdOf(ordinal)} more than once.`);
    }
    inventory[ordinal] = { at: "bag", seq };
  });
  return Object.freeze(inventory as TilePlacement[]);
}

// ── Ordered views ────────────────────────────────────────────────────────────

function orderedOrdinals(
  inventory: Inventory,
  match: (placement: TilePlacement) => number | null,
): TileOrdinal[] {
  const entries: Array<{ ordinal: TileOrdinal; seq: number }> = [];
  for (const ordinal of ALL_ORDINALS) {
    // Tolerates a malformed value so that reading one produces an
    // `InventoryError` naming the problem rather than a TypeError from here.
    const placement = inventory[ordinal] as TilePlacement | undefined;
    const seq = placement ? match(placement) : null;
    if (seq !== null) entries.push({ ordinal, seq });
  }
  entries.sort((first, second) => first.seq - second.seq || first.ordinal - second.ordinal);
  return entries.map((entry) => entry.ordinal);
}

/** Draw order of the bag: index 0 is the next tile out. */
export function bagOrder(inventory: Inventory): TileOrdinal[] {
  return orderedOrdinals(inventory, (placement) => (placement.at === "bag" ? placement.seq : null));
}

export function rackOrder(inventory: Inventory, side: Side): TileOrdinal[] {
  return orderedOrdinals(inventory, (placement) =>
    placement.at === "rack" && placement.side === side ? placement.seq : null,
  );
}

export function pendingReturnOrder(inventory: Inventory, side: Side): TileOrdinal[] {
  return orderedOrdinals(inventory, (placement) =>
    placement.at === "pendingReturn" && placement.side === side ? placement.seq : null,
  );
}

export type BoardTile = {
  ordinal: TileOrdinal;
  row: number;
  col: number;
  placedTurn: number;
  by: Side;
  assigned?: string;
};

/** Committed board tiles, in a deterministic (row-major) order. */
export function boardTiles(inventory: Inventory): BoardTile[] {
  const tiles: BoardTile[] = [];
  for (const ordinal of ALL_ORDINALS) {
    const placement = inventory[ordinal];
    if (placement.at !== "board") continue;
    tiles.push({
      ordinal,
      row: placement.row,
      col: placement.col,
      placedTurn: placement.placedTurn,
      by: placement.by,
      assigned: placement.assigned,
    });
  }
  tiles.sort((first, second) => first.row - second.row || first.col - second.col);
  return tiles;
}

export function countAt(inventory: Inventory, kind: PlacementKind): number {
  let total = 0;
  for (const ordinal of ALL_ORDINALS) {
    if (inventory[ordinal].at === kind) total += 1;
  }
  return total;
}

// ── Canonical form ───────────────────────────────────────────────────────────

/**
 * Renumber ordering keys to 0..n-1 within each ordered location, preserving
 * relative order.
 *
 * This gives the inventory a UNIQUE canonical form: two clients that reached
 * the same physical state by different routes serialize to identical bytes, so
 * "observers at revision N agree" is decidable by comparison rather than by
 * heuristics.
 */
export function normalizeInventory(inventory: Inventory): Inventory {
  const next = inventory.slice() as TilePlacement[];
  const renumber = (ordinals: readonly TileOrdinal[], rewrite: (seq: number) => TilePlacement) => {
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

// ── Verification ─────────────────────────────────────────────────────────────

/**
 * Prove that a value really is a lawful placement of the closed physical set.
 * Returns every problem found rather than the first, so a corrupt state can be
 * diagnosed in one pass.
 */
export function inventoryProblems(inventory: Inventory): string[] {
  const problems: string[] = [];

  if (!Array.isArray(inventory) || inventory.length !== TILE_COUNT) {
    problems.push(
      `The inventory must account for exactly ${TILE_COUNT} tiles, found ${
        Array.isArray(inventory) ? inventory.length : "a non-array value"
      }.`,
    );
    return problems;
  }

  const occupiedSquares = new Map<string, TileOrdinal>();
  const seqSeen: Record<string, Set<number>> = {};
  const counts: Record<string, number> = {};

  const noteSeq = (bucket: string, seq: number, ordinal: TileOrdinal) => {
    counts[bucket] = (counts[bucket] ?? 0) + 1;
    if (!Number.isInteger(seq) || seq < 0) {
      problems.push(`${tileIdOf(ordinal)} has a non-ordinal position ${seq} in ${bucket}.`);
      return;
    }
    const seen = (seqSeen[bucket] ??= new Set());
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
        if (
          !Number.isInteger(row) ||
          !Number.isInteger(col) ||
          row < 0 ||
          col < 0 ||
          row >= BOARD_SIZE ||
          col >= BOARD_SIZE
        ) {
          problems.push(`${tileIdOf(ordinal)} is on a board square (${row}, ${col}) off the board.`);
          break;
        }
        const square = `${row}:${col}`;
        const other = occupiedSquares.get(square);
        if (other !== undefined) {
          problems.push(
            `${tileIdOf(other)} and ${tileIdOf(ordinal)} both occupy board square (${row}, ${col}).`,
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
          `${tileIdOf(ordinal)} is in "${(placement as { at: string }).at}", which is not a location.`,
        );
    }

    // A chosen face is only meaningful for a tile that has one, and only while
    // that tile is committed to the board. Anywhere else it would be a silent
    // mutation of the tile's apparent value.
    const assigned = placement.at === "board" ? placement.assigned : undefined;
    if (assigned !== undefined && !tokenAcceptsAssignment(tokenOfOrdinal(ordinal))) {
      problems.push(
        `${tileIdOf(ordinal)} is a fixed "${tokenOfOrdinal(ordinal)}" tile but claims the face "${assigned}".`,
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

/**
 * The gate every committed state must pass. Throws with diagnostics rather
 * than repairing: an impossible physical state is a bug to be reported, and
 * inventing or deleting a tile to make the numbers work would destroy the very
 * thing the invariant protects.
 */
export function assertInventory(inventory: Inventory, context = "canonical state"): Inventory {
  const problems = inventoryProblems(inventory);
  if (problems.length > 0) {
    throw new InventoryError(`The ${context} does not describe the 100-tile set`, problems);
  }
  return inventory;
}

// ── Transitions ──────────────────────────────────────────────────────────────

/** One tile changing location. A transition is a set of these applied together. */
export type TileMove = { ordinal: TileOrdinal; to: TilePlacement };

/**
 * Apply a set of tile moves as ONE transition.
 *
 * The input inventory is never mutated and the result is only returned once it
 * has been normalized and proven lawful — so a rejected transition leaves the
 * caller holding exactly the state it started with. There is no intermediate
 * value in which some tiles have moved and others have not.
 */
export function applyMoves(
  inventory: Inventory,
  moves: readonly TileMove[],
  context = "transition",
): Inventory {
  const next = inventory.slice() as TilePlacement[];
  const touched = new Set<TileOrdinal>();
  for (const move of moves) {
    if (!Number.isInteger(move.ordinal) || move.ordinal < 0 || move.ordinal >= TILE_COUNT) {
      throw new InventoryError(`A ${context} tried to move ${move.ordinal}, which is not a tile.`);
    }
    if (touched.has(move.ordinal)) {
      throw new InventoryError(
        `A ${context} moved ${tileIdOf(move.ordinal)} to two places at once.`,
      );
    }
    touched.add(move.ordinal);
    next[move.ordinal] = move.to;
  }
  return assertInventory(normalizeInventory(Object.freeze(next)), context);
}

/** Ordering key that appends to the end of an ordered location. */
export function appendSeq(inventory: Inventory, kind: "bag"): number;
export function appendSeq(
  inventory: Inventory,
  kind: "rack" | "pendingReturn",
  side: Side,
): number;
export function appendSeq(
  inventory: Inventory,
  kind: "bag" | "rack" | "pendingReturn",
  side?: Side,
): number {
  if (kind === "bag") return bagOrder(inventory).length;
  return kind === "rack"
    ? rackOrder(inventory, side as Side).length
    : pendingReturnOrder(inventory, side as Side).length;
}
