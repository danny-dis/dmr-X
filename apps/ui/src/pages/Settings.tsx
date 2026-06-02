import * as React from 'react';
import { Settings as SettingsIcon, Save, RotateCcw, Server, Shield, Brain, Cpu } from 'lucide-react';
import { PageHeader, PageContainer } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Button } from '@/components/primitives/Button';
import { Badge } from '@/components/primitives/Badge';
import { Input } from '@/components/primitives/Input';
import { Switch } from '@/components/primitives/Switch';
import { Slider } from '@/components/primitives/Slider';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { toast } from '@/components/primitives/Toast';

interface SettingsForm {
  routingStrategy: 'auto' | 'cost' | 'latency' | 'round-robin' | 'priority';
  costOptimization: boolean;
  latencyBudgetMs: number;
  autoFallback: boolean;
  defaultModel: string;
  maxContextWindow: number;
  defaultTemperature: number;
  requireAuth: boolean;
  corsOrigins: string;
  rateLimitRpm: number;
  cacheTtlSec: number;
  streamingChunkSize: number;
  workerConcurrency: number;
}

const DEFAULTS: SettingsForm = {
  routingStrategy: 'auto',
  costOptimization: true,
  latencyBudgetMs: 2000,
  autoFallback: true,
  defaultModel: 'free',
  maxContextWindow: 128000,
  defaultTemperature: 0.7,
  requireAuth: true,
  corsOrigins: '*',
  rateLimitRpm: 600,
  cacheTtlSec: 300,
  streamingChunkSize: 64,
  workerConcurrency: 8,
};

function fromServer(s: Record<string, unknown> | null): SettingsForm {
  if (!s) return { ...DEFAULTS };
  return {
    routingStrategy: (s.routingStrategy as SettingsForm['routingStrategy']) ?? DEFAULTS.routingStrategy,
    costOptimization: s.costOptimization != null ? Boolean(s.costOptimization) : DEFAULTS.costOptimization,
    latencyBudgetMs: typeof s.latencyBudgetMs === 'number' ? s.latencyBudgetMs : DEFAULTS.latencyBudgetMs,
    autoFallback: s.autoFallback != null ? Boolean(s.autoFallback) : DEFAULTS.autoFallback,
    defaultModel: typeof s.defaultModel === 'string' ? s.defaultModel : DEFAULTS.defaultModel,
    maxContextWindow: typeof s.maxContextWindow === 'number' ? s.maxContextWindow : DEFAULTS.maxContextWindow,
    defaultTemperature: typeof s.defaultTemperature === 'number' ? s.defaultTemperature : DEFAULTS.defaultTemperature,
    requireAuth: s.requireAuth != null ? Boolean(s.requireAuth) : DEFAULTS.requireAuth,
    corsOrigins: typeof s.corsOrigins === 'string' ? s.corsOrigins : DEFAULTS.corsOrigins,
    rateLimitRpm: typeof s.rateLimitRpm === 'number' ? s.rateLimitRpm : DEFAULTS.rateLimitRpm,
    cacheTtlSec: typeof s.cacheTtlSec === 'number' ? s.cacheTtlSec : DEFAULTS.cacheTtlSec,
    streamingChunkSize: typeof s.streamingChunkSize === 'number' ? s.streamingChunkSize : DEFAULTS.streamingChunkSize,
    workerConcurrency: typeof s.workerConcurrency === 'number' ? s.workerConcurrency : DEFAULTS.workerConcurrency,
  };
}

function toServer(f: SettingsForm): Record<string, unknown> {
  return {
    routingStrategy: f.routingStrategy,
    costOptimization: f.costOptimization,
    latencyBudgetMs: f.latencyBudgetMs,
    autoFallback: f.autoFallback,
    defaultModel: f.defaultModel,
    maxContextWindow: f.maxContextWindow,
    defaultTemperature: f.defaultTemperature,
    requireAuth: f.requireAuth,
    corsOrigins: f.corsOrigins,
    rateLimitRpm: f.rateLimitRpm,
    cacheTtlSec: f.cacheTtlSec,
    streamingChunkSize: f.streamingChunkSize,
    workerConcurrency: f.workerConcurrency,
  };
}

