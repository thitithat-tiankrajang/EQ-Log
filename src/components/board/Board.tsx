import { ArrowDown, ArrowRight } from "lucide-react";
import {
  slotTypeAt,
  type BoardSnapshot,
  type PendingPlacement,
} from "../../game";
import { SLOT_LABELS } from "../../uiText";
import { Tile } from "./Tile";

type PlacementCursor = { row: number; col: number; dir: "right" | "down" } | null;

export function Board({
  board,
  pendingPlacements,
  placementCursor = null,
  scoringKeys,
  selectedRackTileId,
  selectedPendingTileId,
  onCellClick,
}: {
  board: BoardSnapshot;
  pendingPlacements: PendingPlacement[];
  placementCursor?: PlacementCursor;
  scoringKeys?: Set<string>;
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
            const isCursor = placementCursor && placementCursor.row === rowIndex && placementCursor.col === colIndex;
            const isScoring = scoringKeys?.has(key) ?? false;
            return (
              <button
                className={`board-cell slot-${slot} ${cell ? "filled" : ""} ${pending ? "pending" : ""} ${
                  pending?.tile.id === selectedPendingTileId ? "pending-selected" : ""
                } ${isCursor ? `cursor cursor-${placementCursor!.dir}` : ""} ${isScoring ? "scoring" : ""}`}
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
                {isCursor && !cell && (
                  <span className="board-cell-cursor" aria-hidden="true">
                    {placementCursor!.dir === "right" ? <ArrowRight size={20} /> : <ArrowDown size={20} />}
                  </span>
                )}
              </button>
            );
          }),
        )}
      </div>
    </div>
  );
}
