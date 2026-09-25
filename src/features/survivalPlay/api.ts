// The Survival playtest as the Play page reaches it: a server that holds the
// whole game and answers with the player's view only.
//
// DEV ONLY for now. The server is the offline playtest engine
// (tools/survival-generator/playtest), mounted into the dev server at
// /survival-playtest by vite.config.ts. Everything the page needs goes through
// `SurvivalPlaytestSource`, so an online implementation can replace this one
// without the Play page noticing.
import type { AmathToken, Side } from "../../game";

export type SurvivalSeat = "player" | "authur";

/** A tile the player can see on the board. */
export type SurvivalBoardTile = {
  cell: number;
  kind: AmathToken;
  face: string;
  owner: SurvivalSeat;
  turn: number;
};

export type SurvivalPlacement = { cell: number; kind: AmathToken; face: string };

/** A tile of the player's own, identified by kind only. */
export type SurvivalKindTile = { kind: AmathToken };

export type SurvivalEnding = {
  reason: "rack_out" | "no_score_streak";
  bonusTo: SurvivalSeat | null;
  bonusPoints: number;
};

/**
 * One turn as the player may see it. Authur's turns carry only what was put on
 * the board and counts; the `your…` racks exist only on the player's own turns.
 */
export type SurvivalTurn = {
  turn: number;
  seat: SurvivalSeat;
  playedBy: "human" | "authur";
  type: "place" | "exchange" | "pass";
  placements?: SurvivalPlacement[];
  tilesExchanged?: number;
  yourRackBefore?: SurvivalKindTile[];
  yourRackAfter?: SurvivalKindTile[];
  yourExchanged?: SurvivalKindTile[];
  scoreGained: number;
  scoresAfter: Record<SurvivalSeat, number>;
  tilesDrawn: number;
  bagCountAfter: number;
  scorelessStreakAfter: number;
  ended?: SurvivalEnding;
};

/** The Authur-vs-Authur game before the takeover, public facts only. */
export type SurvivalSourceLog = {
  format: string;
  seats: Record<SurvivalSeat, Side>;
  start: {
    turn: number;
    seat: SurvivalSeat;
    scores: Record<SurvivalSeat, number>;
    rackCounts: Record<SurvivalSeat, number>;
    bagCount: number;
  };
  turns: Omit<SurvivalTurn, "playedBy" | "yourRackBefore" | "yourRackAfter" | "yourExchanged">[];
  takeover: { turn: number; seat: SurvivalSeat };
};

export type SurvivalLevel = {
  id: string;
  number: number;
  deficit: number;
  bagRemaining: number;
  turnNumber: number;
  scores: Record<SurvivalSeat, number>;
};

export type SurvivalResult = {
  outcome: "win" | "loss" | "tie";
  scores: Record<SurvivalSeat, number>;
  margin: number;
  reason: SurvivalEnding["reason"];
  bonusTo: SurvivalSeat | null;
  bonusPoints: number;
  turns: number;
  yourTurns: number;
  authurTurns: number;
  savedAs: string | null;
};

/** Everything the page receives about an attempt. Never the bag order, never Authur's rack. */
export type SurvivalView = {
  attemptId: string;
  level: SurvivalLevel;
  status: "your-turn" | "authur-to-move" | "finished";
  seats: Record<SurvivalSeat, Side>;
  turnNumber: number;
  board: SurvivalBoardTile[];
  rack: { id: string; kind: AmathToken }[];
  authurRackCount: number;
  bagCount: number;
  scores: Record<SurvivalSeat, number>;
  scorelessStreak: number;
  exchangeAllowed: boolean;
  sourceLog: SurvivalSourceLog;
  log: SurvivalTurn[];
  result: SurvivalResult | null;
};

export type SurvivalMove =
  | { type: "place"; placements: { tileId: string; cell: number; face?: string }[] }
  | { type: "exchange"; tileIds: string[] }
  | { type: "pass" };

export type SurvivalPlaytestSource = {
  levels(): Promise<SurvivalLevel[]>;
  start(levelId: string): Promise<SurvivalView>;
  read(attemptId: string): Promise<SurvivalView>;
  move(attemptId: string, move: SurvivalMove): Promise<SurvivalView>;
  authur(attemptId: string): Promise<SurvivalView>;
};

const BASE = "/survival-playtest/api";

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(
      data.error ?? `Survival playtest server: ${response.status} ${response.statusText}`,
    );
  }
  return data as T;
}

export const survivalPlaytestSource: SurvivalPlaytestSource = {
  levels: async () => (await call<{ levels: SurvivalLevel[] }>("GET", "/levels")).levels,
  start: (levelId) => call<SurvivalView>("POST", "/attempts", { levelId }),
  read: (attemptId) => call<SurvivalView>("GET", `/attempts/${encodeURIComponent(attemptId)}`),
  move: (attemptId, move) =>
    call<SurvivalView>("POST", `/attempts/${encodeURIComponent(attemptId)}/move`, { move }),
  authur: (attemptId) =>
    call<SurvivalView>("POST", `/attempts/${encodeURIComponent(attemptId)}/authur`),
};
