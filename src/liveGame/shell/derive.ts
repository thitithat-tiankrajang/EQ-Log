import {
  AMATH_TOKENS,
  displayToken,
  type AmathToken,
  type BoardSnapshot,
  type Side,
  type TileInstance,
} from "../../game";
import type { RankedTurnView } from "../../features/ranked/publicView";

/** The latest committed outcome, built only from public logs. Tentative tiles never enter it. */
export type LastMove = {
  id: string;
  turnNumber: number;
  side: Side;
  kind: "place" | "exchange" | "pass";
  score: number;
  exchangedCount: number;
  cells: { row: number; col: number }[];
  /** The main line the move made, e.g. "12=4×3". */
  expression: string | null;
  /** The same line as tile faces, for glyph rendering. */
  faces: string[];
};

function placedCells(log: RankedTurnView) {
  const cells: { row: number; col: number }[] = [];
  log.boardAfter.forEach((row, r) =>
    row.forEach((cell, c) => {
      if (!cell) return;
      const before = log.boardBefore?.[r]?.[c];
      const added = log.boardBefore
        ? !before
        : cell.placedTurn === log.turnNumber && cell.side === log.side;
      if (added) cells.push({ row: r, col: c });
    }),
  );
  return cells;
}

function lineThrough(board: BoardSnapshot, cells: { row: number; col: number }[]): string[] {
  if (cells.length === 0) return [];
  const run = (horizontal: boolean) => {
    const { row, col } = cells[0];
    const at = (offset: number) =>
      horizontal ? board[row]?.[col + offset] : board[row + offset]?.[col];
    let start = 0;
    while (at(start - 1)) start -= 1;
    let end = 0;
    while (at(end + 1)) end += 1;
    const tiles: string[] = [];
    for (let offset = start; offset <= end; offset += 1) tiles.push(displayToken(at(offset)!.tile));
    return tiles;
  };
  const horizontal =
    cells.length > 1
      ? cells.every((cell) => cell.row === cells[0].row)
      : run(true).length >= run(false).length;
  const tiles = run(horizontal);
  return tiles.length > 1 ? tiles : [];
}

/** One committed turn as the player reads it. */
export function moveOf(log: RankedTurnView): LastMove {
  const kind =
    log.action === "place_equation" ? "place" : log.action === "exchange" ? "exchange" : "pass";
  const cells = kind === "place" ? placedCells(log) : [];
  const faces = kind === "place" ? lineThrough(log.boardAfter, cells) : [];
  return {
    id: log.id,
    turnNumber: log.turnNumber,
    side: log.side,
    kind,
    score: log.score,
    exchangedCount: log.exchangedCount,
    cells,
    expression: faces.length ? faces.join("") : null,
    faces,
  };
}

export function deriveLastMove(logs: readonly RankedTurnView[]): LastMove | null {
  const log = [...logs].reverse().find((item) => item.action !== "end_game");
  return log ? moveOf(log) : null;
}

export const TOKEN_ORDER = Object.keys(AMATH_TOKENS) as AmathToken[];

/**
 * Tiles the viewer cannot see: the full set minus the public board minus every
 * rack the viewer is entitled to. Derived from the recipient projection only;
 * it never reads a bag. For a player it is bag + opponent rack; for a Physical
 * host, who sees both racks, it is the bag's composition (never its order).
 */
export function unseenPool(board: BoardSnapshot, knownRacks: readonly (readonly TileInstance[])[]) {
  const counts = new Map<AmathToken, number>(
    TOKEN_ORDER.map((token) => [token, AMATH_TOKENS[token].count]),
  );
  const take = (token: AmathToken) => counts.set(token, Math.max(0, (counts.get(token) ?? 0) - 1));
  for (const row of board) for (const cell of row) if (cell) take(cell.tile.token);
  for (const rack of knownRacks) for (const tile of rack) take(tile.token);
  let total = 0;
  for (const value of counts.values()) total += value;
  return { counts, total };
}
