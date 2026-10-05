/**
 * NeedleRouter — management surface for the local Needle tool pre-filter.
 *
 * Needle (services/needle-router) narrows a large tool list down to the few
 * functions a request actually needs, before the expensive routed model sees
 * it. It is an optimisation, never load-bearing: if it is slow or down, the
 * gateway silently falls back to the full tool list.
 *
 * That fallback is why this page exists. "Enabled" and "working" are different
 * things — Needle can be up, reachable, and still have every one of its results
 * thrown away for exceeding the latency budget. The status card says so plainly
 * rather than showing a green badge over a filter that never takes effect.
 *
 * Depth (2..20 layers) is the dominant latency lever on CPU-only hardware, so
 * the depth table plus the benchmark exist to let an operator pick a rung with
 * evidence instead of guessing.
 */
import {
  Activity, AlertTriangle, CheckCircle2, ChevronDown, Cpu, Download, Gauge,
  Layers, Loader2, Play, RefreshCw, Rocket, Trash2, Zap,
} from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/primitives/AlertDialog';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Checkbox } from '@/components/primitives/Checkbox';
import { DataState } from '@/components/primitives/DataState';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Switch } from '@/components/primitives/Switch';
import { toast } from '@/components/primitives/Toast';
import { Admin } from '@/lib/admin';
import {
  useApplyNeedleRung,
  useBuildNeedleRung,
  useNeedleJob,
  useNeedleRungs,
  useNeedleStatus,
  useNeedleVersions,
  useRunNeedleBenchmark,
  useUpgradeNeedle,
} from '@/lib/queries/needle';
import { useSettings, useUpdateSettings } from '@/lib/queries/settings';
import type {
  ApiNeedleBenchmarkResult,
  ApiNeedleBenchmarkRung,
  ApiNeedleJob,
} from '@/types/api';

/* -------------------------------------------------------------------------- */

const LAYER_OPTIONS = Array.from({ length: 19 }, (_, i) => i + 2); // 2..20

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—';
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

function formatMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

/* -------------------------------------------------------------------------- */