export function SettingsPage() {
  const settings = useApiData<Record<string, unknown>>(
    () => Admin.getSettings(),
    [],
    { refetchInterval: 60000 }
  );
  const [form, setForm] = React.useState<SettingsForm>(DEFAULTS);
  const [saving, setSaving] = React.useState(false);
  const [resetKey, setResetKey] = React.useState(0);

  React.useEffect(() => {
    setForm(fromServer(settings.data));
  }, [settings.data, resetKey]);

  const update = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onSave = async () => {
    setSaving(true);
    try {
      await Admin.updateSettings(toServer(form));
      toast.success('Settings saved', { description: 'Configuration persisted to the gateway.' });
      await settings.refetch();
    } catch (e) {
      toast.error('Save failed', { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const onReset = () => {
    setResetKey((k) => k + 1);
    setForm({ ...DEFAULTS });
    toast.show('Reset to defaults', { description: 'Click Save to apply.', tone: 'info' });
  };

  const dirty = JSON.stringify(form) !== JSON.stringify(fromServer(settings.data));

  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description="Gateway configuration — routing, defaults, security, performance"
        icon={<SettingsIcon className="size-5" />}
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
        {settings.isLoading ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <Tabs defaultValue="routing" orientation="vertical">
            <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-3">
              <TabsList variant="pills" className="flex-col items-stretch h-fit">
                <TabsTrigger value="routing" variant="pills" className="justify-start">
                  <Brain className="size-3" /> Routing
                </TabsTrigger>
                <TabsTrigger value="defaults" variant="pills" className="justify-start">
                  <Cpu className="size-3" /> Defaults
                </TabsTrigger>
                <TabsTrigger value="security" variant="pills" className="justify-start">
                  <Shield className="size-3" /> Security
                </TabsTrigger>
                <TabsTrigger value="performance" variant="pills" className="justify-start">
                  <Server className="size-3" /> Performance
                </TabsTrigger>
              </TabsList>

              <div>
                <TabsContent value="routing">
                  <Card padding="md">
                    <CardHeader className="px-0 pt-0">
                      <CardTitle>Routing strategy</CardTitle>
                      <p className="text-[10px] text-fg-muted mt-0.5">How requests are assigned to providers</p>
                    </CardHeader>
                    <CardContent className="px-0 flex flex-col gap-4">
                      <SettingRow label="Default strategy" description="Fallback when no policy applies">
                        <Select
                          value={form.routingStrategy}
                          onValueChange={(v) => update('routingStrategy', v as SettingsForm['routingStrategy'])}
                        >
                          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">Auto (intelligence-aware)</SelectItem>
                            <SelectItem value="cost">Lowest cost</SelectItem>
                            <SelectItem value="latency">Lowest latency</SelectItem>
                            <SelectItem value="round-robin">Round-robin</SelectItem>
                            <SelectItem value="priority">Priority order</SelectItem>
                          </SelectContent>
                        </Select>
                      </SettingRow>
                      <SettingRow label="Cost optimization" description="Prefer cheaper models when possible">
                        <Switch
                          checked={form.costOptimization}
                          onCheckedChange={(v) => update('costOptimization', v)}
                        />
                      </SettingRow>
                      <SettingRow label="Latency budget" description="Max acceptable p95 latency (ms)">
                        <div className="w-48 space-y-2">
                          <Slider
                            value={[form.latencyBudgetMs]}
                            min={100}
                            max={10000}
                            step={100}
                            onValueChange={(v) => update('latencyBudgetMs', v[0] ?? DEFAULTS.latencyBudgetMs)}
                          />
                          <p className="text-[10px] text-fg-muted text-right">{form.latencyBudgetMs}ms</p>
                        </div>
                      </SettingRow>
                      <SettingRow label="Auto-fallback" description="Retry on alternate provider if first fails">
                        <Switch
                          checked={form.autoFallback}
                          onCheckedChange={(v) => update('autoFallback', v)}
                        />
                      </SettingRow>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="defaults">
                  <Card padding="md">
                    <CardHeader className="px-0 pt-0">
                      <CardTitle>Model defaults</CardTitle>
                    </CardHeader>
                    <CardContent className="px-0 flex flex-col gap-4">
                      <SettingRow label="Default model">
                        <Input
                          value={form.defaultModel}
                          onChange={(e) => update('defaultModel', e.target.value)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow label="Max context window" description="Tokens">
                        <Input
                          type="number"
                          value={form.maxContextWindow}
                          onChange={(e) => update('maxContextWindow', Number(e.target.value) || DEFAULTS.maxContextWindow)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow label="Default temperature">
                        <Input
                          type="number"
                          step="0.1"
                          value={form.defaultTemperature}
                          onChange={(e) => update('defaultTemperature', Number(e.target.value) || DEFAULTS.defaultTemperature)}
                          className="w-48"
                        />
                      </SettingRow>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="security">
                  <Card padding="md">
                    <CardHeader className="px-0 pt-0">
                      <CardTitle>Security</CardTitle>
                    </CardHeader>
                    <CardContent className="px-0 flex flex-col gap-4">
                      <SettingRow label="Require auth" description="Reject unauthenticated requests">
                        <Switch
                          checked={form.requireAuth}
                          onCheckedChange={(v) => update('requireAuth', v)}
                        />
                      </SettingRow>
                      <SettingRow label="CORS allowed origins">
                        <Input
                          value={form.corsOrigins}
                          onChange={(e) => update('corsOrigins', e.target.value)}
                          className="w-72"
                        />
                      </SettingRow>
                      <SettingRow label="Rate limit (req/min)">
                        <Input
                          type="number"
                          value={form.rateLimitRpm}
                          onChange={(e) => update('rateLimitRpm', Number(e.target.value) || DEFAULTS.rateLimitRpm)}
                          className="w-48"
                        />
                      </SettingRow>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="performance">
                  <Card padding="md">
                    <CardHeader className="px-0 pt-0">
                      <CardTitle>Performance</CardTitle>
                    </CardHeader>
                    <CardContent className="px-0 flex flex-col gap-4">
                      <SettingRow label="Cache TTL (seconds)">
                        <Input
                          type="number"
                          value={form.cacheTtlSec}
                          onChange={(e) => update('cacheTtlSec', Number(e.target.value) || DEFAULTS.cacheTtlSec)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow label="Streaming chunk size">
                        <Input
                          type="number"
                          value={form.streamingChunkSize}
                          onChange={(e) => update('streamingChunkSize', Number(e.target.value) || DEFAULTS.streamingChunkSize)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow label="Worker concurrency">
                        <Input
                          type="number"
                          value={form.workerConcurrency}
                          onChange={(e) => update('workerConcurrency', Number(e.target.value) || DEFAULTS.workerConcurrency)}
                          className="w-48"
                        />
                      </SettingRow>
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
