import { partitionLiveRooms } from "../../components/pages/lobby/RoomsView";
import type { GameStatus } from "../../game";
import type { RoomMeta } from "../../rooms";

/**
 * What Home shows from the room lists the lobbies already read. Nothing here
 * decides whether a room can be opened or joined: opening goes through the
 * app's existing open path, and the server answers.
 */

/** The roles, from the server's `viewer_role` (or a device-local room), that make a game yours. */
const MY_ROLES = new Set(["Owner", "Player A", "Player B", "Player A/B", "Local"]);

export function isMyGame(role: string): boolean {
  return MY_ROLES.has(role);
}

/**
 * A room's status as the lists give it: the server's waiting and paused rooms
 * both arrive as "draft" (remoteRooms), and only a finished game is over.
 */
const CONTINUABLE: ReadonlySet<GameStatus> = new Set<GameStatus>(["draft", "playing"]);

/** Games you own, host or play in that have not ended, most recently active first. */
export function continuableGames(
  rooms: RoomMeta[],
  roleOf: (room: RoomMeta) => string,
): RoomMeta[] {
  return rooms
    .filter((room) => CONTINUABLE.has(room.status) && isMyGame(roleOf(room)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Other players' rooms with an open seat, as the lobby shows them, newest first. */
export function openGames(
  rooms: RoomMeta[],
  roleOf: (room: RoomMeta) => string,
  limit = 4,
): RoomMeta[] {
  return partitionLiveRooms(rooms)
    .openSeats.filter((room) => room.joinPolicy === "open" && !isMyGame(roleOf(room)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit);
}

/** The same room listed by more than one scope, once. */
export function uniqueRooms(lists: RoomMeta[][]): RoomMeta[] {
  const seen = new Map<string, RoomMeta>();
  for (const room of lists.flat()) if (!seen.has(room.id)) seen.set(room.id, room);
  return [...seen.values()];
}

export type RankedGame = { id: string; status: "waiting" | "matched" | "playing" };

/** Your Ranked matches Home offers to continue, from the Ranked list's `mine`. */
export function continuableRanked(mine: { id: string; status: string }[]): RankedGame[] {
  const order = { playing: 0, matched: 1, waiting: 2 } as const;
  return mine
    .filter((match): match is RankedGame => match.status in order)
    .sort((a, b) => order[a.status] - order[b.status]);
}
