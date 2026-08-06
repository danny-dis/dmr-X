import { Minimize2, Save, RotateCcw, RefreshCw, BarChart3 } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import { Input } from '@/components/primitives/Input';
import { Slider } from '@/components/primitives/Slider';
import { Switch } from '@/components/primitives/Switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { toast } from '@/components/primitives/Toast';
import {
  useCleanupCompressionCache,
  useCompressionConfig,
  useCompressionStats,
  useUpdateCompressionConfig,
  type CompressionConfig,
  type CompressionStats,
} from '@/lib/queries/compression';

/* -------------------------------------------------------------------------- */
/*  Form type + defaults                                                      */
/* -------------------------------------------------------------------------- */

const DEFAULT_CONFIG: CompressionConfig = {
  enabled: false,
  proxyUrl: 'http://localhost:8787',
  reversible: true,
  minTokensToCompress: 100,
};

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export function CompressionPage() {
  const config = useCompressionConfig({ refetchInterval: 60000 });
  const stats = useCompressionStats({ refetchInterval: 30000 });
  const updateConfig = useUpdateCompressionConfig();
  const cleanupCache = useCleanupCompressionCache();

  const [form, setForm] = React.useState<CompressionConfig>(DEFAULT_CONFIG);
  const saving = updateConfig.isPending;
  const cleaning = cleanupCache.isPending;

  React.useEffect(() => {
    if (config.data) {
      setForm(config.data);
    }
  }, [config.data]);

  const update = <K extends keyof CompressionConfig>(key: K, value: CompressionConfig[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onSave = async () => {
    try {
      await updateConfig.mutateAsync(form);
      toast.success('Compression settings saved');
    } catch (e) {
      toast.error('Save failed', { description: (e as Error).message });
    }
  };

  const onReset = () => {
    setForm({ ...DEFAULT_CONFIG });
    toast.show('Reset to defaults', { description: 'Click Save to apply.', tone: 'info' });
  };

  const onCleanup = async () => {
    try {
      await cleanupCache.mutateAsync();
      toast.success('Cache cleaned up');
    } catch (e) {
      toast.error('Cleanup failed', { description: (e as Error).message });
    }
  };

  const dirty = JSON.stringify(form) !== JSON.stringify(config.data);

  const formatNumber = (n: number) => n.toLocaleString();
  const formatPercent = (n: number) => `${(n * 100).toFixed(1)}%`;

  return (
    <PageContainer>
      <PageHeader
        title="Compression"
        description="Configure Headroom context compression to reduce token costs and latency"
        icon={<Minimize2 className="size-5" />}
        actions={
          <>
            {dirty && (
              <Badge tone="warning" size="sm">
                Unsaved
              </Badge>
            )}
            <Button variant="ghost" size="sm" onClick={onReset} disabled={saving} aria-label="Reset to defaults">
              <RotateCcw className="size-3" aria-hidden />
              Reset
            </Button>
            <Button size="sm" onClick={onSave} loading={saving} disabled={!dirty} aria-label="Save compression settings">
              <Save className="size-3" aria-hidden />
              Save
            </Button>
          </>
        }
      />

      <div className="mt-5">
        <DataState
          data={config.data}
          isLoading={config.isLoading}
          error={config.error}
          onRetry={config.refetch}
          skeletonRows={6}
        >
          {() => (
            <Tabs defaultValue="settings" orientation="vertical">
              <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-3">
                <TabsList variant="pills" className="flex-col items-stretch h-fit">
                  <TabsTrigger value="settings" variant="pills" className="justify-start">
                    <Minimize2 className="size-3" aria-hidden /> Settings
                  </TabsTrigger>
                  <TabsTrigger value="stats" variant="pills" className="justify-start">
                    <BarChart3 className="size-3" aria-hidden /> Statistics
                  </TabsTrigger>
                </TabsList>

                <div>
                  {/* ==================== SETTINGS ==================== */}
                  <TabsContent value="settings">
                    <Card padding="md">
                      <CardHeader className="px-0 pt-0">
                        <CardTitle>Compression Configuration</CardTitle>
                        <p className="text-[10px] text-fg-muted mt-0.5">
                          Headroom compresses prompts before they reach LLM providers, reducing token costs and latency
                        </p>
                      </CardHeader>
                      <CardContent className="px-0 flex flex-col gap-4">
                        <SettingRow
                          label="Enable compression"
                          description="Compress prompts before sending to providers"
                        >
                          <Switch
                            checked={form.enabled}
                            onCheckedChange={(v) => update('enabled', v)}
                          />
                        </SettingRow>

                        <SettingRow
                          label="Proxy URL"
                          description="Headroom proxy server URL"
                        >
                          <Input
                            value={form.proxyUrl}
                            onChange={(e) => update('proxyUrl', e.target.value)}
                            placeholder="http://localhost:8787"
                            className="w-64"
                            disabled={!form.enabled}
                          />
                        </SettingRow>

                        <SettingRow
                          label="API Key"
                          description="Optional API key for proxy authentication"
                        >
                          <Input
                            value={form.apiKey || ''}
                            onChange={(e) => update('apiKey', e.target.value || undefined)}
                            placeholder="Optional"
                            type="password"
                            className="w-64"
                            disabled={!form.enabled}
                          />
                        </SettingRow>

                        <SettingRow
                          label="Reversible (CCR)"
                          description="Store originals for retrieval on demand"
                        >
                          <Switch
                            checked={form.reversible}
                            onCheckedChange={(v) => update('reversible', v)}
                            disabled={!form.enabled}
                          />
                        </SettingRow>

                        <SettingRow
                          label="Minimum tokens to compress"
                          description="Skip compression for small prompts"
                        >
                          <div className="w-48 space-y-2">
                            <Slider
                              value={[form.minTokensToCompress]}
                              min={0}
                              max={1000}
                              step={10}
                              onValueChange={(v) => update('minTokensToCompress', v[0] ?? DEFAULT_CONFIG.minTokensToCompress)}
                              disabled={!form.enabled}
                            />
                            <p className="text-[10px] text-fg-muted text-right">
                              {form.minTokensToCompress} tokens
                            </p>
                          </div>
                        </SettingRow>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  {/* ==================== STATISTICS ==================== */}
                  <TabsContent value="stats">
                    <Card padding="md">
                      <CardHeader className="px-0 pt-0">
                        <CardTitle>Compression Statistics</CardTitle>
                        <p className="text-[10px] text-fg-muted mt-0.5">
                          Track token savings and compression performance
                        </p>
                      </CardHeader>
                      <CardContent className="px-0">
                        <DataState
                          data={stats.data}
                          isLoading={stats.isLoading}
                          error={stats.error}
                          onRetry={stats.refetch}
                          skeletonRows={3}
                        >
                          {(data) => (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <StatCard
                                title="Total Requests"
                                value={formatNumber(data.totalRequests ?? 0)}
                                description="Requests with compression"
                              />
                              <StatCard
                                title="Tokens Saved"
                                value={formatNumber(data.totalTokensSaved ?? 0)}
                                description="Total tokens reduced"
                              />
                              <StatCard
                                title="Avg Compression"
                                value={formatPercent(data.avgCompressionRatio ?? 0)}
                                description="Average reduction ratio"
                              />
                            </div>
                          )}
                        </DataState>

                        <div className="mt-6 flex justify-end">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={onCleanup}
                            loading={cleaning}
                            aria-label="Cleanup expired cache"
                          >
                            <RefreshCw className="size-3" aria-hidden />
                            Cleanup Expired Cache
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>
                </div>
              </div>
            </Tabs>
          )}
        </DataState>
      </div>
    </PageContainer>
  );
}

/* -------------------------------------------------------------------------- */
/*  Helper components                                                         */
/* -------------------------------------------------------------------------- */

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-border last:border-0">
      <div>
        <p className="text-sm font-medium text-fg">{label}</p>
        {description && <p className="text-[11px] text-fg-muted mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function StatCard({
  title,
  value,
  description,
}: {
  title: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-4">
      <p className="text-[11px] text-fg-muted uppercase tracking-wide">{title}</p>
      <p className="text-2xl font-semibold text-fg mt-1">{value}</p>
      <p className="text-[11px] text-fg-muted mt-1">{description}</p>
    </div>
  );
}