import { randomUUID } from 'node:crypto';
import type { UnifiedRequest } from '@dmr-x/core';
import type { Router } from '@dmr-x/router';
import { getDb } from '@dmr-x/db';
import { eventBus, logger, SystemEvents } from '@dmr-x/utils';

// ─── Rubric System ──────────────────────────────────────────────────────────
// G-Eval style rubric-based evaluation with weighted criteria and
// chain-of-thought reasoning.

export interface RubricCriterion {
  name: string;
  description: string;
  weight: number;   // 0-1, all weights must sum to 1
  scale: number;    // Likert scale (e.g. 5 for 1-5 scoring)
}

/**
 * Default evaluation rubric for model output comparison.
 * Each criterion is scored 1-5, then weighted to compute a composite score.
 */
export const DEFAULT_RUBRIC: RubricCriterion[] = [
  { name: 'accuracy', description: 'Factual correctness and precision of the response; absence of errors or hallucinations', weight: 0.35, scale: 5 },
  { name: 'relevance', description: 'How well the response addresses the specific prompt and stays on topic', weight: 0.25, scale: 5 },
  { name: 'clarity', description: 'Organization, coherence, readability, and conciseness of the response', weight: 0.15, scale: 5 },
  { name: 'completeness', description: 'Thoroughness and adequate coverage of all aspects of the prompt', weight: 0.15, scale: 5 },
  { name: 'harmlessness', description: 'Appropriateness, safety, and absence of harmful or biased content', weight: 0.10, scale: 5 },
];

export interface CriterionScore {
  A: number;           // Score 1-5 for Response A
  B: number;           // Score 1-5 for Response B
  reasoning: string;   // Why these scores were given
}

export interface EvaluationResult {
  winner: 'A' | 'B' | 'Tie';
  reasoning: string;
  // Legacy scores (backward compatible)
  scores: {
    accuracy: number;
    formatting: number;
    tone: number;
  };
  // New rubric-based detailed scores
  rubricScores?: Record<string, CriterionScore>;
  weightedTotal?: { A: number; B: number };
}

// ─── Multi-Judge Ensemble Types ──────────────────────────────────────────────

export interface JudgeConfig {
  modelId: string;
  weight: number;
  label: string;
}

export interface JudgeVerdict {
  judgeId: string;
  judgeLabel: string;
  winner: 'A' | 'B' | 'Tie';
  rubricScores: Record<string, CriterionScore>;
  weightedTotal: { A: number; B: number };
}

export interface EnsembleResult {
  winner: 'A' | 'B' | 'Tie';
  confidence: number;
  votes: { A: number; B: number; Tie: number };
  judgments: JudgeVerdict[];
  averageWeightedTotal: { A: number; B: number };
  kappaMatrix?: Record<string, Record<string, number>>;
}

export const DEFAULT_JUDGE_PANEL: JudgeConfig[] = [
  { modelId: 'gpt-4o', weight: 1, label: 'GPT-4o' },
  { modelId: 'claude-sonnet-4-20250514', weight: 1, label: 'Claude Sonnet' },
  { modelId: 'gemini-2.5-pro', weight: 1, label: 'Gemini 2.5 Pro' },
];

// ─── Cohen's Kappa ───────────────────────────────────────────────────────────

/**
 * Calculate Cohen's Kappa for inter-rater reliability between two judges.
 */
export function calculateKappa(
  judgeAVerdicts: Array<{ winner: 'A' | 'B' | 'Tie' }>,
  judgeBVerdicts: Array<{ winner: 'A' | 'B' | 'Tie' }>,
): { kappa: number; agreement: number; interpretation: string } {
  if (judgeAVerdicts.length !== judgeBVerdicts.length || judgeAVerdicts.length === 0) {
    return { kappa: 0, agreement: 0, interpretation: 'No data' };
  }

  const categories: Array<'A' | 'B' | 'Tie'> = ['A', 'B', 'Tie'];
  const n = judgeAVerdicts.length;

  // Observed agreement
  let agreed = 0;
  for (let i = 0; i < n; i++) {
    if (judgeAVerdicts[i]!.winner === judgeBVerdicts[i]!.winner) agreed++;
  }
  const po = agreed / n;

  // Expected agreement by chance
  let pe = 0;
  for (const cat of categories) {
    const countA = judgeAVerdicts.filter(v => v.winner === cat).length;
    const countB = judgeBVerdicts.filter(v => v.winner === cat).length;
    pe += (countA / n) * (countB / n);
  }

  const kappa = po === 1 && pe === 1 ? 1 : (po - pe) / (1 - pe);

  const interpretation =
    kappa >= 0.81 ? 'Almost perfect agreement' :
    kappa >= 0.61 ? 'Substantial agreement' :
    kappa >= 0.41 ? 'Moderate agreement' :
    kappa >= 0.21 ? 'Fair agreement' :
    kappa >= 0 ? 'Slight agreement' :
    'Poor agreement (worse than random)';

  return {
    kappa: Math.round(kappa * 1000) / 1000,
    agreement: Math.round(po * 1000) / 10,
    interpretation,
  };
}

