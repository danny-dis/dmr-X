import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  Settings as SettingsIcon, Bell, ShieldCheck,
  Route, BarChart3, Webhook, Database, Save
} from 'lucide-react';
import { useSettings } from '@/hooks/useApiData';

interface SettingSection {
  id: string;
  label: string;
  icon: typeof SettingsIcon;
  description: string;
}

const sections: SettingSection[] = [
  { id: 'general', label: 'General', icon: SettingsIcon, description: 'Platform name, timezone, defaults' },
  { id: 'routing', label: 'Routing', icon: Route, description: 'Weights, timeouts, fallback rules' },
  { id: 'notifications', label: 'Notifications', icon: Bell, description: 'Alert channels, thresholds' },
  { id: 'security', label: 'Security', icon: ShieldCheck, description: 'Auth, CORS, encryption' },
  { id: 'benchmarks', label: 'Benchmarks', icon: BarChart3, description: 'Schedules, test suites' },
  { id: 'webhooks', label: 'Webhooks', icon: Webhook, description: 'Endpoint URLs, retry config' },
  { id: 'retention', label: 'Retention', icon: Database, description: 'Log TTL, data cleanup' },
];

const STORAGE_KEY = 'dmrx-settings';

interface LocalSettings {
  platformName: string;
  timezone: string;
  requestTimeout: string;
  qualityWeight: string;
  costWeight: string;
  latencyWeight: string;
  slackWebhook: string;
  emailRecipients: string;
  latencyThreshold: string;
  quotaThreshold: string;
  requireApiKey: boolean;
  autoKeyRotation: boolean;
  corsOrigins: string;
  maxRequestSize: string;
  autoBenchmark: boolean;
  benchmarkFrequency: string;
  regressionThreshold: string;
  routeDecisionWebhook: string;
  alertWebhook: string;
  webhookMaxRetries: string;
  webhookRetryBackoff: string;
  requestLogRetention: string;
  memoryRetention: string;
  benchmarkHistory: string;
}

const defaultLocal: LocalSettings = {
  platformName: 'DMR-X',
  timezone: 'UTC',
  requestTimeout: '30',
  qualityWeight: '0.4',
  costWeight: '0.3',
  latencyWeight: '0.3',
  slackWebhook: '',
  emailRecipients: '',
  latencyThreshold: '5000',
  quotaThreshold: '75',
  requireApiKey: true,
  autoKeyRotation: true,
  corsOrigins: '*',
  maxRequestSize: '50',
  autoBenchmark: true,
  benchmarkFrequency: 'Every 6 hours',
  regressionThreshold: '2.0',
  routeDecisionWebhook: '',
  alertWebhook: '',
  webhookMaxRetries: '3',
  webhookRetryBackoff: '5',
  requestLogRetention: '7',
  memoryRetention: '90',
  benchmarkHistory: '365',
};

