import type { ActionType, Side, TileInstance } from "../../game";
import { Tile } from "./Tile";

type ActionMode = "none" | ActionType;

export function Rack({
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
}: {
  rack: (TileInstance | null)[];
  side: Side;
  label: string;
  active: boolean;
  selectedRackTileId: string | null;
  exchangeOutgoingIds: string[];
  carriedOverTileIds?: Set<string>;
  actionMode?: ActionMode;
  onTileClick: (tile: TileInstance, side: Side) => void;
  onEmptySlotClick?: (index: number, side: Side) => void;
}) {
  const tileCount = rack.filter(Boolean).length;
  return (
    <section className={`rack side-${side.toLowerCase()} ${active ? "active" : ""}`}>
      <div className="rack-label">
        <strong>{label}</strong>
        <span>{tileCount}/8</span>
      </div>
      <div className="rack-tiles">
        {Array.from({ length: 8 }).map((_, index) => {
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
}
