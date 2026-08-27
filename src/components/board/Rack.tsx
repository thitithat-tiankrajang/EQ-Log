import { memo } from "react";
import type { ActionType, Side, TileInstance } from "../../game";
import { RACK_SIZE } from "../../constants/gameRules";
import { Tile } from "./Tile";

type ActionMode = "none" | ActionType;

type RackProps = {
  rack: (TileInstance | null)[];
  side: Side;
  label: string;
  active: boolean;
  selectedRackTileId: string | null;
  exchangeOutgoingIds: string[];
  carriedOverTileIds?: Set<string>;
  actionMode?: ActionMode;
  /** Must be stable across renders — see `sameRack`. */
  onTileClick: (tile: TileInstance, side: Side) => void;
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
    a.side !== b.side || a.label !== b.label || a.active !== b.active ||
    a.actionMode !== b.actionMode || a.selectedRackTileId !== b.selectedRackTileId
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
  side,
  label,
  active,
  selectedRackTileId,
  exchangeOutgoingIds,
  carriedOverTileIds = new Set<string>(),
  actionMode = "none",
  onTileClick,
  onEmptySlotClick,
}: RackProps) {
  const tileCount = rack.filter(Boolean).length;
  return (
    <section className={`rack side-${side.toLowerCase()} ${active ? "active" : ""}`}>
      <div className="rack-label">
        <strong>{label}</strong>
        <span>{tileCount}/{RACK_SIZE}</span>
      </div>
      <div className="rack-tiles">
        {Array.from({ length: RACK_SIZE }).map((_, index) => {
          const tile = rack[index];
          const slotNumber = index + 1;
          if (!tile) {
            return (
              <div className="rack-cell" key={`empty-${index}`}>
                <span className="rack-cell-index" aria-hidden>{slotNumber}</span>
                <button
                  aria-label={`Empty rack slot ${slotNumber}`}
                  className="rack-slot"
                  type="button"
                  onClick={() => onEmptySlotClick?.(index, side)}
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
            <div className="rack-cell" key={tile.id}>
              <span className="rack-cell-index" aria-hidden>{slotNumber}</span>
              <button
                className={`tile-button rack-tile ${selectionClass} ${isCarriedOver ? "carried-over" : ""}`}
                type="button"
                disabled={isCarriedOver}
                aria-label={isCarriedOver ? `Rack slot ${slotNumber} (held from previous turn)` : `Rack slot ${slotNumber}`}
                title={isCarriedOver ? "Held from previous turn" : undefined}
                onClick={() => onTileClick(tile, side)}
              >
                <Tile tile={tile} />
                {isCarriedOver && <span className="rack-tile-held-flag" aria-hidden="true" />}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}, sameRack);
