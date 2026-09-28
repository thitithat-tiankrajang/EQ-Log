/**
 * What a Ranked match puts at stake for one player, exactly as the database's
 * `ranked_stakes` computed it. The client never derives a rating change: it
 * shows these numbers and hands `basis` back when it claims, and the server
 * refuses with `ranked_stakes_changed` if the numbers are no longer true.
 * There is no draw-free variant: Ranked results include draws.
 */
export type RankedStakes = {
  matchId: string;
  side: "A" | "B";
  opponentId: string;
  rating: number;
  games: number;
  opponentRating: number;
  after: { win: number; draw: number; loss: number };
  basis: string;
};

/** A `ranked_stakes` row, as the service role reads it. */
export type RankedStakesRow = {
  match_id: string;
  viewer_side: string;
  opponent_id: string;
  viewer_rating: number;
  viewer_games: number;
  opponent_rating: number;
  win_rating: number;
  draw_rating: number;
  loss_rating: number;
  basis: string;
};

export function rankedStakesFromRow(row: RankedStakesRow): RankedStakes {
  if (row.viewer_side !== "A" && row.viewer_side !== "B") {
    throw new Error(`Unexpected Ranked seat: ${row.viewer_side}`);
  }
  return {
    matchId: row.match_id,
    side: row.viewer_side,
    opponentId: row.opponent_id,
    rating: row.viewer_rating,
    games: row.viewer_games,
    opponentRating: row.opponent_rating,
    after: { win: row.win_rating, draw: row.draw_rating, loss: row.loss_rating },
    basis: row.basis,
  };
}

/** The change each result would make, from the server's own before and after. */
export function rankedStakeChanges(stakes: RankedStakes): {
  win: number;
  draw: number;
  loss: number;
} {
  return {
    win: stakes.after.win - stakes.rating,
    draw: stakes.after.draw - stakes.rating,
    loss: stakes.after.loss - stakes.rating,
  };
}

/**
 * The stakes the Ranked function shows a player before they commit to a match:
 * who, how long, their rating now and after each result, and the basis to hand
 * back when they confirm. The opponent's rating and games are not included;
 * the player needs only their own consequences.
 */
export type RankedStakePreview = {
  matchId: string;
  opponent: { id: string; name: string };
  minutes: number;
  rating: number;
  after: { win: number; draw: number; loss: number };
  basis: string;
};

export function rankedStakePreview(
  stakes: RankedStakes,
  opponentName: string,
  minutes: number,
): RankedStakePreview {
  return {
    matchId: stakes.matchId,
    opponent: { id: stakes.opponentId, name: opponentName },
    minutes,
    rating: stakes.rating,
    after: { ...stakes.after },
    basis: stakes.basis,
  };
}
