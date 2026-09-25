import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { ActionType, Side, TileInstance } from "../../game";
import { RACK_SIZE } from "../../constants/gameRules";
import { Tile } from "./Tile";

type ActionMode = "none" | ActionType;

type RackProps = {
  rack: (TileInstance | null)[];
  /** Closed slots for a public replay. No tile identities are supplied. */
  hiddenCount?: number;
  side: Side;
  label: string;
  active: boolean;
  selectedRackTileId: string | null;
  exchangeOutgoingIds: string[];
  carriedOverTileIds?: Set<string>;
  actionMode?: ActionMode;
  /**
   * Keyboard entry for this rack, or null when it is off.
   *
   * The rack goes YELLOW while this is set, because typing takes over keys the rest of the page
   * uses — a transcriber pressing `p` must be able to see at a glance whether that meant "the
   * plus tile" or whatever `p` means elsewhere. A mode you cannot see is a mode that surprises
   * you, and the board is not a safe place to be surprised.
   */
  typing?: { focus: number } | null;
  /** Must be stable across renders — see `sameRack`. */
  onSlotFocus?: (index: number, side: Side) => void;
  /** Must be stable across renders — see `sameRack`. */
  onTileClick: (tile: TileInstance, side: Side) => void;
  /** Select the tiles inside a drag rectangle in exchange mode. */
  onExchangeSelectTiles?: (ids: string[], additive: boolean) => void;
  /** Must be stable across renders — see `sameRack`. */
  onEmptySlotClick?: (index: number, side: Side) => void;
};

/**
 * The rack redraws only when the rack changes.
 *
 * Its owner re-renders on every clock tick and every board interaction, and the
 * caller rebuilds `exchangeOutgoingIds` and `carriedOverTileIds` from scratch
 * each time, so identity comparison alone would never hit. Comparing contents
 * costs a couple of dozen checks against eight tiles.
 *
 * The two callbacks are not compared: callers pass stable ones (ref indirection
 * in App), which is what makes the rest of this comparison worth doing.
 */
function sameRack(a: RackProps, b: RackProps): boolean {
  if (
    a.side !== b.side ||
    a.label !== b.label ||
    a.active !== b.active ||
    a.hiddenCount !== b.hiddenCount ||
    a.actionMode !== b.actionMode ||
    a.selectedRackTileId !== b.selectedRackTileId ||
    (a.typing?.focus ?? -1) !== (b.typing?.focus ?? -1)
  ) {
    return false;
  }
  if (a.rack !== b.rack) {
    if (a.rack.length !== b.rack.length) return false;
    for (let i = 0; i < a.rack.length; i += 1) if (a.rack[i] !== b.rack[i]) return false;
  }
  if (a.exchangeOutgoingIds !== b.exchangeOutgoingIds) {
    if (a.exchangeOutgoingIds.length !== b.exchangeOutgoingIds.length) return false;
    for (let i = 0; i < a.exchangeOutgoingIds.length; i += 1) {
      if (a.exchangeOutgoingIds[i] !== b.exchangeOutgoingIds[i]) return false;
    }
  }
  const ac = a.carriedOverTileIds;
  const bc = b.carriedOverTileIds;
  if (ac !== bc) {
    if ((ac?.size ?? 0) !== (bc?.size ?? 0)) return false;
    if (ac && bc) for (const id of ac) if (!bc.has(id)) return false;
  }
  return true;
}

