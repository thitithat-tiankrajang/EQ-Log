import type { TileInstance } from "../game";

export function clearTileAssignment(tile: TileInstance): TileInstance {
  return { ...tile, assignedToken: undefined };
}

