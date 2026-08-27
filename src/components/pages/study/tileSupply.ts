// What the physical set still has left, given what is already on the board and
// in the rack.
//
// The engine derives the opponent's tiles and the bag by SUBTRACTION from this
// same set, so a position that over-spends a token is not merely untidy — it
// describes a game that cannot exist, and the service refuses it. Doing the
// arithmetic here as well means the player finds out while they are still
// typing rather than after they press Analyse.

import { AMATH_TOKENS, type AmathToken } from "../../../constants/tileDefinitions";
import type { BoardSnapshot, TileInstance } from "../../../game";

export const TOKEN_LIST = Object.keys(AMATH_TOKENS) as AmathToken[];

export const TOTAL_TILES = TOKEN_LIST.reduce(
  (total, token) => total + AMATH_TOKENS[token].count,
  0,
);

export type TokenUsage = Partial<Record<AmathToken, number>>;

export function countUsage(board: BoardSnapshot, rack: TileInstance[]): TokenUsage {
  const used: TokenUsage = {};
  const add = (token: AmathToken) => {
    used[token] = (used[token] ?? 0) + 1;
  };
  for (const row of board) {
    for (const cell of row) if (cell) add(cell.tile.token);
  }
  for (const tile of rack) add(tile.token);
  return used;
}

export function remainingOf(used: TokenUsage, token: AmathToken): number {
  return AMATH_TOKENS[token].count - (used[token] ?? 0);
}

export function tilesPlaced(used: TokenUsage): number {
  return TOKEN_LIST.reduce((total, token) => total + (used[token] ?? 0), 0);
}

/**
 * The hidden inventory, exactly as the service derives it.
 *
 * Restated here only to SHOW the player what the engine will be told — the
 * server never takes these numbers from the client. If the two ever disagree,
 * the server's answer is the one that is used, and this display is the bug.
 */
export function hiddenInventory(used: TokenUsage): { oppRackCount: number; bagCount: number } {
  const unseen = Math.max(0, TOTAL_TILES - tilesPlaced(used));
  const oppRackCount = Math.min(8, unseen);
  return { oppRackCount, bagCount: unseen - oppRackCount };
}
