// Per-member statistics computed from the lobby's RoomMeta list.
// RoomMeta is what's already loaded in memory for the lobby, so stats are
// O(rooms) without re-reading any full game state.

import type { RoomMeta } from "./rooms";
import type { Side } from "./game";
import type { Member } from "./members";

export type GameOutcome = "win" | "loss" | "draw";

export type PerOpponentStats = {
  opponentId: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  avgScore: number;
  avgOpponentScore: number;
  pointDifferential: number;
  /** Most recent room for quick navigation. */
  lastPlayedAt: string | null;
};

export type MemberStats = {
  memberId: string;
  games: number;
  finished: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  avgScore: number;
  pointsFor: number;
  pointsAgainst: number;
  opponents: PerOpponentStats[];
  lastPlayedAt: string | null;
};

function sideMemberId(room: RoomMeta, side: Side): string | null {
  return side === "A" ? room.memberAId ?? null : room.memberBId ?? null;
}

function scoreFor(room: RoomMeta, side: Side): number {
  return side === "A" ? room.scoreA : room.scoreB;
}

function outcomeFor(room: RoomMeta, side: Side): GameOutcome | null {
  if (room.status !== "finished" || room.gameMode === "solo") return null;
  const mine = scoreFor(room, side);
  const theirs = scoreFor(room, side === "A" ? "B" : "A");
  if (mine === theirs) return "draw";
  return mine > theirs ? "win" : "loss";
}

function emptyOpponent(opponentId: string): PerOpponentStats {
  return {
    opponentId,
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    winRate: 0,
    avgScore: 0,
    avgOpponentScore: 0,
    pointDifferential: 0,
    lastPlayedAt: null,
  };
}

export function computeMemberStats(memberId: string, rooms: RoomMeta[]): MemberStats {
  const stats: MemberStats = {
    memberId,
    games: 0,
    finished: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    winRate: 0,
    avgScore: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    opponents: [],
    lastPlayedAt: null,
  };
  const opponentMap = new Map<string, PerOpponentStats>();

  for (const room of rooms) {
    const ownSide: Side | null =
      room.memberAId === memberId ? "A" : room.memberBId === memberId ? "B" : null;
    if (!ownSide) continue;
    const otherSide: Side = ownSide === "A" ? "B" : "A";
    const opponentId = sideMemberId(room, otherSide);
    const mine = scoreFor(room, ownSide);
    const theirs = scoreFor(room, otherSide);

    stats.games += 1;
    stats.pointsFor += mine;
    stats.pointsAgainst += theirs;
    if (room.status === "finished") {
      stats.finished += 1;
      const outcome = outcomeFor(room, ownSide);
      if (outcome === "win") stats.wins += 1;
      else if (outcome === "loss") stats.losses += 1;
      else if (outcome === "draw") stats.draws += 1;
    }

    const previous = stats.lastPlayedAt;
    if (!previous || room.updatedAt > previous) stats.lastPlayedAt = room.updatedAt;

    if (opponentId) {
      const entry = opponentMap.get(opponentId) ?? emptyOpponent(opponentId);
      entry.games += 1;
      entry.avgScore += mine;
      entry.avgOpponentScore += theirs;
      if (room.status === "finished") {
        const outcome = outcomeFor(room, ownSide);
        if (outcome === "win") entry.wins += 1;
        else if (outcome === "loss") entry.losses += 1;
        else if (outcome === "draw") entry.draws += 1;
      }
      if (!entry.lastPlayedAt || room.updatedAt > entry.lastPlayedAt) {
        entry.lastPlayedAt = room.updatedAt;
      }
      opponentMap.set(opponentId, entry);
    }
  }

  if (stats.games > 0) stats.avgScore = stats.pointsFor / stats.games;
  const competitiveFinished = stats.wins + stats.losses + stats.draws;
  if (competitiveFinished > 0) {
    stats.winRate = stats.wins / competitiveFinished;
  }

  stats.opponents = [...opponentMap.values()]
    .map((entry) => {
      const finishedAgainst = entry.wins + entry.losses + entry.draws;
      return {
        ...entry,
        winRate: finishedAgainst > 0 ? entry.wins / finishedAgainst : 0,
        avgScore: entry.games > 0 ? entry.avgScore / entry.games : 0,
        avgOpponentScore: entry.games > 0 ? entry.avgOpponentScore / entry.games : 0,
        pointDifferential: entry.games > 0 ? (entry.avgScore - entry.avgOpponentScore) / entry.games : 0,
      };
    })
    .sort((a, b) => b.games - a.games);

  return stats;
}

export function computeAllMemberStats(
  members: Member[],
  rooms: RoomMeta[],
): Map<string, MemberStats> {
  const map = new Map<string, MemberStats>();
  for (const member of members) {
    map.set(member.id, computeMemberStats(member.id, rooms));
  }
  return map;
}

export function formatWinRate(rate: number): string {
  if (!Number.isFinite(rate)) return "—";
  return `${Math.round(rate * 100)}%`;
}

export function formatAverage(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(1);
}
