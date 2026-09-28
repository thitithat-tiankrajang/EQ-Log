import { serverErrorCode, serverErrorNotice, type ServerErrorCode } from "../../i18n/serverErrors";
import { supabase } from "../../supabaseClient";
import type { RankedAction } from "./rules";
import type { RankedMatchView } from "./publicView";
import type { RankedStakePreview } from "./stakes";

export type RankedOpenRoom = {
  id: string;
  creatorId: string;
  creator: string;
  minutesA: number;
  createdAt: string;
};
export type RankedRating = {
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
};
export type RankedLeaderboardRow = RankedRating & {
  player_id: string;
  name: string;
  place: number;
};

/**
 * A refusal from the Ranked function. `code` is the server's machine-readable
 * reason (the Edge Function's `code`, or the database's `snake_code:` prefix)
 * so callers can react to it — `ranked_stakes_changed` above all — without
 * reading prose; the message is the player-facing one where the product
 * explains that code, and the server's text otherwise.
 */
export class RankedRequestError extends Error {
  readonly code: ServerErrorCode | null;
  readonly serverMessage: string;
  /** With `ranked_stakes_changed`: the new stakes, to confirm again. */
  readonly preview: RankedStakePreview | null;

  constructor(
    serverMessage: string,
    code: ServerErrorCode | null,
    preview: RankedStakePreview | null = null,
  ) {
    super(serverErrorNotice({ error: serverMessage, code }) ?? serverMessage);
    this.name = "RankedRequestError";
    this.code = code;
    this.serverMessage = serverMessage;
    this.preview = preview;
  }
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error("Ranked needs an online account.");
  const { data, error } = await supabase.functions.invoke("ranked", { body });
  if (error) {
    const response = "context" in error ? error.context : null;
    const detail =
      response instanceof Response
        ? ((await response.json().catch(() => null)) as {
            error?: string;
            code?: string;
            preview?: RankedStakePreview;
          } | null)
        : null;
    const serverMessage = detail?.error ?? error.message;
    throw new RankedRequestError(
      serverMessage,
      serverErrorCode({ error: serverMessage, code: detail?.code }),
      detail?.preview ?? null,
    );
  }
  return data as T;
}

export const rankedClient = {
  list: () =>
    invoke<{ open: RankedOpenRoom[]; mine: { id: string; status: string }[] }>({
      operation: "list",
    }),
  leaderboard: () =>
    invoke<{ rows: RankedLeaderboardRow[]; own: RankedRating }>({ operation: "leaderboard" }),
  create: (minutesA: number, minutesB: number) =>
    invoke<{ match: RankedMatchView }>({ operation: "create", minutesA, minutesB }),
  /** The rating this match puts at stake for you, as the server computes it. */
  preview: (id: string) => invoke<{ preview: RankedStakePreview }>({ operation: "preview", id }),
  /**
   * Take a seat in a waiting room at the stakes you were shown: `basis` is the
   * preview's. Without it the server refuses (`ranked_stakes_required`); if the
   * stakes moved it refuses with `ranked_stakes_changed` and the new preview,
   * and nothing is claimed. It never retries on its own.
   */
  join: (id: string, basis?: string) =>
    invoke<{ match: RankedMatchView }>({
      operation: "join",
      id,
      ...(basis ? { basis } : {}),
    }),
  cancel: (id: string) => invoke<{ cancelled: boolean }>({ operation: "cancel", id }),
  ready: (id: string) => invoke<{ match: RankedMatchView }>({ operation: "ready", id }),
  read: (id: string) => invoke<{ match: RankedMatchView }>({ operation: "read", id }),
  action: (id: string, revision: number, action: RankedAction) =>
    invoke<{ match: RankedMatchView }>({ operation: "action", id, revision, action }),
};
