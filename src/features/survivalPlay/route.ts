// A Survival session on the Play page is addressed like a room, in its own
// namespace, so the router needs no new shape and the room machinery can tell
// at once that it must stay out of the way:
//
//   #/play/survival:level:<levelId>      start a fresh attempt at a level
//   #/play/survival:attempt:<attemptId>  an attempt already under way
const PREFIX = "survival:";

export type SurvivalRoute =
  { kind: "level"; levelId: string } | { kind: "attempt"; attemptId: string };

export function survivalLevelRoomId(levelId: string): string {
  return `${PREFIX}level:${levelId}`;
}

export function survivalAttemptRoomId(attemptId: string): string {
  return `${PREFIX}attempt:${attemptId}`;
}

export function parseSurvivalRoomId(roomId: string | null | undefined): SurvivalRoute | null {
  if (!roomId?.startsWith(PREFIX)) return null;
  const [kind, ...rest] = roomId.slice(PREFIX.length).split(":");
  const id = rest.join(":");
  if (!id) return null;
  if (kind === "level") return { kind: "level", levelId: id };
  if (kind === "attempt") return { kind: "attempt", attemptId: id };
  return null;
}
