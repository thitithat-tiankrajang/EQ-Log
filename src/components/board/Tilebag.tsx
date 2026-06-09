import { useMemo, useState } from "react";
import {
  AMATH_TOKENS,
  displayToken,
  getTileType,
  tilePoint,
  type AmathToken,
  type TileInstance,
  type TokenType,
} from "../../game";

type TileStack = {
  token: AmathToken;
  display: string;
  type: TokenType;
  point: number;
  tiles: TileInstance[];
};

const TOKEN_ORDER = new Map((Object.keys(AMATH_TOKENS) as AmathToken[]).map((token, index) => [token, index]));

type CompositionGroup = "lightNumber" | "heavyNumber" | "operator" | "Blank";
type CompositionFilter = "all" | CompositionGroup;

const COMPOSITION_LABELS: Record<CompositionGroup, string> = {
  lightNumber: "Light",
  heavyNumber: "Heavy",
  operator: "Ops",
  Blank: "?",
};

const COMPOSITION_GROUPS: CompositionGroup[] = ["lightNumber", "heavyNumber", "operator", "Blank"];

// "Operators" in the user's request bundles together: + - × ÷ +/- ×/÷ =
// (everything in the original `operator`, `choice`, and `equals` types).
// Blanks (?) stay on their own.
function bucketFor(type: TokenType): CompositionGroup {
  if (type === "lightNumber") return "lightNumber";
  if (type === "heavyNumber") return "heavyNumber";
  if (type === "Blank") return "Blank";
  return "operator";
}

function TilebagStats({
  tilebag,
  selected,
  onSelect,
}: {
  tilebag: TileInstance[];
  selected: CompositionFilter;
  onSelect: (filter: CompositionFilter) => void;
}) {
  const total = tilebag.length;
  const counts = useMemo(() => {
    const c: Record<CompositionGroup, number> = {
      lightNumber: 0,
      heavyNumber: 0,
      operator: 0,
      Blank: 0,
    };
    for (const tile of tilebag) c[bucketFor(getTileType(tile))] += 1;
    return c;
  }, [tilebag]);

  return (
    <div className="tilebag-stats" aria-label="Tilebag composition & filter">
      {COMPOSITION_GROUPS.map((group) => {
        const count = counts[group];
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const isActive = selected === group;
        return (
          <button
            aria-pressed={isActive}
            className={`tilebag-stat ${isActive ? "active" : ""}`}
            key={group}
            title={isActive ? `Showing ${COMPOSITION_LABELS[group]} — click to show all` : `Filter to ${COMPOSITION_LABELS[group]}`}
            type="button"
            onClick={() => onSelect(isActive ? "all" : group)}
          >
            <span className="ts-label">{COMPOSITION_LABELS[group]}</span>
            <div className="ts-row">
              <span className="ts-count">{count}</span>
              <span className="ts-pct">{pct}%</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function Tilebag({
  tilebag,
  disabled,
  onPick,
}: {
  tilebag: TileInstance[];
  disabled: boolean;
  onPick: (tile: TileInstance) => void;
}) {
  const [selectedFilter, setSelectedFilter] = useState<CompositionFilter>("all");

  const stacks = useMemo(() => {
    const seen = new Map<AmathToken, TileStack>();

    for (const tile of tilebag) {
      const type = getTileType(tile);
      if (selectedFilter !== "all" && selectedFilter !== bucketFor(type)) continue;

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
  const ariaLabel = selectedFilter === "all" ? "All tiles" : COMPOSITION_LABELS[selectedFilter];

  return (
    <>
      <TilebagStats
        onSelect={setSelectedFilter}
        selected={selectedFilter}
        tilebag={tilebag}
      />
      <div
        aria-label={`${ariaLabel} · ${visibleTileCount} tiles`}
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
