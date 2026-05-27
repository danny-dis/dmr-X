import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  Settings as SettingsIcon, Bell, ShieldCheck,
  Route, BarChart3, Webhook, Database, Save
} from 'lucide-react';

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

interface SettingsData {
  routingTimeout: string;
  fallbackEnabled: boolean;
  logRetention: string;
}

function loadSettings(): SettingsData {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return { routingTimeout: '30', fallbackEnabled: true, logRetention: '30' };
}

export default function Settings() {
  const [activeSection, setActiveSection] = useState('general');
  const [routingTimeout, setRoutingTimeout] = useState('30');
  const [fallbackEnabled, setFallbackEnabled] = useState(true);
  const [logRetention, setLogRetention] = useState('30');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const s = loadSettings();
    setRoutingTimeout(s.routingTimeout);
    setFallbackEnabled(s.fallbackEnabled);
    setLogRetention(s.logRetention);
  }, []);

  const handleSave = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ routingTimeout, fallbackEnabled, logRetention }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [routingTimeout, fallbackEnabled, logRetention]);

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
                    defaultValue="DMR-X"
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Default Timezone</label>
                  <select className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]">
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
                    defaultValue="30"
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
                    defaultValue="0.4"
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
                    defaultValue="0.3"
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
                    defaultValue="0.3"
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
                    defaultValue="https://hooks.slack.com/services/..."
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Email Recipients (comma-separated)</label>
                  <input
                    type="text"
                    defaultValue="ops@acme.com"
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Latency Alert Threshold (ms)</label>
                  <input
                    type="number"
                    defaultValue="5000"
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Quota Alert Threshold (%)</label>
                  <input
                    type="number"
                    defaultValue="75"
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
                  <div className="w-10 h-5 rounded-full bg-[#00FFB2] relative">
                    <div className="w-4 h-4 rounded-full bg-white absolute top-0.5 left-5" />
                  </div>
                </div>
                <div className="flex items-center justify-between p-3 bg-[#0A0A0C] rounded-lg border border-[#27272E]">
                  <div>
                    <div className="text-xs text-[#F8F9FC] font-medium">Auto Key Rotation</div>
                    <div className="text-[11px] text-[#595962]">Rotate provider keys every 90 days</div>
                  </div>
                  <div className="w-10 h-5 rounded-full bg-[#00FFB2] relative">
                    <div className="w-4 h-4 rounded-full bg-white absolute top-0.5 left-5" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Allowed Origins (CORS)</label>
                  <textarea
                    defaultValue="*"
                    rows={3}
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C] resize-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Max Request Size (MB)</label>
                  <input
                    type="number"
                    defaultValue="50"
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
                  <div className="w-10 h-5 rounded-full bg-[#00FFB2] relative">
                    <div className="w-4 h-4 rounded-full bg-white absolute top-0.5 left-5" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Run Frequency</label>
                  <select className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]">
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
                    defaultValue="2.0"
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
                    placeholder="https://your-app.com/webhooks/routing"
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C] placeholder-[#595962]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Alert Webhook</label>
                  <input
                    type="text"
                    placeholder="https://your-app.com/webhooks/alerts"
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C] placeholder-[#595962]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Max Retries</label>
                  <input
                    type="number"
                    defaultValue="3"
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Retry Backoff (seconds)</label>
                  <input
                    type="number"
                    defaultValue="5"
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
                    defaultValue="7"
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Memory Retention (days)</label>
                  <input
                    type="number"
                    defaultValue="90"
                    className="w-full px-3 py-2 bg-[#0A0A0C] border border-[#27272E] rounded-md text-xs text-[#F8F9FC] outline-none focus:border-[#F7A51C]"
                  />
                </div>
                <div>
                  <label className="text-xs text-[#A6A6B0] block mb-1.5">Benchmark History (days)</label>
                  <input
                    type="number"
                    defaultValue="365"
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
