import * as React from 'react';
import { Trophy, Play, Plus, Clock, Cpu, Zap, TrendingUp } from 'lucide-react';
import { PageHeader, PageContainer } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Button } from '@/components/primitives/Button';
import { Badge } from '@/components/primitives/Badge';
import { Skeleton } from '@/components/primitives/Skeleton';
import { EmptyState } from '@/components/primitives/EmptyState';
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
  const benchmarks = useApiData<ApiBenchmarkResult[]>(
    () => Admin.listBenchmarks(),
    [],
    { refetchInterval: 30000 }
  );

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [modelIds, setModelIds] = React.useState('');
  const [promptSet, setPromptSet] = React.useState('');
  const [concurrency, setConcurrency] = React.useState(1);
  const [submitting, setSubmitting] = React.useState(false);

  const handleRunBenchmark = async () => {
    setSubmitting(true);
    try {
      await Admin.runBenchmark({
        models: modelIds.split(',').map((s) => s.trim()).filter(Boolean),
        promptSet,
        concurrency,
      });
      toast.success('Benchmark started successfully');
      setDialogOpen(false);
      benchmarks.refetch();
    } catch {
      toast.error('Failed to start benchmark');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Benchmarks"
        description="Performance comparisons across providers and models"
        icon={<Trophy className="size-5" />}
        actions={
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="size-3" />
            New benchmark
          </Button>
        }
      />

      {benchmarks.isLoading ? (
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : benchmarks.data && benchmarks.data.length > 0 ? (
        <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-3">
          {benchmarks.data.map((b) => (
            <Card key={b.id} padding="none">
              <div className="p-4 border-b border-border flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-fg">{b.name}</h3>
                  <p className="text-[10px] text-fg-muted mt-0.5">
                    {b.models?.length ?? 0} models · {b.promptCount} prompts · {timeAgo(b.runAt)}
                  </p>
                </div>
                <Badge tone="primary" size="sm">latest</Badge>
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
                    bars={[{ key: 'latency', color: TONE[0] }]}
                    height={140}
                    yFormatter={(v) => formatDuration(v)}
                  />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card padding="none" className="mt-5 border-dashed">
          <EmptyState
            title="No benchmarks yet"
            description="Run a benchmark to compare provider performance across prompts."
            action={
              <Button onClick={() => setDialogOpen(true)}>
                <Play className="size-3" />
                Run benchmark
              </Button>
            }
          />
        </Card>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Run Benchmark</DialogTitle>
            <DialogDescription>Configure and run a performance benchmark across models.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Model IDs</label>
                <Input
                  value={modelIds}
                  onChange={(e) => setModelIds(e.target.value)}
                  placeholder="gpt-4o, claude-3-opus, llama-3-70b"
                />
              </div>
              <div>
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Prompt set</label>
                <Input
                  value={promptSet}
                  onChange={(e) => setPromptSet(e.target.value)}
                  placeholder="default"
                />
              </div>
              <div>
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Concurrency</label>
                <Input
                  type="number"
                  min={1}
                  value={concurrency}
                  onChange={(e) => setConcurrency(Number(e.target.value))}
                />
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
            <Button onClick={handleRunBenchmark} loading={submitting}>
              Run benchmark
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
