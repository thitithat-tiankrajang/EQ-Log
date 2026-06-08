import { useMemo, useState } from "react";
import { displayToken, groupedTilebag, type TileInstance, type TokenType } from "../game";
import { TILE_GROUP_LABELS } from "../uiText";
import { Tile } from "./Tile";

const TILEBAG_FILTERS: Array<"all" | TokenType> = [
  "all",
  "lightNumber",
  "heavyNumber",
  "operator",
  "choice",
  "equals",
  "Blank",
];

export function Tilebag({
  tilebag,
  disabled,
  onPick,
}: {
  tilebag: TileInstance[];
  disabled: boolean;
  onPick: (tile: TileInstance) => void;
}) {
  const [selectedFilter, setSelectedFilter] = useState<"all" | TokenType>("all");
  const groups = groupedTilebag(tilebag);
  const visibleGroups = useMemo(
    () =>
      TILEBAG_FILTERS.filter((filter) => filter !== "all")
        .filter((group) => selectedFilter === "all" || selectedFilter === group)
        .map((group) => [group, groups[group]] as const),
    [groups, selectedFilter],
  );

  return (
    <>
      <div className="tilebag-filter" aria-label="Tilebag filter">
        {TILEBAG_FILTERS.map((filter) => (
          <button
            className={selectedFilter === filter ? "active" : ""}
            key={filter}
            type="button"
            onClick={() => setSelectedFilter(filter)}
          >
            {filter === "all" ? "All" : TILE_GROUP_LABELS[filter]}
          </button>
        ))}
      </div>
      <div className="tilebag-groups">
        {visibleGroups.map(([group, tiles]) => {
          if (tiles.length === 0) return null;
          return (
            <section className={`tilebag-group tilebag-group-${group}`} key={group}>
              <h3>
                {TILE_GROUP_LABELS[group]} <span>{tiles.length}</span>
              </h3>
              <div className="tile-list">
                {tiles.map((tile) => (
                  <button
                    className="tile-button"
                    disabled={disabled}
                    key={tile.id}
                    title={`Pick ${displayToken(tile)}`}
                    type="button"
                    onClick={() => onPick(tile)}
                  >
                    <Tile tile={tile} />
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
