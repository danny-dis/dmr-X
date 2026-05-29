import { useState } from 'react';
import { useRouteDecisions } from '@/hooks/useApiData';
import StatusBadge from '@/components/StatusBadge';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ErrorBanner';
import {
  Search, Filter, ArrowRight, Eye, Play,
  Zap, Target
} from 'lucide-react';

const taskTypes = ['all', 'text-generation', 'code-generation', 'vision-analysis', 'agentic-workflow', 'embedding', 'image-generation', 'speech-to-text', 'rag-query'];
const statusFilters = ['all', 'success', 'fallback', 'error', 'retry'];

export default function RoutingConsole() {
  const { decisions: routeDecisions, error } = useRouteDecisions();
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const filtered = routeDecisions.filter((r) => {
    if (filterType !== 'all' && r.taskType !== filterType) return false;
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    if (searchQuery && !r.selectedModel.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !r.selectedProvider.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !r.taskType.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#F8F9FC]">Routing Console</h1>
          <p className="text-xs text-[#595962] mt-0.5">Live request routing decisions and inspection</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1A1A20] rounded-md border border-[#27272E]">
            <div className="w-2 h-2 rounded-full bg-[#FF4D6A] animate-pulse" />
            <span className="text-[11px] text-[#A6A6B0] font-mono-data">LIVE STREAM</span>
          </div>
        </div>
      </div>

      <ErrorBanner error={error} />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-2 bg-[#0F0F12] border border-[#27272E] rounded-lg flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-[#595962]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search routes..."
            className="bg-transparent text-xs text-[#F8F9FC] placeholder-[#595962] outline-none flex-1"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-[#595962]" />
          <div className="flex gap-1">
            {taskTypes.slice(0, 5).map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border',
                  filterType === type
                    ? 'bg-[#F7A51C]/10 border-[#F7A51C]/30 text-[#F7A51C]'
                    : 'bg-[#0F0F12] border-[#27272E] text-[#595962] hover:text-[#A6A6B0]'
                )}
              >
                {type === 'all' ? 'All' : type.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(0, 3)).join(' ')}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-1">
          {statusFilters.map((status) => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={cn(
                'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border',
                filterStatus === status
                  ? 'bg-[#F7A51C]/10 border-[#F7A51C]/30 text-[#F7A51C]'
                  : 'bg-[#0F0F12] border-[#27272E] text-[#595962] hover:text-[#A6A6B0]'
              )}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Routing Table */}
      <div className="glass-card rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="text-[10px] text-[#595962] uppercase tracking-wider bg-[#0A0A0C]">
              <th className="text-left p-3 font-medium">Timestamp</th>
              <th className="text-left p-3 font-medium">Task Type</th>
              <th className="text-left p-3 font-medium">Selected Model</th>
              <th className="text-left p-3 font-medium">Provider</th>
              <th className="text-left p-3 font-medium">Mode</th>
              <th className="text-left p-3 font-medium">Confidence</th>
              <th className="text-left p-3 font-medium">Latency</th>
              <th className="text-left p-3 font-medium">Cost</th>
              <th className="text-left p-3 font-medium">Status</th>
              <th className="text-left p-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#27272E]/30">
            {filtered.map((route) => (
              <>
                <tr
                  key={route.id}
                  className={cn(
                    'hover:bg-[#1A1A20] transition-colors cursor-pointer group',
                    expandedRow === route.id && 'bg-[#1A1A20]'
                  )}
                  onClick={() => setExpandedRow(expandedRow === route.id ? null : route.id)}
                >
                  <td className="p-3 text-[11px] text-[#595962] font-mono-data">
                    {new Date(route.timestamp).toLocaleTimeString()}
                  </td>
                  <td className="p-3">
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#1A1A20] text-[#A6A6B0] border border-[#27272E]">
                      {route.taskType}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-[#F8F9FC] font-medium">{route.selectedModel}</td>
                  <td className="p-3 text-[11px] text-[#A6A6B0]">{route.selectedProvider}</td>
                  <td className="p-3">
                    <span className={cn(
                      'text-[11px] px-1.5 py-0.5 rounded font-mono-data',
                      route.executionMode === 'stream' && 'bg-[#00E0FF]/10 text-[#00E0FF]',
                      route.executionMode === 'sync' && 'bg-[#F7A51C]/10 text-[#F7A51C]',
                      route.executionMode === 'async' && 'bg-[#595962]/10 text-[#595962]',
                    )}>
                      {route.executionMode}
                    </span>
                  </td>
                  <td className="p-3 text-[11px] text-[#F7A51C] font-mono-data font-semibold">
                    {(route.confidence * 100).toFixed(0)}%
                  </td>
                  <td className="p-3 text-[11px] text-[#595962] font-mono-data">{route.latency}ms</td>
                  <td className="p-3 text-[11px] text-[#595962] font-mono-data">${route.cost.toFixed(4)}</td>
                  <td className="p-3"><StatusBadge status={route.status} /></td>
                  <td className="p-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button className="p-1 rounded hover:bg-[#27272E]" title="Inspect">
                        <Eye className="w-3 h-3 text-[#A6A6B0]" />
                      </button>
                      <button className="p-1 rounded hover:bg-[#27272E]" title="Replay">
                        <Play className="w-3 h-3 text-[#A6A6B0]" />
                      </button>
                    </div>
                  </td>
                </tr>
                {/* Expanded detail */}
                {expandedRow === route.id && (
                  <tr>
                    <td colSpan={10} className="p-0">
                      <div className="bg-[#0A0A0C] border-t border-[#27272E] p-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {/* Decision Details */}
                          <div className="space-y-2">
                            <h4 className="text-[11px] font-semibold text-[#F8F9FC] uppercase tracking-wider">Decision</h4>
                            <p className="text-xs text-[#A6A6B0] leading-relaxed">{route.decisionReason}</p>
                            <div className="flex items-center gap-2 text-[11px] text-[#595962] font-mono-data">
                              <Target className="w-3 h-3 text-[#F7A51C]" />
                              <span>Input: {route.inputTokens.toLocaleString()} tokens</span>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-[#595962] font-mono-data">
                              <Zap className="w-3 h-3 text-[#00E0FF]" />
                              <span>Output: {route.outputTokens.toLocaleString()} tokens</span>
                            </div>
                          </div>

                          {/* Fallback Chain */}
                          <div className="space-y-2">
                            <h4 className="text-[11px] font-semibold text-[#F8F9FC] uppercase tracking-wider">Fallback Chain</h4>
                            <div className="space-y-1.5">
                              <div className="flex items-center gap-2 text-xs text-[#00FFB2]">
                                <span className="w-4 h-4 rounded-full bg-[#00FFB2]/10 flex items-center justify-center text-[10px]">1</span>
                                <span>{route.selectedModel}</span>
                                <span className="text-[10px] text-[#595962]">(selected)</span>
                              </div>
                              {route.fallbackChain.map((fb, i) => (
                                <div key={fb} className="flex items-center gap-2 text-xs text-[#595962]">
                                  <ArrowRight className="w-3 h-3 ml-1" />
                                  <span className="w-4 h-4 rounded-full bg-[#1A1A20] flex items-center justify-center text-[10px]">{i + 2}</span>
                                  <span>{fb}</span>
                                </div>
                              ))}
                              {route.fallbackChain.length === 0 && (
                                <span className="text-[11px] text-[#595962]">No fallback required</span>
                              )}
                            </div>
                          </div>

                          {/* Metrics */}
                          <div className="space-y-2">
                            <h4 className="text-[11px] font-semibold text-[#F8F9FC] uppercase tracking-wider">Metrics</h4>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="bg-[#1A1A20] rounded p-2">
                                <div className="text-[10px] text-[#595962]">Latency</div>
                                <div className="text-sm font-semibold text-[#F8F9FC] font-mono-data">{route.latency}ms</div>
                              </div>
                              <div className="bg-[#1A1A20] rounded p-2">
                                <div className="text-[10px] text-[#595962]">Cost</div>
                                <div className="text-sm font-semibold text-[#F7A51C] font-mono-data">${route.cost.toFixed(4)}</div>
                              </div>
                              <div className="bg-[#1A1A20] rounded p-2">
                                <div className="text-[10px] text-[#595962]">Confidence</div>
                                <div className="text-sm font-semibold text-[#00E0FF] font-mono-data">{(route.confidence * 100).toFixed(0)}%</div>
                              </div>
                              <div className="bg-[#1A1A20] rounded p-2">
                                <div className="text-[10px] text-[#595962]">Tokens</div>
                                <div className="text-sm font-semibold text-[#F8F9FC] font-mono-data">{(route.inputTokens + route.outputTokens).toLocaleString()}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="p-8 text-center text-sm text-[#595962]">No routing decisions match your filters.</div>
        )}
      </div>
    </div>
  );
}
