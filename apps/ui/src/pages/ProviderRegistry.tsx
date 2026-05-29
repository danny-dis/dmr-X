import { useState } from 'react';
import { useProviders, useCatalog } from '@/hooks/useApiData';
import { activateProvider, testProviderConnection } from '@/lib/api';
import StatusBadge from '@/components/StatusBadge';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ErrorBanner';
import {
  Search, Database, ChevronRight, Loader2, ExternalLink, Copy, Check, Plus, Key, X, Zap, CheckCircle2, XCircle, Activity
} from 'lucide-react';

const costTierColors: Record<string, string> = {
  low: 'text-[#00FFB2]',
  medium: 'text-[#F7A51C]',
  high: 'text-[#FF4D6A]',
  premium: 'text-[#F7A51C]',
};

export default function ProviderRegistry() {
  const { providers, loading: providersLoading, refetch: refetchProviders, error: providersError } = useProviders();
  const { catalog, loading: catalogLoading, error: catalogError } = useCatalog();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showActivateDialog, setShowActivateDialog] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<any>(null);
  const [apiKey, setApiKey] = useState('');
  const [activating, setActivating] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [testing, setTesting] = useState(false);

  // Merge registered providers with catalog
  const mergedProviders = catalog.map((template) => {
    const registered = providers.find((p) => p.name === template.id);
    return {
      ...template,
      registeredId: registered?.id,
      status: registered?.status || 'inactive',
      isRegistered: !!registered,
      avgLatency: registered?.avgLatency || 0,
      successRate: registered?.successRate || 100,
      currentKey: registered?.apiKey,
    };
  });

  const filtered = mergedProviders.filter((p) =>
    !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const detailProvider = mergedProviders.find((p) => p.id === selectedProvider);

  const handleActivate = async () => {
    if (!activeTemplate) return;
    setActivating(true);
    try {
      await activateProvider(activeTemplate.id, apiKey);
      await refetchProviders();
      setShowActivateDialog(false);
      setApiKey('');
      setActiveTemplate(null);
    } catch (err: any) {
      alert(`Activation failed: ${err.message}`);
    } finally {
      setActivating(false);
    }
  };

  const handleTest = async () => {
    if (!activeTemplate || !apiKey) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testProviderConnection(activeTemplate.id, activeTemplate.baseUrl, apiKey);
      setTestResult(result);
    } catch (err: any) {
      setTestResult({ status: 'failed', message: err.message });
    } finally {
      setTesting(false);
    }
  };

  const openActivateDialog = (template: any) => {
    setActiveTemplate(template);
    setApiKey(template.currentKey || '');
    setTestResult(null);
    setShowActivateDialog(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[#F8F9FC]">Provider Registry</h1>
            {(providersLoading || catalogLoading) && <Loader2 className="w-4 h-4 text-[#F7A51C] animate-spin" />}
          </div>
          <p className="text-xs text-[#595962] mt-0.5">Explore and activate AI providers from the catalog</p>
        </div>
      </div>

      <ErrorBanner error={providersError || catalogError} />

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-2 bg-[#0F0F12] border border-[#27272E] rounded-lg flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-[#595962]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search providers (e.g., Google, OpenAI, Groq)..."
            className="bg-transparent text-xs text-[#F8F9FC] placeholder-[#595962] outline-none flex-1"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Provider Cards */}
        <div className="xl:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((provider) => (
            <div
              key={provider.id}
              className={cn(
                'glass-card rounded-xl p-4 cursor-pointer hover:border-[#F7A51C]/30 transition-all flex flex-col',
                selectedProvider === provider.id && 'border-[#F7A51C]/50 bg-[#F7A51C]/5'
              )}
              onClick={() => setSelectedProvider(selectedProvider === provider.id ? null : provider.id)}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-[#F7A51C]/10 flex items-center justify-center">
                    <Database className="w-4 h-4 text-[#F7A51C]" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-[#F8F9FC]">{provider.name}</div>
                    <div className="text-[10px] text-[#595962] font-mono-data uppercase tracking-wider">{provider.category}</div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {provider.isRegistered ? (
                    <StatusBadge status={provider.status as any} />
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#595962]/10 text-[#595962] border border-[#595962]/20 font-medium uppercase">
                      Inactive
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="bg-[#1A1A20] rounded p-2">
                  <div className="text-[10px] text-[#595962]">Latency</div>
                  <div className="text-xs font-semibold text-[#F8F9FC] font-mono-data">{provider.avgLatency || '-'}ms</div>
                </div>
                <div className="bg-[#1A1A20] rounded p-2">
                  <div className="text-[10px] text-[#595962]">Success</div>
                  <div className="text-xs font-semibold text-[#00FFB2] font-mono-data">{provider.successRate}%</div>
                </div>
                <div className="bg-[#1A1A20] rounded p-2">
                  <div className="text-[10px] text-[#595962]">Models</div>
                  <div className="text-xs font-semibold text-[#F8F9FC] font-mono-data">{provider.models.length}</div>
                </div>
              </div>

              <div className="mt-auto pt-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                   {provider.apiFormat === 'openai' && (
                     <div className="flex items-center gap-1 text-[10px] text-[#00E0FF] bg-[#00E0FF]/5 px-1.5 py-0.5 rounded border border-[#00E0FF]/20">
                       <Zap className="w-2.5 h-2.5" /> OpenAI-Compat
                     </div>
                   )}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); openActivateDialog(provider); }}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all",
                    provider.isRegistered 
                      ? "bg-[#1A1A20] text-[#A6A6B0] hover:text-[#F8F9FC] border border-[#27272E]"
                      : "bg-[#F7A51C] text-black hover:bg-[#F7A51C]/90"
                  )}
                >
                  {provider.isRegistered ? <><Key className="w-3 h-3" /> Edit Key</> : <><Plus className="w-3 h-3" /> Activate</>}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Detail Panel */}
        <div className="glass-card rounded-xl p-5 sticky top-4 h-fit">
          {detailProvider ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-lg bg-[#F7A51C]/10 flex items-center justify-center">
                    <Database className="w-5 h-5 text-[#F7A51C]" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-[#F8F9FC]">{detailProvider.name}</h3>
                    <p className="text-[11px] text-[#595962] font-mono-data truncate max-w-[200px]">{detailProvider.baseUrl}</p>
                  </div>
                </div>
              </div>

              <p className="text-xs text-[#A6A6B0] leading-relaxed">
                {detailProvider.description}
              </p>

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-[#1A1A20] rounded p-3">
                  <div className="text-[10px] text-[#595962] mb-1">Status</div>
                  {detailProvider.isRegistered ? (
                    <StatusBadge status={detailProvider.status as any} />
                  ) : (
                    <span className="text-[10px] text-[#595962] font-mono-data">INACTIVE</span>
                  )}
                </div>
                <div className="bg-[#1A1A20] rounded p-3">
                  <div className="text-[10px] text-[#595962] mb-1">Format</div>
                  <div className="text-xs font-bold text-[#F8F9FC] font-mono-data uppercase">{detailProvider.apiFormat}</div>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-[#27272E]">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#595962]">Env Variable</span>
                  <span className="text-[#F8F9FC] font-mono-data text-[10px]">{detailProvider.envKey || 'None'}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#595962]">Base URL</span>
                  <button 
                    className="text-[#F7A51C] font-mono-data text-[10px] truncate max-w-[150px] hover:underline"
                    onClick={() => { navigator.clipboard.writeText(detailProvider.baseUrl); }}
                  >
                    {detailProvider.baseUrl}
                  </button>
                </div>
              </div>

              {/* Supported Models */}
              <div className="pt-2 border-t border-[#27272E]">
                <h4 className="text-[11px] font-semibold text-[#F8F9FC] mb-2 uppercase tracking-widest">Available Models ({detailProvider.models.length})</h4>
                <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                  {detailProvider.models.map((model: any) => (
                    <div key={model.id} className="flex items-center justify-between group">
                      <div className="flex items-center gap-2 text-xs text-[#A6A6B0]">
                        <ChevronRight className="w-3 h-3 text-[#595962] group-hover:text-[#F7A51C]" />
                        <span className="font-mono-data truncate max-w-[150px]">{model.id}</span>
                      </div>
                      {model.inputCostPer1M === 0 && (
                        <span className="text-[9px] px-1 rounded bg-[#00FFB2]/10 text-[#00FFB2] font-bold">FREE</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-4">
                {detailProvider.signupUrl && (
                  <a
                    href={detailProvider.signupUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold bg-[#1A1A20] text-[#A6A6B0] rounded-xl border border-[#27272E] hover:text-[#F8F9FC] transition-all"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Get API Key from {detailProvider.name}
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div className="h-[400px] flex flex-col items-center justify-center text-center py-12">
              <Database className="w-12 h-12 text-[#1A1A20] mb-4" />
              <h4 className="text-sm font-bold text-[#595962]">Select a Provider</h4>
              <p className="text-xs text-[#595962] max-w-[200px] mt-2">Explore details and models available in the catalog</p>
            </div>
          )}
        </div>
      </div>

      {/* Activate / Edit Key Dialog */}
      {showActivateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-md bg-[#0F0F12] border border-[#27272E] rounded-2xl p-6 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#F7A51C] to-[#FF4D6A]" />
            
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#F7A51C]/10 flex items-center justify-center">
                  <Database className="w-5 h-5 text-[#F7A51C]" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-[#F8F9FC]">Activate {activeTemplate?.name}</h2>
                  <p className="text-xs text-[#595962]">Configure API credentials</p>
                </div>
              </div>
              <button onClick={() => setShowActivateDialog(false)} className="p-2 rounded-lg hover:bg-[#1A1A20] transition-colors">
                <X className="w-5 h-5 text-[#595962]" />
              </button>
            </div>

            <div className="space-y-4">
               <div className="p-3 rounded-xl bg-[#F7A51C]/5 border border-[#F7A51C]/10">
                 <div className="text-[11px] text-[#F7A51C] font-semibold flex items-center gap-2 mb-1 uppercase tracking-wider">
                   <Zap className="w-3 h-3" /> Auto-Configuration
                 </div>
                 <p className="text-[11px] text-[#A6A6B0] leading-relaxed">
                   Endpoints, models, and routing rules for {activeTemplate?.name} are handled internally. You only need to provide your API key.
                 </p>
               </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-[#F8F9FC]">API Key</label>
                  {activeTemplate?.envKey === '' && (
                    <span className="text-[10px] text-[#00FFB2] font-bold uppercase tracking-widest">Optional / No Key Needed</span>
                  )}
                </div>
                <div className="relative">
                  <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#595962]" />
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={activeTemplate?.envKey || "Enter your API key..."}
                    className="w-full pl-10 pr-4 py-3 text-sm bg-[#0A0A0C] border border-[#27272E] rounded-xl text-[#F8F9FC] placeholder-[#595962] outline-none focus:border-[#F7A51C]/50 transition-all font-mono-data"
                  />
                </div>
                {activeTemplate?.signupUrl && (
                  <a 
                    href={activeTemplate.signupUrl} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="text-[10px] text-[#F7A51C] hover:underline mt-2 flex items-center gap-1"
                  >
                    Don't have a key? Sign up for {activeTemplate.name} <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>

              {testResult && (
                <div className={cn(
                  "p-3 rounded-xl flex items-start gap-3",
                  testResult.status === 'passed' ? "bg-emerald-500/5 border border-emerald-500/20" : "bg-red-500/5 border border-red-500/20"
                )}>
                  {testResult.status === 'passed' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className={cn("text-xs font-bold", testResult.status === 'passed' ? "text-emerald-400" : "text-red-400")}>
                      {testResult.status === 'passed' ? "Connection Passed" : "Connection Failed"}
                    </div>
                    <p className="text-[11px] text-[#A6A6B0] mt-1 break-words line-clamp-2">
                      {testResult.message}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 mt-8">
              <button
                onClick={handleTest}
                disabled={testing || activating || (!apiKey && activeTemplate?.envKey !== '')}
                className="flex-1 flex items-center justify-center gap-2 py-3 text-xs font-bold bg-[#1A1A20] text-[#A6A6B0] rounded-xl border border-[#27272E] hover:text-[#F8F9FC] transition-all disabled:opacity-50"
              >
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
                Test Connection
              </button>
              <button
                onClick={handleActivate}
                disabled={activating || testing || (!apiKey && activeTemplate?.envKey !== '')}
                className="flex-[2] flex items-center justify-center gap-2 py-3 text-xs font-bold bg-[#F7A51C] text-black rounded-xl hover:bg-[#F7A51C]/90 shadow-lg shadow-[#F7A51C]/10 transition-all disabled:opacity-50"
              >
                {activating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {activeTemplate?.isRegistered ? 'Update Credentials' : 'Activate Provider'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
