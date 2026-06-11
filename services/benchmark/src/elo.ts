/**
 * Elo Rating System implementation for DMR-X.
 * Ported/adapted from chatbot arena best practices.
 */

export interface EloUpdate {
  newRatingA: number;
  newRatingB: number;
  changeA: number;
  changeB: number;
}

/**
 * Calculate new Elo ratings for two models after a head-to-head battle.
 * 
 * @param ratingA - Current rating of Model A
 * @param ratingB - Current rating of Model B
 * @param outcome - 1.0 if A wins, 0.5 for tie, 0.0 if B wins
 * @param k - K-factor (sensitivity). Standard is 32, but we use a lower value (4) for stability in LLM benchmarks.
 */
export function calculateEloUpdate(
  ratingA: number,
  ratingB: number,
  outcome: number,
  k: number = 4
): EloUpdate {
  // 1. Calculate expected scores
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  const expectedB = 1 - expectedA;

  // 2. Update ratings based on actual outcome
  const changeA = k * (outcome - expectedA);
  const changeB = k * ((1 - outcome) - expectedB);

  return {
    newRatingA: ratingA + changeA,
    newRatingB: ratingB + changeB,
    changeA,
    changeB,
  };
}

/**
 * Convert an Elo rating to a normalized 0-1 quality score for use in the router.
 * Uses min-max normalization relative to the current population.
 */
export function normalizeElo(
  rating: number,
  minRating: number = 800,
  maxRating: number = 1600
): number {
  const normalized = (rating - minRating) / (maxRating - minRating);
  return Math.max(0, Math.min(1, normalized));
}