// ─── Prompt Templates ───────────────────────────────────────────────────────

function buildComparePrompt(
  prompt: string,
  responseA: string,
  responseB: string,
  rubric: RubricCriterion[],
): string {
  const rubricDescription = rubric.map((c, i) =>
    `${i + 1}. ${c.name} (weight ${Math.round(c.weight * 100)}%): ${c.description}\n   Score each response 1-${c.scale}`
  ).join('\n\n');

  return `
You are an impartial judge evaluating two AI responses to the same user prompt.

Evaluate each response using the following rubric criteria (${rubric.length} dimensions, each scored 1-${rubric[0]!.scale}):

${rubricDescription}

For each criterion, FIRST explain your reasoning for both responses, THEN give scores.

**Original User Prompt:**
"${prompt}"

**Response A:**
"${responseA}"

**Response B:**
"${responseB}"

Return your evaluation in the following EXACT JSON format:
{
  "rubricScores": {
    "accuracy": { "A": <1-5>, "B": <1-5>, "reasoning": "brief explanation" },
    "relevance": { "A": <1-5>, "B": <1-5>, "reasoning": "brief explanation" },
    "clarity": { "A": <1-5>, "B": <1-5>, "reasoning": "brief explanation" },
    "completeness": { "A": <1-5>, "B": <1-5>, "reasoning": "brief explanation" },
    "harmlessness": { "A": <1-5>, "B": <1-5>, "reasoning": "brief explanation" }
  },
  "weightedTotal": { "A": <composite 1-5>, "B": <composite 1-5> },
  "winner": "A" | "B" | "Tie",
  "reasoning": "Overall justification for the winner selection"
}
`.trim();
}

function buildGradePrompt(prompt: string, response: string, rubric: RubricCriterion[]): string {
  const rubricDescription = rubric.map((c, i) =>
    `${i + 1}. ${c.name} (weight ${Math.round(c.weight * 100)}%): ${c.description}\n   Score 1-${c.scale}`
  ).join('\n\n');

  return `
You are an impartial judge evaluating a single AI response.

Evaluate the response using the following rubric criteria (${rubric.length} dimensions, each scored 1-${rubric[0]!.scale}):

${rubricDescription}

For each criterion, explain your reasoning then give a score.

**Original User Prompt:**
"${prompt}"

**Response:**
"${response}"

Return ONLY a single number between 0.0 and 1.0 representing the weighted quality score.
`.trim();
}

// ─── Score Parsing ──────────────────────────────────────────────────────────

function computeWeightedScore(
  rubricScores: Record<string, CriterionScore>,
  rubric: RubricCriterion[],
  side: 'A' | 'B',
): number {
  let total = 0;
  for (const criterion of rubric) {
    const cs = rubricScores[criterion.name];
    if (cs) {
      total += (side === 'A' ? cs.A : cs.B) / criterion.scale * criterion.weight;
    }
  }
  return Math.min(5, Math.max(1, total * 5)); // Scale back to 1-5
}

function determineWinnerFromRubric(
  weightedTotal: { A: number; B: number },
): 'A' | 'B' | 'Tie' {
  const diff = weightedTotal.A - weightedTotal.B;
  const threshold = 0.25; // Minimum difference to declare a winner
  if (diff > threshold) return 'A';
  if (diff < -threshold) return 'B';
  return 'Tie';
}

// ─── Judge Service ──────────────────────────────────────────────────────────

/**
 * JudgeService uses a high-capability LLM to evaluate and compare model outputs.
 * Implements G-Eval style rubric-based evaluation with chain-of-thought reasoning.
 */
export class JudgeService {
  constructor(private router: Router) {}

