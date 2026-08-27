import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";
import { memo, useRef, type CSSProperties } from "react";
import {
  slotTypeAt,
  tileNeedsAssignment,
  type BoardSnapshot,
  type PendingPlacement,
} from "../../game";
import { SLOT_LABELS } from "../../uiText";
import { BOARD_SIZE } from "../../constants/gameRules";
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

type BoardProps = {
  board: BoardSnapshot;
  pendingPlacements: PendingPlacement[];
  placementCursor?: PlacementCursor;
  scoreAnchor?: BoardScoreAnchor | null;
  scoringKeys?: Set<string>;
  selectedRackTileId: string | null;
  selectedPendingTileId: string | null;
  /** Must be stable across renders — see `sameBoardPicture`. */
  onCellClick: (row: number, col: number) => void;
  /** Must be stable across renders — see `sameBoardPicture`. */
  onPendingAssignmentEdit?: (tileId: string) => void;
};

/**
 * Are two renders of the board the same picture?
 *
 * The board is 225 buttons, and the component that owns it re-renders on every
 * keystroke, every tile selection and every clock tick — none of which change
 * what the grid looks like. Comparing the props costs a few hundred reference
 * checks; skipping the render saves rebuilding and reconciling 225 elements.
 *
 * Two props are deliberately NOT compared: `onCellClick` and
 * `onPendingAssignmentEdit`. Callers must pass STABLE callbacks (see the ref
 * indirection in App), because a fresh closure per render would defeat this
 * comparison entirely. A stable callback that reads current state through a ref
 * is always up to date, so ignoring its identity is safe.
 *
 * `board` is compared cell by cell rather than by identity on purpose: while a
 * move is being composed the caller rebuilds the array every render
 * (`boardWithPending`), so its identity is never stable even when every square
 * on it is.
 */
function sameBoardPicture(a: BoardProps, b: BoardProps): boolean {
  if (
    a.selectedRackTileId !== b.selectedRackTileId ||
    a.selectedPendingTileId !== b.selectedPendingTileId
  ) {
    return false;
  }

  const ac = a.placementCursor;
  const bc = b.placementCursor;
  if (ac !== bc && (!ac || !bc || ac.row !== bc.row || ac.col !== bc.col || ac.dir !== bc.dir)) {
    return false;
  }

  const aa = a.scoreAnchor;
  const ba = b.scoreAnchor;
  if (aa !== ba) {
    if (!aa || !ba) return false;
    if (
      aa.row !== ba.row || aa.col !== ba.col || aa.score !== ba.score ||
      aa.isValid !== ba.isValid || aa.orientation !== ba.orientation ||
      aa.side !== ba.side || aa.alignX !== ba.alignX || aa.alignY !== ba.alignY
    ) {
      return false;
    }
  }

  const ak = a.scoringKeys;
  const bk = b.scoringKeys;
  if (ak !== bk) {
    if ((ak?.size ?? 0) !== (bk?.size ?? 0)) return false;
    if (ak && bk) for (const key of ak) if (!bk.has(key)) return false;
  }

  const ap = a.pendingPlacements;
  const bp = b.pendingPlacements;
  if (ap !== bp) {
    if (ap.length !== bp.length) return false;
    for (let i = 0; i < ap.length; i += 1) {
      const x = ap[i];
      const y = bp[i];
      if (
        x !== y &&
        (x.row !== y.row || x.col !== y.col || x.tile !== y.tile ||
          x.assignedToken !== y.assignedToken)
      ) {
        return false;
      }
    }
  }

  if (a.board !== b.board) {
    for (let r = 0; r < a.board.length; r += 1) {
      const rowA = a.board[r];
      const rowB = b.board[r];
      if (rowA === rowB) continue;
      if (!rowB || rowA.length !== rowB.length) return false;
      for (let c = 0; c < rowA.length; c += 1) if (rowA[c] !== rowB[c]) return false;
    }
  }

  return true;
}

export const Board = memo(function Board({
  board,
  pendingPlacements,
  placementCursor = null,
  scoreAnchor = null,
  scoringKeys,
  selectedRackTileId,
  selectedPendingTileId,
  onCellClick,
  onPendingAssignmentEdit,
}: BoardProps) {
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
        {Array.from({ length: BOARD_SIZE }).map((_, index) => (
          <span key={index}>C{index + 1}</span>
        ))}
      </div>
      <div className="board-row-labels" aria-hidden="true">
        {Array.from({ length: BOARD_SIZE }).map((_, index) => (
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
          {scoreAnchor?.isValid && (
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
}, sameBoardPicture);
