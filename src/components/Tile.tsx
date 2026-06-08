import { displayToken, getTileType, tilePoint, type TileInstance } from "../game";

export function Tile({
  tile,
  compact = false,
  showPoint = false,
}: {
  tile: TileInstance;
  compact?: boolean;
  showPoint?: boolean;
}) {
  const type = getTileType(tile);
  const assignedChoice = Boolean(tile.assignedToken && (tile.token === "+/-" || tile.token === "x//"));
  return (
    <span className={`tile tile-${type} ${compact ? "compact" : ""} ${assignedChoice ? "assigned-choice" : ""}`}>
      <b>{displayToken(tile)}</b>
      {(!compact || showPoint) && <small>{tilePoint(tile)}</small>}
    </span>
  );
}
