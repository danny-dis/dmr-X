/**
 * Elo Rating System implementation for DMR-X.
 * Adapted from chatbot arena best practices.
 *
 * K-factor: 8 (moderate sensitivity — double the original 4 for better responsiveness,
 *            but conservative vs LMSys K=32 to avoid volatility with AI judge).
 * Starting Elo: 1200.
 * Confidence intervals provided via getEloConfidenceInterval().
 */

export interface EloUpdate {
  newRatingA: number;
  newRatingB: number;
  changeA: number;
  changeB: number;
}

export interface EloConfidenceInterval {
  lower: number;
  upper: number;
  margin: number;
  games: number;
}

/**
 * Calculate new Elo ratings for two models after a head-to-head battle.
 *
 * @param ratingA - Current rating of Model A
 * @param ratingB - Current rating of Model B
 * @param outcome - 1.0 if A wins, 0.5 for tie, 0.0 if B wins
 * @param k - K-factor (sensitivity). Default 8 for AI-judge battles.
 *            Use higher values (e.g. 16-32) for human-feedback battles.
 */
export function calculateEloUpdate(
  ratingA: number,
  ratingB: number,
  outcome: number,
  k: number = 8
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
 * Calculate the approximate standard error of an Elo rating.
 * Standard error ≈ 200 / sqrt(number of games played).
 * Fewer games = wider uncertainty; more games = tighter estimate.
 */
export function calculateEloStandardError(rating: number, numGames: number): number {
  if (numGames < 1) return 200; // Max uncertainty with no data
  // Clamp to a reasonable minimum (200 is the typical Elo spread / 2)
  return Math.min(200, 200 / Math.sqrt(numGames));
}

/**
 * Compute a confidence interval for an Elo rating given the number of games played.
 *
 * @param rating - The Elo rating
 * @param numGames - Number of games (battles) played
 * @param confidenceLevel - 90, 95, or 99 percent confidence
 * @returns Lower bound, upper bound, margin of error, and games count
 */
export function getEloConfidenceInterval(
  rating: number,
  numGames: number,
  confidenceLevel: 90 | 95 | 99 = 95
): EloConfidenceInterval {
  const zScores: Record<number, number> = { 90: 1.645, 95: 1.96, 99: 2.576 };
  const z = zScores[confidenceLevel] ?? 1.96;
  const se = calculateEloStandardError(rating, numGames);
  const margin = z * se;

  return {
    lower: Math.round((rating - margin) * 10) / 10,
    upper: Math.round((rating + margin) * 10) / 10,
    margin: Math.round(margin * 10) / 10,
    games: numGames,
  };
}

/**
 * Convert an Elo rating to a normalized 0-1 quality score for use in the router.
 * Uses min-max normalization relative to the current population.
 */
export function normalizeElo(
  rating: number,
  minRating: number = 800,
  maxRating: number = 2000
): number {
  const normalized = (rating - minRating) / (maxRating - minRating);
  return Math.max(0, Math.min(1, normalized));
}
