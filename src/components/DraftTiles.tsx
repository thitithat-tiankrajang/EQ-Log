import type { TileInstance } from "../game";
import { Tile } from "./Tile";

export function DraftTiles({
  title,
  tiles,
  removable = false,
  onRemove,
}: {
  title: string;
  tiles: TileInstance[];
  removable?: boolean;
  onRemove?: (tileId: string) => void;
}) {
  return (
    <div className="draft-tiles">
      <span>{title}</span>
      <div>
        {tiles.length === 0 ? (
          <em>None</em>
        ) : (
          tiles.map((tile) => (
            <button
              className="tile-button"
              key={tile.id}
              type="button"
              onClick={() => removable && onRemove?.(tile.id)}
            >
              <Tile tile={tile} />
            </button>
          ))
        )}
      </div>
    </div>
  );
}
