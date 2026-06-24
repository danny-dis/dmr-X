import {
  Settings as SettingsIcon, Save, RotateCcw, Server, Shield, Brain, Cpu,
  Bell, Webhook, Trophy, Clock, AlertTriangle, KeyRound, Copy, Check,
} from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogClose,
} from '@/components/primitives/Dialog';
import { Input } from '@/components/primitives/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Slider } from '@/components/primitives/Slider';
import { Switch } from '@/components/primitives/Switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { toast } from '@/components/primitives/Toast';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';

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
      toast.error('Rotation failed', { description: (e as Error).message });
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

  const dirty = JSON.stringify(form) !== JSON.stringify(fromServer(settings.data));

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
                <TabsTrigger value="alerts" variant="pills" className="justify-start">
                  <Bell className="size-3" /> Alerts
                </TabsTrigger>
                <TabsTrigger value="webhooks" variant="pills" className="justify-start">
                  <Webhook className="size-3" /> Webhooks
                </TabsTrigger>
                <TabsTrigger value="benchmarks" variant="pills" className="justify-start">
                  <Trophy className="size-3" /> Benchmarks
                </TabsTrigger>
                <TabsTrigger value="retention" variant="pills" className="justify-start">
                  <Clock className="size-3" /> Data Retention
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
                          checked={form.fallbackEnabled}
                          onCheckedChange={(v) => update('fallbackEnabled', v)}
                        />
                      </SettingRow>
                      <SettingRow label="Routing timeout" description="Max time to wait for router decision (ms)">
                        <Input
                          type="number"
                          value={form.routingTimeout}
                          onChange={(e) => update('routingTimeout', Number(e.target.value) || DEFAULTS.routingTimeout)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow label="Quality weight" description="Weight for quality in routing score (0–1)">
                        <div className="w-48 space-y-2">
                          <Slider
                            value={[form.qualityWeight]}
                            min={0}
                            max={1}
                            step={0.05}
                            onValueChange={(v) => update('qualityWeight', v[0] ?? DEFAULTS.qualityWeight)}
                          />
                          <p className="text-[10px] text-fg-muted text-right">{form.qualityWeight.toFixed(2)}</p>
                        </div>
                      </SettingRow>
                      <SettingRow label="Cost weight" description="Weight for cost in routing score (0–1)">
                        <div className="w-48 space-y-2">
                          <Slider
                            value={[form.costWeight]}
                            min={0}
                            max={1}
                            step={0.05}
                            onValueChange={(v) => update('costWeight', v[0] ?? DEFAULTS.costWeight)}
                          />
                          <p className="text-[10px] text-fg-muted text-right">{form.costWeight.toFixed(2)}</p>
                        </div>
                      </SettingRow>
                      <SettingRow label="Latency weight" description="Weight for latency in routing score (0–1)">
                        <div className="w-48 space-y-2">
                          <Slider
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
                      <SettingRow label="Platform name" description="Display name shown in the UI">
                        <Input
                          value={form.platformName}
                          onChange={(e) => update('platformName', e.target.value)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow label="Timezone" description="System timezone for timestamps">
                        <Select value={form.timezone} onValueChange={(v) => update('timezone', v)}>
                          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
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
                      <SettingRow label="Require auth" description="Reject unauthenticated requests">
                        <Switch
                          checked={form.requireApiKeyAuth}
                          onCheckedChange={(v) => update('requireApiKeyAuth', v)}
                        />
                      </SettingRow>
                      <SettingRow label="CORS allowed origins">
                        <Input
                          value={form.allowedOrigins}
                          onChange={(e) => update('allowedOrigins', e.target.value)}
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
                      <SettingRow label="Auto key rotation" description="Automatically rotate API keys on schedule">
                        <Switch
                          checked={form.autoKeyRotation}
                          onCheckedChange={(v) => update('autoKeyRotation', v)}
                        />
                      </SettingRow>
                      <SettingRow label="Max request size (MB)" description="Maximum allowed request body size">
                        <Input
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
                        <AlertTriangle className="size-4 mt-0.5 shrink-0" />
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
                          <KeyRound className="size-3" />
                          Rotate admin key
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* ==================== CONFIRM ROTATION DIALOG ==================== */}
                <Dialog open={rotateConfirmOpen} onOpenChange={setRotateConfirmOpen}>
                  <DialogContent size="md">
                    <DialogHeader>
                      <DialogTitle>Rotate admin API key?</DialogTitle>
                      <DialogDescription>
                        You&apos;ll be logged out and need to use the new key.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogBody>
                      <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-warning">
                        <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                        <div className="text-xs leading-relaxed">
                          The current admin key will stop working immediately after rotation.
                          Make sure you can save the new key — you will not be shown it again
                          after this dialog closes.
                        </div>
                      </div>
                    </DialogBody>
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button variant="ghost" size="sm" disabled={rotating}>
                          Cancel
                        </Button>
                      </DialogClose>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleRotate}
                        loading={rotating}
                        disabled={rotating}
                      >
                        <KeyRound className="size-3" />
                        Yes, rotate
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

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
                          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
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
                                  <Check className="size-3" />
                                  Copied
                                </>
                              ) : (
                                <>
                                  <Copy className="size-3" />
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
                      <SettingRow label="Cache TTL (seconds)">
                        <Input
                          type="number"
                          value={form.cacheTtlSec}
                          onChange={(e) => update('cacheTtlSec', Number(e.target.value) || DEFAULTS.cacheTtlSec)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow label="Streaming chunk size" description="Tokens per streaming chunk">
                        <Input
                          type="number"
                          value={form.streamingChunkSize}
                          onChange={(e) => update('streamingChunkSize', Number(e.target.value) || DEFAULTS.streamingChunkSize)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow label="Worker concurrency" description="Max parallel worker threads">
                        <Input
                          type="number"
                          value={form.workerConcurrency}
                          onChange={(e) => update('workerConcurrency', Number(e.target.value) || DEFAULTS.workerConcurrency)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow label="Request timeout (ms)" description="Per-request timeout to providers">
                        <Input
                          type="number"
                          value={form.requestTimeout}
                          onChange={(e) => update('requestTimeout', Number(e.target.value) || DEFAULTS.requestTimeout)}
                          className="w-48"
                        />
                      </SettingRow>
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
                      <SettingRow label="Slack webhook URL" description="Post alerts to a Slack channel">
                        <Input
                          value={form.slackWebhookUrl}
                          onChange={(e) => update('slackWebhookUrl', e.target.value)}
                          placeholder="https://hooks.slack.com/services/..."
                          className="w-72"
                        />
                      </SettingRow>
                      <SettingRow label="Email recipients" description="Comma-separated email addresses">
                        <Input
                          value={form.emailRecipients}
                          onChange={(e) => update('emailRecipients', e.target.value)}
                          placeholder="ops@example.com, team@example.com"
                          className="w-72"
                        />
                      </SettingRow>
                      <SettingRow label="Latency alert threshold (ms)" description="Alert when avg latency exceeds this">
                        <div className="w-48 space-y-2">
                          <Slider
                            value={[form.latencyAlertThreshold]}
                            min={500}
                            max={30000}
                            step={500}
                            onValueChange={(v) => update('latencyAlertThreshold', v[0] ?? DEFAULTS.latencyAlertThreshold)}
                          />
                          <p className="text-[10px] text-fg-muted text-right">{form.latencyAlertThreshold}ms</p>
                        </div>
                      </SettingRow>
                      <SettingRow label="Quota alert threshold (%)" description="Alert when tenant usage exceeds this percentage">
                        <div className="w-48 space-y-2">
                          <Slider
                            value={[form.quotaAlertThreshold]}
                            min={50}
                            max={100}
                            step={5}
                            onValueChange={(v) => update('quotaAlertThreshold', v[0] ?? DEFAULTS.quotaAlertThreshold)}
                          />
                          <p className="text-[10px] text-fg-muted text-right">{form.quotaAlertThreshold}%</p>
                        </div>
                      </SettingRow>
                      <SettingRow label="Alert webhook URL" description="Send alerts to a generic webhook endpoint">
                        <Input
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
                      <SettingRow label="Route decision webhook" description="POST routing decisions to this URL">
                        <Input
                          value={form.routeDecisionWebhook}
                          onChange={(e) => update('routeDecisionWebhook', e.target.value)}
                          placeholder="https://example.com/webhooks/routing"
                          className="w-72"
                        />
                      </SettingRow>
                      <SettingRow label="Alert webhook URL" description="POST alerts to this URL">
                        <Input
                          value={form.alertWebhook}
                          onChange={(e) => update('alertWebhook', e.target.value)}
                          placeholder="https://example.com/webhooks/alerts"
                          className="w-72"
                        />
                      </SettingRow>
                      <SettingRow label="Max retries" description="Maximum webhook delivery retry attempts">
                        <Input
                          type="number"
                          min={0}
                          max={10}
                          value={form.webhookMaxRetries}
                          onChange={(e) => update('webhookMaxRetries', Number(e.target.value) || DEFAULTS.webhookMaxRetries)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow label="Retry backoff (ms)" description="Exponential backoff between retries">
                        <Input
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
                      <SettingRow label="Auto-run benchmarks" description="Schedule periodic benchmark runs">
                        <Switch
                          checked={form.autoBenchmarkRuns}
                          onCheckedChange={(v) => update('autoBenchmarkRuns', v)}
                        />
                      </SettingRow>
                      <SettingRow label="Benchmark frequency" description="How often to run benchmarks">
                        <Select value={form.benchmarkFrequency} onValueChange={(v) => update('benchmarkFrequency', v)}>
                          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="hourly">Hourly</SelectItem>
                            <SelectItem value="daily">Daily</SelectItem>
                            <SelectItem value="weekly">Weekly</SelectItem>
                            <SelectItem value="monthly">Monthly</SelectItem>
                          </SelectContent>
                        </Select>
                      </SettingRow>
                      <SettingRow label="Regression threshold (%)" description="Alert when score drops more than this">
                        <div className="w-48 space-y-2">
                          <Slider
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
                      <SettingRow label="Request log retention (days)" description="Keep request logs for this many days">
                        <Input
                          type="number"
                          min={1}
                          value={form.requestLogRetentionDays}
                          onChange={(e) => update('requestLogRetentionDays', Number(e.target.value) || DEFAULTS.requestLogRetentionDays)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow label="Memory retention (days)" description="Keep memory items for this many days">
                        <Input
                          type="number"
                          min={1}
                          value={form.memoryRetentionDays}
                          onChange={(e) => update('memoryRetentionDays', Number(e.target.value) || DEFAULTS.memoryRetentionDays)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow label="Benchmark history (days)" description="Keep benchmark results for this many days">
                        <Input
                          type="number"
                          min={1}
                          value={form.benchmarkHistoryDays}
                          onChange={(e) => update('benchmarkHistoryDays', Number(e.target.value) || DEFAULTS.benchmarkHistoryDays)}
                          className="w-48"
                        />
                      </SettingRow>
                      <SettingRow label="General log retention (days)" description="Keep general logs for this many days">
                        <Input
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
      </div>
    </PageContainer>
  );
}

/* -------------------------------------------------------------------------- */
/*  Helper component                                                          */
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
