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
  actionMode = "none",
  onTileClick,
}: {
  rack: TileInstance[];
  side: Side;
  label: string;
  active: boolean;
  selectedRackTileId: string | null;
  exchangeOutgoingIds: string[];
  actionMode?: ActionMode;
  onTileClick: (tile: TileInstance, side: Side) => void;
}) {
  return (
    <section className={`rack side-${side.toLowerCase()} ${active ? "active" : ""}`}>
      <div className="rack-label">
        <strong>{label}</strong>
        <span>{rack.length}/8</span>
      </div>
      <div className="rack-tiles">
        {Array.from({ length: 8 }).map((_, index) => {
          const tile = rack[index];
          if (!tile) return <div className="rack-slot" key={`empty-${index}`} />;
          const isSelected = selectedRackTileId === tile.id;
          const isOutgoing = exchangeOutgoingIds.includes(tile.id);
          const selectionClass = isOutgoing
            ? "outgoing"
            : isSelected
              ? actionMode === "exchange"
                ? "selected exchange-select"
                : "selected place-select"
              : "";
          return (
            <button
              className={`tile-button rack-tile ${selectionClass}`}
              key={tile.id}
              type="button"
              onClick={() => onTileClick(tile, side)}
            >
              <Tile tile={tile} />
            </button>
          );
        })}
      </div>
    </section>
  );
}
