import { useState } from 'react';
import { useProviders } from '@/hooks/useApiData';
import StatusBadge from '@/components/StatusBadge';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ErrorBanner';
import {
  Search, Database, ChevronRight, Loader2, ExternalLink, Copy, Check
} from 'lucide-react';

const costTierColors: Record<string, string> = {
  low: 'text-[#00FFB2]',
  medium: 'text-[#F7A51C]',
  high: 'text-[#FF4D6A]',
  premium: 'text-[#F7A51C]',
};

export default function ProviderRegistry() {
  const { providers, loading, source, error } = useProviders();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filtered = providers.filter((p) =>
    !searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const detailProvider = providers.find((p) => p.id === selectedProvider);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[#F8F9FC]">Provider Registry</h1>
            {loading && <Loader2 className="w-4 h-4 text-[#F7A51C] animate-spin" />}
            <span className={cn(
              'text-[10px] px-1.5 py-0.5 rounded font-mono-data',
              source === 'api' ? 'bg-[#00FFB2]/10 text-[#00FFB2]' : 'bg-[#595962]/10 text-[#595962]'
            )}>
              {source}
            </span>
          </div>
          <p className="text-xs text-[#595962] mt-0.5">{providers.length} providers registered</p>
        </div>
      </div>

      <ErrorBanner error={error} />

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-2 bg-[#0F0F12] border border-[#27272E] rounded-lg flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-[#595962]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search providers..."
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
                'glass-card rounded-xl p-4 cursor-pointer hover:border-[#F7A51C]/30 transition-all',
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
                    <div className="text-[11px] text-[#595962] font-mono-data">{provider.region}</div>
                  </div>
                </div>
                <StatusBadge status={provider.status} />
              </div>

              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="bg-[#1A1A20] rounded p-2">
                  <div className="text-[10px] text-[#595962]">Latency</div>
                  <div className="text-xs font-semibold text-[#F8F9FC] font-mono-data">{provider.avgLatency}ms</div>
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

              <div className="flex items-center justify-between">
                <span className={cn('text-[11px] font-semibold capitalize', costTierColors[provider.costTier])}>
                  {provider.costTier} tier
                </span>
                <div className="flex items-center gap-2">
                  {provider.signupUrl && (
                    <div className="flex items-center gap-1">
                      <a
                        href={provider.signupUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-[#F7A51C] hover:text-[#F8F9FC] transition-colors flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="w-3 h-3" /> Get Key
                      </a>
                      <button
                        className="text-[11px] text-[#595962] hover:text-[#F8F9FC] transition-colors"
                        onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(provider.signupUrl!); setCopiedId(provider.id); setTimeout(() => setCopiedId(null), 2000); }}
                        title="Copy signup link"
                      >
                        {copiedId === provider.id ? <Check className="w-3 h-3 text-[#00FFB2]" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  )}
                  <span className="text-[11px] text-[#595962] font-mono-data">
                    {provider.rateLimit.requests.toLocaleString()}/{provider.rateLimit.window}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Detail Panel */}
        <div className="glass-card rounded-xl p-5">
          {detailProvider ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-lg bg-[#F7A51C]/10 flex items-center justify-center">
                    <Database className="w-5 h-5 text-[#F7A51C]" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-[#F8F9FC]">{detailProvider.name}</h3>
                    <p className="text-[11px] text-[#595962] font-mono-data">{detailProvider.baseUrl}</p>
                  </div>
                </div>
                {detailProvider.signupUrl && (
                  <div className="flex items-center gap-2">
                    <a
                      href={detailProvider.signupUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 text-xs font-medium bg-[#F7A51C]/10 text-[#F7A51C] rounded-lg hover:bg-[#F7A51C]/20 transition-colors flex items-center gap-1.5"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Get API Key
                    </a>
                    <button
                      className="px-2 py-1.5 text-xs text-[#595962] hover:text-[#F8F9FC] bg-[#1A1A20] rounded-lg hover:bg-[#27272E] transition-colors flex items-center gap-1.5"
                      onClick={() => { navigator.clipboard.writeText(detailProvider.signupUrl!); setCopiedId(detailProvider.id); setTimeout(() => setCopiedId(null), 2000); }}
                      title="Copy signup link"
                    >
                      {copiedId === detailProvider.id ? <><Check className="w-3.5 h-3.5 text-[#00FFB2]" /> Copied</> : <><Copy className="w-3.5 h-3.5" /> Copy Link</>}
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="bg-[#1A1A20] rounded p-3">
                  <div className="text-[10px] text-[#595962] mb-1">Health Status</div>
                  <StatusBadge status={detailProvider.status} />
                </div>
                <div className="bg-[#1A1A20] rounded p-3">
                  <div className="text-[10px] text-[#595962] mb-1">Failover</div>
                  <StatusBadge status={detailProvider.failoverStatus} />
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-[#27272E]">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#595962]">Region</span>
                  <span className="text-[#F8F9FC] font-mono-data">{detailProvider.region}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#595962]">Cost Tier</span>
                  <span className={cn('font-medium capitalize', costTierColors[detailProvider.costTier])}>{detailProvider.costTier}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#595962]">Rate Limit</span>
                  <span className="text-[#F8F9FC] font-mono-data">{detailProvider.rateLimit.requests.toLocaleString()} req/{detailProvider.rateLimit.window}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#595962]">Avg Latency</span>
                  <span className="text-[#F8F9FC] font-mono-data">{detailProvider.avgLatency}ms</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#595962]">Success Rate</span>
                  <span className="text-[#00FFB2] font-mono-data">{detailProvider.successRate}%</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#595962]">Last Health Check</span>
                  <span className="text-[#595962] font-mono-data">{new Date(detailProvider.lastHealthCheck).toLocaleTimeString()}</span>
                </div>
              </div>

              {/* Supported Models */}
              <div className="pt-2 border-t border-[#27272E]">
                <h4 className="text-[11px] font-semibold text-[#F8F9FC] mb-2">Supported Models ({detailProvider.models.length})</h4>
                <div className="space-y-1">
                  {detailProvider.models.map((model) => (
                    <div key={model} className="flex items-center gap-2 text-xs text-[#A6A6B0]">
                      <ChevronRight className="w-3 h-3 text-[#595962]" />
                      <span className="font-mono-data">{model}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center py-12">
              <Database className="w-8 h-8 text-[#27272E] mb-3" />
              <p className="text-sm text-[#595962]">Select a provider to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
