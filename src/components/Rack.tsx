import type { Side, TileInstance } from "../game";
import { Tile } from "./Tile";

export function Rack({
  rack,
  side,
  label,
  active,
  selectedRackTileId,
  exchangeOutgoingIds,
  onTileClick,
}: {
  rack: TileInstance[];
  side: Side;
  label: string;
  active: boolean;
  selectedRackTileId: string | null;
  exchangeOutgoingIds: string[];
  onTileClick: (tile: TileInstance, side: Side) => void;
}) {
  return (
    <section className={`rack ${active ? "active" : ""}`}>
      <div className="rack-label">
        <strong>{label}</strong>
        <span>{rack.length}/8</span>
      </div>
      <div className="rack-tiles">
        {Array.from({ length: 8 }).map((_, index) => {
          const tile = rack[index];
          if (!tile) return <div className="rack-slot" key={`empty-${index}`} />;
          return (
            <button
              className={`tile-button rack-tile ${selectedRackTileId === tile.id ? "selected" : ""} ${
                exchangeOutgoingIds.includes(tile.id) ? "outgoing" : ""
              }`}
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
