import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";
import { useRef, type CSSProperties } from "react";
import {
  slotTypeAt,
  tileNeedsAssignment,
  type BoardSnapshot,
  type PendingPlacement,
} from "../../game";
import { SLOT_LABELS } from "../../uiText";
import { Tile } from "./Tile";

type Direction = "right" | "down" | "left" | "up";
type PlacementCursor = { row: number; col: number; dir: Direction } | null;

export type BoardScoreAnchor = {
  row: number;
  col: number;
  orientation: "horizontal" | "vertical";
  side: "left" | "right" | "above" | "below";
  alignX: "start" | "end";
  alignY: "start" | "end";
  score: number;
  isValid: boolean;
};

export function Board({
  board,
  pendingPlacements,
  placementCursor = null,
  scoreAnchor = null,
  scoringKeys,
  selectedRackTileId,
  selectedPendingTileId,
  onCellClick,
  onPendingAssignmentEdit,
}: {
  board: BoardSnapshot;
  pendingPlacements: PendingPlacement[];
  placementCursor?: PlacementCursor;
  scoreAnchor?: BoardScoreAnchor | null;
  scoringKeys?: Set<string>;
  selectedRackTileId: string | null;
  selectedPendingTileId: string | null;
  onCellClick: (row: number, col: number) => void;
  onPendingAssignmentEdit?: (tileId: string) => void;
}) {
  const pendingByKey = new Map(pendingPlacements.map((item) => [`${item.row}:${item.col}`, item]));
  const editPressTimerRef = useRef<number | null>(null);
  const suppressClickKeyRef = useRef<string | null>(null);

  const clearEditPress = () => {
    if (editPressTimerRef.current !== null) {
      window.clearTimeout(editPressTimerRef.current);
      editPressTimerRef.current = null;
    }
  };

  const startEditPress = (pending: PendingPlacement | undefined, key: string) => {
    clearEditPress();
    if (!pending || !onPendingAssignmentEdit || !tileNeedsAssignment(pending.tile.token)) return;
    editPressTimerRef.current = window.setTimeout(() => {
      suppressClickKeyRef.current = key;
      onPendingAssignmentEdit(pending.tile.id);
      editPressTimerRef.current = null;
    }, 520);
  };

  const openAssignmentEditor = (pending: PendingPlacement | undefined, key: string) => {
    if (!pending || !onPendingAssignmentEdit || !tileNeedsAssignment(pending.tile.token)) return;
    clearEditPress();
    suppressClickKeyRef.current = key;
    onPendingAssignmentEdit(pending.tile.id);
  };

  const handleCellClick = (row: number, col: number, key: string) => {
    if (suppressClickKeyRef.current === key) {
      suppressClickKeyRef.current = null;
      return;
    }
    onCellClick(row, col);
  };

  return (
    <div className="board-frame">
      <div className="board-corner" aria-hidden="true" />
      <div className="board-col-labels" aria-hidden="true">
        {Array.from({ length: 15 }).map((_, index) => (
          <span key={index}>C{index + 1}</span>
        ))}
      </div>
      <div className="board-row-labels" aria-hidden="true">
        {Array.from({ length: 15 }).map((_, index) => (
          <span key={index}>R{index + 1}</span>
        ))}
      </div>
      <div className="board-grid-wrap">
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
              const isAssignablePending = Boolean(pending && tileNeedsAssignment(pending.tile.token));
              return (
                <button
                  className={`board-cell slot-${slot} ${cell ? "filled" : ""} ${pending ? "pending" : ""} ${
                    pending?.tile.id === selectedPendingTileId ? "pending-selected" : ""
                  } ${isCursor ? `cursor cursor-${placementCursor!.dir}` : ""} ${isScoring ? "scoring" : ""} ${
                    isAssignablePending ? "assignable-pending" : ""
                  }`}
                  key={key}
                  type="button"
                  title={isAssignablePending ? "Hold to change this tile value. Press E when selected." : undefined}
                  onClick={() => handleCellClick(rowIndex, colIndex, key)}
                  onDoubleClick={() => openAssignmentEditor(pending, key)}
                  onPointerCancel={clearEditPress}
                  onPointerDown={() => startEditPress(pending, key)}
                  onPointerLeave={clearEditPress}
                  onPointerUp={clearEditPress}
                >
                  {cell ? (
                    // A placed tile fully covers the square — no premium pip/star behind it.
                    <Tile compact showPoint tile={cell.tile} />
                  ) : isCursor ? (
                    <span className="board-cell-cursor" aria-hidden="true">
                      {(() => {
                        const dir = placementCursor!.dir;
                        if (dir === "right") return <ArrowRight size={22} />;
                        if (dir === "down") return <ArrowDown size={22} />;
                        if (dir === "left") return <ArrowLeft size={22} />;
                        return <ArrowUp size={22} />;
                      })()}
                    </span>
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
          {scoreAnchor && (
            <span
              className={`board-score-badge ${scoreAnchor.orientation} side-${scoreAnchor.side} align-x-${
                scoreAnchor.alignX
              } align-y-${scoreAnchor.alignY} ${scoreAnchor.isValid ? "valid" : "invalid"}`}
              style={
                {
                  "--badge-row": scoreAnchor.row + 1,
                  "--badge-col": scoreAnchor.col + 1,
                } as CSSProperties
              }
              aria-hidden="true"
            >
              {scoreAnchor.score} <small>pts</small>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
