/** Trusted reducer adapter. A worker proposal is never a browser response. */
import { getAssignmentOptions, getRack, type GameState } from "../game";
import type { RankedAction } from "../features/ranked/rules";

export type TrustedBotMove = {
  type: "place" | "exchange" | "pass";
  placements?: Array<{ r: number; c: number; kind: string; token: string }>;
  exchange?: string[];
};

export function botActionFor(game: GameState, move: TrustedBotMove): RankedAction {
  if (!game.botSide || game.activeSide !== game.botSide) throw new Error("Not a bot turn");
  const remaining = [...getRack(game, game.botSide)];
  const take = (kind: string) => {
    const index = remaining.findIndex((tile) => tile.token === kind);
    if (index < 0) throw new Error("Invalid bot proposal");
    return remaining.splice(index, 1)[0]!;
  };
  if (move.type === "pass") return { kind: "pass" };
  if (move.type === "exchange")
    return { kind: "exchange", tileIds: (move.exchange ?? []).map((kind) => take(kind).id) };
  if (move.type !== "place") throw new Error("Invalid bot proposal");
  return {
    kind: "place",
    placements: (move.placements ?? []).map((placed) => {
      const tile = take(placed.kind);
      return {
        tileId: tile.id,
        row: placed.r,
        col: placed.c,
        ...(getAssignmentOptions(tile.token).length ? { assignedToken: placed.token } : {}),
      };
    }),
  };
}
