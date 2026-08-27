import { memo } from "react";
import { displayToken, getTileType, tilePoint, type TileInstance } from "../../game";

/**
 * Memoized: a board redraw walks 225 of these, and a tile is immutable — the
 * object identity only changes when the tile itself does. Default shallow
 * comparison is therefore exact here, not an approximation.
 */
export const Tile = memo(function Tile({
  tile,
  compact = false,
  showPoint = false,
}: {
  tile: TileInstance;
  compact?: boolean;
  showPoint?: boolean;
}) {
  const type = getTileType(tile);
  const assignedChoice = Boolean(tile.assignedToken && (tile.token === "+/-" || tile.token === "x//" || tile.token === "?"));
  // A blank that has not been assigned a value shows nothing, because that is
  // what the physical tile is: a blank face. The `?` it used to show was a
  // symbol the game does not contain, and it read like a character the tile
  // could be played as. `displayToken` still returns `?` — it is the text form
  // used in logs and equations, where "nothing" would be unreadable.
  const bareBlank = tile.token === "?" && !tile.assignedToken;
  return (
    <span
      className={`tile tile-${type} ${compact ? "compact" : ""} ${assignedChoice ? "assigned-choice" : ""} ${bareBlank ? "tile-bare-blank" : ""}`}
      {...(bareBlank ? { "aria-label": "Blank tile", title: "Blank" } : {})}
    >
      <b>{bareBlank ? "" : displayToken(tile)}</b>
      {(!compact || showPoint) && <small>{tilePoint(tile)}</small>}
    </span>
  );
});
