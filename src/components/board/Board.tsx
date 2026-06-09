import {
  slotTypeAt,
  type BoardSnapshot,
  type PendingPlacement,
} from "../../game";
import { SLOT_LABELS } from "../../uiText";
import { Tile } from "./Tile";

export function Board({
  board,
  pendingPlacements,
  selectedRackTileId,
  selectedPendingTileId,
  onCellClick,
}: {
  board: BoardSnapshot;
  pendingPlacements: PendingPlacement[];
  selectedRackTileId: string | null;
  selectedPendingTileId: string | null;
  onCellClick: (row: number, col: number) => void;
}) {
  const pendingByKey = new Map(pendingPlacements.map((item) => [`${item.row}:${item.col}`, item]));
  return (
    <div className="board-frame">
      <div className="board-corner" aria-hidden="true" />
      <div className="board-col-labels" aria-hidden="true">
        {Array.from({ length: 15 }).map((_, index) => (
          <span key={index}>{index + 1}</span>
        ))}
      </div>
      <div className="board-row-labels" aria-hidden="true">
        {Array.from({ length: 15 }).map((_, index) => (
          <span key={index}>{index + 1}</span>
        ))}
      </div>
      <div className={`board ${selectedRackTileId || selectedPendingTileId ? "placing" : ""}`}>
        {board.map((row, rowIndex) =>
          row.map((cell, colIndex) => {
            const key = `${rowIndex}:${colIndex}`;
            const slot = slotTypeAt(rowIndex, colIndex);
            const label = SLOT_LABELS[slot];
            const pending = pendingByKey.get(key);
            const isCenter = slot === "px3star";
            return (
              <button
                className={`board-cell slot-${slot} ${cell ? "filled" : ""} ${pending ? "pending" : ""} ${
                  pending?.tile.id === selectedPendingTileId ? "pending-selected" : ""
                }`}
                key={key}
                type="button"
                onClick={() => onCellClick(rowIndex, colIndex)}
              >
                {cell ? (
                  // A placed tile fully covers the square — no premium pip/star behind it.
                  <Tile compact showPoint tile={cell.tile} />
                ) : (
                  label && (
                    <span className={`premium-label ${isCenter ? "star" : ""}`}>
                      {isCenter ? "★" : label}
                    </span>
                  )
                )}
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}
