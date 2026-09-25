export type RankTier = "Bronze" | "Silver" | "Gold" | "Platinum" | "Diamond" | "Master";

export function rankTier(rating: number): RankTier {
  if (rating >= 1800) return "Master";
  if (rating >= 1600) return "Diamond";
  if (rating >= 1400) return "Platinum";
  if (rating >= 1200) return "Gold";
  if (rating >= 1000) return "Silver";
  return "Bronze";
}

export function ratingDelta(
  ownRating: number,
  opponentRating: number,
  score: 0 | 0.5 | 1,
  gamesPlayed: number,
): number {
  const expected = 1 / (1 + 10 ** ((opponentRating - ownRating) / 400));
  const raw = (gamesPlayed < 10 ? 40 : 24) * (score - expected);
  return raw < 0 ? -Math.round(-raw) : Math.round(raw);
}
