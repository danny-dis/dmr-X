import { Trophy, Plus, Clock, TrendingUp, Swords, Info, Activity, ShieldCheck } from 'lucide-react';
import * as React from 'react';

import { BarSeriesChart } from '@/components/charts/BarSeriesChart';
import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogBody, DialogFooter,
  DialogClose,
} from '@/components/primitives/Dialog';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Input } from '@/components/primitives/Input';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/primitives/Tabs';
import { toast } from '@/components/primitives/Toast';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { getTokenForPath } from '@/lib/api';
import { formatDuration, formatNumber, timeAgo } from '@/lib/formatters';
import type { ApiBenchmarkResult, ApiBenchmarkLeaderboardEntry } from '@/types/api';

const TONE = ['#7C5CFF', '#22D3EE', '#34D399', '#FBBF24', '#F87171', '#F472B6', '#A3E635'];

export function BenchmarksPage() {
  const [activeTab, setActiveTab] = React.useState('leaderboard');
  
  const leaderboard = useApiData<ApiBenchmarkLeaderboardEntry[]>(() => Admin.getLeaderboard(), [], { refetchInterval: 60000 });
  const battles = useApiData<any[]>(() => Admin.getBattles(), [], { refetchInterval: 30000 });
  const history = useApiData<ApiBenchmarkResult[]>(() => Admin.listBenchmarks(), [], { refetchInterval: 60000 });

  // Dialog state
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [quickTestModels, setQuickTestModels] = React.useState<string[]>([]);
  const [quickTestCategory, setQuickTestCategory] = React.useState<string>('');
  const [submitting, setSubmitting] = React.useState(false);

  const [arenaDialogOpen, setArenaDialogOpen] = React.useState(false);
  const [arenaModelA, setArenaModelA] = React.useState('');
  const [arenaModelB, setArenaModelB] = React.useState('');
  const [arenaCustomPrompt, setArenaCustomPrompt] = React.useState('');
  const [arenaCategory, setArenaCategory] = React.useState('');
  const [arenaDifficulty, setArenaDifficulty] = React.useState('');
  const [submittingArena, setSubmittingArena] = React.useState(false);

  // Model list for dropdowns
  const [allModels, setAllModels] = React.useState<any[]>([]);
  const [modelSearchA, setModelSearchA] = React.useState('');
  const [modelSearchB, setModelSearchB] = React.useState('');
  const [showDropdownA, setShowDropdownA] = React.useState(false);
  const [showDropdownB, setShowDropdownB] = React.useState(false);
  const [validationTab, setValidationTab] = React.useState<'review' | 'history'>('review');
  const [currentBattle, setCurrentBattle] = React.useState<any>(null);
  const [loadingBattle, setLoadingBattle] = React.useState(false);
  const [validationStats, setValidationStats] = React.useState<any>(null);
  const [validationHistory, setValidationHistory] = React.useState<any[]>([]);
  const [reviewerId, setReviewerId] = React.useState('');

  // Tournament state
  const [tournamentDialogOpen, setTournamentDialogOpen] = React.useState(false);
  const [selectedTournamentModels, setSelectedTournamentModels] = React.useState<string[]>([]);
  const [tournamentCategory, setTournamentCategory] = React.useState('');
  const [tournamentDifficulty, setTournamentDifficulty] = React.useState('');
  const [tournamentCustomPrompt, setTournamentCustomPrompt] = React.useState('');
  const [submittingTournament, setSubmittingTournament] = React.useState(false);
  const [tournamentResults, setTournamentResults] = React.useState<any>(null);
  const [tournamentModelSearch, setTournamentModelSearch] = React.useState('');

  // Model detail modal
  const [detailModel, setDetailModel] = React.useState<any>(null);
  const [detailStats, setDetailStats] = React.useState<any>(null);
  const [detailHistory, setDetailHistory] = React.useState<any>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);

  const handleRunBenchmark = async () => {
    setSubmitting(true);
    try {
      await Admin.runBenchmark({
        models: quickTestModels,
        promptSet: quickTestCategory || 'default',
        concurrency: 1,
      });
      toast.success('Benchmark started in background');
      setDialogOpen(false);
      history.refetch();
    } catch {
      toast.error('Failed to start benchmark');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRunArenaBattle = async () => {
    setSubmittingArena(true);
    try {
      await Admin.runArenaBattle(arenaModelA, arenaModelB, arenaCustomPrompt || undefined, arenaCategory || undefined, arenaDifficulty || undefined);
      toast.success('Arena battle started');
      setArenaDialogOpen(false);
      battles.refetch();
    } catch {
      toast.error('Failed to start arena battle');
    } finally {
      setSubmittingArena(false);
    }
  };

  const handleRunTournament = async () => {
    if (selectedTournamentModels.length < 2) {
      toast.error('Select at least 2 models');
      return;
    }
    setSubmittingTournament(true);
    setTournamentResults(null);
    try {
      const res = await fetch('/admin/benchmarks/tournament', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getTokenForPath('/admin')}` },
        body: JSON.stringify({
          modelIds: selectedTournamentModels,
          category: tournamentCategory || undefined,
          difficulty: tournamentDifficulty || undefined,
          prompt: tournamentCustomPrompt || undefined,
        }),
      });
      const data = await res.json();
      if (data.status === 'completed') {
        toast.success(`Tournament complete: ${data.completed}/${data.totalBattles} battles done`);
        setTournamentResults(data);
        leaderboard.refetch();
      } else {
        toast.error('Tournament failed');
      }
    } catch {
      toast.error('Failed to start tournament');
    }
    setSubmittingTournament(false);
  };

  const handleModelClick = async (modelId: string) => {
    const model = leaderboard.data?.find(m => m.id === modelId);
    if (!model) return;
    setDetailModel(model);
    setDetailLoading(true);
    try {
      const [statsRes, historyRes] = await Promise.all([
        fetch(`/admin/benchmarks/models/${modelId}/stats`, { headers: { 'Authorization': `Bearer ${getTokenForPath('/admin')}` } }),
        fetch(`/admin/benchmarks/models/${modelId}/history`, { headers: { 'Authorization': `Bearer ${getTokenForPath('/admin')}` } }),
      ]);
      setDetailStats(await statsRes.json());
      setDetailHistory(await historyRes.json());
    } catch { /* ignore */ }
    setDetailLoading(false);
  };

  const fetchNextValidation = React.useCallback(async () => {
    setLoadingBattle(true);
    try {
      const res = await fetch('/admin/benchmarks/validate/next', { headers: { 'Authorization': `Bearer ${getTokenForPath('/admin')}` } });
      const data = await res.json();
      setCurrentBattle(data.battle);
    } catch { /* ignore */ }
    setLoadingBattle(false);
  }, []);

  const submitValidation = async (humanWinner: 'A' | 'B' | 'Tie') => {
    if (!currentBattle) return;
    try {
      const res = await fetch('/admin/benchmarks/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getTokenForPath('/admin')}` },
        body: JSON.stringify({ battleId: currentBattle.id, humanWinner, reviewerId: reviewerId || undefined }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Validation recorded. Judge agreement rate: ${data.agreementRate}%`);
        fetchValidationStats();
        fetchNextValidation();
      }
    } catch { toast.error('Failed to submit validation'); }
  };

  const fetchValidationStats = React.useCallback(async () => {
    try {
      const res = await fetch('/admin/benchmarks/validations', { headers: { 'Authorization': `Bearer ${getTokenForPath('/admin')}` } });
      const data = await res.json();
      setValidationStats(data.stats);
      setValidationHistory(data.validations || []);
    } catch { /* ignore */ }
  }, []);

  // Fetch available models for dropdowns
  const fetchModels = React.useCallback(async () => {
    try {
      const res = await fetch('/admin/models', { 
        headers: { 'Authorization': `Bearer ${getTokenForPath('/admin')}` }
      });
      const data = await res.json();
      setAllModels(data.models || []);
    } catch { /* ignore */ }
  }, []);

  // Load models when page mounts
  React.useEffect(() => { fetchModels(); }, [fetchModels]);

  // Filter models by search text
  const filteredModels = React.useMemo(() => {
    if (!modelSearchA) return allModels;
    const s = modelSearchA.toLowerCase();
    return allModels.filter((m: any) => 
      m.display_name?.toLowerCase().includes(s) || 
      m.model_id?.toLowerCase().includes(s) ||
      m.provider_name?.toLowerCase().includes(s)
    );
  }, [allModels, modelSearchA]);

  // Close dropdowns on outside click
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      setShowDropdownA(false);
      setShowDropdownB(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Benchmark Lab"
        description="Elo-based competitive rankings and performance analysis"
        icon={<Trophy className="size-5" />}
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => leaderboard.refetch()}>
              <Activity className="size-3 mr-1" />
              Refresh
            </Button>
            <Button size="sm" variant="outline" onClick={() => setTournamentDialogOpen(true)}>
              <Swords className="size-3 mr-1" />
              Tournament
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="size-3 mr-1" />
              Quick Test
            </Button>
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-5">
        <TabsList>
          <TabsTrigger value="leaderboard">
            <Trophy className="size-3 mr-2" />
            Leaderboard
          </TabsTrigger>
          <TabsTrigger value="arena">
            <Swords className="size-3 mr-2" />
            Arena Battles
          </TabsTrigger>
          <TabsTrigger value="history">
            <Clock className="size-3 mr-2" />
            Execution History
          </TabsTrigger>
          <TabsTrigger value="validation">
            <ShieldCheck className="size-3 mr-2" />
            Validation
          </TabsTrigger>
        </TabsList>

        <TabsContent value="leaderboard" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2" padding="none">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="p-3 text-[10px] font-semibold text-fg-muted uppercase">Rank</th>
                      <th className="p-3 text-[10px] font-semibold text-fg-muted uppercase">Model</th>
                      <th className="p-3 text-[10px] font-semibold text-fg-muted uppercase">Elo Rating</th>
                      <th className="p-3 text-[10px] font-semibold text-fg-muted uppercase">Quality</th>
                      <th className="p-3 text-[10px] font-semibold text-fg-muted uppercase">Latency</th>
                      <th className="p-3 text-[10px] font-semibold text-fg-muted uppercase">Tier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.isLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i} className="border-b border-border">
                          <td colSpan={6} className="p-3"><Skeleton className="h-4 w-full" /></td>
                        </tr>
                      ))
                    ) : leaderboard.data?.map((model, i) => (
                      <tr key={model.id} className="border-b border-border hover:bg-muted/10 transition-colors cursor-pointer" onClick={() => handleModelClick(model.id)}>
                        <td className="p-3 font-mono text-xs text-fg-muted">#{i + 1}</td>
                        <td className="p-3">
                          <div className="flex flex-col">
                            <span className="text-xs font-medium text-fg">{model.display_name}</span>
                            <span className="text-[10px] text-fg-muted">{model.provider_name} / {model.model_id}</span>
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-primary">{Math.round(model.elo_rating)}</span>
                            {model.confidenceInterval && model.confidenceInterval.games > 0 && (
                              <span className="text-[10px] font-mono text-fg-muted" 
                                    title={`95% CI: ${model.confidenceInterval.lower}–${model.confidenceInterval.upper} (based on ${model.confidenceInterval.games} battles)`}>
                                ±{Math.round(model.confidenceInterval.margin)}
                              </span>
                            )}
                            {i === 0 && <Badge tone="warning" size="sm">Champion</Badge>}
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-primary" 
                                style={{ width: `${(model.quality_score || 0.5) * 100}%` }}
                              />
                            </div>
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
                    <TrendingUp className="size-3 mr-2 text-primary" />
                    Elo Distribution
                  </CardTitle>
                </CardHeader>
                <CardContent className="h-48 pt-0">
                  {!leaderboard.isLoading && leaderboard.data && (
                    <BarSeriesChart
                      data={leaderboard.data.slice(0, 8).map(m => ({ name: m.display_name, elo: m.elo_rating }))}
                      xKey="name"
                      bars={[{ key: 'elo', color: TONE[0] }]}
                      height={160}
                      hideGrid
                    />
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-xs flex items-center">
                    <Info className="size-3 mr-2 text-fg-muted" />
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
        </TabsContent>

        <TabsContent value="arena" className="mt-4">
          <div className="flex justify-end mb-4">
            <Button size="sm" onClick={() => setArenaDialogOpen(true)}>
              <Swords className="size-3 mr-1" />
              Run Arena Battle
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-4">
            {battles.isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : battles.data && battles.data.length > 0 ? (
              battles.data.map((battle) => (
                <Card key={battle.id} padding="none">
                  <div className="p-3 border-b border-border flex items-center justify-between bg-muted/10">
                    <div className="flex items-center gap-3">
                      <Swords className="size-4 text-primary" />
                      <span className="text-xs font-semibold">Arena Battle: {battle.benchmark_type}</span>
                    </div>
                    <span className="text-[10px] text-fg-muted">{timeAgo(battle.run_at)}</span>
                  </div>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-8">
                      <div className={`flex-1 p-3 rounded-lg border ${battle.score === 1 ? 'border-primary bg-primary/5' : 'border-border'}`}>
                        <div className="flex justify-between mb-1">
                          <span className="text-xs font-bold">{battle.model_name}</span>
                          {battle.score === 1 && <Badge tone="primary" size="sm">Winner</Badge>}
                        </div>
                        <p className="text-[10px] text-fg-muted italic line-clamp-2">"{(battle.details as any).reasoning || 'No details available'}"</p>
                      </div>
                      
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-[10px] font-bold text-fg-muted">VS</span>
                        <div className="h-8 w-px bg-border" />
                      </div>

                      <div className={`flex-1 p-3 rounded-lg border ${battle.score === 0 ? 'border-primary bg-primary/5' : 'border-border'}`}>
                        <div className="flex justify-between mb-1">
                          <span className="text-xs font-bold">{(battle.details as any).competitor_name || 'Competitor'}</span>
                          {battle.score === 0 && <Badge tone="primary" size="sm">Winner</Badge>}
                        </div>
                        <p className="text-[10px] text-fg-muted italic line-clamp-2">{(battle.details as any).reasoning || '...'}</p>
                      </div>
                    </div>
                    
                    <div className="mt-3 pt-3 border-t border-border flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase text-fg-muted">Accuracy</span>
                        <span className="text-xs font-mono">{(battle.details as any).scores?.accuracy}/10</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase text-fg-muted">Tone</span>
                        <span className="text-xs font-mono">{(battle.details as any).scores?.tone}/10</span>
                      </div>
                      <div className="ml-auto">
                        <span className="text-[10px] text-fg-muted mr-2">Elo Change:</span>
                        <span className={`text-xs font-bold ${battle.score === 1 ? 'text-primary' : 'text-fg-muted'}`}>
                          {battle.score === 1 ? '+' : ''}{Math.round((battle.details as any).elo_change || 0)}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              <EmptyState title="No battles recorded" description="Run arena battles to see competitive comparisons." />
            )}
          </div>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {history.isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)
            ) : history.data && history.data.length > 0 ? (
              history.data.map((b) => (
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
                        <p className="text-lg font-semibold text-fg mt-0.5">{formatDuration(b.avgLatencyMs ?? 0)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-fg-muted uppercase tracking-wider">Throughput</p>
                        <p className="text-lg font-semibold text-fg mt-0.5">{formatNumber(b.throughput ?? 0, true)}/s</p>
                      </div>
                    </div>
                    {b.byModel && (
                      <BarSeriesChart
                        data={Object.entries(b.byModel).map(([model, latency]) => ({ model, latency }))}
                        xKey="model"
                        bars={[{ key: 'latency', color: TONE[1] }]}
                        height={140}
                        yFormatter={(v) => formatDuration(v)}
                      />
                    )}
                  </CardContent>
                </Card>
              ))
            ) : (
              <EmptyState title="No executions yet" description="History of full-sweep benchmark runs will appear here." />
            )}
          </div>
        </TabsContent>

        <TabsContent value="validation" className="mt-4">
          <div className="flex gap-2 mb-4">
            <Button size="sm" variant={validationTab === 'review' ? 'default' : 'ghost'} onClick={() => setValidationTab('review')}>
              Review Battle
            </Button>
            <Button size="sm" variant={validationTab === 'history' ? 'default' : 'ghost'} onClick={() => { setValidationTab('history'); fetchValidationStats(); }}>
              Validation History
            </Button>
          </div>

          {validationTab === 'review' && (
            <div className="space-y-4">
              {!currentBattle && !loadingBattle && (
                <div className="text-center py-8">
                  <Button onClick={fetchNextValidation}>Load Next Battle for Review</Button>
                </div>
              )}
              {loadingBattle && <Skeleton className="h-64 w-full" />}
              {currentBattle && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <ShieldCheck className="size-4 text-primary" />
                      Judge Decision Review
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-muted/10 rounded-lg">
                      <div>
                        <span className="text-xs uppercase text-fg-muted">Model A</span>
                        <p className="text-sm font-semibold">{currentBattle.modelA.name}</p>
                        <p className="text-[10px] text-fg-muted">{currentBattle.modelA.provider}</p>
                        {currentBattle.modelA.id && (
                          <p className="text-[9px] font-mono text-fg-muted/60 mt-0.5">ID: {currentBattle.modelA.id.slice(0, 8)}…</p>
                        )}
                      </div>
                      <Badge tone={currentBattle.judgeWinner === 'A' ? 'primary' : 'muted'}>
                        {currentBattle.judgeWinner === 'A' ? 'Judge says A wins' : 'Judge says B wins'}
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-muted/10 rounded-lg">
                      <div>
                        <span className="text-xs uppercase text-fg-muted">Model B</span>
                        <p className="text-sm font-semibold">{currentBattle.modelB.name}</p>
                        <p className="text-[10px] text-fg-muted">{currentBattle.modelB.provider}</p>
                        {currentBattle.modelB.id && (
                          <p className="text-[9px] font-mono text-fg-muted/60 mt-0.5">ID: {currentBattle.modelB.id.slice(0, 8)}…</p>
                        )}
                      </div>
                      <Badge tone={currentBattle.judgeWinner === 'B' ? 'primary' : 'muted'}>
                        {currentBattle.judgeWinner === 'B' ? 'Judge says B wins' : 'Judge says A wins'}
                      </Badge>
                    </div>

                    {currentBattle.judgeReasoning && (
                      <div>
                        <p className="text-[10px] uppercase text-fg-muted mb-1">Judge Reasoning</p>
                        <p className="text-xs p-3 bg-muted/5 rounded border border-border italic">
                          "{currentBattle.judgeReasoning}"
                        </p>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Your reviewer ID (optional)"
                        value={reviewerId}
                        onChange={(e) => setReviewerId(e.target.value)}
                        className="text-xs"
                      />
                    </div>

                    <div>
                      <p className="text-[10px] uppercase text-fg-muted mb-2">Your Verdict</p>
                      <div className="flex gap-2">
                        <Button onClick={() => submitValidation('A')} variant="outline" size="sm" className="flex-1">
                          A Wins
                        </Button>
                        <Button onClick={() => submitValidation('Tie')} variant="outline" size="sm" className="flex-1">
                          Tie
                        </Button>
                        <Button onClick={() => submitValidation('B')} variant="outline" size="sm" className="flex-1">
                          B Wins
                        </Button>
                      </div>
                    </div>

                    <div className="flex justify-between">
                      <Button variant="ghost" size="sm" onClick={() => setCurrentBattle(null)}>Skip</Button>
                      <Button variant="ghost" size="sm" onClick={fetchNextValidation}>Next Battle</Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {validationTab === 'history' && (
            <div className="space-y-4">
              {validationStats && (
                <div className="grid grid-cols-3 gap-3">
                  <Card>
                    <CardContent className="p-4 text-center">
                      <p className="text-2xl font-bold text-primary">{validationStats.total}</p>
                      <p className="text-[10px] text-fg-muted uppercase">Total Validations</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <p className="text-2xl font-bold text-success">{validationStats.agreementRate}%</p>
                      <p className="text-[10px] text-fg-muted uppercase">Judge Agreement</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <p className="text-2xl font-bold text-fg">{validationStats.agreedCount}/{validationStats.total}</p>
                      <p className="text-[10px] text-fg-muted uppercase">Correct / Total</p>
                    </CardContent>
                  </Card>
                </div>
              )}
              <div className="space-y-2">
                {validationHistory.length === 0 && (
                  <EmptyState title="No validations yet" description="Review battles to start tracking judge accuracy." />
                )}
                {validationHistory.map((v: any) => (
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
                            <div className="text-[10px] text-fg-muted/70">
                              {v.model_a_name ?? '?'} <span className="text-fg-muted/40">vs</span> {v.model_b_name ?? '?'}
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
              {/* Model multi-select */}
              <div>
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Select Models ({selectedTournamentModels.length} selected)</label>
                <Input
                  value={tournamentModelSearch}
                  onChange={(e) => setTournamentModelSearch(e.target.value)}
                  placeholder="Search models..."
                  className="mb-2"
                />
                <div className="max-h-40 overflow-y-auto border border-border rounded-md divide-y divide-border">
                  {allModels
                    .filter((m: any) => !tournamentModelSearch || m.display_name?.toLowerCase().includes(tournamentModelSearch.toLowerCase()))
                    .slice(0, 30)
                    .map((m: any) => (
                      <label key={m.id} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted/10 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedTournamentModels.includes(m.id)}
                          onChange={() => {
                            setSelectedTournamentModels(prev =>
                              prev.includes(m.id)
                                ? prev.filter(id => id !== m.id)
                                : [...prev, m.id]
                            );
                          }}
                          className="rounded border-border"
                        />
                        <span className="font-medium">{m.display_name || m.model_id}</span>
                        <span className="text-fg-muted">{m.provider_name}</span>
                        {m.elo_rating && <span className="ml-auto text-fg-muted">Elo: {Math.round(m.elo_rating)}</span>}
                      </label>
                    ))}
                  {allModels.length === 0 && <div className="px-3 py-4 text-xs text-center text-fg-muted">Loading models...</div>}
                </div>
              </div>

              {/* Category + difficulty */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Category (optional)</label>
                  <select value={tournamentCategory} onChange={(e) => setTournamentCategory(e.target.value)}
                    className="w-full text-xs bg-background border border-border rounded-md px-3 py-2 text-fg">
                    <option value="">All categories</option>
                    <option value="reasoning">Reasoning</option>
                    <option value="instruction">Instruction</option>
                    <option value="creative">Creative</option>
                    <option value="coding">Coding</option>
                    <option value="knowledge">Knowledge</option>
                    <option value="safety">Safety</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Difficulty</label>
                  <select value={tournamentDifficulty} onChange={(e) => setTournamentDifficulty(e.target.value)}
                    className="w-full text-xs bg-background border border-border rounded-md px-3 py-2 text-fg">
                    <option value="">Any</option>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
              </div>

              {/* Custom prompt */}
              <div>
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Custom Prompt (optional — same prompt for all battles)</label>
                <textarea value={tournamentCustomPrompt} onChange={(e) => setTournamentCustomPrompt(e.target.value)}
                  placeholder="Type a prompt to use for all battles..."
                  rows={2}
                  className="w-full text-xs bg-background border border-border rounded-md px-3 py-2 text-fg resize-none"
                />
              </div>

              {/* Results */}
              {tournamentResults && (
                <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
                  <p className="text-xs font-semibold text-primary mb-1">Tournament Complete</p>
                  <p className="text-[10px] text-fg-muted">
                    {tournamentResults.completed}/{tournamentResults.totalBattles} battles · 
                    Category: {tournamentResults.promptCategory} · 
                    {tournamentResults.errors > 0 && ` ${tournamentResults.errors} errors`}
                  </p>
                </div>
              )}
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button onClick={handleRunTournament} loading={submittingTournament} disabled={selectedTournamentModels.length < 2}>
              Run Tournament ({selectedTournamentModels.length} models, {selectedTournamentModels.length > 1 ? (selectedTournamentModels.length * (selectedTournamentModels.length - 1) / 2) : 0} battles)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Quick Test Run</DialogTitle>
            <DialogDescription>Run benchmarks on specific models. Results are scored and stored.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Model IDs (comma separated)</label>
                <Input
                  value={quickTestModels.join(', ')}
                  onChange={(e) => setQuickTestModels(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                  placeholder="gpt-4o, claude-3-opus, llama-3-70b"
                />
              </div>
              <div>
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Category (optional)</label>
                <select
                  value={quickTestCategory}
                  onChange={(e) => setQuickTestCategory(e.target.value)}
                  className="w-full text-xs bg-background border border-border rounded-md px-3 py-2 text-fg"
                >
                  <option value="">All categories (default)</option>
                  <option value="reasoning">Reasoning</option>
                  <option value="instruction">Instruction Following</option>
                  <option value="creative">Creative</option>
                  <option value="coding">Coding</option>
                  <option value="knowledge">Knowledge</option>
                  <option value="multilingual">Multilingual</option>
                  <option value="safety">Safety</option>
                </select>
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button onClick={handleRunBenchmark} loading={submitting}>
              Run Test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={arenaDialogOpen} onOpenChange={setArenaDialogOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Run Arena Battle</DialogTitle>
            <DialogDescription>Pit two models against each other in a blind comparison. Picks a random prompt from the benchmark bank unless you provide one.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="space-y-4">
              {/* Model A selector */}
              <div className="relative">
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Model A</label>
                <Input
                  value={arenaModelA ? (allModels.find((m: any) => m.id === arenaModelA)?.display_name || arenaModelA) : ''}
                  onChange={(e) => { setModelSearchA(e.target.value); setShowDropdownA(true); setArenaModelA(''); }}
                  onFocus={() => setShowDropdownA(true)}
                  placeholder="Search and select a model..."
                />
                {showDropdownA && (
                  <div className="absolute z-50 mt-1 w-full bg-background border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {(modelSearchA ? allModels.filter((m: any) => 
                      m.display_name?.toLowerCase().includes(modelSearchA.toLowerCase()) ||
                      m.model_id?.toLowerCase().includes(modelSearchA.toLowerCase())
                    ) : allModels).slice(0, 20).map((m: any) => (
                      <button
                        key={m.id}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-muted/10 transition-colors ${arenaModelA === m.id ? 'bg-primary/10 text-primary' : 'text-fg'}`}
                        onClick={() => { setArenaModelA(m.id); setModelSearchA(''); setShowDropdownA(false); }}
                      >
                        <span className="font-medium">{m.display_name || m.model_id}</span>
                        <span className="text-fg-muted ml-2">{m.provider_name}</span>
                      </button>
                    ))}
                    {allModels.length === 0 && <div className="px-3 py-2 text-xs text-fg-muted">Loading models...</div>}
                  </div>
                )}
              </div>

              {/* Model B selector */}
              <div className="relative">
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Model B</label>
                <Input
                  value={arenaModelB ? (allModels.find((m: any) => m.id === arenaModelB)?.display_name || arenaModelB) : ''}
                  onChange={(e) => { setModelSearchB(e.target.value); setShowDropdownB(true); setArenaModelB(''); }}
                  onFocus={() => setShowDropdownB(true)}
                  placeholder="Search and select a model..."
                />
                {showDropdownB && (
                  <div className="absolute z-50 mt-1 w-full bg-background border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {(modelSearchB ? allModels.filter((m: any) => 
                      m.display_name?.toLowerCase().includes(modelSearchB.toLowerCase()) ||
                      m.model_id?.toLowerCase().includes(modelSearchB.toLowerCase())
                    ) : allModels).slice(0, 20).map((m: any) => (
                      <button
                        key={m.id}
                        className={`w-full text-left px-3 py-2 text-xs hover:bg-muted/10 transition-colors ${arenaModelB === m.id ? 'bg-primary/10 text-primary' : 'text-fg'}`}
                        onClick={() => { setArenaModelB(m.id); setModelSearchB(''); setShowDropdownB(false); }}
                      >
                        <span className="font-medium">{m.display_name || m.model_id}</span>
                        <span className="text-fg-muted ml-2">{m.provider_name}</span>
                      </button>
                    ))}
                    {allModels.length === 0 && <div className="px-3 py-2 text-xs text-fg-muted">Loading models...</div>}
                  </div>
                )}
              </div>

              {/* Custom prompt */}
              <div>
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Custom Prompt (optional — leave blank for random)</label>
                <textarea
                  value={arenaCustomPrompt}
                  onChange={(e) => setArenaCustomPrompt(e.target.value)}
                  placeholder="Type your own test prompt here..."
                  rows={3}
                  className="w-full text-xs bg-background border border-border rounded-md px-3 py-2 text-fg resize-none"
                />
              </div>

              {/* Category filter */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Category (optional)</label>
                  <select
                    value={arenaCategory}
                    onChange={(e) => setArenaCategory(e.target.value)}
                    className="w-full text-xs bg-background border border-border rounded-md px-3 py-2 text-fg"
                  >
                    <option value="">Random</option>
                    <option value="reasoning">Reasoning</option>
                    <option value="instruction">Instruction</option>
                    <option value="creative">Creative</option>
                    <option value="coding">Coding</option>
                    <option value="knowledge">Knowledge</option>
                    <option value="safety">Safety</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Difficulty (optional)</label>
                  <select
                    value={arenaDifficulty}
                    onChange={(e) => setArenaDifficulty(e.target.value)}
                    className="w-full text-xs bg-background border border-border rounded-md px-3 py-2 text-fg"
                  >
                    <option value="">Random</option>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button onClick={handleRunArenaBattle} loading={submittingArena} disabled={!arenaModelA || !arenaModelB}>
              Run Battle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Model Detail Modal */}
      <Dialog open={!!detailModel} onOpenChange={(open) => { if (!open) setDetailModel(null); }}>
        <DialogContent size="lg">
          {detailModel && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Trophy className="size-4 text-primary" />
                  {detailModel.display_name}
                  <span className="text-xs font-normal text-fg-muted">{detailModel.provider_name}</span>
                </DialogTitle>
                <DialogDescription>
                  Elo: <span className="font-bold text-primary">{Math.round(detailModel.elo_rating)}</span>
                  {detailModel.confidenceInterval && detailModel.confidenceInterval.games > 0 && (
                    <span className="text-fg-muted ml-2">
                      ±{Math.round(detailModel.confidenceInterval.margin)} (95% CI, {detailModel.confidenceInterval.games} battles)
                    </span>
                  )}
                  <span className="ml-3">Quality: {((detailModel.quality_score || 0.5) * 100).toFixed(1)}%</span>
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                {detailLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-32 w-full" />
                    <Skeleton className="h-32 w-full" />
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Per-category scores */}
                    <div>
                      <h4 className="text-xs font-semibold text-fg mb-2 uppercase tracking-wider">Category Performance</h4>
                      {detailStats?.categoryScores?.length > 0 ? (
                        <div className="space-y-2">
                          {detailStats.categoryScores.map((s: any, i: number) => (
                            <div key={i} className="flex items-center gap-3 p-2 bg-muted/5 rounded-lg">
                              <span className="text-[10px] font-mono w-20 text-fg-muted uppercase">{s.benchmark_type}</span>
                              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-primary rounded-full" style={{ width: `${s.avg_score * 100}%` }} />
                              </div>
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
                      <h4 className="text-xs font-semibold text-fg mb-2 uppercase tracking-wider">Elo History ({detailHistory?.totalBattles ?? 0} battles)</h4>
                      {detailHistory?.eloTrace?.length > 1 ? (
                        <div className="h-32 bg-muted/5 rounded-lg p-3 flex items-end gap-[2px]">
                          {detailHistory.eloTrace.map((point: any, i: number) => {
                            const minElo = Math.min(...detailHistory.eloTrace.map((p: any) => p.elo));
                            const maxElo = Math.max(...detailHistory.eloTrace.map((p: any) => p.elo));
                            const range = Math.max(maxElo - minElo, 50);
                            const height = ((point.elo - minElo) / range) * 100;
                            return (
                              <div key={i} className="flex-1 flex flex-col items-center justify-end h-full" title={`${point.elo} (${point.date})`}>
                                <div className="w-full bg-primary/60 rounded-t-sm hover:bg-primary transition-colors" style={{ height: `${Math.max(height, 5)}%` }} />
                              </div>
                            );
                          })}
                        </div>
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