export default function Settings() {
  const { settings: serverSettings, loading, save: saveToServer } = useSettings();
  const [activeSection, setActiveSection] = useState('general');
  const [routingTimeout, setRoutingTimeout] = useState('30');
  const [fallbackEnabled, setFallbackEnabled] = useState(true);
  const [logRetention, setLogRetention] = useState('30');
  const [local, setLocal] = useState<LocalSettings>(defaultLocal);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const updateLocal = <K extends keyof LocalSettings>(key: K, value: LocalSettings[K]) => {
    setLocal((prev) => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    if (loading) return;
    // Merge server settings into local state
    if (Object.keys(serverSettings).length > 0) {
      setRoutingTimeout(String(serverSettings.routingTimeout ?? '30'));
      setFallbackEnabled(serverSettings.fallbackEnabled !== false);
      setLogRetention(String(serverSettings.logRetention ?? '30'));
      setLocal((prev) => ({
        ...prev,
        ...(serverSettings.platformName != null && { platformName: String(serverSettings.platformName) }),
        ...(serverSettings.timezone != null && { timezone: String(serverSettings.timezone) }),
        ...(serverSettings.requestTimeout != null && { requestTimeout: String(serverSettings.requestTimeout) }),
        ...(serverSettings.qualityWeight != null && { qualityWeight: String(serverSettings.qualityWeight) }),
        ...(serverSettings.costWeight != null && { costWeight: String(serverSettings.costWeight) }),
        ...(serverSettings.latencyWeight != null && { latencyWeight: String(serverSettings.latencyWeight) }),
        ...(serverSettings.slackWebhookUrl != null && { slackWebhook: String(serverSettings.slackWebhookUrl) }),
        ...(serverSettings.emailRecipients != null && { emailRecipients: String(serverSettings.emailRecipients) }),
        ...(serverSettings.latencyAlertThreshold != null && { latencyThreshold: String(serverSettings.latencyAlertThreshold) }),
        ...(serverSettings.quotaAlertThreshold != null && { quotaThreshold: String(serverSettings.quotaAlertThreshold) }),
        ...(serverSettings.requireApiKeyAuth != null && { requireApiKey: !!serverSettings.requireApiKeyAuth }),
        ...(serverSettings.autoKeyRotation != null && { autoKeyRotation: !!serverSettings.autoKeyRotation }),
        ...(serverSettings.allowedOrigins != null && { corsOrigins: String(serverSettings.allowedOrigins) }),
        ...(serverSettings.maxRequestSizeMb != null && { maxRequestSize: String(serverSettings.maxRequestSizeMb) }),
        ...(serverSettings.autoBenchmarkRuns != null && { autoBenchmark: !!serverSettings.autoBenchmarkRuns }),
        ...(serverSettings.benchmarkFrequency != null && { benchmarkFrequency: String(serverSettings.benchmarkFrequency) }),
        ...(serverSettings.regressionThreshold != null && { regressionThreshold: String(serverSettings.regressionThreshold) }),
        ...(serverSettings.routeDecisionWebhook != null && { routeDecisionWebhook: String(serverSettings.routeDecisionWebhook) }),
        ...(serverSettings.alertWebhook != null && { alertWebhook: String(serverSettings.alertWebhook) }),
        ...(serverSettings.webhookMaxRetries != null && { webhookMaxRetries: String(serverSettings.webhookMaxRetries) }),
        ...(serverSettings.webhookRetryBackoff != null && { webhookRetryBackoff: String(serverSettings.webhookRetryBackoff) }),
        ...(serverSettings.requestLogRetentionDays != null && { requestLogRetention: String(serverSettings.requestLogRetentionDays) }),
        ...(serverSettings.memoryRetentionDays != null && { memoryRetention: String(serverSettings.memoryRetentionDays) }),
        ...(serverSettings.benchmarkHistoryDays != null && { benchmarkHistory: String(serverSettings.benchmarkHistoryDays) }),
      }));
    }
    // Also load from localStorage (takes precedence for fields that exist there)
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const s = JSON.parse(saved);
        setRoutingTimeout(s.routingTimeout ?? '30');
        setFallbackEnabled(s.fallbackEnabled !== false);
        setLogRetention(s.logRetention ?? '30');
        if (s.local) setLocal((prev) => ({ ...prev, ...s.local }));
      }
    } catch {}
  }, [loading, serverSettings]);

  const handleSave = useCallback(async () => {
    const data = { routingTimeout, fallbackEnabled, logRetention, local };
    // Save to localStorage
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    // Save all fields to server
    try {
      await saveToServer({
        routingTimeout,
        fallbackEnabled,
        logRetention,
        qualityWeight: local.qualityWeight,
        costWeight: local.costWeight,
        latencyWeight: local.latencyWeight,
        platformName: local.platformName,
        timezone: local.timezone,
        requestTimeout: local.requestTimeout,
        slackWebhookUrl: local.slackWebhook,
        emailRecipients: local.emailRecipients,
        latencyAlertThreshold: local.latencyThreshold,
        quotaAlertThreshold: local.quotaThreshold,
        requireApiKeyAuth: local.requireApiKey,
        autoKeyRotation: local.autoKeyRotation,
        allowedOrigins: local.corsOrigins,
        maxRequestSizeMb: local.maxRequestSize,
        autoBenchmarkRuns: local.autoBenchmark,
        benchmarkFrequency: local.benchmarkFrequency,
        regressionThreshold: local.regressionThreshold,
        routeDecisionWebhook: local.routeDecisionWebhook,
        alertWebhook: local.alertWebhook,
        webhookMaxRetries: local.webhookMaxRetries,
        webhookRetryBackoff: local.webhookRetryBackoff,
        requestLogRetentionDays: local.requestLogRetention,
        memoryRetentionDays: local.memoryRetention,
        benchmarkHistoryDays: local.benchmarkHistory,
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Server save failed');
      setTimeout(() => setSaveError(null), 5000);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [routingTimeout, fallbackEnabled, logRetention, local, saveToServer]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#F8F9FC]">Settings</h1>
          <p className="text-xs text-[#595962] mt-0.5">Configure DMR-X platform settings</p>
        </div>
        <button
          onClick={handleSave}
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-md text-xs font-semibold transition-colors',
            saved
              ? 'bg-[#00FFB2] text-[#060608]'
              : 'bg-[#F7A51C] text-[#060608] hover:bg-[#F7A51C]/90'
          )}
        >
          <Save className="w-3.5 h-3.5" />
          {saved ? 'Saved!' : 'Save Changes'}
        </button>
      </div>
      {saveError && (
        <div className="text-xs text-[#FF4D6A] bg-[#FF4D6A]/10 rounded-lg px-3 py-2">
          {saveError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Section Navigation */}
        <div className="space-y-1">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  'w-full flex items-start gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
                  activeSection === section.id
                    ? 'bg-[#F7A51C]/10 text-[#F7A51C]'
                    : 'text-[#A6A6B0] hover:bg-[#1A1A20] hover:text-[#F8F9FC]'
                )}
              >
                <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="text-sm font-medium">{section.label}</div>
                  <div className="text-[11px] text-[#595962] mt-0.5">{section.description}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Settings Content */}
        <div className="lg:col-span-3 glass-card rounded-xl p-6">
          {activeSection === 'general' && (
            <div className="space-y-6">
              <h3 className="text-sm font-semibold text-[#F8F9FC]">General Settings</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Platform Name</label>
                  <input
                    type="text"
                    value={local.platformName}
                    onChange={(e) => updateLocal('platformName', e.target.value)}
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Default Timezone</label>
                  <select
                    value={local.timezone}
                    onChange={(e) => updateLocal('timezone', e.target.value)}
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]"
                  >
                    <option>UTC</option>
                    <option>America/New_York</option>
                    <option>Europe/London</option>
                    <option>Asia/Tokyo</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Request Timeout (seconds)</label>
                  <input
                    type="number"
                    value={local.requestTimeout}
                    onChange={(e) => updateLocal('requestTimeout', e.target.value)}
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]"
                  />
                </div>
              </div>
            </div>
          )}

          {activeSection === 'routing' && (
            <div className="space-y-6">
              <h3 className="text-sm font-semibold text-[#F8F9FC]">Routing Configuration</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-[#0A0A0C] rounded-lg border border-[#27272E]">
                  <div>
                    <div className="text-xs text-[#F8F9FC] font-medium">Fallback Enabled</div>
                    <div className="text-[11px] text-[#595962]">Automatically route to backup providers on failure</div>
                  </div>
                  <button
                    onClick={() => setFallbackEnabled(!fallbackEnabled)}
                    className={cn(
                      'w-10 h-5 rounded-full transition-colors relative',
                      fallbackEnabled ? 'bg-[#00FFB2]' : 'bg-[#27272E]'
                    )}
                  >
                    <div className={cn(
                      'w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all',
                      fallbackEnabled ? 'left-5' : 'left-0.5'
                    )} />
                  </button>
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Max Routing Timeout (seconds)</label>
                  <input
                    type="number"
                    value={routingTimeout}
                    onChange={(e) => setRoutingTimeout(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Quality Weight (0-1)</label>
                  <input
                    type="number"
                    value={local.qualityWeight}
                    onChange={(e) => updateLocal('qualityWeight', e.target.value)}
                    step="0.1"
                    min="0"
                    max="1"
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Cost Weight (0-1)</label>
                  <input
                    type="number"
                    value={local.costWeight}
                    onChange={(e) => updateLocal('costWeight', e.target.value)}
                    step="0.1"
                    min="0"
                    max="1"
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Latency Weight (0-1)</label>
                  <input
                    type="number"
                    value={local.latencyWeight}
                    onChange={(e) => updateLocal('latencyWeight', e.target.value)}
                    step="0.1"
                    min="0"
                    max="1"
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]"
                  />
                </div>
              </div>
            </div>
          )}

          {activeSection === 'notifications' && (
            <div className="space-y-6">
              <h3 className="text-sm font-semibold text-[#F8F9FC]">Notification Settings</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Slack Webhook URL</label>
                  <input
                    type="text"
                    value={local.slackWebhook}
                    onChange={(e) => updateLocal('slackWebhook', e.target.value)}
                    placeholder="https://hooks.slack.com/services/..."
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C] placeholder-[#595962]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Email Recipients (comma-separated)</label>
                  <input
                    type="text"
                    value={local.emailRecipients}
                    onChange={(e) => updateLocal('emailRecipients', e.target.value)}
                    placeholder="ops@example.com"
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C] placeholder-[#595962]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Latency Alert Threshold (ms)</label>
                  <input
                    type="number"
                    value={local.latencyThreshold}
                    onChange={(e) => updateLocal('latencyThreshold', e.target.value)}
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Quota Alert Threshold (%)</label>
                  <input
                    type="number"
                    value={local.quotaThreshold}
                    onChange={(e) => updateLocal('quotaThreshold', e.target.value)}
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]"
                  />
                </div>
              </div>
            </div>
          )}

          {activeSection === 'security' && (
            <div className="space-y-6">
              <h3 className="text-sm font-semibold text-[#F8F9FC]">Security Settings</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-[#0A0A0C] rounded-lg border border-[#27272E]">
                  <div>
                    <div className="text-xs text-[#F8F9FC] font-medium">Require API Key Auth</div>
                    <div className="text-[11px] text-[#595962]">All requests must include valid API key</div>
                  </div>
                  <button
                    onClick={() => updateLocal('requireApiKey', !local.requireApiKey)}
                    className={cn(
                      'w-10 h-5 rounded-full transition-colors relative',
                      local.requireApiKey ? 'bg-[#00FFB2]' : 'bg-[#27272E]'
                    )}
                  >
                    <div className={cn(
                      'w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all',
                      local.requireApiKey ? 'left-5' : 'left-0.5'
                    )} />
                  </button>
                </div>
                <div className="flex items-center justify-between p-3 bg-[#0A0A0C] rounded-lg border border-[#27272E]">
                  <div>
                    <div className="text-xs text-[#F8F9FC] font-medium">Auto Key Rotation</div>
                    <div className="text-[11px] text-[#595962]">Rotate provider keys every 90 days</div>
                  </div>
                  <button
                    onClick={() => updateLocal('autoKeyRotation', !local.autoKeyRotation)}
                    className={cn(
                      'w-10 h-5 rounded-full transition-colors relative',
                      local.autoKeyRotation ? 'bg-[#00FFB2]' : 'bg-[#27272E]'
                    )}
                  >
                    <div className={cn(
                      'w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all',
                      local.autoKeyRotation ? 'left-5' : 'left-0.5'
                    )} />
                  </button>
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Allowed Origins (CORS)</label>
                  <textarea
                    value={local.corsOrigins}
                    onChange={(e) => updateLocal('corsOrigins', e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C] resize-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Max Request Size (MB)</label>
                  <input
                    type="number"
                    value={local.maxRequestSize}
                    onChange={(e) => updateLocal('maxRequestSize', e.target.value)}
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]"
                  />
                </div>
              </div>
            </div>
          )}

          {activeSection === 'benchmarks' && (
            <div className="space-y-6">
              <h3 className="text-sm font-semibold text-[#F8F9FC]">Benchmark Schedule</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-[#0A0A0C] rounded-lg border border-[#27272E]">
                  <div>
                    <div className="text-xs text-[#F8F9FC] font-medium">Auto Benchmark Runs</div>
                    <div className="text-[11px] text-[#595962]">Automatically run benchmarks on schedule</div>
                  </div>
                  <button
                    onClick={() => updateLocal('autoBenchmark', !local.autoBenchmark)}
                    className={cn(
                      'w-10 h-5 rounded-full transition-colors relative',
                      local.autoBenchmark ? 'bg-[#00FFB2]' : 'bg-[#27272E]'
                    )}
                  >
                    <div className={cn(
                      'w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all',
                      local.autoBenchmark ? 'left-5' : 'left-0.5'
                    )} />
                  </button>
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Run Frequency</label>
                  <select
                    value={local.benchmarkFrequency}
                    onChange={(e) => updateLocal('benchmarkFrequency', e.target.value)}
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]"
                  >
                    <option>Every 6 hours</option>
                    <option>Every 12 hours</option>
                    <option>Daily</option>
                    <option>Weekly</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Regression Threshold (%)</label>
                  <input
                    type="number"
                    value={local.regressionThreshold}
                    onChange={(e) => updateLocal('regressionThreshold', e.target.value)}
                    step="0.1"
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]"
                  />
                </div>
              </div>
            </div>
          )}

          {activeSection === 'webhooks' && (
            <div className="space-y-6">
              <h3 className="text-sm font-semibold text-[#F8F9FC]">Webhook Configuration</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Route Decision Webhook</label>
                  <input
                    type="text"
                    value={local.routeDecisionWebhook}
                    onChange={(e) => updateLocal('routeDecisionWebhook', e.target.value)}
                    placeholder="https://your-app.com/webhooks/routing"
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C] placeholder-[#595962]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Alert Webhook</label>
                  <input
                    type="text"
                    value={local.alertWebhook}
                    onChange={(e) => updateLocal('alertWebhook', e.target.value)}
                    placeholder="https://your-app.com/webhooks/alerts"
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C] placeholder-[#595962]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Max Retries</label>
                  <input
                    type="number"
                    value={local.webhookMaxRetries}
                    onChange={(e) => updateLocal('webhookMaxRetries', e.target.value)}
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Retry Backoff (seconds)</label>
                  <input
                    type="number"
                    value={local.webhookRetryBackoff}
                    onChange={(e) => updateLocal('webhookRetryBackoff', e.target.value)}
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]"
                  />
                </div>
              </div>
            </div>
          )}

          {activeSection === 'retention' && (
            <div className="space-y-6">
              <h3 className="text-sm font-semibold text-[#F8F9FC]">Data Retention</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Audit Log Retention (days)</label>
                  <input
                    type="number"
                    value={logRetention}
                    onChange={(e) => setLogRetention(e.target.value)}
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Request Log Retention (days)</label>
                  <input
                    type="number"
                    value={local.requestLogRetention}
                    onChange={(e) => updateLocal('requestLogRetention', e.target.value)}
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Memory Retention (days)</label>
                  <input
                    type="number"
                    value={local.memoryRetention}
                    onChange={(e) => updateLocal('memoryRetention', e.target.value)}
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Benchmark History (days)</label>
                  <input
                    type="number"
                    value={local.benchmarkHistory}
                    onChange={(e) => updateLocal('benchmarkHistory', e.target.value)}
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
