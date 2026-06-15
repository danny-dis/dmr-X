import * as React from 'react';
import { Trophy, Play, Plus, Clock, Cpu, Zap, TrendingUp, Swords, ShieldCheck, Info, ChevronRight, Activity } from 'lucide-react';
import { PageHeader, PageContainer } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Button } from '@/components/primitives/Button';
import { Badge } from '@/components/primitives/Badge';
import { Skeleton } from '@/components/primitives/Skeleton';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/primitives/Tabs';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogBody, DialogFooter,
  DialogClose,
} from '@/components/primitives/Dialog';
import { Input } from '@/components/primitives/Input';
import { toast } from '@/components/primitives/Toast';
import { BarSeriesChart } from '@/components/charts/BarSeriesChart';
import { LatencyChart } from '@/components/charts/LatencyChart';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { formatDuration, formatNumber, timeAgo } from '@/lib/formatters';
import type { ApiBenchmarkResult } from '@/types/api';

const TONE = ['#7C5CFF', '#22D3EE', '#34D399', '#FBBF24', '#F87171', '#F472B6', '#A3E635'];

export function BenchmarksPage() {
  const [activeTab, setActiveTab] = React.useState('leaderboard');
  
  const leaderboard = useApiData<any[]>(() => Admin.getLeaderboard(), [], { refetchInterval: 60000 });
  const battles = useApiData<any[]>(() => Admin.getBattles(), [], { refetchInterval: 30000 });
  const history = useApiData<ApiBenchmarkResult[]>(() => Admin.listBenchmarks(), [], { refetchInterval: 60000 });

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [modelIds, setModelIds] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const handleRunBenchmark = async () => {
    setSubmitting(true);
    try {
      await Admin.runBenchmark({
        models: modelIds.split(',').map((s) => s.trim()).filter(Boolean),
        promptSet: 'default',
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
                      <tr key={model.id} className="border-b border-border hover:bg-muted/10 transition-colors">
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
                  Ratings are calculated using an Elo system (K=4) based on blind pairwise comparisons by a high-capability AI Judge (GPT-4o). 
                  Human feedback from the Playground is weighted 4x higher than AI Judge outcomes.
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="arena" className="mt-4">
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
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Quick Test Run</DialogTitle>
            <DialogDescription>Run a reasoning benchmark on specific models to calibrate Elo.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Model IDs (comma separated)</label>
                <Input
                  value={modelIds}
                  onChange={(e) => setModelIds(e.target.value)}
                  placeholder="gpt-4o, claude-3-opus, llama-3-70b"
                />
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
    </PageContainer>
  );
}
