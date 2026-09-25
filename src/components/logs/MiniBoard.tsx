import { memo } from "react";
import { BOARD_LAYOUT, displayToken, type BoardSnapshot } from "../../game";

/**
 * A board to look at, not to play on: the map's preview of a turn.
 *
 * Plain cells rather than the play `Board`, which is 225 interactive buttons with drag, cursor
 * and scoring state — all of it cost, none of it wanted in a thumbnail. The squares keep their
 * premium colours so a position is recognisable at a glance, and the tiles a turn placed are
 * marked so "what happened here" reads without the log.
 */
export const MiniBoard = memo(function MiniBoard({
  board,
  highlight,
  label,
}: {
  board: BoardSnapshot;
  /** `row:col` of the cells to mark: the turn's own tiles. */
  highlight?: ReadonlySet<string>;
  label: string;
}) {
  return (
    <div className="mini-board" role="img" aria-label={label}>
      {board.map((cells, row) =>
        cells.map((cell, col) => {
          const key = `${row}:${col}`;
          const slot = BOARD_LAYOUT[row]?.[col] ?? "px1";
          return (
            <span
              key={key}
              className={`mini-cell slot-${slot}${cell ? ` has-tile side-${cell.side.toLowerCase()}` : ""}${
                highlight?.has(key) ? " is-new" : ""
              }`}
            >
              {cell ? displayToken(cell.tile) : ""}
            </span>
          );
        }),
      )}
    </div>
  );
});