/** Runs a job to completion, showing progress, and reports the outcome once. */
function JobPanel({
  jobId,
  onSettled,
  renderResult,
}: {
  jobId: string | null;
  onSettled?: (job: ApiNeedleJob) => void;
  renderResult?: (job: ApiNeedleJob) => React.ReactNode;
}) {
  const job = useNeedleJob(jobId);
  const settledRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const data = job.data;
    if (!data || !onSettled) return;
    if (data.status !== 'succeeded' && data.status !== 'failed') return;
    if (settledRef.current === data.id) return;
    settledRef.current = data.id;
    onSettled(data);
  }, [job.data, onSettled]);

  if (!jobId) return null;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-fg">{job.data?.label ?? 'Job'}</span>
        {job.data?.status === 'running' || job.data?.status === 'queued' ? (
          <Badge tone="info" size="sm"><Loader2 className="size-3 animate-spin" /> Running</Badge>
        ) : job.data?.status === 'succeeded' ? (
          <Badge tone="success" size="sm">Succeeded</Badge>
        ) : job.data?.status === 'failed' ? (
          <Badge tone="danger" size="sm">Failed</Badge>
        ) : null}
      </div>

      {(job.data?.status === 'running' || job.data?.status === 'queued') && job.data.progress && (
        <p className="font-mono text-[10px] text-fg-muted break-all">{job.data.progress}</p>
      )}

      {job.data?.error && <p className="text-[11px] text-danger">{job.data.error}</p>}
      {job.data && job.data.status === 'succeeded' && renderResult?.(job.data)}

      {job.data && job.data.log.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer items-center gap-1 text-[10px] text-fg-subtle">
            <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
            Log ({job.data.log.length} lines)
          </summary>
          <pre className="mt-2 max-h-56 overflow-auto rounded bg-bg/60 p-2 font-mono text-[10px] leading-relaxed text-fg-muted">
            {job.data.log.join('\n')}
          </pre>
        </details>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function BenchmarkTable({ result }: { result: ApiNeedleBenchmarkResult }) {
  const best = result.recommended?.rung;
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-fg-subtle">
              <th className="py-1 pr-3 font-medium">Rung</th>
              <th className="py-1 pr-3 font-medium">Mean</th>
              <th className="py-1 pr-3 font-medium">Max</th>
              <th className="py-1 pr-3 font-medium">Accuracy</th>
              <th className="py-1 font-medium">In budget</th>
            </tr>
          </thead>
          <tbody className="text-fg">
            {result.rungs.map((r: ApiNeedleBenchmarkRung) => (
              <tr
                key={r.rung}
                className={r.rung === best ? 'bg-primary/5' : undefined}
              >
                <td className="py-1 pr-3">
                  <span className="flex items-center gap-1.5">
                    {r.rung === best && <CheckCircle2 className="size-3 text-primary" />}
                    <span className="font-mono">{r.rung}</span>
                  </span>
                  {r.error && <span className="block text-danger">{r.error}</span>}
                </td>
                <td className="py-1 pr-3">{r.meanSeconds != null ? `${r.meanSeconds}s` : '—'}</td>
                <td className="py-1 pr-3">{r.maxSeconds != null ? `${r.maxSeconds}s` : '—'}</td>
                <td className="py-1 pr-3">
                  {r.accuracy != null ? `${(r.accuracy * 100).toFixed(0)}%` : '—'}
                </td>
                <td className="py-1">
                  {r.underBudget != null && r.cases != null ? (
                    <Badge tone={r.underBudget > 0 ? 'success' : 'danger'} size="sm">
                      {r.underBudget}/{r.cases}
                    </Badge>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {result.recommended && (
        <p className="text-[11px] text-fg-muted">
          <span className="font-medium text-fg">Recommended:</span>{' '}
          <span className="font-mono">{result.recommended.rung}</span> — {result.recommended.reason}.
        </p>
      )}

      {result.rungs.every((r) => (r.underBudget ?? 0) === 0) && (
        <p className="text-[11px] text-warning">
          No rung finished inside the {result.host.budgetMs}ms budget on this host, so the
          pre-filter is not currently taking effect regardless of which rung is active.
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function NeedleRouterPage() {
  const status = useNeedleStatus({ refetchInterval: 15000 });
  const rungs = useNeedleRungs({ refetchInterval: 30000 });
  const versions = useNeedleVersions();
  const settings = useSettings();
  const updateSettings = useUpdateSettings();

  const [buildLayers, setBuildLayers] = React.useState(8);
  const [buildJobId, setBuildJobId] = React.useState<string | null>(null);
  const [benchJobId, setBenchJobId] = React.useState<string | null>(null);
  const [upgradeJobId, setUpgradeJobId] = React.useState<string | null>(null);
  const [selectedRungs, setSelectedRungs] = React.useState<string[]>([]);
  const [upgradeTarget, setUpgradeTarget] = React.useState<string | null>(null);
  const [confirmUpgrade, setConfirmUpgrade] = React.useState(false);
  const [benchResult, setBenchResult] = React.useState<ApiNeedleBenchmarkResult | null>(null);

  const buildRung = useBuildNeedleRung();
  const applyRung = useApplyNeedleRung();
  const runBenchmark = useRunNeedleBenchmark();
  const upgrade = useUpgradeNeedle();

  const enabled = Boolean(
    (settings.data as Record<string, unknown> | undefined)?.needleRouterEnabled,
  );
  const sidecar = status.data?.sidecar;
  const budgetMs = status.data?.timeoutBudgetMs ?? 1500;
  const lastLatency = status.data?.lastAttempt?.latencyMs ?? null;

  // Default the benchmark selection to the first rung once they load.
  React.useEffect(() => {
    if (selectedRungs.length === 0 && rungs.data?.rungs.length) {
      setSelectedRungs([rungs.data.rungs[0]!.file]);
    }
  }, [rungs.data, selectedRungs.length]);

  const onToggleEnabled = async (next: boolean) => {
    try {
      await updateSettings.mutateAsync({ needleRouterEnabled: next });
      toast.success(next ? 'Needle pre-filter enabled' : 'Needle pre-filter disabled');
    } catch (err) {
      toast.error('Could not update setting', { description: String(err) });
    }
  };

  const onBuild = async () => {
    try {
      const { jobId } = await buildRung.mutateAsync(buildLayers);
      setBuildJobId(jobId);
      toast.info(`Building ${buildLayers}-layer rung…`);
    } catch (err) {
      toast.error('Build failed to start', { description: String(err) });
    }
  };

  const onApply = async (file: string | null) => {
    try {
      const res = await applyRung.mutateAsync(file);
      toast.success(`Active rung: ${file ?? 'full 20-layer'}`, { description: `Depth ${res.depth ?? '—'} — warming up now.` });
    } catch (err) {
      toast.error('Could not switch rung', { description: String(err) });
    }
  };

  const onBenchmark = async () => {
    if (selectedRungs.length === 0) return;
    try {
      const { jobId } = await runBenchmark.mutateAsync(selectedRungs);
      setBenchJobId(jobId);
      setBenchResult(null);
      toast.info('Benchmark started', { description: 'This takes minutes on CPU.' });
    } catch (err) {
      toast.error('Benchmark failed to start', { description: String(err) });
    }
  };

  const onUpgrade = async () => {
    if (!upgradeTarget) return;
    try {
      const { jobId } = await upgrade.mutateAsync(upgradeTarget);
      setUpgradeJobId(jobId);
      setConfirmUpgrade(false);
      toast.info(`Upgrading to ${upgradeTarget}…`);
    } catch (err) {
      toast.error('Upgrade failed to start', { description: String(err) });
    }
  };

  /* ---------------------------------------------------------------------- */

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Needle Router"
        description="Manage the local tool pre-filter: toggle it, choose its depth, benchmark the options, and upgrade it."
        icon={<Zap className="size-5" />}
      />

      <div className="mt-5 flex flex-col gap-4">
        {/* ==================== STATUS + TOGGLE ==================== */}
        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle>Status</CardTitle>
            <p className="mt-0.5 text-[10px] text-fg-muted">
              Needle 3 (services/needle-router) narrows a large tool list before it reaches the
              routed model. It is an optimisation — if it is slow or down, the full tool list is
              used instead.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 px-0">
            <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-surface-2/40 p-3">
              <div>
                <p className="text-xs font-medium text-fg">Enable Needle pre-filter</p>
                <p className="text-[10px] text-fg-muted">Applies on the next request — no restart needed</p>
              </div>
              <Switch
                id="needle-enabled"
                checked={enabled}
                disabled={settings.isLoading || updateSettings.isPending}
                onCheckedChange={onToggleEnabled}
              />
            </div>

            {/* The honest warning: enabled is not the same as working. */}
            {enabled && status.data?.bypassed && (
              <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                <div className="text-[11px] text-fg">
                  <p className="font-medium">The pre-filter is not taking effect.</p>
                  <p className="mt-0.5 text-fg-muted">
                    The last attempt took {formatMs(lastLatency)} against a {formatMs(budgetMs)} budget,
                    so the full tool list was used for that request. Pick a shallower rung below, or
                    raise the budget.
                  </p>
                </div>
              </div>
            )}

            <DataState
              data={status.data}
              isLoading={status.isLoading}
              error={status.error}
              onRetry={() => status.refetch()}
              skeletonRows={2}
            >
              {(s) => (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-fg">Sidecar</span>
                    <div className="flex items-center gap-1.5">
                      {s.reachable ? (
                        <Badge tone="success" size="sm">Reachable</Badge>
                      ) : (
                        <Badge tone="danger" size="sm">Unreachable</Badge>
                      )}
                      {s.bypassed && <Badge tone="warning" size="sm">Bypassed</Badge>}
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-fg-muted sm:grid-cols-3">
                    <dt>Version</dt>
                    <dd className="text-right text-fg">{sidecar?.packageVersion ?? '—'}</dd>
                    <dt>Depth</dt>
                    <dd className="text-right text-fg">
                      {sidecar?.depth != null ? `${sidecar.depth} layers` : '—'}
                    </dd>
                    <dt>Weights</dt>
                    <dd className="truncate text-right text-fg" title={sidecar?.weights ?? undefined}>
                      {sidecar?.weights ?? 'full model'}
                    </dd>
                    <dt>Model loaded</dt>
                    <dd className="text-right text-fg">
                      {s.modelLoaded == null ? '—' : s.modelLoaded ? 'Yes' : 'No'}
                    </dd>
                    <dt>Cached agents</dt>
                    <dd className="text-right text-fg">{sidecar?.cachedAgents ?? '—'}</dd>
                    <dt>Health probe</dt>
                    <dd className="text-right text-fg">{formatMs(s.probeLatencyMs)}</dd>
                    <dt>Latency budget</dt>
                    <dd className="text-right text-fg">{formatMs(s.timeoutBudgetMs)}</dd>
                    <dt>Last filter attempt</dt>
                    <dd className="text-right text-fg">
                      {s.lastAttempt
                        ? `${s.lastAttempt.outcome} (${formatMs(s.lastAttempt.latencyMs)})`
                        : 'None yet this session'}
                    </dd>
                    <dt>Tools narrowed</dt>
                    <dd className="text-right text-fg">
                      {s.lastAttempt?.matchedCount != null && s.lastAttempt?.toolCount != null
                        ? `${s.lastAttempt.matchedCount} of ${s.lastAttempt.toolCount}`
                        : '—'}
                    </dd>
                  </dl>
                </div>
              )}
            </DataState>
          </CardContent>
        </Card>

        {/* ==================== DEPTH ==================== */}
        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle className="flex items-center gap-2">
              <Layers className="size-4" /> Depth
            </CardTitle>
            <p className="mt-0.5 text-[10px] text-fg-muted">
              A rung is a sliced export of the base weights. Fewer layers is faster but less
              accurate — this is the biggest speed lever on a CPU-only host.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 px-0">
            <DataState
              data={rungs.data}
              isLoading={rungs.isLoading}
              error={rungs.error}
              onRetry={() => rungs.refetch()}
              skeletonRows={2}
            >
              {(data) => (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-left text-fg-subtle">
                        <th className="py-1 pr-3 font-medium">Rung</th>
                        <th className="py-1 pr-3 font-medium">Layers</th>
                        <th className="py-1 pr-3 font-medium">Size</th>
                        <th className="py-1 pr-3 font-medium">Built</th>
                        <th className="py-1 font-medium" />
                      </tr>
                    </thead>
                    <tbody className="text-fg">
                      <tr className={sidecar?.weights == null ? 'bg-primary/5' : undefined}>
                        <td className="py-1 pr-3 font-mono">full model</td>
                        <td className="py-1 pr-3">20</td>
                        <td className="py-1 pr-3">35.3 MB</td>
                        <td className="py-1 pr-3 text-fg-subtle">shipped</td>
                        <td className="py-1 text-right">
                          {sidecar?.weights == null ? (
                            <Badge tone="primary" size="sm">Active</Badge>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => onApply(null)}
                              loading={applyRung.isPending}>Use</Button>
                          )}
                        </td>
                      </tr>
                      {data.rungs.map((r) => {
                        const isActive = sidecar?.weights === r.file;
                        return (
                          <tr key={r.file} className={isActive ? 'bg-primary/5' : undefined}>
                            <td className="py-1 pr-3 font-mono">{r.file}</td>
                            <td className="py-1 pr-3">{r.layers}</td>
                            <td className="py-1 pr-3">{formatBytes(r.bytes)}</td>
                            <td className="py-1 pr-3 text-fg-subtle">
                              {r.builtAt ? new Date(r.builtAt).toLocaleDateString() : '—'}
                            </td>
                            <td className="py-1 text-right">
                              {isActive ? (
                                <Badge tone="primary" size="sm">Active</Badge>
                              ) : (
                                <Button size="sm" variant="ghost" onClick={() => onApply(r.file)}
                                  loading={applyRung.isPending}>Use</Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </DataState>

            <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="build-layers" className="text-[10px] text-fg-muted">Layers to build</label>
                <Select value={String(buildLayers)} onValueChange={(v) => setBuildLayers(Number(v))}>
                  <SelectTrigger id="build-layers" className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LAYER_OPTIONS.map((n) => (
                      <SelectItem key={n} value={String(n)}>{n} layers</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={onBuild} loading={buildRung.isPending} leftIcon={<Download />}>
                Build rung
              </Button>
              <p className="text-[10px] text-fg-muted">Takes about a minute; runs in the background.</p>
            </div>

            <JobPanel
              jobId={buildJobId}
              onSettled={(job) => {
                rungs.refetch();
                if (job.status === 'succeeded') {
                  toast.success('Rung built', { description: job.label });
                } else {
                  toast.error('Build failed', { description: job.error ?? undefined });
                }
              }}
            />
          </CardContent>
        </Card>

        {/* ==================== BENCHMARK ==================== */}
        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle className="flex items-center gap-2">
              <Gauge className="size-4" /> Benchmark
            </CardTitle>
            <p className="mt-0.5 text-[10px] text-fg-muted">
              Times each rung on this machine and scores how often it picks the right tool.
              Runs in the background — the full 20-layer model takes several minutes.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 px-0">
            <DataState
              data={rungs.data}
              isLoading={rungs.isLoading}
              error={rungs.error}
              skeletonRows={1}
            >
              {(data) => (
                <div className="flex flex-wrap gap-3">
                  {data.rungs.map((r) => (
                    <label key={r.file} className="flex cursor-pointer items-center gap-2 text-[11px] text-fg">
                      <Checkbox
                        checked={selectedRungs.includes(r.file)}
                        onCheckedChange={(v) =>
                          setSelectedRungs((prev) =>
                            v ? [...prev, r.file] : prev.filter((f) => f !== r.file),
                          )
                        }
                      />
                      <span className="font-mono">{r.file}</span>
                      <span className="text-fg-subtle">({r.layers}L)</span>
                    </label>
                  ))}
                </div>
              )}
            </DataState>

            <div className="flex items-center gap-2">
              <Button
                onClick={onBenchmark}
                loading={runBenchmark.isPending}
                disabled={selectedRungs.length === 0}
                leftIcon={<Play />}
              >
                Run benchmark
              </Button>
              {benchResult && (
                <Button variant="ghost" size="sm" leftIcon={<RefreshCw />}
                  onClick={() => setBenchResult(null)}>Clear results</Button>
              )}
            </div>

            {benchResult && <BenchmarkTable result={benchResult} />}

            <JobPanel
              jobId={benchJobId}
              onSettled={(job) => {
                if (job.status === 'succeeded' && job.result) {
                  setBenchResult(job.result as ApiNeedleBenchmarkResult);
                  toast.success('Benchmark complete');
                } else if (job.status === 'failed') {
                  toast.error('Benchmark failed', { description: job.error ?? undefined });
                }
              }}
            />
          </CardContent>
        </Card>

        {/* ==================== UPGRADE ==================== */}
        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle className="flex items-center gap-2">
              <Rocket className="size-4" /> Version
            </CardTitle>
            <p className="mt-0.5 text-[10px] text-fg-muted">
              The cactus-needle package that runs inference. Upgrading restarts the sidecar.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 px-0">
            <DataState
              data={versions.data}
              isLoading={versions.isLoading}
              error={versions.error}
              onRetry={() => versions.refetch()}
              skeletonRows={1}
            >
              {(v) => (
                <>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-fg-muted">
                    <dt>Installed</dt>
                    <dd className="text-right text-fg">{v.installed ?? 'unknown'}</dd>
                    <dt>Latest published</dt>
                    <dd className="text-right text-fg">{v.latest ?? '—'}</dd>
                  </dl>

                  {v.error && <p className="text-[11px] text-warning">{v.error}</p>}

                  {v.latest && v.installed && v.latest !== v.installed && (
                    <Button
                      onClick={() => { setUpgradeTarget(v.latest); setConfirmUpgrade(true); }}
                      leftIcon={<Rocket />}
                      className="self-start"
                    >
                      Upgrade to {v.latest}
                    </Button>
                  )}
                  {v.latest && v.installed && v.latest === v.installed && (
                    <p className="flex items-center gap-1.5 text-[11px] text-success">
                      <CheckCircle2 className="size-3.5" /> Up to date.
                    </p>
                  )}
                </>
              )}
            </DataState>

            <JobPanel
              jobId={upgradeJobId}
              onSettled={(job) => {
                versions.refetch();
                status.refetch();
                if (job.status === 'succeeded') {
                  toast.success('Upgrade complete', { description: job.label });
                } else {
                  toast.error('Upgrade failed', { description: job.error ?? undefined });
                }
              }}
            />
          </CardContent>
        </Card>

        {/* ==================== BUILD / VERSION NOTES ==================== */}
        <Card padding="md">
          <CardHeader className="px-0 pt-0">
            <CardTitle className="flex items-center gap-2">
              <Cpu className="size-4" /> About these numbers
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <ul className="flex flex-col gap-1.5 text-[11px] text-fg-muted">
              <li className="flex gap-2">
                <Activity className="mt-0.5 size-3.5 shrink-0" />
                Latency is dominated by CPU vector support. Machines without AVX2/FMA run these
                models far slower than the published mobile benchmarks.
              </li>
              <li className="flex gap-2">
                <Trash2 className="mt-0.5 size-3.5 shrink-0" />
                The 2-layer rung is fastest but measured 0% accuracy — it refuses almost everything.
                Prefer 4 layers and up.
              </li>
              <li className="flex gap-2">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                The {formatMs(budgetMs)} budget is set by <code className="font-mono">DMRX_NEEDLE_TIMEOUT_MS</code>.
                If no rung fits it, the pre-filter cannot take effect on this host.
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Upgrade confirmation — this runs pip install, so it is never one click. */}
      <AlertDialog open={confirmUpgrade} onOpenChange={setConfirmUpgrade}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Upgrade cactus-needle to {upgradeTarget}?</AlertDialogTitle>
            <AlertDialogDescription>
              This runs <code className="font-mono">pip install</code> in the sidecar's virtual
              environment and restarts the sidecar. Inference is unavailable for a few seconds
              while it comes back up.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="primary" onClick={onUpgrade} loading={upgrade.isPending}>
              Upgrade
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
