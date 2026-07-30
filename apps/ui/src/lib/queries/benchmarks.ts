import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Admin, api } from '../admin';
import { keys } from '../queryClient';

import type { PollOptions } from './types';
import type { ApiBenchmarkResult, ApiBenchmarkLeaderboardEntry } from '@/types/api';

// ---------------------------------------------------------------------------
// Benchmarks, arena battles & judge validation
// ---------------------------------------------------------------------------

interface Battle {
  id: string;
  benchmark_type: string;
  run_at: string;
  score: number;
  model_name: string;
  details: {
    reasoning?: string;
    competitor_name?: string;
    scores?: { accuracy?: number; tone?: number };
    elo_change?: number;
  };
}

interface ModelSummary {
  id: string;
  display_name?: string;
  model_id?: string;
  provider_name?: string;
  elo_rating?: number;
}

interface TournamentResult {
  status: string;
  completed: number;
  totalBattles: number;
  errors: number;
  promptCategory?: string;
}

interface ValidationBattle {
  id: string;
  modelA: { id?: string; name: string; provider: string };
  modelB: { id?: string; name: string; provider: string };
  judgeWinner: 'A' | 'B';
  judgeReasoning?: string;
}

interface ValidationStats {
  total: number;
  agreementRate: number;
  agreedCount: number;
}

interface ValidationRecord {
  id: string;
  agreed: boolean;
  judge_winner: string;
  human_winner: string;
  model_a_name?: string;
  model_b_name?: string;
  created_at?: string;
}

interface ModelDetailStats {
  categoryScores?: Array<{ benchmark_type: string; avg_score: number; count: number }>;
}

interface ModelDetailHistory {
  totalBattles?: number;
  eloTrace?: Array<{ elo: number; date: string }>;
}

export type {
  Battle,
  ModelSummary,
  TournamentResult,
  ValidationBattle,
  ValidationStats,
  ValidationRecord,
  ModelDetailStats,
  ModelDetailHistory,
};

// ── Queries ────────────────────────────────────────────────────────────────

export function useLeaderboard(options?: PollOptions) {
  return useQuery({
    queryKey: keys.benchmarks.leaderboard(),
    queryFn: () => Admin.getLeaderboard() as Promise<ApiBenchmarkLeaderboardEntry[]>,
    ...options,
  });
}

export function useArenaBattles(options?: PollOptions) {
  return useQuery({
    queryKey: keys.benchmarks.battles(),
    queryFn: () => Admin.getBattles() as Promise<Battle[]>,
    ...options,
  });
}

export function useBenchmarkHistory(options?: PollOptions) {
  return useQuery({
    queryKey: keys.benchmarks.history(),
    queryFn: () => Admin.listBenchmarks(),
    ...options,
  });
}

export function useBenchmarkModels(options?: PollOptions) {
  return useQuery({
    queryKey: keys.benchmarks.models(),
    queryFn: () => Admin.getAllModels() as Promise<ModelSummary[]>,
    ...options,
  });
}

/** On-demand — loaded when the operator opens the validation review tab, not on mount. */
export function useValidations(options?: PollOptions) {
  return useQuery({
    queryKey: keys.benchmarks.validations(),
    queryFn: () => api<{ stats: ValidationStats | null; validations: ValidationRecord[] }>('/admin/benchmarks/validations'),
    enabled: false,
    ...options,
  });
}

export function useModelDetail(modelId: string | undefined) {
  return useQuery({
    queryKey: keys.benchmarks.modelStats(modelId ?? ''),
    queryFn: async () => {
      if (!modelId) throw new Error('No model selected');
      const [stats, history] = await Promise.all([
        api<ModelDetailStats>(`/admin/benchmarks/models/${modelId}/stats`),
        api<ModelDetailHistory>(`/admin/benchmarks/models/${modelId}/history`),
      ]);
      return { stats, history };
    },
    enabled: !!modelId,
  });
}

// ── Mutations ──────────────────────────────────────────────────────────────

export function useRunBenchmark() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { models: string[]; promptSet: string; concurrency: number }) => Admin.runBenchmark(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.benchmarks.history() }),
  });
}

export function useRunArenaBattle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ modelA, modelB, prompt, category, difficulty }: {
      modelA: string;
      modelB: string;
      prompt?: string;
      category?: string;
      difficulty?: string;
    }) => Admin.runArenaBattle(modelA, modelB, prompt, category, difficulty),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.benchmarks.battles() }),
  });
}

export function useRunTournament() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { modelIds: string[]; category?: string; difficulty?: string; prompt?: string }) =>
      api<TournamentResult>('/admin/benchmarks/tournament', { method: 'POST', body: payload }),
    onSuccess: (result) => {
      if (result.status === 'completed') {
        void qc.invalidateQueries({ queryKey: keys.benchmarks.leaderboard() });
      }
    },
  });
}

export function usePostValidation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { battleId: string; humanWinner: 'A' | 'B' | 'Tie'; reviewerId?: string }) =>
      api<{ success: boolean; agreementRate: number }>('/admin/benchmarks/validate', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.benchmarks.validations() }),
  });
}

export async function fetchNextValidationBattle(): Promise<{ battle: ValidationBattle | null }> {
  return api<{ battle: ValidationBattle | null }>('/admin/benchmarks/validate/next');
}
