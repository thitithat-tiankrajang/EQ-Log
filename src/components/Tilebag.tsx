import { useMemo, useState } from "react";
import {
  AMATH_TOKENS,
  displayToken,
  getTileType,
  tilePoint,
  type AmathToken,
  type TileInstance,
  type TokenType,
} from "../game";
import { TILE_GROUP_LABELS } from "../uiText";

const TILEBAG_FILTERS: Array<"all" | TokenType> = [
  "all",
  "lightNumber",
  "heavyNumber",
  "operator",
  "choice",
  "equals",
  "Blank",
];

type TileStack = {
  token: AmathToken;
  display: string;
  type: TokenType;
  point: number;
  tiles: TileInstance[];
};

const TOKEN_ORDER = new Map((Object.keys(AMATH_TOKENS) as AmathToken[]).map((token, index) => [token, index]));

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

  const stacks = useMemo(() => {
    const seen = new Map<AmathToken, TileStack>();

    for (const tile of tilebag) {
      const type = getTileType(tile);
      if (selectedFilter !== "all" && selectedFilter !== type) continue;

      const existing = seen.get(tile.token);
      if (existing) {
        existing.tiles.push(tile);
      } else {
        seen.set(tile.token, {
          token: tile.token,
          display: displayToken(tile),
          type,
          point: tilePoint(tile),
          tiles: [tile],
        });
      }
    }

    return Array.from(seen.values()).sort((a, b) => {
      return (TOKEN_ORDER.get(a.token) ?? Number.MAX_SAFE_INTEGER) - (TOKEN_ORDER.get(b.token) ?? Number.MAX_SAFE_INTEGER);
    });
  }, [selectedFilter, tilebag]);

  const visibleTileCount = stacks.reduce((count, stack) => count + stack.tiles.length, 0);

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
      <div
        aria-label={`${selectedFilter === "all" ? "All tiles" : TILE_GROUP_LABELS[selectedFilter]} · ${visibleTileCount} tiles`}
        className="tilebag-groups tilebag-stacks"
      >
        {stacks.length === 0 ? (
          <p className="tilebag-empty">No tiles in this filter.</p>
        ) : (
          stacks.map((stack) => (
            <button
              className={`tile-button tile-stack tile-stack-${stack.type}`}
              disabled={disabled}
              key={stack.token}
              title={`Pick ${stack.display} (${stack.tiles.length} left)`}
              type="button"
              onClick={() => onPick(stack.tiles[0])}
            >
              <span className={`tile tile-${stack.type}`}>
                <b>{stack.display}</b>
                <small>{stack.point}</small>
              </span>
              <span className="tile-stack-count">{stack.tiles.length}</span>
            </button>
          ))
        )}
      </div>
    </>
  );
}
