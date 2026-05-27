import { useState } from 'react';
import { useApiKeys, useProviders, useTenants } from '@/hooks/useApiData';
import StatusBadge from '@/components/StatusBadge';
import { testProviderConnection, type TestProviderResult } from '@/lib/api';
import { Key, Search, Copy, Clock, ShieldCheck, Activity, Plug, CheckCircle2, XCircle, Loader2, X } from 'lucide-react';
import { ErrorBanner } from '@/components/ErrorBanner';

export default function ProviderKeys() {
  const { keys: apiKeys, error } = useApiKeys();
  const { providers } = useProviders();
  const { tenants } = useTenants();
  const [searchQuery, setSearchQuery] = useState('');
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [testProviderId, setTestProviderId] = useState('');
  const [testBaseUrl, setTestBaseUrl] = useState('');
  const [testApiKey, setTestApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestProviderResult | null>(null);

  const filtered = apiKeys.filter((k) =>
    !searchQuery || k.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleTest = async () => {
    if (!testProviderId || !testBaseUrl || !testApiKey) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testProviderConnection(testProviderId, testBaseUrl, testApiKey);
      setTestResult(result);
    } catch (err: unknown) {
      setTestResult({
        status: 'failed',
        provider_id: testProviderId,
        latency_ms: 0,
        message: err instanceof Error ? err.message : 'Request failed',
      });
    } finally {
      setTesting(false);
    }
  };

  const closeDialog = () => {
    setShowTestDialog(false);
    setTestProviderId('');
    setTestBaseUrl('');
    setTestApiKey('');
    setTestResult(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#F8F9FC]">Provider Keys</h1>
          <p className="text-xs text-[#595962] mt-0.5">API key management for all providers</p>
        </div>
        <button
          onClick={() => setShowTestDialog(true)}
          className="flex items-center gap-2 px-3 py-2 text-xs font-medium bg-[#F7A51C]/10 text-[#F7A51C] border border-[#F7A51C]/20 rounded-lg hover:bg-[#F7A51C]/20 transition-all"
        >
          <Plug className="w-3.5 h-3.5" />
          Test Connection
        </button>
      </div>

      <ErrorBanner error={error} />

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-2 bg-[#0F0F12] border border-[#27272E] rounded-lg flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-[#595962]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search keys..."
            className="bg-transparent text-xs text-[#F8F9FC] placeholder-[#595962] outline-none flex-1"
          />
        </div>
      </div>

      {/* Key Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filtered.map((key) => {
          const provider = providers.find((p) => p.id === key.providerId);
          const tenant = tenants.find((t) => t.id === key.tenantId);
          return (
            <div key={key.id} className="glass-card rounded-xl p-4 hover:border-[#F7A51C]/20 transition-all">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-[#F7A51C]/10 flex items-center justify-center">
                    <Key className="w-4 h-4 text-[#F7A51C]" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-[#F8F9FC]">{key.name}</div>
                    <div className="text-[11px] text-[#595962]">{tenant?.name || key.tenantId}</div>
                  </div>
                </div>
                <StatusBadge status={key.status} />
              </div>

              {/* Key display */}
              <div className="flex items-center gap-2 p-2 bg-[#0A0A0C] rounded mb-3">
                <code className="text-[11px] text-[#A6A6B0] font-mono-data flex-1 truncate">{key.key}</code>
                <button className="p-1 rounded hover:bg-[#1A1A20]" title="Copy">
                  <Copy className="w-3 h-3 text-[#595962]" />
                </button>
              </div>

              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-3">
                  {provider && (
                    <span className="text-[#A6A6B0]">{provider.name}</span>
                  )}
                  <span className="text-[#595962] flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> {key.scopes.length} scopes
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[#595962]">
                  <span className="flex items-center gap-1">
                    <Activity className="w-3 h-3" /> {key.usageThisMonth.toLocaleString()}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {new Date(key.lastUsed).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Test Connection Dialog */}
      {showTestDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[#141418] border border-[#27272E] rounded-xl p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-[#F8F9FC]">Test Provider Connection</h2>
              <button onClick={closeDialog} className="p-1 rounded hover:bg-[#1A1A20]">
                <X className="w-4 h-4 text-[#595962]" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-[#595962] mb-1 block">Provider ID</label>
                <select
                  value={testProviderId}
                  onChange={(e) => {
                    setTestProviderId(e.target.value);
                    const p = providers.find((pr) => pr.id === e.target.value);
                    if (p?.baseUrl) setTestBaseUrl(p.baseUrl);
                  }}
                  className="w-full px-3 py-2 text-xs bg-[#0F0F12] border border-[#27272E] rounded-lg text-[#F8F9FC] outline-none focus:border-[#F7A51C]/40"
                >
                  <option value="">Select provider...</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[11px] text-[#595962] mb-1 block">Base URL</label>
                <input
                  type="text"
                  value={testBaseUrl}
                  onChange={(e) => setTestBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  className="w-full px-3 py-2 text-xs bg-[#0F0F12] border border-[#27272E] rounded-lg text-[#F8F9FC] placeholder-[#595962] outline-none focus:border-[#F7A51C]/40"
                />
              </div>

              <div>
                <label className="text-[11px] text-[#595962] mb-1 block">API Key</label>
                <input
                  type="password"
                  value={testApiKey}
                  onChange={(e) => setTestApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full px-3 py-2 text-xs bg-[#0F0F12] border border-[#27272E] rounded-lg text-[#F8F9FC] placeholder-[#595962] outline-none focus:border-[#F7A51C]/40"
                />
              </div>
            </div>

            {/* Result */}
            {testResult && (
              <div className={`mt-3 p-3 rounded-lg flex items-start gap-2 ${
                testResult.status === 'passed'
                  ? 'bg-emerald-500/10 border border-emerald-500/20'
                  : 'bg-red-500/10 border border-red-500/20'
              }`}>
                {testResult.status === 'passed' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                )}
                <div>
                  <div className={`text-xs font-medium ${
                    testResult.status === 'passed' ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {testResult.status === 'passed' ? 'Connection Passed' : 'Connection Failed'}
                  </div>
                  <div className="text-[11px] text-[#A6A6B0] mt-0.5">
                    {testResult.message} {testResult.latency_ms > 0 && `(${testResult.latency_ms}ms)`}
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={closeDialog}
                className="px-3 py-2 text-xs text-[#595962] hover:text-[#F8F9FC] transition-colors"
              >
                Close
              </button>
              <button
                onClick={handleTest}
                disabled={testing || !testProviderId || !testBaseUrl || !testApiKey}
                className="flex items-center gap-2 px-4 py-2 text-xs font-medium bg-[#F7A51C] text-black rounded-lg hover:bg-[#F7A51C]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {testing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <Plug className="w-3.5 h-3.5" />
                    Test
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
