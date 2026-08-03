import { Trophy, Plus, Clock, TrendingUp, Swords, Info, Activity, ShieldCheck } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router';

import { BarSeriesChart } from '@/components/charts/BarSeriesChart';
import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogBody, DialogFooter,
  DialogClose,
} from '@/components/primitives/Dialog';
import { interpretError, InlineError } from '@/components/primitives/ErrorState';
import { Input } from '@/components/primitives/Input';
import { MultiSelect, type MultiSelectOption } from '@/components/primitives/MultiSelect';
import { Progress } from '@/components/primitives/Progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/primitives/Tabs';
import { Textarea } from '@/components/primitives/Textarea';
import { toast } from '@/components/primitives/Toast';
import { useApiData } from '@/hooks/useApiData';
import { Admin, api } from '@/lib/admin';
import { chartColor } from '@/lib/chartPalette';
import { formatDuration, formatNumber, timeAgo } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { ApiBenchmarkResult, ApiBenchmarkLeaderboardEntry } from '@/types/api';

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

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

interface ValidationBattleModel {
  id?: string;
  name: string;
  provider: string;
}

interface ValidationBattle {
  id: string;
  modelA: ValidationBattleModel;
  modelB: ValidationBattleModel;
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

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

// Radix `Select.Item` rejects an empty-string value, so "no filter" states use
// a sentinel that's translated back to '' (the value the API calls expect)
// right where the Select is wired up.
const SENTINEL_ALL = '__all__';
const SENTINEL_ANY = '__any__';
const SENTINEL_RANDOM = '__random__';
const SENTINEL_DEFAULT = '__default__';

const CATEGORY_OPTIONS = [
  { value: 'reasoning', label: 'Reasoning' },
  { value: 'instruction', label: 'Instruction' },
  { value: 'creative', label: 'Creative' },
  { value: 'coding', label: 'Coding' },
  { value: 'knowledge', label: 'Knowledge' },
  { value: 'safety', label: 'Safety' },
];

const QUICK_TEST_CATEGORY_OPTIONS = [
  { value: 'reasoning', label: 'Reasoning' },
  { value: 'instruction', label: 'Instruction Following' },
  { value: 'creative', label: 'Creative' },
  { value: 'coding', label: 'Coding' },
  { value: 'knowledge', label: 'Knowledge' },
  { value: 'multilingual', label: 'Multilingual' },
  { value: 'safety', label: 'Safety' },
];

const DIFFICULTY_OPTIONS = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

/* -------------------------------------------------------------------------- */
/*  API helpers                                                               */
/*                                                                             */
/*  These endpoints have no wrapper in lib/admin.ts yet, so they call the     */
/*  shared `api()` helper directly (same paths the old hand-rolled `fetch`    */
/*  calls used) instead of duplicating auth-header plumbing.                 */
/* -------------------------------------------------------------------------- */

async function fetchTournament(payload: {
  modelIds: string[];
  category?: string;
  difficulty?: string;
  prompt?: string;
}): Promise<TournamentResult> {
  return api<TournamentResult>('/admin/benchmarks/tournament', { method: 'POST', body: payload });
}

async function fetchModelStats(modelId: string): Promise<ModelDetailStats> {
  return api<ModelDetailStats>(`/admin/benchmarks/models/${modelId}/stats`);
}

async function fetchModelHistory(modelId: string): Promise<ModelDetailHistory> {
  return api<ModelDetailHistory>(`/admin/benchmarks/models/${modelId}/history`);
}

async function fetchNextValidationBattle(): Promise<{ battle: ValidationBattle | null }> {
  return api<{ battle: ValidationBattle | null }>('/admin/benchmarks/validate/next');
}

async function postValidation(body: {
  battleId: string;
  humanWinner: 'A' | 'B' | 'Tie';
  reviewerId?: string;
}): Promise<{ success: boolean; agreementRate: number }> {
  return api<{ success: boolean; agreementRate: number }>('/admin/benchmarks/validate', {
    method: 'POST',
    body,
  });
}

async function fetchValidations(): Promise<{ stats: ValidationStats | null; validations: ValidationRecord[] }> {
  return api<{ stats: ValidationStats | null; validations: ValidationRecord[] }>('/admin/benchmarks/validations');
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export function BenchmarksPage() {
  const [activeTab, setActiveTab] = React.useState('leaderboard');

  const leaderboard = useApiData<ApiBenchmarkLeaderboardEntry[]>(() => Admin.getLeaderboard(), [], { refetchInterval: 60000 });
  const battles = useApiData<Battle[]>(() => Admin.getBattles(), [], { refetchInterval: 30000 });
  const history = useApiData<ApiBenchmarkResult[]>(() => Admin.listBenchmarks(), [], { refetchInterval: 60000 });
  const models = useApiData<ModelSummary[]>(() => Admin.getAllModels(), []);

  const modelOptions = React.useMemo<MultiSelectOption[]>(
    () =>
      (models.data ?? []).map((m) => ({
        value: m.id,
        label: m.display_name || m.model_id || m.id,
        description: m.elo_rating
          ? `${m.provider_name ?? 'unknown provider'} · Elo ${Math.round(m.elo_rating)}`
          : m.provider_name,
      })),
    [models.data]
  );

  // Quick Test dialog state
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [quickTestModels, setQuickTestModels] = React.useState<string[]>([]);
  const [quickTestCategory, setQuickTestCategory] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  // Arena dialog state
  const [arenaDialogOpen, setArenaDialogOpen] = React.useState(false);
  const [arenaModelA, setArenaModelA] = React.useState('');
  const [arenaModelB, setArenaModelB] = React.useState('');
  const [arenaCustomPrompt, setArenaCustomPrompt] = React.useState('');
  const [arenaCategory, setArenaCategory] = React.useState('');
  const [arenaDifficulty, setArenaDifficulty] = React.useState('');
  const [submittingArena, setSubmittingArena] = React.useState(false);

  // Validation state
  const [validationTab, setValidationTab] = React.useState<'review' | 'history'>('review');
  const [currentBattle, setCurrentBattle] = React.useState<ValidationBattle | null>(null);
  const [loadingBattle, setLoadingBattle] = React.useState(false);
  const [reviewerId, setReviewerId] = React.useState('');
  const [verdictSubmitting, setVerdictSubmitting] = React.useState<'A' | 'B' | 'Tie' | null>(null);
  // `enabled: false` — this is triggered on demand (tab switch / after a
  // submission), not on mount, so DataState only ever sees it mid-flight.
  const validation = useApiData<{ stats: ValidationStats | null; validations: ValidationRecord[] }>(
    fetchValidations,
    [],
    { enabled: false }
  );

  // Tournament state
  const [tournamentDialogOpen, setTournamentDialogOpen] = React.useState(false);
  const [selectedTournamentModels, setSelectedTournamentModels] = React.useState<string[]>([]);
  const [tournamentCategory, setTournamentCategory] = React.useState('');
  const [tournamentDifficulty, setTournamentDifficulty] = React.useState('');
  const [tournamentCustomPrompt, setTournamentCustomPrompt] = React.useState('');
  const [submittingTournament, setSubmittingTournament] = React.useState(false);
  const [tournamentResults, setTournamentResults] = React.useState<TournamentResult | null>(null);

  // Model detail dialog state — derived from the leaderboard so it always
  // reflects the latest fetch instead of a stale click-time snapshot.
  const [detailModelId, setDetailModelId] = React.useState<string | null>(null);
  const detailModel = detailModelId ? (leaderboard.data?.find((m) => m.id === detailModelId) ?? null) : null;
  const modelDetail = useApiData<{ stats: ModelDetailStats; history: ModelDetailHistory }>(
    async () => {
      if (!detailModelId) throw new Error('No model selected');
      const [stats, hist] = await Promise.all([
        fetchModelStats(detailModelId),
        fetchModelHistory(detailModelId),
      ]);
      return { stats, history: hist };
    },
    [detailModelId],
    { enabled: !!detailModelId }
  );

  const handleRunBenchmark = async () => {
    setSubmitting(true);
    try {
      await Admin.runBenchmark({
        models: quickTestModels,
        promptSet: quickTestCategory || 'default',
        concurrency: 1,
      });
      toast.success('Benchmark started', {
        description: 'Running in the background — results will appear in Execution History.',
      });
      setDialogOpen(false);
      void history.refetch();
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRunArenaBattle = async () => {
    setSubmittingArena(true);
    try {
      await Admin.runArenaBattle(
        arenaModelA,
        arenaModelB,
        arenaCustomPrompt || undefined,
        arenaCategory || undefined,
        arenaDifficulty || undefined
      );
      toast.success('Arena battle started', {
        description: 'Check the Arena Battles tab shortly for the result.',
      });
      setArenaDialogOpen(false);
      void battles.refetch();
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    } finally {
      setSubmittingArena(false);
    }
  };

  const handleRunTournament = async () => {
    if (selectedTournamentModels.length < 2) {
      toast.error('Select at least 2 models', {
        description: 'Choose two or more models to run a round-robin tournament.',
      });
      return;
    }
    setSubmittingTournament(true);
    setTournamentResults(null);
    try {
      const result = await fetchTournament({
        modelIds: selectedTournamentModels,
        category: tournamentCategory || undefined,
        difficulty: tournamentDifficulty || undefined,
        prompt: tournamentCustomPrompt || undefined,
      });
      if (result.status === 'completed') {
        toast.success('Tournament complete', {
          description: `${result.completed}/${result.totalBattles} battles finished.`,
        });
        setTournamentResults(result);
        void leaderboard.refetch();
      } else {
        toast.warning('Tournament did not finish', {
          description: 'Check the gateway logs for details, then try again.',
        });
      }
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    } finally {
      setSubmittingTournament(false);
    }
  };

  const loadNextValidationBattle = React.useCallback(async () => {
    setLoadingBattle(true);
    try {
      const data = await fetchNextValidationBattle();
      setCurrentBattle(data.battle);
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    } finally {
      setLoadingBattle(false);
    }
  }, []);

  const submitValidation = async (humanWinner: 'A' | 'B' | 'Tie') => {
    if (!currentBattle) return;
    setVerdictSubmitting(humanWinner);
    try {
      const result = await postValidation({
        battleId: currentBattle.id,
        humanWinner,
        reviewerId: reviewerId || undefined,
      });
      if (result.success) {
        toast.success('Validation recorded', {
          description: `Judge agreement rate is now ${result.agreementRate}%.`,
        });
        void validation.refetch();
        void loadNextValidationBattle();
      }
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    } finally {
      setVerdictSubmitting(null);
    }
  };

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Benchmark Lab"
        description="Elo-based competitive rankings and performance analysis"
        icon={<Trophy className="size-5" />}
        actions={
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void leaderboard.refetch()}
              loading={leaderboard.isLoading && leaderboard.data != null}
              aria-label="Refresh leaderboard"
            >
              <Activity className="size-3 mr-1" aria-hidden />
              Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={() => setTournamentDialogOpen(true)} aria-label="Open tournament dialog">
              <Swords className="size-3 mr-1" aria-hidden />
              Tournament
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(true)} aria-label="Open quick test dialog">
              <Plus className="size-3 mr-1" aria-hidden />
              Quick Test
            </Button>
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-5">
        <TabsList>
          <TabsTrigger value="leaderboard">
            <Trophy className="size-3 mr-2" aria-hidden />
            Leaderboard
          </TabsTrigger>
          <TabsTrigger value="arena">
            <Swords className="size-3 mr-2" aria-hidden />
            Arena Battles
          </TabsTrigger>
          <TabsTrigger value="history">
            <Clock className="size-3 mr-2" aria-hidden />
            Execution History
          </TabsTrigger>
          <TabsTrigger value="validation">
            <ShieldCheck className="size-3 mr-2" aria-hidden />
            Validation
          </TabsTrigger>
        </TabsList>

        {/* ==================== LEADERBOARD ==================== */}
        <TabsContent value="leaderboard" className="mt-4">
          <DataState
            data={leaderboard.data}
            isLoading={leaderboard.isLoading}
            error={leaderboard.error}
            onRetry={leaderboard.refetch}
            loading={
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card className="lg:col-span-2" padding="none">
                  <div className="p-3 space-y-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </div>
                </Card>
                <Skeleton className="h-64 w-full" />
              </div>
            }
            empty={{
              icon: <Trophy className="size-8" />,
              title: 'No leaderboard data yet',
              description: 'Run a quick test or tournament to start ranking models.',
              action: (
                <Button size="sm" onClick={() => setDialogOpen(true)}>
                  <Plus className="size-3 mr-1" aria-hidden />
                  Quick Test
                </Button>
              ),
            }}
          >
            {(entries) => (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card className="lg:col-span-2" padding="none">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-border bg-surface-2">
                          <th scope="col" className="p-3 text-[10px] font-semibold text-fg-muted uppercase">Rank</th>
                          <th scope="col" className="p-3 text-[10px] font-semibold text-fg-muted uppercase">Model</th>
                          <th scope="col" className="p-3 text-[10px] font-semibold text-fg-muted uppercase">Elo Rating</th>
                          <th scope="col" className="p-3 text-[10px] font-semibold text-fg-muted uppercase">Quality</th>
                          <th scope="col" className="p-3 text-[10px] font-semibold text-fg-muted uppercase">Latency</th>
                          <th scope="col" className="p-3 text-[10px] font-semibold text-fg-muted uppercase">Tier</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entries.map((model, i) => (
                          <tr
                            key={model.id}
                            tabIndex={0}
                            role="button"
                            aria-label={`View details for ${model.display_name}`}
                            onClick={() => setDetailModelId(model.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setDetailModelId(model.id);
                              }
                            }}
                            className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset"
                          >
                            <td className="p-3 font-mono text-xs text-fg-muted">#{i + 1}</td>
                            <td className="p-3">
                              <div className="flex flex-col">
                                <span className="text-xs font-medium text-fg">{model.display_name}</span>
                                <span className="text-[10px] text-fg-muted">{model.provider_name} / {model.model_id}</span>
                              </div>
                            </td>
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-primary font-mono">{Math.round(model.elo_rating)}</span>
                                {model.confidenceInterval && model.confidenceInterval.games > 0 && (
                                  <span
                                    className="text-[10px] font-mono text-fg-muted"
                                    title={`95% CI: ${model.confidenceInterval.lower}–${model.confidenceInterval.upper} (based on ${model.confidenceInterval.games} battles)`}
                                  >
                                    ±{Math.round(model.confidenceInterval.margin)}
                                  </span>
                                )}
                                {i === 0 && <Badge tone="warning" size="sm">Champion</Badge>}
                              </div>
                            </td>
                            <td className="p-3">
                              <div className="flex items-center gap-2">
                                <Progress
                                  value={(model.quality_score || 0.5) * 100}
                                  className="w-16"
                                  aria-label={`${model.display_name} quality score`}
                                />
                                <span className="text-[10px] font-mono">{((model.quality_score || 0.5) * 100).toFixed(1)}%</span>
                              </div>
                            </td>
                            <td className="p-3 text-xs font-mono text-fg-muted">{formatDuration(model.avg_latency_ms)}</td>
                            <td className="p-3">
                              <Badge tone="muted" size="sm">{model.capability_tier}</Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>

                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-xs flex items-center">
                        <TrendingUp className="size-3 mr-2 text-primary" aria-hidden />
                        Elo Distribution
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="h-48 pt-0">
                      <BarSeriesChart
                        data={entries.slice(0, 8).map((m) => ({ name: m.display_name, elo: m.elo_rating }))}
                        xKey="name"
                        bars={[{ key: 'elo', color: chartColor('primary') }]}
                        height={160}
                        hideGrid
                      />
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-xs flex items-center">
                        <Info className="size-3 mr-2 text-fg-muted" aria-hidden />
                        About Elo Rankings
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-[11px] text-fg-muted leading-relaxed pt-0">
                      Ratings are calculated using an Elo system (K=8) based on blind pairwise comparisons by a high-capability AI Judge (GPT-4o).
                      Human feedback from the Playground is weighted 2-4x higher than AI Judge outcomes.
                      Confidence intervals (95%) are shown based on the number of battles recorded — wider intervals indicate fewer data points.
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </DataState>
        </TabsContent>

        {/* ==================== ARENA BATTLES ==================== */}
        <TabsContent value="arena" className="mt-4">
          <div className="flex justify-end mb-4">
            <Button size="sm" onClick={() => setArenaDialogOpen(true)}>
              <Swords className="size-3 mr-1" aria-hidden />
              Run Arena Battle
            </Button>
          </div>
          <DataState
            data={battles.data}
            isLoading={battles.isLoading}
            error={battles.error}
            onRetry={battles.refetch}
            loading={
              <div className="space-y-4">
                {Array.from({ length: 2 }).map((_, i) => (
                  <Skeleton key={i} className="h-48 w-full" />
                ))}
              </div>
            }
            empty={{
              icon: <Swords className="size-8" />,
              title: 'No battles recorded',
              description: 'Run an arena battle to compare two models head-to-head.',
              action: (
                <Button size="sm" onClick={() => setArenaDialogOpen(true)}>
                  <Swords className="size-3 mr-1" aria-hidden />
                  Run Arena Battle
                </Button>
              ),
            }}
          >
            {(items) => (
              <div className="grid grid-cols-1 gap-4">
                {items.map((battle) => (
                  <Card key={battle.id} padding="none">
                    <div className="p-3 border-b border-border flex items-center justify-between bg-surface-2">
                      <div className="flex items-center gap-3">
                        <Swords className="size-4 text-primary" aria-hidden />
                        <span className="text-xs font-semibold">Arena Battle: {battle.benchmark_type}</span>
                      </div>
                      <span className="text-[10px] text-fg-muted">{timeAgo(battle.run_at)}</span>
                    </div>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-8">
                        <div className={cn('flex-1 p-3 rounded-lg border', battle.score === 1 ? 'border-primary bg-primary/5' : 'border-border')}>
                          <div className="flex justify-between mb-1">
                            <span className="text-xs font-bold">{battle.model_name}</span>
                            {battle.score === 1 && <Badge tone="primary" size="sm">Winner</Badge>}
                          </div>
                          <p className="text-[10px] text-fg-muted italic line-clamp-2">"{battle.details.reasoning || 'No details available'}"</p>
                        </div>

                        <div className="flex flex-col items-center gap-1">
                          <span className="text-[10px] font-bold text-fg-muted">VS</span>
                          <div className="h-8 w-px bg-border" />
                        </div>

                        <div className={cn('flex-1 p-3 rounded-lg border', battle.score === 0 ? 'border-primary bg-primary/5' : 'border-border')}>
                          <div className="flex justify-between mb-1">
                            <span className="text-xs font-bold">{battle.details.competitor_name || 'Competitor'}</span>
                            {battle.score === 0 && <Badge tone="primary" size="sm">Winner</Badge>}
                          </div>
                          <p className="text-[10px] text-fg-muted italic line-clamp-2">{battle.details.reasoning || '...'}</p>
                        </div>
                      </div>

                      <div className="mt-3 pt-3 border-t border-border flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase text-fg-muted">Accuracy</span>
                          <span className="text-xs font-mono">{battle.details.scores?.accuracy}/10</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase text-fg-muted">Tone</span>
                          <span className="text-xs font-mono">{battle.details.scores?.tone}/10</span>
                        </div>
                        <div className="ml-auto">
                          <span className="text-[10px] text-fg-muted mr-2">Elo Change:</span>
                          <span className={cn('text-xs font-bold font-mono', battle.score === 1 ? 'text-primary' : 'text-fg-muted')}>
                            {battle.score === 1 ? '+' : ''}{Math.round(battle.details.elo_change || 0)}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </DataState>
        </TabsContent>

        {/* ==================== EXECUTION HISTORY ==================== */}
        <TabsContent value="history" className="mt-4">
          <DataState
            data={history.data}
            isLoading={history.isLoading}
            error={history.error}
            onRetry={history.refetch}
            loading={
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-48 w-full" />
                ))}
              </div>
            }
            empty={{
              icon: <Clock className="size-8" />,
              title: 'No executions yet',
              description: 'Full-sweep benchmark runs will appear here once you run a quick test.',
              action: (
                <Button size="sm" onClick={() => setDialogOpen(true)}>
                  <Plus className="size-3 mr-1" aria-hidden />
                  Quick Test
                </Button>
              ),
            }}
          >
            {(items) => (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {items.map((b) => (
                  <Card key={b.id} padding="none">
                    <div className="p-4 border-b border-border flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-fg">{b.name}</h3>
                        <p className="text-[10px] text-fg-muted mt-0.5">
                          {b.models?.length ?? 0} models · {b.promptCount} prompts · {b.runAt ? timeAgo(b.runAt) : '—'}
                        </p>
                      </div>
                      <Badge tone="primary" size="sm">completed</Badge>
                    </div>
                    <CardContent className="p-4">
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <p className="text-[10px] text-fg-muted uppercase tracking-wider">Avg latency</p>
                          <p className="text-lg font-semibold text-fg mt-0.5 font-mono">{formatDuration(b.avgLatencyMs ?? 0)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-fg-muted uppercase tracking-wider">Throughput</p>
                          <p className="text-lg font-semibold text-fg mt-0.5 font-mono">{formatNumber(b.throughput ?? 0, true)}/s</p>
                        </div>
                      </div>
                      {b.byModel && (
                        <BarSeriesChart
                          data={Object.entries(b.byModel).map(([model, latency]) => ({ model, latency }))}
                          xKey="model"
                          bars={[{ key: 'latency', color: chartColor('accent') }]}
                          height={140}
                          yFormatter={(v) => formatDuration(v)}
                        />
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </DataState>
        </TabsContent>

        {/* ==================== VALIDATION ==================== */}
        <TabsContent value="validation" className="mt-4">
          <div className="flex gap-2 mb-4">
            <Button size="sm" variant={validationTab === 'review' ? 'primary' : 'ghost'} onClick={() => setValidationTab('review')}>
              Review Battle
            </Button>
            <Button
              size="sm"
              variant={validationTab === 'history' ? 'primary' : 'ghost'}
              onClick={() => { setValidationTab('history'); void validation.refetch(); }}
            >
              Validation History
            </Button>
          </div>

          {validationTab === 'review' && (
            <div className="space-y-4">
              {!currentBattle && !loadingBattle && (
                <div className="text-center py-8">
                  <Button onClick={() => void loadNextValidationBattle()}>Load Next Battle for Review</Button>
                </div>
              )}
              {!currentBattle && loadingBattle && <Skeleton className="h-64 w-full" />}
              {currentBattle && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <ShieldCheck className="size-4 text-primary" aria-hidden />
                      Judge Decision Review
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-surface-2 rounded-lg">
                      <div>
                        <span className="text-xs uppercase text-fg-muted">Model A</span>
                        <p className="text-sm font-semibold">{currentBattle.modelA.name}</p>
                        <p className="text-[10px] text-fg-muted">{currentBattle.modelA.provider}</p>
                        {currentBattle.modelA.id && (
                          <p className="text-[9px] font-mono text-fg-subtle mt-0.5">ID: {currentBattle.modelA.id.slice(0, 8)}…</p>
                        )}
                      </div>
                      <Badge tone={currentBattle.judgeWinner === 'A' ? 'primary' : 'muted'}>
                        {currentBattle.judgeWinner === 'A' ? 'Judge says A wins' : 'Judge says B wins'}
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-surface-2 rounded-lg">
                      <div>
                        <span className="text-xs uppercase text-fg-muted">Model B</span>
                        <p className="text-sm font-semibold">{currentBattle.modelB.name}</p>
                        <p className="text-[10px] text-fg-muted">{currentBattle.modelB.provider}</p>
                        {currentBattle.modelB.id && (
                          <p className="text-[9px] font-mono text-fg-subtle mt-0.5">ID: {currentBattle.modelB.id.slice(0, 8)}…</p>
                        )}
                      </div>
                      <Badge tone={currentBattle.judgeWinner === 'B' ? 'primary' : 'muted'}>
                        {currentBattle.judgeWinner === 'B' ? 'Judge says B wins' : 'Judge says A wins'}
                      </Badge>
                    </div>

                    {currentBattle.judgeReasoning && (
                      <div>
                        <p className="text-[10px] uppercase text-fg-muted mb-1">Judge Reasoning</p>
                        <p className="text-xs p-3 bg-surface-2 rounded border border-border italic">
                          "{currentBattle.judgeReasoning}"
                        </p>
                      </div>
                    )}

                    <div>
                      <label htmlFor="reviewer-id" className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">
                        Your reviewer ID (optional)
                      </label>
                      <Input
                        id="reviewer-id"
                        placeholder="e.g. your name or handle"
                        value={reviewerId}
                        onChange={(e) => setReviewerId(e.target.value)}
                        className="text-xs"
                      />
                    </div>

                    <div>
                      <p className="text-[10px] uppercase text-fg-muted mb-2">Your Verdict</p>
                      <div className="flex gap-2">
                        <Button
                          onClick={() => void submitValidation('A')}
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          loading={verdictSubmitting === 'A'}
                          disabled={verdictSubmitting !== null && verdictSubmitting !== 'A'}
                        >
                          A Wins
                        </Button>
                        <Button
                          onClick={() => void submitValidation('Tie')}
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          loading={verdictSubmitting === 'Tie'}
                          disabled={verdictSubmitting !== null && verdictSubmitting !== 'Tie'}
                        >
                          Tie
                        </Button>
                        <Button
                          onClick={() => void submitValidation('B')}
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          loading={verdictSubmitting === 'B'}
                          disabled={verdictSubmitting !== null && verdictSubmitting !== 'B'}
                        >
                          B Wins
                        </Button>
                      </div>
                    </div>

                    <div className="flex justify-between">
                      <Button variant="ghost" size="sm" onClick={() => setCurrentBattle(null)} disabled={loadingBattle}>
                        Skip
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void loadNextValidationBattle()} loading={loadingBattle}>
                        Next Battle
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {validationTab === 'history' && (
            <DataState
              data={validation.data}
              isLoading={validation.isLoading}
              error={validation.error}
              onRetry={validation.refetch}
              isEmpty={(d) => d.validations.length === 0}
              loading={
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <Skeleton key={i} className="h-20 w-full" />
                    ))}
                  </div>
                  <Skeleton className="h-16 w-full" />
                </div>
              }
              empty={{
                icon: <ShieldCheck className="size-8" />,
                title: 'No validations yet',
                description: 'Review battles to start tracking judge accuracy.',
              }}
            >
              {(data) => (
                <div className="space-y-4">
                  {data.stats && (
                    <div className="grid grid-cols-3 gap-3" aria-live="polite">
                      <Card>
                        <CardContent className="p-4 text-center">
                          <p className="text-2xl font-bold text-primary font-mono">{data.stats.total}</p>
                          <p className="text-[10px] text-fg-muted uppercase">Total Validations</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 text-center">
                          <p className="text-2xl font-bold text-success font-mono">{data.stats.agreementRate}%</p>
                          <p className="text-[10px] text-fg-muted uppercase">Judge Agreement</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 text-center">
                          <p className="text-2xl font-bold text-fg font-mono">{data.stats.agreedCount}/{data.stats.total}</p>
                          <p className="text-[10px] text-fg-muted uppercase">Correct / Total</p>
                        </CardContent>
                      </Card>
                    </div>
                  )}
                  <div className="space-y-2">
                    {data.validations.map((v) => (
                      <Card key={v.id} padding="none">
                        <div className="p-3 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Badge tone={v.agreed ? 'primary' : 'danger'} size="sm">
                              {v.agreed ? 'Agreed' : 'Disagreed'}
                            </Badge>
                            <div className="text-xs space-y-0.5">
                              <div>
                                <span className="text-fg-muted">Judge: </span>
                                <span className="font-mono">{v.judge_winner}</span>
                                <span className="text-fg-muted mx-1">→ Human: </span>
                                <span className="font-mono">{v.human_winner}</span>
                              </div>
                              {(v.model_a_name || v.model_b_name) && (
                                <div className="text-[10px] text-fg-subtle">
                                  {v.model_a_name ?? '?'} <span className="text-fg-subtle/60">vs</span> {v.model_b_name ?? '?'}
                                </div>
                              )}
                            </div>
                          </div>
                          <span className="text-[10px] text-fg-muted">{v.created_at ? timeAgo(v.created_at) : ''}</span>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </DataState>
          )}
        </TabsContent>
      </Tabs>

      {/* Tournament Dialog */}
      <Dialog open={tournamentDialogOpen} onOpenChange={setTournamentDialogOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Round-Robin Tournament</DialogTitle>
            <DialogDescription>Select 2-10 models to battle every pair combination. Results are ranked by total wins.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="space-y-4">
              <div role="group" aria-label={`Select models (${selectedTournamentModels.length} selected)`}>
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">
                  Select models ({selectedTournamentModels.length} selected)
                </label>
                {models.error ? (
                  <InlineError error={models.error} onRetry={models.refetch} />
                ) : (
                  <MultiSelect
                    options={modelOptions}
                    value={selectedTournamentModels}
                    onChange={setSelectedTournamentModels}
                    placeholder={models.isLoading ? 'Loading models…' : 'Search and select models…'}
                    searchPlaceholder="Search models…"
                    emptyText="No models found."
                    disabled={models.isLoading}
                  />
                )}
                {!models.isLoading && !models.error && modelOptions.length === 0 && (
                  <p className="text-[11px] text-fg-muted mt-1">
                    No models configured. <Link to="/connect" className="text-primary hover:underline">Connect a provider</Link> to add models.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="tournament-category" className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">
                    Category (optional)
                  </label>
                  <Select
                    value={tournamentCategory || SENTINEL_ALL}
                    onValueChange={(v) => setTournamentCategory(v === SENTINEL_ALL ? '' : v)}
                  >
                    <SelectTrigger id="tournament-category" size="sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SENTINEL_ALL}>All categories</SelectItem>
                      {CATEGORY_OPTIONS.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label htmlFor="tournament-difficulty" className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">
                    Difficulty
                  </label>
                  <Select
                    value={tournamentDifficulty || SENTINEL_ANY}
                    onValueChange={(v) => setTournamentDifficulty(v === SENTINEL_ANY ? '' : v)}
                  >
                    <SelectTrigger id="tournament-difficulty" size="sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SENTINEL_ANY}>Any</SelectItem>
                      {DIFFICULTY_OPTIONS.map((d) => (
                        <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <label htmlFor="tournament-prompt" className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">
                  Custom prompt (optional — same prompt for all battles)
                </label>
                <Textarea
                  id="tournament-prompt"
                  value={tournamentCustomPrompt}
                  onChange={(e) => setTournamentCustomPrompt(e.target.value)}
                  placeholder="Type a prompt to use for all battles…"
                  rows={2}
                />
              </div>

              {tournamentResults && (
                <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg" aria-live="polite">
                  <p className="text-xs font-semibold text-primary mb-1">Tournament complete</p>
                  <p className="text-[10px] text-fg-muted">
                    {tournamentResults.completed}/{tournamentResults.totalBattles} battles ·
                    Category: {tournamentResults.promptCategory ?? 'all'} ·
                    {tournamentResults.errors > 0 ? ` ${tournamentResults.errors} errors` : ' no errors'}
                  </p>
                </div>
              )}
              {submittingTournament && (
                <p className="text-[10px] text-fg-muted" aria-live="polite">
                  Running {selectedTournamentModels.length > 1 ? (selectedTournamentModels.length * (selectedTournamentModels.length - 1)) / 2 : 0} battles — this can take a while.
                </p>
              )}
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() => void handleRunTournament()}
              loading={submittingTournament}
              disabled={selectedTournamentModels.length < 2}
            >
              Run tournament ({selectedTournamentModels.length} models, {selectedTournamentModels.length > 1 ? (selectedTournamentModels.length * (selectedTournamentModels.length - 1) / 2) : 0} battles)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick Test Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Quick Test Run</DialogTitle>
            <DialogDescription>Run benchmarks on specific models. Results are scored and stored.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="space-y-4">
              <div>
                <label htmlFor="quicktest-models" className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">
                  Model IDs (comma separated)
                </label>
                <Input
                  id="quicktest-models"
                  value={quickTestModels.join(', ')}
                  onChange={(e) => setQuickTestModels(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                  placeholder="gpt-4o, claude-3-opus, llama-3-70b"
                />
              </div>
              <div>
                <label htmlFor="quicktest-category" className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">
                  Category (optional)
                </label>
                <Select
                  value={quickTestCategory || SENTINEL_DEFAULT}
                  onValueChange={(v) => setQuickTestCategory(v === SENTINEL_DEFAULT ? '' : v)}
                >
                  <SelectTrigger id="quicktest-category" size="sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SENTINEL_DEFAULT}>All categories (default)</SelectItem>
                    {QUICK_TEST_CATEGORY_OPTIONS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button onClick={() => void handleRunBenchmark()} loading={submitting}>
              Run test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Arena Battle Dialog */}
      <Dialog open={arenaDialogOpen} onOpenChange={setArenaDialogOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Run Arena Battle</DialogTitle>
            <DialogDescription>Pit two models against each other in a blind comparison. Picks a random prompt from the benchmark bank unless you provide one.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="space-y-4">
              {models.error && <InlineError error={models.error} onRetry={models.refetch} />}
              {!models.isLoading && !models.error && modelOptions.length === 0 && (
                <p className="text-[11px] text-fg-muted">
                  No models configured. <Link to="/connect" className="text-primary hover:underline">Connect a provider</Link> to add models.
                </p>
              )}

              <div role="group" aria-label="Model A">
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Model A</label>
                <MultiSelect
                  options={modelOptions}
                  value={arenaModelA ? [arenaModelA] : []}
                  onChange={(vals) => setArenaModelA(vals[vals.length - 1] ?? '')}
                  placeholder={models.isLoading ? 'Loading models…' : 'Search and select a model…'}
                  searchPlaceholder="Search models…"
                  emptyText="No models found."
                  disabled={models.isLoading}
                />
              </div>

              <div role="group" aria-label="Model B">
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Model B</label>
                <MultiSelect
                  options={modelOptions}
                  value={arenaModelB ? [arenaModelB] : []}
                  onChange={(vals) => setArenaModelB(vals[vals.length - 1] ?? '')}
                  placeholder={models.isLoading ? 'Loading models…' : 'Search and select a model…'}
                  searchPlaceholder="Search models…"
                  emptyText="No models found."
                  disabled={models.isLoading}
                />
              </div>

              <div>
                <label htmlFor="arena-prompt" className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">
                  Custom prompt (optional — leave blank for random)
                </label>
                <Textarea
                  id="arena-prompt"
                  value={arenaCustomPrompt}
                  onChange={(e) => setArenaCustomPrompt(e.target.value)}
                  placeholder="Type your own test prompt here…"
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="arena-category" className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">
                    Category (optional)
                  </label>
                  <Select value={arenaCategory || SENTINEL_RANDOM} onValueChange={(v) => setArenaCategory(v === SENTINEL_RANDOM ? '' : v)}>
                    <SelectTrigger id="arena-category" size="sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SENTINEL_RANDOM}>Random</SelectItem>
                      {CATEGORY_OPTIONS.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label htmlFor="arena-difficulty" className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">
                    Difficulty (optional)
                  </label>
                  <Select value={arenaDifficulty || SENTINEL_RANDOM} onValueChange={(v) => setArenaDifficulty(v === SENTINEL_RANDOM ? '' : v)}>
                    <SelectTrigger id="arena-difficulty" size="sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SENTINEL_RANDOM}>Random</SelectItem>
                      {DIFFICULTY_OPTIONS.map((d) => (
                        <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button onClick={() => void handleRunArenaBattle()} loading={submittingArena} disabled={!arenaModelA || !arenaModelB}>
              Run battle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Model Detail Modal */}
      <Dialog open={!!detailModelId} onOpenChange={(open) => { if (!open) setDetailModelId(null); }}>
        <DialogContent size="lg">
          {detailModel && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Trophy className="size-4 text-primary" aria-hidden />
                  {detailModel.display_name}
                  <span className="text-xs font-normal text-fg-muted">{detailModel.provider_name}</span>
                </DialogTitle>
                <DialogDescription>
                  Elo: <span className="font-bold text-primary font-mono">{Math.round(detailModel.elo_rating)}</span>
                  {detailModel.confidenceInterval && detailModel.confidenceInterval.games > 0 && (
                    <span className="text-fg-muted ml-2">
                      ±{Math.round(detailModel.confidenceInterval.margin)} (95% CI, {detailModel.confidenceInterval.games} battles)
                    </span>
                  )}
                  <span className="ml-3">Quality: {((detailModel.quality_score || 0.5) * 100).toFixed(1)}%</span>
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                <DataState
                  data={modelDetail.data}
                  isLoading={modelDetail.isLoading}
                  error={modelDetail.error}
                  onRetry={modelDetail.refetch}
                  loading={
                    <div className="space-y-3">
                      <Skeleton className="h-32 w-full" />
                      <Skeleton className="h-32 w-full" />
                    </div>
                  }
                >
                  {(detail) => (
                    <div className="space-y-4">
                      {/* Per-category scores */}
                      <div>
                        <h4 className="text-xs font-semibold text-fg mb-2 uppercase tracking-wider">Category Performance</h4>
                        {detail.stats.categoryScores && detail.stats.categoryScores.length > 0 ? (
                          <div className="space-y-2">
                            {detail.stats.categoryScores.map((s, i) => (
                              <div key={i} className="flex items-center gap-3 p-2 bg-surface-2 rounded-lg">
                                <span className="text-[10px] font-mono w-20 text-fg-muted uppercase">{s.benchmark_type}</span>
                                <Progress
                                  value={s.avg_score * 100}
                                  className="flex-1"
                                  aria-label={`${s.benchmark_type} average score`}
                                />
                                <span className="text-[10px] font-mono text-fg w-10 text-right">{(s.avg_score * 100).toFixed(0)}%</span>
                                <span className="text-[10px] text-fg-muted w-16 text-right">n={s.count}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-fg-muted">No benchmark data yet.</p>
                        )}
                      </div>

                      {/* Elo history */}
                      <div>
                        <h4 className="text-xs font-semibold text-fg mb-2 uppercase tracking-wider">
                          Elo History ({detail.history.totalBattles ?? 0} battles)
                        </h4>
                        {detail.history.eloTrace && detail.history.eloTrace.length > 1 ? (
                          <EloHistoryChart trace={detail.history.eloTrace} />
                        ) : (
                          <p className="text-xs text-fg-muted">Not enough battle data for Elo history chart.</p>
                        )}
                      </div>

                      {/* Model details */}
                      <div className="text-[10px] text-fg-muted space-y-1">
                        <p>Model ID: <span className="font-mono text-fg">{detailModel.model_id}</span></p>
                        <p>Provider: <span className="font-mono text-fg">{detailModel.provider_name}</span></p>
                        <p>Capability Tier: <span className="font-mono text-fg">{detailModel.capability_tier || 'unset'}</span></p>
                        <p>Avg Latency: <span className="font-mono text-fg">{detailModel.avg_latency_ms ? `${detailModel.avg_latency_ms}ms` : 'N/A'}</span></p>
                      </div>
                    </div>
                  )}
                </DataState>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="ghost">Close</Button>
                </DialogClose>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

/* -------------------------------------------------------------------------- */
/*  Helper components                                                        */
/* -------------------------------------------------------------------------- */

/** Minimal bar-chart of Elo rating over time. Not chart-library-backed (the
 * shape is a single series of unevenly-spaced points from raw battle history)
 * so it stays a small hand-rolled visual, given a text alternative via
 * `role="img"` + `aria-label` since the bars carry no individual semantics. */
function EloHistoryChart({ trace }: { trace: Array<{ elo: number; date: string }> }) {
  const minElo = Math.min(...trace.map((p) => p.elo));
  const maxElo = Math.max(...trace.map((p) => p.elo));
  const range = Math.max(maxElo - minElo, 50);

  return (
    <div
      role="img"
      aria-label={`Elo rating trend across ${trace.length} battles, ranging from ${Math.round(minElo)} to ${Math.round(maxElo)}`}
      className="h-32 bg-surface-2 rounded-lg p-3 flex items-end gap-[2px]"
    >
      {trace.map((point, i) => {
        const height = ((point.elo - minElo) / range) * 100;
        return (
          <div key={i} className="flex-1 flex flex-col items-center justify-end h-full" title={`${point.elo} (${point.date})`}>
            <div
              aria-hidden
              className="w-full bg-primary/60 rounded-t-sm hover:bg-primary transition-colors"
              style={{ height: `${Math.max(height, 5)}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}
