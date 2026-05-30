import { useState, useEffect } from 'react';
import { useProviders, useCatalog } from '@/hooks/useApiData';
import { updateProviderApiKey, activateProvider, testProviderConnection, type TestProviderResult } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';
import { Key, Search, ExternalLink, Eye, EyeOff, Save, Loader2, X, Plug, CheckCircle2, XCircle, Activity } from 'lucide-react';
import { ErrorBanner } from '@/components/ErrorBanner';
import { cn } from '@/lib/utils';

export default function ProviderKeys() {
  const { providers, loading: providersLoading, refetch: refetchProviders, error: providersError } = useProviders();
  const { catalog, loading: catalogLoading, error: catalogError } = useCatalog();
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editKeyValue, setEditKeyValue] = useState('');
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [testProviderId, setTestProviderId] = useState('');
  const [testBaseUrl, setTestBaseUrl] = useState('');
  const [testApiKey, setTestApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestProviderResult | null>(null);

  // Merge catalog with registered providers
  const mergedProviders = catalog.map((template) => {
    const registered = providers.find((p) => p.name === template.id);
    return {
      ...template,
      registeredId: registered?.id,
      status: registered?.status || 'inactive',
      isRegistered: !!registered,
      hasKey: registered?.hasKey ?? false,
    };
  });

  const filtered = mergedProviders.filter((p) =>
    !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSaveKey = async (provider: any) => {
    setSaving(true);
    try {
      if (provider.registeredId) {
        // Registered provider — update key directly
        await updateProviderApiKey(provider.registeredId, editKeyValue);
      } else {
        // Not yet registered — activate from catalog
        await activateProvider(provider.id, editKeyValue);
      }
      await refetchProviders();
      setEditingId(null);
      setEditKeyValue('');
    } catch (err: any) {
      alert(`Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const startEditing = (provider: any) => {
    setEditingId(provider.id);  // Use catalog id for both registered and unregistered
    setEditKeyValue('');
    setShowKey((prev) => ({ ...prev, [provider.id]: false }));
  };

  const openTestDialog = (provider: any) => {
    setTestProviderId(provider.id);
    setTestBaseUrl(provider.baseUrl);
    setTestApiKey('');
    setTestResult(null);
    setShowTestDialog(true);
  };

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#F8F9FC]">Provider API Keys</h1>
          <p className="text-xs text-[#595962] mt-0.5">Manage API keys for all AI providers</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[#595962]">
          <Key className="w-3.5 h-3.5" />
          {mergedProviders.filter(p => p.hasKey).length} / {mergedProviders.length} configured
        </div>
      </div>

      <ErrorBanner error={providersError || catalogError} />

      <div className="flex items-center gap-2 px-3 py-2 bg-[#0F0F12] border border-[#27272E] rounded-lg max-w-sm">
        <Search className="w-3.5 h-3.5 text-[#595962]" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search providers..."
          className="bg-transparent text-xs text-[#F8F9FC] placeholder-[#595962] outline-none flex-1"
        />
      </div>

      {/* Provider Key Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.map((provider) => {
          const isEditing = editingId === provider.id;
          const isVisible = showKey[provider.id];

          return (
            <div key={provider.id} className="glass-card rounded-xl p-4 hover:border-[#F7A51C]/20 transition-all">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center",
                    provider.hasKey ? "bg-emerald-500/10" : "bg-[#27272E]"
                  )}>
                    <Key className={cn("w-4 h-4", provider.hasKey ? "text-emerald-400" : "text-[#595962]")} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-[#F8F9FC]">{provider.name}</div>
                    <div className="text-[10px] text-[#595962] uppercase tracking-wider">{provider.category}</div>
                  </div>
                </div>
                <span className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded font-bold uppercase",
                  provider.hasKey
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-[#595962]/10 text-[#595962] border border-[#595962]/20"
                )}>
                  {provider.hasKey ? 'Active' : 'No Key'}
                </span>
              </div>

              {/* API Key Field */}
              {isEditing ? (
                <div className="space-y-2 mb-3">
                  <div className="relative">
                    <input
                      type={isVisible ? 'text' : 'password'}
                      value={editKeyValue}
                      onChange={(e) => setEditKeyValue(e.target.value)}
                      placeholder="Enter API key..."
                      className="w-full px-3 py-2 pr-16 text-xs bg-[#0A0A0C] border border-[#F7A51C]/30 rounded-lg text-[#F8F9FC] placeholder-[#595962] outline-none font-mono-data"
                    />
                    <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      <button
                        onClick={() => setShowKey((prev) => ({ ...prev, [provider.id]: !isVisible }))}
                        className="p-1 rounded hover:bg-[#1A1A20]"
                      >
                        {isVisible ? <EyeOff className="w-3 h-3 text-[#595962]" /> : <Eye className="w-3 h-3 text-[#595962]" />}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSaveKey(provider)}
                      disabled={saving}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold bg-emerald-500 text-black rounded-lg hover:bg-emerald-400 disabled:opacity-50 transition-all"
                    >
                      {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                      Save
                    </button>
                    <button
                      onClick={() => { setEditingId(null); setEditKeyValue(''); }}
                      className="px-3 py-1.5 text-[11px] text-[#595962] hover:text-[#F8F9FC] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mb-3">
                  {provider.hasKey ? (
                    <div className="flex items-center gap-2 p-2 bg-[#0A0A0C] rounded-lg">
                      <code className="text-[11px] text-[#A6A6B0] font-mono-data flex-1 truncate">
                        ••••••••••••••••••••
                      </code>
                    </div>
                  ) : (
                    <div className="p-2 bg-[#0A0A0C] rounded-lg text-[11px] text-[#595962]">
                      No API key configured
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => startEditing(provider)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold bg-[#F7A51C] text-black rounded-lg hover:bg-[#F7A51C]/90 transition-all"
                >
                  <Key className="w-3 h-3" />
                  {provider.hasKey ? 'Edit Key' : 'Add Key'}
                </button>
                {provider.hasKey && (
                  <button
                    onClick={() => openTestDialog(provider)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-[#1A1A20] text-[#A6A6B0] rounded-lg border border-[#27272E] hover:text-[#F8F9FC] transition-all"
                  >
                    <Plug className="w-3 h-3" />
                    Test
                  </button>
                )}
                {provider.signupUrl && (
                  <a
                    href={provider.signupUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto flex items-center gap-1 px-2 py-1.5 text-[10px] text-[#595962] hover:text-[#F7A51C] transition-colors"
                    title={`Get API key from ${provider.name}`}
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
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
              <h2 className="text-sm font-bold text-[#F8F9FC]">Test Connection</h2>
              <button onClick={() => setShowTestDialog(false)} className="p-1 rounded hover:bg-[#1A1A20]">
                <X className="w-4 h-4 text-[#595962]" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-[#595962] mb-1 block">Provider</label>
                <div className="px-3 py-2 text-xs bg-[#0F0F12] border border-[#27272E] rounded-lg text-[#F8F9FC]">
                  {testProviderId}
                </div>
              </div>
              <div>
                <label className="text-[11px] text-[#595962] mb-1 block">Base URL</label>
                <div className="px-3 py-2 text-xs bg-[#0F0F12] border border-[#27272E] rounded-lg text-[#A6A6B0] font-mono-data truncate">
                  {testBaseUrl}
                </div>
              </div>
              <div>
                <label className="text-[11px] text-[#595962] mb-1 block">API Key</label>
                <input
                  type="password"
                  value={testApiKey}
                  onChange={(e) => setTestApiKey(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#0F0F12] border border-[#27272E] rounded-lg text-[#F8F9FC] outline-none focus:border-[#F7A51C]/40 font-mono-data"
                />
              </div>
            </div>

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
                onClick={() => setShowTestDialog(false)}
                className="px-3 py-2 text-xs text-[#595962] hover:text-[#F8F9FC] transition-colors"
              >
                Close
              </button>
              <button
                onClick={handleTest}
                disabled={testing || !testApiKey}
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
