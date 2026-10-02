import type { BoardSnapshot, TileInstance } from "../game";

/** Public board coordinates carry no private physical inventory references. */
export function visibleBoard(board: BoardSnapshot): BoardSnapshot {
  return board.map((row, r) =>
    row.map((cell, c) =>
      cell
        ? {
            side: cell.side,
            placedTurn: cell.placedTurn,
            tile: {
              id: `board:${r}:${c}`,
              token: cell.tile.token,
              ...(cell.tile.assignedToken ? { assignedToken: cell.tile.assignedToken } : {}),
            },
          }
        : null,
    ),
  );
}

export function ownTiles(tiles: TileInstance[]): TileInstance[] {
  return tiles.map(({ id, token }) => ({ id, token }));
}
