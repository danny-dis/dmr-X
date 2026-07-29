import { Minimize2, Save, RotateCcw, RefreshCw, BarChart3 } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Input } from '@/components/primitives/Input';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Slider } from '@/components/primitives/Slider';
import { Switch } from '@/components/primitives/Switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { toast } from '@/components/primitives/Toast';
import { useApiData } from '@/hooks/useApiData';
import { api } from '@/lib/admin';

/* -------------------------------------------------------------------------- */
/*  Form type + defaults                                                      */
/* -------------------------------------------------------------------------- */

interface CompressionConfig {
  enabled: boolean;
  proxyUrl: string;
  apiKey?: string;
  reversible: boolean;
  minTokensToCompress: number;
}

interface CompressionStats {
  totalRequests: number;
  totalTokensSaved: number;
  avgCompressionRatio: number;
}

const DEFAULT_CONFIG: CompressionConfig = {
  enabled: false,
  proxyUrl: 'http://localhost:8787',
  reversible: true,
  minTokensToCompress: 100,
};

/* -------------------------------------------------------------------------- */
/*  API helpers                                                               */
/* -------------------------------------------------------------------------- */

async function fetchCompressionConfig(): Promise<CompressionConfig> {
  return api<CompressionConfig>('/v1/compression/config');
}

async function updateCompressionConfig(config: Partial<CompressionConfig>): Promise<CompressionConfig> {
  return api<CompressionConfig>('/v1/compression/config', {
    method: 'PUT',
    body: config,
  });
}

async function fetchCompressionStats(): Promise<CompressionStats> {
  return api<CompressionStats>('/v1/compression/stats');
}

async function cleanupCompressionCache(): Promise<void> {
  await api('/v1/compression/cleanup', { method: 'POST' });
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export function CompressionPage() {
  const config = useApiData<CompressionConfig>(
    fetchCompressionConfig,
    [],
    { refetchInterval: 60000 }
  );

  const stats = useApiData<CompressionStats>(
    fetchCompressionStats,
    [],
    { refetchInterval: 30000 }
  );

  const [form, setForm] = React.useState<CompressionConfig>(DEFAULT_CONFIG);
  const [saving, setSaving] = React.useState(false);
  const [cleaning, setCleaning] = React.useState(false);

  React.useEffect(() => {
    if (config.data) {
      setForm(config.data);
    }
  }, [config.data]);

  const update = <K extends keyof CompressionConfig>(key: K, value: CompressionConfig[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onSave = async () => {
    setSaving(true);
    try {
      await updateCompressionConfig(form);
      toast.success('Compression settings saved');
      await config.refetch();
    } catch (e) {
      toast.error('Save failed', { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const onReset = () => {
    setForm({ ...DEFAULT_CONFIG });
    toast.show('Reset to defaults', { description: 'Click Save to apply.', tone: 'info' });
  };

  const onCleanup = async () => {
    setCleaning(true);
    try {
      await cleanupCompressionCache();
      toast.success('Cache cleaned up');
      await stats.refetch();
    } catch (e) {
      toast.error('Cleanup failed', { description: (e as Error).message });
    } finally {
      setCleaning(false);
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
            <Button variant="ghost" size="sm" onClick={onReset} disabled={saving}>
              <RotateCcw className="size-3" />
              Reset
            </Button>
            <Button size="sm" onClick={onSave} loading={saving} disabled={!dirty}>
              <Save className="size-3" />
              Save
            </Button>
          </>
        }
      />

      <div className="mt-5">
        {config.isLoading ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <Tabs defaultValue="settings" orientation="vertical">
            <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-3">
              <TabsList variant="pills" className="flex-col items-stretch h-fit">
                <TabsTrigger value="settings" variant="pills" className="justify-start">
                  <Minimize2 className="size-3" /> Settings
                </TabsTrigger>
                <TabsTrigger value="stats" variant="pills" className="justify-start">
                  <BarChart3 className="size-3" /> Statistics
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
                      {stats.isLoading ? (
                        <Skeleton className="h-32 w-full" />
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <StatCard
                            title="Total Requests"
                            value={formatNumber(stats.data?.totalRequests ?? 0)}
                            description="Requests with compression"
                          />
                          <StatCard
                            title="Tokens Saved"
                            value={formatNumber(stats.data?.totalTokensSaved ?? 0)}
                            description="Total tokens reduced"
                          />
                          <StatCard
                            title="Avg Compression"
                            value={formatPercent(stats.data?.avgCompressionRatio ?? 0)}
                            description="Average reduction ratio"
                          />
                        </div>
                      )}

                      <div className="mt-6 flex justify-end">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={onCleanup}
                          loading={cleaning}
                        >
                          <RefreshCw className="size-3" />
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