export type RoomVisibility = "public" | "region";

export type RoomScope =
  { visibility: "public"; regionId: null } | { visibility: "region"; regionId: string };

export function makeRoomScope(
  visibility: RoomVisibility,
  regionId: string | null | undefined,
): RoomScope | null {
  if (visibility === "public") return { visibility: "public", regionId: null };
  return regionId ? { visibility: "region", regionId } : null;
}

export function roomBelongsToScope(
  room: { visibility?: RoomVisibility; regionId?: string | null },
  scope: RoomScope,
): boolean {
  const visibility = room.visibility ?? "public";
  if (scope.visibility === "public") return visibility === "public";
  return visibility === "region" && room.regionId === scope.regionId;
}
