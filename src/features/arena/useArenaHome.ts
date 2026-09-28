import { useCallback, useEffect, useState } from "react";
import { getMyProBotStatus } from "../probot/repository";
import type { ProBotStatus } from "../../bot/catalog";
import * as remoteRooms from "../../remoteRooms";
import * as localRooms from "../../rooms";
import type { RoomMeta } from "../../rooms";
import type { RoomScope } from "../../roomScope";
import { supabase } from "../../supabaseClient";
import { rankedClient } from "../ranked/client";
import { arenaBots, type ArenaBot, type CatalogBot } from "./arenaBots";
import { continuableRanked, uniqueRooms, type RankedGame } from "./arenaGames";

export type ArenaGames =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      /** Every live room the lobbies would list for this player, once each. */
      rooms: RoomMeta[];
      /** Null when Ranked could not be read (or is not online): shown as nothing, never as zero. */
      ranked: { mine: RankedGame[]; waitingForOpponent: number } | null;
    };

/**
 * The rooms and Ranked matches Home shows, read through the same calls the
 * lobbies and the Ranked page use: `list_live_games` for Public, the player's
 * Region and Private, and the Ranked list. Home adds no authority of its own.
 */
export function useArenaGames({
  remoteEnabled,
  regionId,
  userId,
}: {
  remoteEnabled: boolean;
  regionId: string | null;
  userId: string | null;
}): { games: ArenaGames; reload: () => void } {
  const [games, setGames] = useState<ArenaGames>({ status: "loading" });
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    let alive = true;
    setGames({ status: "loading" });
    const load = async (): Promise<ArenaGames> => {
      if (!remoteEnabled) {
        const scopes: RoomScope[] = [{ visibility: "public", regionId: null }];
        if (regionId) scopes.push({ visibility: "region", regionId });
        return {
          status: "ready",
          rooms: uniqueRooms(scopes.map((scope) => localRooms.listRooms(scope))),
          ranked: null,
        };
      }
      const [rooms, ranked] = await Promise.all([
        Promise.all([
          remoteRooms.listRooms({ visibility: "public", regionId: null }),
          regionId
            ? remoteRooms.listRooms({ visibility: "region", regionId })
            : Promise.resolve([]),
          remoteRooms.listPrivateRooms(),
        ]).then(uniqueRooms),
        rankedClient.list().catch(() => null),
      ]);
      return {
        status: "ready",
        rooms,
        ranked: ranked && {
          mine: continuableRanked(ranked.mine),
          waitingForOpponent: ranked.open.filter((room) => room.creatorId !== userId).length,
        },
      };
    };
    load()
      .then((next) => {
        if (alive) setGames(next);
      })
      .catch(() => {
        if (alive) setGames({ status: "error" });
      });
    return () => {
      alive = false;
    };
  }, [epoch, regionId, remoteEnabled, userId]);

  const reload = useCallback(() => setEpoch((value) => value + 1), []);
  return { games, reload };
}

export type ArenaBots =
  | { status: "offline" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; bots: ArenaBot[]; probot: ProBotStatus | null };

/**
 * The AI opponents Home offers, from the bot catalogue (`list_bots`), with the
 * player's Pro-Bot status for information only: the setup the player is sent
 * to, and the server behind it, decide what can actually be started.
 */
export function useArenaBots({ serverAvailable }: { serverAvailable: boolean }): {
  bots: ArenaBots;
  reload: () => void;
} {
  const [bots, setBots] = useState<ArenaBots>(() =>
    supabase ? { status: "loading" } : { status: "offline" },
  );
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    const db = supabase;
    if (!db) return;
    let alive = true;
    setBots({ status: "loading" });
    Promise.all([
      db.rpc("list_bots").then(({ data, error }) => {
        if (error) throw error;
        return (data ?? []) as CatalogBot[];
      }),
      getMyProBotStatus().catch(() => null),
    ])
      .then(([catalog, probot]) => {
        if (alive)
          setBots({ status: "ready", bots: arenaBots(catalog, { serverAvailable }), probot });
      })
      .catch(() => {
        if (alive) setBots({ status: "error" });
      });
    return () => {
      alive = false;
    };
  }, [epoch, serverAvailable]);

  const reload = useCallback(() => setEpoch((value) => value + 1), []);
  return { bots, reload };
}
