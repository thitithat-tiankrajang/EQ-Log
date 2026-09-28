export type RankTier = "Bronze" | "Silver" | "Gold" | "Platinum" | "Diamond" | "Master";

export function rankTier(rating: number): RankTier {
  if (rating >= 1800) return "Master";
  if (rating >= 1600) return "Diamond";
  if (rating >= 1400) return "Platinum";
  if (rating >= 1200) return "Gold";
  if (rating >= 1000) return "Silver";
  return "Bronze";
}