  /**
   * Compare two model responses head-to-head using rubric-based evaluation.
   *
   * @param prompt - The original user prompt
   * @param responseA - Response from Model A
   * @param responseB - Response from Model B
   * @param judgeModelId - The LLM to use as judge (default: 'gpt-4o')
   * @param shuffleOptions - If true, randomly swap A/B to mitigate position bias
   * @param rubric - Custom rubric criteria (defaults to DEFAULT_RUBRIC)
   */
  async compare(
    prompt: string,
    responseA: string,
    responseB: string,
    judgeModelId: string = 'gpt-4o',
    shuffleOptions: boolean = true,
    rubric: RubricCriterion[] = DEFAULT_RUBRIC,
  ): Promise<EvaluationResult> {
    logger.info({ judgeModelId, shuffleOptions }, 'Starting head-to-head rubric evaluation');

    // Position bias mitigation: randomly swap A/B labels
    const swap = shuffleOptions && Math.random() > 0.5;
    const labelA = swap ? responseB : responseA;
    const labelB = swap ? responseA : responseB;

    const judgePrompt = buildComparePrompt(prompt, labelA, labelB, rubric);

    try {
      const judgeRequest: UnifiedRequest = {
        modality: 'llm',
        model: judgeModelId,
        messages: [{ role: 'user', content: judgePrompt }],
        max_tokens: 1000,
        response_format: { type: 'json_object' },
        stream: false,
        metadata: {
          is_internal: true,
          purpose: 'benchmarking',
        },
      };

      const { response } = await this.router.route(judgeRequest, {
        path: '/v1/chat/completions',
        qualityTarget: 'frontier',
      });

      const content = response.message?.content;
      if (typeof content !== 'string') {
        throw new Error('Judge returned empty response');
      }

      const parsed = JSON.parse(content) as {
        rubricScores?: Record<string, CriterionScore>;
        weightedTotal?: { A: number; B: number };
        winner?: 'A' | 'B' | 'Tie';
        reasoning?: string;
      };

      // Use rubric scores if available, fall back to legacy format
      const rubricScores = parsed.rubricScores;
      const weightedTotal = parsed.weightedTotal;

      // Determine winner from rubric if not explicitly provided
      let winner = parsed.winner ?? 'Tie';
      if (winner === 'Tie' && weightedTotal) {
        winner = determineWinnerFromRubric(weightedTotal);
      }

      // If labels were swapped, invert the winner so it refers to original labeling
      if (swap) {
        if (winner === 'A') winner = 'B';
        else if (winner === 'B') winner = 'A';
      }

      // Build backward-compatible scores
      const weightedA = weightedTotal?.A ?? 5;
      const weightedB = weightedTotal?.B ?? 5;
      const scores = {
        accuracy: Math.round(Math.max(weightedA, weightedB) * 2),
        formatting: rubricScores?.clarity ? Math.round(Math.max(rubricScores.clarity.A, rubricScores.clarity.B) * 2) : 5,
        tone: rubricScores?.harmlessness ? Math.round(Math.max(rubricScores.harmlessness.A, rubricScores.harmlessness.B) * 2) : 5,
      };

      return {
        winner,
        reasoning: parsed.reasoning ?? 'Evaluation completed via rubric scoring',
        scores,
        rubricScores,
        weightedTotal,
      };
    } catch (err) {
      logger.error({ err }, 'Judge rubric evaluation failed');
      throw err;
    }
  }