export const Rack = memo(function Rack({
  rack,
  hiddenCount,
  side,
  label,
  active,
  selectedRackTileId,
  exchangeOutgoingIds,
  carriedOverTileIds = new Set<string>(),
  actionMode = "none",
  typing = null,
  onSlotFocus,
  onTileClick,
  onExchangeSelectTiles,
  onEmptySlotClick,
}: RackProps) {
  const tileCount = hiddenCount ?? rack.filter(Boolean).length;
  const tilesRef = useRef<HTMLDivElement>(null);
  const detachDragRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef(false);
  const [marquee, setMarquee] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => () => detachDragRef.current?.(), []);

  function beginExchangeDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (actionMode !== "exchange" || !active || !onExchangeSelectTiles || event.button !== 0)
      return;
    detachDragRef.current?.();
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;
    const additive = event.shiftKey;
    let dragging = false;
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      detachDragRef.current = null;
      setMarquee(null);
    };
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      if (!dragging && Math.hypot(next.clientX - startX, next.clientY - startY) < 6) return;
      dragging = true;
      const bounds = tilesRef.current?.getBoundingClientRect();
      if (!bounds) return;
      setMarquee({
        left: Math.max(0, Math.min(startX, next.clientX) - bounds.left),
        top: Math.max(0, Math.min(startY, next.clientY) - bounds.top),
        width: Math.abs(next.clientX - startX),
        height: Math.abs(next.clientY - startY),
      });
    };
    const end = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      cleanup();
      if (!dragging) return;
      const left = Math.min(startX, next.clientX);
      const right = Math.max(startX, next.clientX);
      const top = Math.min(startY, next.clientY);
      const bottom = Math.max(startY, next.clientY);
      const ids = [
        ...(tilesRef.current?.querySelectorAll<HTMLButtonElement>(
          "button.rack-tile:not(:disabled)",
        ) ?? []),
      ]
        .filter((button) => {
          const box = button.getBoundingClientRect();
          return box.left < right && box.right > left && box.top < bottom && box.bottom > top;
        })
        .map((button) => button.dataset.tileId)
        .filter((id): id is string => Boolean(id));
      if (ids.length > 0) onExchangeSelectTiles(ids, additive);
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };
    const cancel = (next: PointerEvent) => {
      if (next.pointerId === pointerId) cleanup();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
    detachDragRef.current = cleanup;
  }

  return (
    <section
      className={`rack side-${side.toLowerCase()} ${active ? "active" : ""}${typing ? " is-typing" : ""}`}
    >
      <div className="rack-label">
        <strong>{label}</strong>
        <span>
          {tileCount}/{RACK_SIZE}
        </span>
      </div>
      <div
        className={`rack-tiles${actionMode === "exchange" && active ? " rack-tiles-marquee" : ""}`}
        ref={tilesRef}
        onPointerDown={beginExchangeDrag}
        onClickCapture={(event) => {
          if (!suppressClickRef.current) return;
          event.preventDefault();
          event.stopPropagation();
          suppressClickRef.current = false;
        }}
      >
        {Array.from({ length: RACK_SIZE }).map((_, index) => {
          if (hiddenCount !== undefined && index < hiddenCount) {
            return (
              <div className="rack-cell" key={`hidden-${index}`}>
                <span className="rack-cell-index" aria-hidden>
                  {index + 1}
                </span>
                <span className="rack-tile-back" aria-label="เบี้ยปิด">
                  ?
                </span>
              </div>
            );
          }
          const tile = rack[index];
          const slotNumber = index + 1;
          // While typing, a click aims the caret rather than acting on the tile — the same
          // gesture a text field gives you, and the only one that makes a rack editable
          // out of order.
          const focused = typing !== null && typing.focus === index;
          const caret = focused ? " is-caret" : "";
          if (!tile) {
            return (
              <div className={`rack-cell${caret}`} key={`empty-${index}`}>
                <span className="rack-cell-index" aria-hidden>
                  {slotNumber}
                </span>
                <button
                  aria-label={`Empty rack slot ${slotNumber}`}
                  className="rack-slot"
                  type="button"
                  onClick={() =>
                    typing ? onSlotFocus?.(index, side) : onEmptySlotClick?.(index, side)
                  }
                />
              </div>
            );
          }
          const isSelected = selectedRackTileId === tile.id;
          const isOutgoing = exchangeOutgoingIds.includes(tile.id);
          const isCarriedOver = carriedOverTileIds.has(tile.id);
          const selectionClass = isOutgoing
            ? "outgoing"
            : isSelected
              ? actionMode === "exchange"
                ? "selected exchange-select"
                : "selected place-select"
              : "";
          return (
            <div className={`rack-cell${caret}`} key={tile.id}>
              <span className="rack-cell-index" aria-hidden>
                {slotNumber}
              </span>
              <button
                className={`tile-button rack-tile ${selectionClass} ${isCarriedOver ? "carried-over" : ""}`}
                data-tile-id={tile.id}
                type="button"
                disabled={isCarriedOver && typing === null}
                aria-label={
                  isCarriedOver
                    ? `Rack slot ${slotNumber} (held from previous turn)`
                    : `Rack slot ${slotNumber}`
                }
                title={isCarriedOver ? "Held from previous turn" : undefined}
                onClick={() => (typing ? onSlotFocus?.(index, side) : onTileClick(tile, side))}
              >
                <Tile tile={tile} />
                {isCarriedOver && <span className="rack-tile-held-flag" aria-hidden="true" />}
              </button>
            </div>
          );
        })}
        {marquee && <span className="rack-marquee" style={marquee} aria-hidden="true" />}
      </div>
    </section>
  );
}, sameRack);
