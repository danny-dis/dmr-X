import {
  Settings as SettingsIcon, Save, RotateCcw, Server, Shield, Brain, Cpu,
  Bell, Webhook, Trophy, Clock, AlertTriangle, KeyRound, Copy, Check,
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
import { DataState } from '@/components/primitives/DataState';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from '@/components/primitives/Dialog';
import { interpretError } from '@/components/primitives/ErrorState';
import { Input } from '@/components/primitives/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Slider } from '@/components/primitives/Slider';
import { Switch } from '@/components/primitives/Switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { toast } from '@/components/primitives/Toast';
import { Admin } from '@/lib/admin';
import { useNeedleStatus, useSettings, useUpdateSettings } from '@/lib/queries/settings';

/* -------------------------------------------------------------------------- */
/*  Form type + defaults                                                      */
/* -------------------------------------------------------------------------- */

interface SettingsForm {
  // Routing
  routingStrategy: 'auto' | 'cost' | 'latency' | 'round-robin' | 'priority';
  costOptimization: boolean;
  latencyBudgetMs: number;
  fallbackEnabled: boolean;
  routingTimeout: number;
  qualityWeight: number;
  costWeight: number;
  latencyWeight: number;
  // Defaults
  defaultModel: string;
  maxContextWindow: number;
  defaultTemperature: number;
  platformName: string;
  timezone: string;
  // Security
  requireApiKeyAuth: boolean;
  allowedOrigins: string;
  rateLimitRpm: number;
  autoKeyRotation: boolean;
  maxRequestSizeMb: number;
  // Performance
  cacheTtlSec: number;
  streamingChunkSize: number;
  workerConcurrency: number;
  requestTimeout: number;
  needleRouterEnabled: boolean;
  // Alerts
  slackWebhookUrl: string;
  emailRecipients: string;
  latencyAlertThreshold: number;
  quotaAlertThreshold: number;
  alertWebhook: string;
  routeDecisionWebhook: string;
  // Webhooks
  webhookMaxRetries: number;
  webhookRetryBackoff: number;
  // Benchmarks
  autoBenchmarkRuns: boolean;
  benchmarkFrequency: string;
  regressionThreshold: number;
  // Data Retention
  requestLogRetentionDays: number;
  memoryRetentionDays: number;
  benchmarkHistoryDays: number;
  logRetention: number;
}

const DEFAULTS: SettingsForm = {
  routingStrategy: 'auto',
  costOptimization: true,
  latencyBudgetMs: 2000,
  fallbackEnabled: true,
  routingTimeout: 30000,
  qualityWeight: 0.4,
  costWeight: 0.25,
  latencyWeight: 0.2,
  defaultModel: 'auto',
  maxContextWindow: 128000,
  defaultTemperature: 0.7,
  platformName: 'DMR-X',
  timezone: 'UTC',
  requireApiKeyAuth: true,
  allowedOrigins: '*',
  rateLimitRpm: 600,
  autoKeyRotation: false,
  maxRequestSizeMb: 10,
  cacheTtlSec: 300,
  streamingChunkSize: 64,
  workerConcurrency: 8,
  requestTimeout: 30000,
  needleRouterEnabled: false,
  slackWebhookUrl: '',
  emailRecipients: '',
  latencyAlertThreshold: 5000,
  quotaAlertThreshold: 80,
  alertWebhook: '',
  routeDecisionWebhook: '',
  webhookMaxRetries: 3,
  webhookRetryBackoff: 1000,
  autoBenchmarkRuns: false,
  benchmarkFrequency: 'daily',
  regressionThreshold: 10,
  requestLogRetentionDays: 30,
  memoryRetentionDays: 90,
  benchmarkHistoryDays: 30,
  logRetention: 30,
};

/* -------------------------------------------------------------------------- */
/*  Server ↔ form mapping                                                    */
/* -------------------------------------------------------------------------- */

function fromServer(s: Record<string, unknown> | null): SettingsForm {
  if (!s) return { ...DEFAULTS };
  const num = (k: string, d: number) => typeof s[k] === 'number' ? s[k] as number : d;
  const str = (k: string, d: string) => typeof s[k] === 'string' ? s[k] as string : d;
  const bool = (k: string, d: boolean) => s[k] != null ? Boolean(s[k]) : d;
  return {
    routingStrategy: (s.routingStrategy as SettingsForm['routingStrategy']) ?? DEFAULTS.routingStrategy,
    costOptimization: bool('costOptimization', DEFAULTS.costOptimization),
    latencyBudgetMs: num('latencyBudgetMs', DEFAULTS.latencyBudgetMs),
    fallbackEnabled: bool('fallbackEnabled', DEFAULTS.fallbackEnabled),
    routingTimeout: num('routingTimeout', DEFAULTS.routingTimeout),
    qualityWeight: num('qualityWeight', DEFAULTS.qualityWeight),
    costWeight: num('costWeight', DEFAULTS.costWeight),
    latencyWeight: num('latencyWeight', DEFAULTS.latencyWeight),
    defaultModel: str('defaultModel', DEFAULTS.defaultModel),
    maxContextWindow: num('maxContextWindow', DEFAULTS.maxContextWindow),
    defaultTemperature: num('defaultTemperature', DEFAULTS.defaultTemperature),
    platformName: str('platformName', DEFAULTS.platformName),
    timezone: str('timezone', DEFAULTS.timezone),
    requireApiKeyAuth: bool('requireApiKeyAuth', DEFAULTS.requireApiKeyAuth),
    allowedOrigins: str('allowedOrigins', DEFAULTS.allowedOrigins),
    rateLimitRpm: num('rateLimitRpm', DEFAULTS.rateLimitRpm),
    autoKeyRotation: bool('autoKeyRotation', DEFAULTS.autoKeyRotation),
    maxRequestSizeMb: num('maxRequestSizeMb', DEFAULTS.maxRequestSizeMb),
    cacheTtlSec: num('cacheTtlSec', DEFAULTS.cacheTtlSec),
    streamingChunkSize: num('streamingChunkSize', DEFAULTS.streamingChunkSize),
    workerConcurrency: num('workerConcurrency', DEFAULTS.workerConcurrency),
    requestTimeout: num('requestTimeout', DEFAULTS.requestTimeout),
    needleRouterEnabled: bool('needleRouterEnabled', DEFAULTS.needleRouterEnabled),
    slackWebhookUrl: str('slackWebhookUrl', DEFAULTS.slackWebhookUrl),
    emailRecipients: str('emailRecipients', DEFAULTS.emailRecipients),
    latencyAlertThreshold: num('latencyAlertThreshold', DEFAULTS.latencyAlertThreshold),
    quotaAlertThreshold: num('quotaAlertThreshold', DEFAULTS.quotaAlertThreshold),
    alertWebhook: str('alertWebhook', DEFAULTS.alertWebhook),
    routeDecisionWebhook: str('routeDecisionWebhook', DEFAULTS.routeDecisionWebhook),
    webhookMaxRetries: num('webhookMaxRetries', DEFAULTS.webhookMaxRetries),
    webhookRetryBackoff: num('webhookRetryBackoff', DEFAULTS.webhookRetryBackoff),
    autoBenchmarkRuns: bool('autoBenchmarkRuns', DEFAULTS.autoBenchmarkRuns),
    benchmarkFrequency: str('benchmarkFrequency', DEFAULTS.benchmarkFrequency),
    regressionThreshold: num('regressionThreshold', DEFAULTS.regressionThreshold),
    requestLogRetentionDays: num('requestLogRetentionDays', DEFAULTS.requestLogRetentionDays),
    memoryRetentionDays: num('memoryRetentionDays', DEFAULTS.memoryRetentionDays),
    benchmarkHistoryDays: num('benchmarkHistoryDays', DEFAULTS.benchmarkHistoryDays),
    logRetention: num('logRetention', DEFAULTS.logRetention),
  };
}

function toServer(f: SettingsForm): Record<string, unknown> {
  return {
    routingStrategy: f.routingStrategy,
    costOptimization: f.costOptimization,
    latencyBudgetMs: f.latencyBudgetMs,
    autoFallback: f.fallbackEnabled,
    routingTimeout: f.routingTimeout,
    qualityWeight: f.qualityWeight,
    costWeight: f.costWeight,
    latencyWeight: f.latencyWeight,
    defaultModel: f.defaultModel,
    maxContextWindow: f.maxContextWindow,
    defaultTemperature: f.defaultTemperature,
    platformName: f.platformName,
    timezone: f.timezone,
    requireAuth: f.requireApiKeyAuth,
    corsOrigins: f.allowedOrigins,
    rateLimitRpm: f.rateLimitRpm,
    autoKeyRotation: f.autoKeyRotation,
    maxRequestSizeMb: f.maxRequestSizeMb,
    cacheTtlSec: f.cacheTtlSec,
    streamingChunkSize: f.streamingChunkSize,
    workerConcurrency: f.workerConcurrency,
    requestTimeout: f.requestTimeout,
    needleRouterEnabled: f.needleRouterEnabled,
    slackWebhookUrl: f.slackWebhookUrl,
    emailRecipients: f.emailRecipients,
    latencyAlertThreshold: f.latencyAlertThreshold,
    quotaAlertThreshold: f.quotaAlertThreshold,
    alertWebhook: f.alertWebhook,
    routeDecisionWebhook: f.routeDecisionWebhook,
    webhookMaxRetries: f.webhookMaxRetries,
    webhookRetryBackoff: f.webhookRetryBackoff,
    autoBenchmarkRuns: f.autoBenchmarkRuns,
    benchmarkFrequency: f.benchmarkFrequency,
    regressionThreshold: f.regressionThreshold,
    requestLogRetentionDays: f.requestLogRetentionDays,
    memoryRetentionDays: f.memoryRetentionDays,
    benchmarkHistoryDays: f.benchmarkHistoryDays,
    logRetention: f.logRetention,
  };
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export function SettingsPage() {
  const settings = useSettings({ refetchInterval: 60000 });
  // Live reachability + last-run telemetry for the Needle tool pre-filter —
  // polled independently of the settings form so the status card stays
  // fresh (and reflects a toggle flip immediately after Save) without
  // reloading the whole settings form.
  const needleStatus = useNeedleStatus({ refetchInterval: 15000 });
  const updateSettings = useUpdateSettings();
  const [form, setForm] = React.useState<SettingsForm>(DEFAULTS);
  const saving = updateSettings.isPending;
  const [resetKey, setResetKey] = React.useState(0);

  React.useEffect(() => {
    setForm(fromServer(settings.data ?? null));
  }, [settings.data, resetKey]);

  const update = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onSave = async () => {
    try {
      await updateSettings.mutateAsync(toServer(form));
      toast.success('Settings saved', { description: 'Configuration persisted to the gateway.' });
      await needleStatus.refetch();
    } catch (e) {
      const interpreted = interpretError(e);
      toast.error(interpreted.title, { description: interpreted.description });
    }
  };

  const onReset = () => {
    setResetKey((k) => k + 1);
    setForm({ ...DEFAULTS });
    toast.show('Reset to defaults', { description: 'Click Save to apply.', tone: 'info' });
  };

  // --- Admin key rotation state ---
  const [rotateConfirmOpen, setRotateConfirmOpen] = React.useState(false);
  const [newKeyDialogOpen, setNewKeyDialogOpen] = React.useState(false);
  const [newKey, setNewKey] = React.useState<string | null>(null);
  const [rotating, setRotating] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const handleRotate = async () => {
    setRotateConfirmOpen(false);
    setRotating(true);
    try {
      const res = await Admin.rotateAdminKey();
      setNewKey(res.new_key);
      setNewKeyDialogOpen(true);
      setCopied(false);
    } catch (e) {
      const interpreted = interpretError(e);
      toast.error(interpreted.title, { description: interpreted.description });
    } finally {
      setRotating(false);
    }
  };

  const copyNewKey = async () => {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
      toast.success('Copied to clipboard', { description: 'Store the new key somewhere safe.' });
    } catch {
      toast.error('Copy failed', { description: 'Select the key manually and copy it.' });
    }
  };

  const acknowledgeAndReload = () => {
    if (newKey) {
      // Persist the new admin token so the UI keeps working after the page
      // reloads. The gateway now expects this key on every admin request.
      try {
        localStorage.setItem('dmrx_token', newKey);
      } catch {
        // localStorage may be unavailable in some environments; surface a
        // warning but still reload so the user can re-authenticate.
        toast.warning('Could not persist new key locally', {
          description: 'You will need to re-enter the key after the reload.',
        });
      }
    }
    setNewKeyDialogOpen(false);
    // Force a clean state — the React app, the API helper, and any cached
    // auth checks all need to come back up with the new bearer token.
    window.location.reload();
  };

  const dirty = JSON.stringify(form) !== JSON.stringify(fromServer(settings.data ?? null));

  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description="Gateway configuration — routing, defaults, security, performance, alerts, webhooks"
        icon={<SettingsIcon className="size-5" />}
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
            <Button size="sm" onClick={onSave} loading={saving} disabled={!dirty} aria-label="Save settings">
              <Save className="size-3" aria-hidden />
              Save
            </Button>
          </>
        }
      />

      <div className="mt-5">
        <DataState
          data={settings.data}
          isLoading={settings.isLoading}
          error={settings.error}
          onRetry={settings.refetch}
          skeletonRows={6}
        >
          {() => (
          <Tabs defaultValue="routing" orientation="vertical">
            <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-3">
              {/* Mobile: horizontal scrollable tabs. Desktop: vertical pills */}
              <TabsList variant="pills" className="flex-col items-stretch h-fit lg:flex-col overflow-x-auto flex-row flex-nowrap lg:overflow-x-visible">
                <TabsTrigger value="routing" variant="pills" className="justify-start whitespace-nowrap" aria-label="Routing">
                  <Brain className="size-3" aria-hidden /> <span className="hidden sm:inline">Routing</span>
                </TabsTrigger>
                <TabsTrigger value="defaults" variant="pills" className="justify-start whitespace-nowrap" aria-label="Defaults">
                  <Cpu className="size-3" aria-hidden /> <span className="hidden sm:inline">Defaults</span>
                </TabsTrigger>
                <TabsTrigger value="security" variant="pills" className="justify-start whitespace-nowrap" aria-label="Security">
                  <Shield className="size-3" aria-hidden /> <span className="hidden sm:inline">Security</span>
                </TabsTrigger>
                <TabsTrigger value="performance" variant="pills" className="justify-start whitespace-nowrap" aria-label="Performance">
                  <Server className="size-3" aria-hidden /> <span className="hidden sm:inline">Performance</span>
                </TabsTrigger>
                <TabsTrigger value="alerts" variant="pills" className="justify-start whitespace-nowrap" aria-label="Alerts">
                  <Bell className="size-3" aria-hidden /> <span className="hidden sm:inline">Alerts</span>
                </TabsTrigger>
                <TabsTrigger value="webhooks" variant="pills" className="justify-start whitespace-nowrap" aria-label="Webhooks">
                  <Webhook className="size-3" aria-hidden /> <span className="hidden sm:inline">Webhooks</span>
                </TabsTrigger>
                <TabsTrigger value="benchmarks" variant="pills" className="justify-start whitespace-nowrap" aria-label="Benchmarks">
                  <Trophy className="size-3" aria-hidden /> <span className="hidden sm:inline">Benchmarks</span>
                </TabsTrigger>
                <TabsTrigger value="retention" variant="pills" className="justify-start whitespace-nowrap" aria-label="Data Retention">
                  <Clock className="size-3" aria-hidden /> <span className="hidden sm:inline">Data Retention</span>
                </TabsTrigger>
              </TabsList>

              <div>
                {/* ==================== ROUTING ==================== */}
                <TabsContent value="routing">
                  <Card padding="md">
                    <CardHeader className="px-0 pt-0">
                      <CardTitle>Routing strategy</CardTitle>
                      <p className="text-[10px] text-fg-muted mt-0.5">How requests are assigned to providers</p>
                    </CardHeader>
                    <CardContent className="px-0 flex flex-col gap-4">
                      <SettingRow id="routing-strategy" label="Default strategy" description="Fallback when no policy applies">
                        <Select
                          value={form.routingStrategy}
                          onValueChange={(v) => update('routingStrategy', v as SettingsForm['routingStrategy'])}
                        >
                          <SelectTrigger id="routing-strategy" aria-describedby="routing-strategy-description" className="w-48"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">Auto (intelligence-aware)</SelectItem>
                            <SelectItem value="cost">Lowest cost</SelectItem>
                            <SelectItem value="latency">Lowest latency</SelectItem>
                            <SelectItem value="round-robin">Round-robin</SelectItem>
                            <SelectItem value="priority">Priority order</SelectItem>
                          </SelectContent>
                        </Select>
                      </SettingRow>
                      <SettingRow id="cost-optimization" label="Cost optimization" description="Prefer cheaper models when possible">
                        <Switch
                          id="cost-optimization"
                          aria-describedby="cost-optimization-description"
                          checked={form.costOptimization}
                          onCheckedChange={(v) => update('costOptimization', v)}
                        />
                      </SettingRow>
                      <SettingRow id="latency-budget" label="Latency budget" description="Max acceptable p95 latency (ms)">
                        <div className="w-48 space-y-2">
                          <Slider
                            id="latency-budget"
                            aria-label="Latency budget"
                            aria-describedby="latency-budget-description"
                            value={[form.latencyBudgetMs]}
                            min={100}
                            max={10000}
                            step={100}
                            onValueChange={(v) => update('latencyBudgetMs', v[0] ?? DEFAULTS.latencyBudgetMs)}
                          />
                          <p className="text-[10px] text-fg-muted text-right">{form.latencyBudgetMs}ms</p>
                        </div>
                      </SettingRow>
                      <SettingRow id="auto-fallback" label="Auto-fallback" description="Retry on alternate provider if first fails">
                        <Switch
                          id="auto-fallback"
                          aria-describedby="auto-fallback-description"
                          checked={form.fallbackEnabled}
                          onCheckedChange={(v) => update('fallbackEnabled', v)}
                        />
                      </SettingRow>
                      <SettingRow id="routing-timeout" label="Routing timeout" description="Max time to wait for router decision (ms)">
                        <Input
                          id="routing-timeout"
                          aria-describedby="routing-timeout-description"
                          type="number"
                          value={form.routingTimeout}
                          onChange={(e) => update('routingTimeout', Number(e.target.value) || DEFAULTS.routingTimeout)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow id="quality-weight" label="Quality weight" description="Weight for quality in routing score (0–1)">
                        <div className="w-48 space-y-2">
                          <Slider
                            id="quality-weight"
                            aria-label="Quality weight"
                            aria-describedby="quality-weight-description"
                            value={[form.qualityWeight]}
                            min={0}
                            max={1}
                            step={0.05}
                            onValueChange={(v) => update('qualityWeight', v[0] ?? DEFAULTS.qualityWeight)}
                          />
                          <p className="text-[10px] text-fg-muted text-right">{form.qualityWeight.toFixed(2)}</p>
                        </div>
                      </SettingRow>
                      <SettingRow id="cost-weight" label="Cost weight" description="Weight for cost in routing score (0–1)">
                        <div className="w-48 space-y-2">
                          <Slider
                            id="cost-weight"
                            aria-label="Cost weight"
                            aria-describedby="cost-weight-description"
                            value={[form.costWeight]}
                            min={0}
                            max={1}
                            step={0.05}
                            onValueChange={(v) => update('costWeight', v[0] ?? DEFAULTS.costWeight)}
                          />
                          <p className="text-[10px] text-fg-muted text-right">{form.costWeight.toFixed(2)}</p>
                        </div>
                      </SettingRow>
                      <SettingRow id="latency-weight" label="Latency weight" description="Weight for latency in routing score (0–1)">
                        <div className="w-48 space-y-2">
                          <Slider
                            id="latency-weight"
                            aria-label="Latency weight"
                            aria-describedby="latency-weight-description"
                            value={[form.latencyWeight]}
                            min={0}
                            max={1}
                            step={0.05}
                            onValueChange={(v) => update('latencyWeight', v[0] ?? DEFAULTS.latencyWeight)}
                          />
                          <p className="text-[10px] text-fg-muted text-right">{form.latencyWeight.toFixed(2)}</p>
                        </div>
                      </SettingRow>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* ==================== DEFAULTS ==================== */}
                <TabsContent value="defaults">
                  <Card padding="md">
                    <CardHeader className="px-0 pt-0">
                      <CardTitle>Model defaults</CardTitle>
                    </CardHeader>
                    <CardContent className="px-0 flex flex-col gap-4">
                      <SettingRow id="default-model" label="Default model">
                        <Input
                          id="default-model"
                          value={form.defaultModel}
                          onChange={(e) => update('defaultModel', e.target.value)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow id="max-context-window" label="Max context window" description="Tokens">
                        <Input
                          id="max-context-window"
                          aria-describedby="max-context-window-description"
                          type="number"
                          value={form.maxContextWindow}
                          onChange={(e) => update('maxContextWindow', Number(e.target.value) || DEFAULTS.maxContextWindow)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow id="default-temperature" label="Default temperature">
                        <Input
                          id="default-temperature"
                          type="number"
                          step="0.1"
                          value={form.defaultTemperature}
                          onChange={(e) => update('defaultTemperature', Number(e.target.value) || DEFAULTS.defaultTemperature)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow id="platform-name" label="Platform name" description="Display name shown in the UI">
                        <Input
                          id="platform-name"
                          aria-describedby="platform-name-description"
                          value={form.platformName}
                          onChange={(e) => update('platformName', e.target.value)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow id="timezone" label="Timezone" description="System timezone for timestamps">
                        <Select value={form.timezone} onValueChange={(v) => update('timezone', v)}>
                          <SelectTrigger id="timezone" aria-describedby="timezone-description" className="w-48"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="UTC">UTC</SelectItem>
                            <SelectItem value="America/New_York">America/New_York</SelectItem>
                            <SelectItem value="America/Chicago">America/Chicago</SelectItem>
                            <SelectItem value="America/Denver">America/Denver</SelectItem>
                            <SelectItem value="America/Los_Angeles">America/Los_Angeles</SelectItem>
                            <SelectItem value="Europe/London">Europe/London</SelectItem>
                            <SelectItem value="Europe/Berlin">Europe/Berlin</SelectItem>
                            <SelectItem value="Asia/Tokyo">Asia/Tokyo</SelectItem>
                            <SelectItem value="Asia/Shanghai">Asia/Shanghai</SelectItem>
                            <SelectItem value="Asia/Kolkata">Asia/Kolkata</SelectItem>
                            <SelectItem value="Australia/Sydney">Australia/Sydney</SelectItem>
                          </SelectContent>
                        </Select>
                      </SettingRow>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* ==================== SECURITY ==================== */}
                <TabsContent value="security" className="flex flex-col gap-4">
                  <Card padding="md">
                    <CardHeader className="px-0 pt-0">
                      <CardTitle>Security</CardTitle>
                    </CardHeader>
                    <CardContent className="px-0 flex flex-col gap-4">
                      <SettingRow id="require-auth" label="Require auth" description="Reject unauthenticated requests">
                        <Switch
                          id="require-auth"
                          aria-describedby="require-auth-description"
                          checked={form.requireApiKeyAuth}
                          onCheckedChange={(v) => update('requireApiKeyAuth', v)}
                        />
                      </SettingRow>
                      <SettingRow id="allowed-origins" label="CORS allowed origins">
                        <Input
                          id="allowed-origins"
                          value={form.allowedOrigins}
                          onChange={(e) => update('allowedOrigins', e.target.value)}
                          className="w-72"
                        />
                      </SettingRow>
                      <SettingRow id="rate-limit-rpm" label="Rate limit (req/min)">
                        <Input
                          id="rate-limit-rpm"
                          type="number"
                          value={form.rateLimitRpm}
                          onChange={(e) => update('rateLimitRpm', Number(e.target.value) || DEFAULTS.rateLimitRpm)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow id="auto-key-rotation" label="Auto key rotation" description="Automatically rotate API keys on schedule">
                        <Switch
                          id="auto-key-rotation"
                          aria-describedby="auto-key-rotation-description"
                          checked={form.autoKeyRotation}
                          onCheckedChange={(v) => update('autoKeyRotation', v)}
                        />
                      </SettingRow>
                      <SettingRow id="max-request-size" label="Max request size (MB)" description="Maximum allowed request body size">
                        <Input
                          id="max-request-size"
                          aria-describedby="max-request-size-description"
                          type="number"
                          value={form.maxRequestSizeMb}
                          onChange={(e) => update('maxRequestSizeMb', Number(e.target.value) || DEFAULTS.maxRequestSizeMb)}
                          className="w-48"
                        />
                      </SettingRow>
                    </CardContent>
                  </Card>

                  {/* Admin API key rotation */}
                  <Card padding="md">
                    <CardHeader className="px-0 pt-0">
                      <CardTitle>Admin API key rotation</CardTitle>
                      <p className="text-[10px] text-fg-muted mt-0.5">
                        Issue a new admin key without restarting the gateway.
                      </p>
                    </CardHeader>
                    <CardContent className="px-0 flex flex-col gap-4">
                      <div
                        className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-warning"
                        role="alert"
                      >
                        <AlertTriangle className="size-4 mt-0.5 shrink-0" aria-hidden />
                        <div className="text-xs leading-relaxed">
                          Rotating the admin key invalidates the current session.
                          Save the new key — it will not be shown again.
                          Update <code className="font-mono">DMRX_ADMIN_API_KEY</code> in
                          your deployment environment to persist across restarts.
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <div className="text-xs text-fg-muted">
                          The new key replaces the current one in <code className="font-mono">process.env</code>
                          immediately. The next admin request must use the new key.
                        </div>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => setRotateConfirmOpen(true)}
                          loading={rotating}
                          disabled={rotating}
                        >
                          <KeyRound className="size-3" aria-hidden />
                          Rotate admin key
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* ==================== CONFIRM ROTATION DIALOG ==================== */}
                <AlertDialog open={rotateConfirmOpen} onOpenChange={setRotateConfirmOpen}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Rotate admin API key?</AlertDialogTitle>
                      <AlertDialogDescription>
                        You&apos;ll be logged out and need to use the new key.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-warning">
                      <AlertTriangle className="size-4 mt-0.5 shrink-0" aria-hidden />
                      <div className="text-xs leading-relaxed">
                        The current admin key will stop working immediately after rotation.
                        Make sure you can save the new key — you will not be shown it again
                        after this dialog closes.
                      </div>
                    </div>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={rotating}>
                        Cancel
                      </AlertDialogCancel>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleRotate}
                        loading={rotating}
                        disabled={rotating}
                      >
                        <KeyRound className="size-3" aria-hidden />
                        Yes, rotate
                      </Button>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                {/* ==================== NEW KEY DISPLAY DIALOG ==================== */}
                <Dialog open={newKeyDialogOpen} onOpenChange={(open) => {
                  // Block closing via overlay/escape — the user must explicitly
                  // acknowledge by clicking "I've saved it". Otherwise they'd
                  // lose the only copy of the key.
                  if (!open) return;
                  setNewKeyDialogOpen(open);
                }}>
                  <DialogContent size="lg">
                    <DialogHeader>
                      <DialogTitle>New admin key</DialogTitle>
                      <DialogDescription>
                        Save this key now. It will not be shown again.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogBody>
                      <div className="flex flex-col gap-3">
                        <div className="flex items-start gap-3 rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-danger">
                          <AlertTriangle className="size-4 mt-0.5 shrink-0" aria-hidden />
                          <div className="text-xs leading-relaxed">
                            This is the only time the new key will be displayed.
                            Store it in a secure location (password manager, secrets vault, etc.)
                            before continuing. The page will reload after you acknowledge.
                          </div>
                        </div>
                        <div className="rounded-lg border border-border bg-surface-2 p-4">
                          <div className="flex items-start justify-between gap-2">
                            <code
                              data-testid="new-admin-key"
                              className="font-mono text-sm break-all text-fg leading-relaxed select-all flex-1"
                            >
                              {newKey ?? ''}
                            </code>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={copyNewKey}
                              className="shrink-0"
                            >
                              {copied ? (
                                <>
                                  <Check className="size-3" aria-hidden />
                                  Copied
                                </>
                              ) : (
                                <>
                                  <Copy className="size-3" aria-hidden />
                                  Copy
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                        <p className="text-[11px] text-fg-muted leading-relaxed">
                          After acknowledging, <code className="font-mono">dmrx_token</code> in
                          your browser&apos;s localStorage will be updated and the page will reload
                          so subsequent admin requests use the new key.
                          For persistence across gateway restarts, also update
                          <code className="font-mono"> DMRX_ADMIN_API_KEY </code> in your deployment.
                        </p>
                      </div>
                    </DialogBody>
                    <DialogFooter>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={acknowledgeAndReload}
                      >
                        I&apos;ve saved it — reload
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                {/* ==================== PERFORMANCE ==================== */}
                <TabsContent value="performance">
                  <Card padding="md">
                    <CardHeader className="px-0 pt-0">
                      <CardTitle>Performance</CardTitle>
                    </CardHeader>
                    <CardContent className="px-0 flex flex-col gap-4">
                      <SettingRow id="cache-ttl" label="Cache TTL (seconds)">
                        <Input
                          id="cache-ttl"
                          type="number"
                          value={form.cacheTtlSec}
                          onChange={(e) => update('cacheTtlSec', Number(e.target.value) || DEFAULTS.cacheTtlSec)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow id="streaming-chunk-size" label="Streaming chunk size" description="Tokens per streaming chunk">
                        <Input
                          id="streaming-chunk-size"
                          aria-describedby="streaming-chunk-size-description"
                          type="number"
                          value={form.streamingChunkSize}
                          onChange={(e) => update('streamingChunkSize', Number(e.target.value) || DEFAULTS.streamingChunkSize)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow id="worker-concurrency" label="Worker concurrency" description="Max parallel worker threads">
                        <Input
                          id="worker-concurrency"
                          aria-describedby="worker-concurrency-description"
                          type="number"
                          value={form.workerConcurrency}
                          onChange={(e) => update('workerConcurrency', Number(e.target.value) || DEFAULTS.workerConcurrency)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow id="request-timeout" label="Request timeout (ms)" description="Per-request timeout to providers">
                        <Input
                          id="request-timeout"
                          aria-describedby="request-timeout-description"
                          type="number"
                          value={form.requestTimeout}
                          onChange={(e) => update('requestTimeout', Number(e.target.value) || DEFAULTS.requestTimeout)}
                          className="w-48"
                        />
                      </SettingRow>
                    </CardContent>
                  </Card>

                  <Card padding="md" className="mt-4">
                    <CardHeader className="px-0 pt-0">
                      <CardTitle>Needle tool pre-filter</CardTitle>
                      <p className="text-[10px] text-fg-muted mt-0.5">
                        Local CPU model (services/needle-router) that narrows a large tool list before
                        it reaches the routed model. Measured single-request inference on this class of
                        hardware runs 50-90+ seconds regardless of tool count, so it stays off by default —
                        review the status below before enabling.
                      </p>
                    </CardHeader>
                    <CardContent className="px-0 flex flex-col gap-4">
                      <SettingRow id="needle-enabled" label="Enable Needle pre-filter" description="Applies on the next request — no restart needed">
                        <Switch
                          id="needle-enabled"
                          aria-describedby="needle-enabled-description"
                          checked={form.needleRouterEnabled}
                          onCheckedChange={(v) => update('needleRouterEnabled', v)}
                        />
                      </SettingRow>

                      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-2/40 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-fg">Sidecar status</span>
                          {needleStatus.isLoading && !needleStatus.data ? (
                            <Badge tone="neutral" size="sm">Checking…</Badge>
                          ) : needleStatus.data?.reachable ? (
                            <Badge tone="success" size="sm">Reachable</Badge>
                          ) : (
                            <Badge tone="danger" size="sm">Unreachable</Badge>
                          )}
                        </div>
                        {needleStatus.data && (
                          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-fg-muted">
                            <dt>Enabled</dt>
                            <dd className="text-right text-fg">{needleStatus.data.enabled ? 'Yes' : 'No (default)'}</dd>
                            <dt>Model loaded</dt>
                            <dd className="text-right text-fg">
                              {needleStatus.data.modelLoaded == null ? '—' : needleStatus.data.modelLoaded ? 'Yes' : 'No'}
                            </dd>
                            <dt>Health probe latency</dt>
                            <dd className="text-right text-fg">{needleStatus.data.probeLatencyMs}ms</dd>
                            <dt>Timeout budget</dt>
                            <dd className="text-right text-fg">{needleStatus.data.timeoutBudgetMs}ms</dd>
                            <dt>Last filter attempt</dt>
                            <dd className="text-right text-fg">
                              {needleStatus.data.lastAttempt
                                ? `${needleStatus.data.lastAttempt.outcome} (${needleStatus.data.lastAttempt.latencyMs ?? '—'}ms)`
                                : 'None yet this session'}
                            </dd>
                          </dl>
                        )}
                        {needleStatus.data?.lastAttempt?.outcome === 'timeout' && (
                          <p className="text-[10px] text-warning">
                            Last attempt exceeded the {needleStatus.data.timeoutBudgetMs}ms budget — the full
                            tool list was used for that turn.
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* ==================== ALERTS ==================== */}
                <TabsContent value="alerts">
                  <Card padding="md">
                    <CardHeader className="px-0 pt-0">
                      <CardTitle>Alert configuration</CardTitle>
                      <p className="text-[10px] text-fg-muted mt-0.5">Configure alert thresholds and notification channels</p>
                    </CardHeader>
                    <CardContent className="px-0 flex flex-col gap-4">
                      <SettingRow id="slack-webhook-url" label="Slack webhook URL" description="Post alerts to a Slack channel">
                        <Input
                          id="slack-webhook-url"
                          aria-describedby="slack-webhook-url-description"
                          value={form.slackWebhookUrl}
                          onChange={(e) => update('slackWebhookUrl', e.target.value)}
                          placeholder="https://hooks.slack.com/services/..."
                          className="w-72"
                        />
                      </SettingRow>
                      <SettingRow id="email-recipients" label="Email recipients" description="Comma-separated email addresses">
                        <Input
                          id="email-recipients"
                          aria-describedby="email-recipients-description"
                          value={form.emailRecipients}
                          onChange={(e) => update('emailRecipients', e.target.value)}
                          placeholder="ops@example.com, team@example.com"
                          className="w-72"
                        />
                      </SettingRow>
                      <SettingRow id="latency-alert-threshold" label="Latency alert threshold (ms)" description="Alert when avg latency exceeds this">
                        <div className="w-48 space-y-2">
                          <Slider
                            id="latency-alert-threshold"
                            aria-label="Latency alert threshold"
                            aria-describedby="latency-alert-threshold-description"
                            value={[form.latencyAlertThreshold]}
                            min={500}
                            max={30000}
                            step={500}
                            onValueChange={(v) => update('latencyAlertThreshold', v[0] ?? DEFAULTS.latencyAlertThreshold)}
                          />
                          <p className="text-[10px] text-fg-muted text-right">{form.latencyAlertThreshold}ms</p>
                        </div>
                      </SettingRow>
                      <SettingRow id="quota-alert-threshold" label="Quota alert threshold (%)" description="Alert when tenant usage exceeds this percentage">
                        <div className="w-48 space-y-2">
                          <Slider
                            id="quota-alert-threshold"
                            aria-label="Quota alert threshold"
                            aria-describedby="quota-alert-threshold-description"
                            value={[form.quotaAlertThreshold]}
                            min={50}
                            max={100}
                            step={5}
                            onValueChange={(v) => update('quotaAlertThreshold', v[0] ?? DEFAULTS.quotaAlertThreshold)}
                          />
                          <p className="text-[10px] text-fg-muted text-right">{form.quotaAlertThreshold}%</p>
                        </div>
                      </SettingRow>
                      <SettingRow id="alerts-alert-webhook-url" label="Alert webhook URL" description="Send alerts to a generic webhook endpoint">
                        <Input
                          id="alerts-alert-webhook-url"
                          aria-describedby="alerts-alert-webhook-url-description"
                          value={form.alertWebhook}
                          onChange={(e) => update('alertWebhook', e.target.value)}
                          placeholder="https://example.com/webhooks/alerts"
                          className="w-72"
                        />
                      </SettingRow>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* ==================== WEBHOOKS ==================== */}
                <TabsContent value="webhooks">
                  <Card padding="md">
                    <CardHeader className="px-0 pt-0">
                      <CardTitle>Webhook configuration</CardTitle>
                      <p className="text-[10px] text-fg-muted mt-0.5">Configure webhook endpoints and retry behavior</p>
                    </CardHeader>
                    <CardContent className="px-0 flex flex-col gap-4">
                      <SettingRow id="route-decision-webhook" label="Route decision webhook" description="POST routing decisions to this URL">
                        <Input
                          id="route-decision-webhook"
                          aria-describedby="route-decision-webhook-description"
                          value={form.routeDecisionWebhook}
                          onChange={(e) => update('routeDecisionWebhook', e.target.value)}
                          placeholder="https://example.com/webhooks/routing"
                          className="w-72"
                        />
                      </SettingRow>
                      <SettingRow id="webhooks-alert-webhook-url" label="Alert webhook URL" description="POST alerts to this URL">
                        <Input
                          id="webhooks-alert-webhook-url"
                          aria-describedby="webhooks-alert-webhook-url-description"
                          value={form.alertWebhook}
                          onChange={(e) => update('alertWebhook', e.target.value)}
                          placeholder="https://example.com/webhooks/alerts"
                          className="w-72"
                        />
                      </SettingRow>
                      <SettingRow id="webhook-max-retries" label="Max retries" description="Maximum webhook delivery retry attempts">
                        <Input
                          id="webhook-max-retries"
                          aria-describedby="webhook-max-retries-description"
                          type="number"
                          min={0}
                          max={10}
                          value={form.webhookMaxRetries}
                          onChange={(e) => update('webhookMaxRetries', Number(e.target.value) || DEFAULTS.webhookMaxRetries)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow id="webhook-retry-backoff" label="Retry backoff (ms)" description="Exponential backoff between retries">
                        <Input
                          id="webhook-retry-backoff"
                          aria-describedby="webhook-retry-backoff-description"
                          type="number"
                          min={100}
                          value={form.webhookRetryBackoff}
                          onChange={(e) => update('webhookRetryBackoff', Number(e.target.value) || DEFAULTS.webhookRetryBackoff)}
                          className="w-48"
                        />
                      </SettingRow>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* ==================== BENCHMARKS ==================== */}
                <TabsContent value="benchmarks">
                  <Card padding="md">
                    <CardHeader className="px-0 pt-0">
                      <CardTitle>Benchmark configuration</CardTitle>
                      <p className="text-[10px] text-fg-muted mt-0.5">Automated model performance comparisons</p>
                    </CardHeader>
                    <CardContent className="px-0 flex flex-col gap-4">
                      <SettingRow id="auto-benchmark-runs" label="Auto-run benchmarks" description="Schedule periodic benchmark runs">
                        <Switch
                          id="auto-benchmark-runs"
                          aria-describedby="auto-benchmark-runs-description"
                          checked={form.autoBenchmarkRuns}
                          onCheckedChange={(v) => update('autoBenchmarkRuns', v)}
                        />
                      </SettingRow>
                      <SettingRow id="benchmark-frequency" label="Benchmark frequency" description="How often to run benchmarks">
                        <Select value={form.benchmarkFrequency} onValueChange={(v) => update('benchmarkFrequency', v)}>
                          <SelectTrigger id="benchmark-frequency" aria-describedby="benchmark-frequency-description" className="w-48"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="hourly">Hourly</SelectItem>
                            <SelectItem value="daily">Daily</SelectItem>
                            <SelectItem value="weekly">Weekly</SelectItem>
                            <SelectItem value="monthly">Monthly</SelectItem>
                          </SelectContent>
                        </Select>
                      </SettingRow>
                      <SettingRow id="regression-threshold" label="Regression threshold (%)" description="Alert when score drops more than this">
                        <div className="w-48 space-y-2">
                          <Slider
                            id="regression-threshold"
                            aria-label="Regression threshold"
                            aria-describedby="regression-threshold-description"
                            value={[form.regressionThreshold]}
                            min={1}
                            max={50}
                            step={1}
                            onValueChange={(v) => update('regressionThreshold', v[0] ?? DEFAULTS.regressionThreshold)}
                          />
                          <p className="text-[10px] text-fg-muted text-right">{form.regressionThreshold}%</p>
                        </div>
                      </SettingRow>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* ==================== DATA RETENTION ==================== */}
                <TabsContent value="retention">
                  <Card padding="md">
                    <CardHeader className="px-0 pt-0">
                      <CardTitle>Data retention</CardTitle>
                      <p className="text-[10px] text-fg-muted mt-0.5">How long to keep historical data before automatic cleanup</p>
                    </CardHeader>
                    <CardContent className="px-0 flex flex-col gap-4">
                      <SettingRow id="request-log-retention" label="Request log retention (days)" description="Keep request logs for this many days">
                        <Input
                          id="request-log-retention"
                          aria-describedby="request-log-retention-description"
                          type="number"
                          min={1}
                          value={form.requestLogRetentionDays}
                          onChange={(e) => update('requestLogRetentionDays', Number(e.target.value) || DEFAULTS.requestLogRetentionDays)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow id="memory-retention" label="Memory retention (days)" description="Keep memory items for this many days">
                        <Input
                          id="memory-retention"
                          aria-describedby="memory-retention-description"
                          type="number"
                          min={1}
                          value={form.memoryRetentionDays}
                          onChange={(e) => update('memoryRetentionDays', Number(e.target.value) || DEFAULTS.memoryRetentionDays)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow id="benchmark-history-retention" label="Benchmark history (days)" description="Keep benchmark results for this many days">
                        <Input
                          id="benchmark-history-retention"
                          aria-describedby="benchmark-history-retention-description"
                          type="number"
                          min={1}
                          value={form.benchmarkHistoryDays}
                          onChange={(e) => update('benchmarkHistoryDays', Number(e.target.value) || DEFAULTS.benchmarkHistoryDays)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow id="general-log-retention" label="General log retention (days)" description="Keep general logs for this many days">
                        <Input
                          id="general-log-retention"
                          aria-describedby="general-log-retention-description"
                          type="number"
                          min={1}
                          value={form.logRetention}
                          onChange={(e) => update('logRetention', Number(e.target.value) || DEFAULTS.logRetention)}
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
        </DataState>
      </div>
    </PageContainer>
  );
}

/* -------------------------------------------------------------------------- */
/*  Helper component                                                          */
/* -------------------------------------------------------------------------- */

function SettingRow({
  id,
  label,
  description,
  children,
}: {
  /** Id of the control rendered in `children` — associates the label via `htmlFor`. */
  id: string;
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-border last:border-0">
      <div>
        <label htmlFor={id} className="text-sm font-medium text-fg">{label}</label>
        {description && <p id={`${id}-description`} className="text-[11px] text-fg-muted mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  );
}