  /**
   * Run multi-judge ensemble evaluation — three judges evaluate the same pair.
   * Results are aggregated via weighted majority voting.
   * Inter-rater reliability (Cohen's Kappa) is computed between each pair.
   */
  async compareEnsemble(
    prompt: string,
    responseA: string,
    responseB: string,
    judgePanel: JudgeConfig[] = DEFAULT_JUDGE_PANEL,
  ): Promise<EnsembleResult> {
    logger.info({ panelSize: judgePanel.length }, 'Starting ensemble evaluation');

    const results = await Promise.allSettled(
      judgePanel.map(j => this.compare(prompt, responseA, responseB, j.modelId, true).then(
        r => ({ judge: j, result: r }),
      )),
    );

    const judgments: JudgeVerdict[] = [];

    for (const settled of results) {
      if (settled.status === 'rejected') {
        logger.warn({ reason: settled.reason }, 'Ensemble judge failed');
        continue;
      }
      const { judge, result } = settled.value;
      judgments.push({
        judgeId: judge.modelId,
        judgeLabel: judge.label,
        winner: result.winner,
        rubricScores: result.rubricScores ?? {},
        weightedTotal: result.weightedTotal ?? { A: 3, B: 3 },
      });
    }

    if (judgments.length === 0) {
      throw new Error('All ensemble judges failed');
    }

    // Weighted majority voting
    const votes = { A: 0, B: 0, Tie: 0 };
    let totalWeight = 0;
    let sumWeightedA = 0;
    let sumWeightedB = 0;

    for (const j of judgments) {
      const w = judgePanel.find(p => p.modelId === j.judgeId)?.weight ?? 1;
      votes[j.winner] += w;
      totalWeight += w;
      sumWeightedA += j.weightedTotal.A * w;
      sumWeightedB += j.weightedTotal.B * w;
    }

    const avgWeightedA = sumWeightedA / totalWeight;
    const avgWeightedB = sumWeightedB / totalWeight;

    // Determine overall winner by weighted majority
    let winner: 'A' | 'B' | 'Tie';
    if (votes.A > votes.B && votes.A > votes.Tie) winner = 'A';
    else if (votes.B > votes.A && votes.B > votes.Tie) winner = 'B';
    else winner = 'Tie';

    // Confidence based on agreement level
    const maxVotes = Math.max(votes.A, votes.B, votes.Tie);
    const agreementRatio = maxVotes / totalWeight;
    const confidence = agreementRatio > 0.7 ? agreementRatio :
      agreementRatio > 0.4 ? agreementRatio * 0.85 : agreementRatio * 0.6;
    const clampedConfidence = Math.round(Math.min(1, Math.max(0, confidence)) * 1000) / 1000;

    // Cohen's Kappa between each pair
    const kappaMatrix: Record<string, Record<string, number>> = {};
    for (let i = 0; i < judgments.length; i++) {
      for (let j = i + 1; j < judgments.length; j++) {
        const a = judgments[i]!;
        const b = judgments[j]!;
        const result = calculateKappa(
          [{ winner: a.winner }],
          [{ winner: b.winner }],
        );
        kappaMatrix[a.judgeId] = kappaMatrix[a.judgeId] ?? {};
        kappaMatrix[b.judgeId] = kappaMatrix[b.judgeId] ?? {};
        kappaMatrix[a.judgeId]![b.judgeId] = result.kappa;
        kappaMatrix[b.judgeId]![a.judgeId] = result.kappa;
      }
    }

    return {
      winner,
      confidence: clampedConfidence,
      votes,
      judgments,
      averageWeightedTotal: { A: avgWeightedA, B: avgWeightedB },
      kappaMatrix,
    };
  }

  /**
   * Store inter-rater reliability metrics in the database.
   */
  async storeJudgeReliability(
    battleId: string,
    judgeA: string,
    judgeB: string,
    kappa: number,
    agreementPercent: number,
  ): Promise<void> {
    const db = getDb();
    db.prepare(`
      INSERT INTO judge_reliability (id, battle_id, judge_model_a, judge_model_b, kappa, agreement_percent, total_comparisons)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(randomUUID(), battleId, judgeA, judgeB, kappa, agreementPercent);

    eventBus.emit(SystemEvents.JUDGE_RELIABILITY_UPDATED, {
      battleId,
      judgeA,
      judgeB,
      kappa,
      agreementPercent,
    });
  }

  /**
   * Single model evaluation using rubric-based grading.
   * Returns a score between 0.0 and 1.0.
   */
  async grade(
    prompt: string,
    response: string,
    judgeModelId: string = 'gpt-4o',
    rubric: RubricCriterion[] = DEFAULT_RUBRIC,
  ): Promise<number> {
    const judgePrompt = buildGradePrompt(prompt, response, rubric);

    try {
      const judgeRequest: UnifiedRequest = {
        modality: 'llm',
        model: judgeModelId,
        messages: [{ role: 'user', content: judgePrompt }],
        max_tokens: 10,
        stream: false,
        metadata: { is_internal: true },
      };

      const { response: judgeResponse } = await this.router.route(judgeRequest, {
        path: '/v1/chat/completions',
      });

      const content = judgeResponse.message?.content;
      const score = parseFloat(typeof content === 'string' ? content : '0');
      return isNaN(score) ? 0.5 : Math.max(0, Math.min(1, score));
    } catch (err) {
      logger.error({ err }, 'Judge rubric grading failed');
      return 0.5;
    }
  }
}
