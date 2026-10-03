import {
  memo,
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";
import { BOARD_SIZE } from "../../constants/gameRules";
import {
  displayToken,
  getTileType,
  slotTypeAt,
  tileNeedsAssignment,
  tilePoint,
  type BoardSnapshot,
  type PendingPlacement,
  type Side,
  type SlotType,
  type TileInstance,
} from "../../game";
import { useLocale } from "../../i18n/LocaleProvider";
import type { Cursor } from "./useTurnDraft";

/**
 * Public tentative tiles an opponent is showing on the table. Phase B fills this
 * from a TRUSTED ephemeral relay; until then the live screen always passes an
 * empty list — the opponent's draft is never received, and never faked.
 */
export type OpponentTentative = {
  row: number;
  col: number;
  tile: Pick<TileInstance, "token" | "assignedToken">;
};

const SLOT_KEY: Record<SlotType, "px1" | "px2" | "px3" | "star" | "ex2" | "ex3"> = {
  px1: "px1",
  px2: "px2",
  px3: "px3",
  px3star: "star",
  ex2: "ex2",
  ex3: "ex3",
};
const SLOT_TEXT: Record<SlotType, string> = {
  px1: "",
  px2: "2P",
  px3: "3P",
  px3star: "★",
  ex2: "2E",
  ex3: "3E",
};

export function LiveTile({
  tile,
  size = "board",
}: {
  tile: Pick<TileInstance, "token" | "assignedToken">;
  size?: "board" | "rack" | "mini";
}) {
  const bare = tile.token === "?" && !tile.assignedToken;
  const shown = bare ? "" : displayToken(tile as TileInstance);
  return (
    <span
      className={`lg-tile lg-tile-${size} lg-type-${getTileType(tile as TileInstance)}${
        tile.assignedToken ? " is-assigned" : ""
      }${shown.length > 2 ? " is-long" : ""}`}
      aria-hidden="true"
    >
      <b>{shown}</b>
      <small>{tilePoint(tile as TileInstance)}</small>
    </span>
  );
}

type BoardProps = {
  board: BoardSnapshot;
  placements: PendingPlacement[];
  opponentTentative: OpponentTentative[];
  lastMove: ReadonlySet<string>;
  lastMoveSide: Side | null;
  cursor: Cursor | null;
  /** Show the placement arrow (ACTIVE) or only a focus mark (THINKING / review). */
  placing: boolean;
  selectedPendingId: string | null;
  players: Record<Side, string>;
  yourSide: Side | null;
  score: { row: number; col: number; value: number } | null;
  labels: boolean;
  /** Stable callbacks only (the board is memoized). */
  onCellClick(row: number, col: number): void;
  onCellFocus(row: number, col: number): void;
  onEditFace(tileId: string): void;
};

const ARROWS = { right: ArrowRight, down: ArrowDown, left: ArrowLeft, up: ArrowUp };

export const LiveBoard = memo(function LiveBoard({
  board,
  placements,
  opponentTentative,
  lastMove,
  lastMoveSide,
  cursor,
  placing,
  selectedPendingId,
  players,
  yourSide,
  score,
  labels,
  onCellClick,
  onCellFocus,
  onEditFace,
}: BoardProps) {
  const { t } = useLocale();
  const gridRef = useRef<HTMLDivElement>(null);
  const pending = new Map(placements.map((item) => [`${item.row}:${item.col}`, item]));
  const remote = new Map(opponentTentative.map((item) => [`${item.row}:${item.col}`, item]));
  const focusRow = cursor?.row ?? 7;
  const focusCol = cursor?.col ?? 7;

  // Keyboard focus follows the cursor, but only when focus is already on the board.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || !grid.contains(document.activeElement)) return;
    grid
      .querySelector<HTMLElement>(`[data-board-row="${focusRow}"][data-board-col="${focusCol}"]`)
      ?.focus();
  }, [focusRow, focusCol]);

  // Focus that comes from a pointer press is followed by a click, which places
  // the cursor itself; only keyboard focus (Tab) moves the cursor on focus.
  const pointerFocus = useRef(false);
  const holdTimer = useRef<number | null>(null);
  const clearHold = () => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const describe = (row: number, col: number) => {
    const where = t("live.board.cell", { row: row + 1, col: col + 1 });
    const slot = slotTypeAt(row, col);
    const premium = slot === "px1" ? "" : `, ${t(`live.board.slot.${SLOT_KEY[slot]}`)}`;
    const mine = pending.get(`${row}:${col}`);
    if (mine)
      return `${where}, ${displayToken({ ...mine.tile, assignedToken: mine.assignedToken })}, ${t("live.board.yourTentative")}`;
    const shown = remote.get(`${row}:${col}`);
    if (shown)
      return `${where}, ${displayToken(shown.tile as TileInstance)}, ${t("live.board.opponentTentative")}`;
    const cell = board[row][col];
    if (!cell) return `${where}${premium}, ${t("live.board.empty")}`;
    const who =
      cell.side === yourSide
        ? t("live.board.byYou")
        : t("live.board.by", { name: players[cell.side] });
    const last = lastMove.has(`${row}:${col}`) ? `, ${t("live.board.lastMove")}` : "";
    return `${where}, ${displayToken(cell.tile)}, ${t("live.board.points", { count: tilePoint(cell.tile) })}, ${who}${last}`;
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    // Home/End jump along the row; the arrows are handled by the turn draft.
    if (event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    onCellFocus(focusRow, event.key === "Home" ? 0 : BOARD_SIZE - 1);
  };

  return (
    <div
      className={`lg-board${labels ? " has-labels" : ""}`}
      data-last-side={lastMoveSide?.toLowerCase()}
    >
      {labels && (
        <>
          <div className="lg-board-cols" aria-hidden="true">
            {Array.from({ length: BOARD_SIZE }, (_, index) => (
              <span key={index}>{index + 1}</span>
            ))}
          </div>
          <div className="lg-board-rows" aria-hidden="true">
            {Array.from({ length: BOARD_SIZE }, (_, index) => (
              <span key={index}>{index + 1}</span>
            ))}
          </div>
        </>
      )}
      <div
        ref={gridRef}
        className="lg-grid"
        role="grid"
        tabIndex={-1}
        aria-label={t("live.board.label")}
        aria-rowcount={BOARD_SIZE}
        aria-colcount={BOARD_SIZE}
        data-live-board
        onKeyDown={onKeyDown}
        // Space turns the placement arrow (on keydown); without this a focused
        // cell button would also "click" on keyup and turn it a second time.
        onKeyUp={(event) => {
          if (event.key === " ") event.preventDefault();
        }}
      >
        {board.map((row, r) => (
          <div role="row" className="lg-row" key={r} aria-rowindex={r + 1}>
            {row.map((cell, c) => {
              const key = `${r}:${c}`;
              const slot = slotTypeAt(r, c);
              const mine = pending.get(key);
              const shown = remote.get(key);
              const isCursor = cursor?.row === r && cursor.col === c;
              const focusable = r === focusRow && c === focusCol;
              const Arrow = isCursor && placing && !cell && !mine ? ARROWS[cursor!.dir] : null;
              const state = mine
                ? "tentative"
                : shown
                  ? "opponent-tentative"
                  : cell
                    ? lastMove.has(key)
                      ? "last"
                      : "committed"
                    : "empty";
              return (
                <div role="gridcell" className="lg-gridcell" key={key} aria-colindex={c + 1}>
                  <button
                    type="button"
                    className={`lg-cell lg-slot-${SLOT_KEY[slot]} is-${state}${
                      cell ? ` side-${cell.side.toLowerCase()}` : ""
                    }${isCursor ? ` is-cursor${placing ? ` dir-${cursor!.dir}` : ""}` : ""}${
                      mine && mine.tile.id === selectedPendingId ? " is-selected" : ""
                    }`}
                    tabIndex={focusable ? 0 : -1}
                    aria-label={describe(r, c)}
                    data-board-row={r}
                    data-board-col={c}
                    data-draft-tile-id={mine?.tile.id}
                    onClick={() => {
                      pointerFocus.current = false;
                      onCellClick(r, c);
                    }}
                    onFocus={() => {
                      if (!isCursor && !pointerFocus.current) onCellFocus(r, c);
                    }}
                    onDoubleClick={() =>
                      mine && tileNeedsAssignment(mine.tile.token) && onEditFace(mine.tile.id)
                    }
                    onPointerDown={() => {
                      pointerFocus.current = true;
                      clearHold();
                      if (mine && tileNeedsAssignment(mine.tile.token))
                        holdTimer.current = window.setTimeout(() => onEditFace(mine.tile.id), 520);
                    }}
                    onPointerUp={clearHold}
                    onPointerLeave={clearHold}
                    onPointerCancel={clearHold}
                  >
                    {mine ? (
                      <LiveTile tile={{ ...mine.tile, assignedToken: mine.assignedToken }} />
                    ) : shown ? (
                      <LiveTile tile={shown.tile} />
                    ) : cell ? (
                      <LiveTile tile={cell.tile} />
                    ) : Arrow ? (
                      <Arrow className="lg-cursor-arrow" aria-hidden="true" />
                    ) : (
                      SLOT_TEXT[slot] && (
                        <span className="lg-premium" aria-hidden="true">
                          {SLOT_TEXT[slot]}
                        </span>
                      )
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
        {score && (
          <span
            className="lg-score-badge"
            style={{ "--r": score.row, "--c": score.col } as CSSProperties}
            aria-hidden="true"
          >
            +{score.value}
          </span>
        )}
      </div>
    </div>
  );
});
