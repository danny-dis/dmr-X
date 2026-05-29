import { useState, useMemo } from 'react';
import { useMemoryItems } from '@/hooks/useApiData';
import StatusBadge from '@/components/StatusBadge';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ErrorBanner';
import { Search, Layers } from 'lucide-react';

export default function MemoryCenter() {
  const { items: memoryItems, error } = useMemoryItems();
  const namespaces = useMemo(() => Array.from(new Set(memoryItems.map((m) => m.namespace))), [memoryItems]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNamespace, setSelectedNamespace] = useState<string | null>(null);
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const filtered = memoryItems.filter((m) => {
    if (searchQuery && !m.content.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (selectedNamespace && m.namespace !== selectedNamespace) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#F8F9FC]">Memory Center</h1>
          <p className="text-xs text-[#595962] mt-0.5">Memory storage, retrieval, and embedding management</p>
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
            placeholder="Search memories..."
            className="bg-transparent text-xs text-[#F8F9FC] placeholder-[#595962] outline-none flex-1"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {namespaces.map((ns) => (
            <button
              key={ns}
              onClick={() => setSelectedNamespace(selectedNamespace === ns ? null : ns)}
              className={cn(
                'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border capitalize',
                selectedNamespace === ns
                  ? 'bg-[#F7A51C]/10 border-[#F7A51C]/30 text-[#F7A51C]'
                  : 'bg-[#0F0F12] border-[#27272E] text-[#595962] hover:text-[#A6A6B0]'
              )}
            >
              {ns.replace(/-/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Memory List */}
      <div className="glass-card rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="text-[10px] text-[#595962] uppercase tracking-wider bg-[#0A0A0C]">
              <th className="text-left p-3 font-medium">Content</th>
              <th className="text-left p-3 font-medium">Namespace</th>
              <th className="text-left p-3 font-medium">Confidence</th>
              <th className="text-left p-3 font-medium">Source</th>
              <th className="text-left p-3 font-medium">Status</th>
              <th className="text-left p-3 font-medium">Age</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#27272E]/30">
            {filtered.map((item) => (
              <>
                <tr
                  key={item.id}
                  className={cn(
                    'hover:bg-[#1A1A20] transition-colors cursor-pointer',
                    expandedItem === item.id && 'bg-[#1A1A20]'
                  )}
                  onClick={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
                >
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <Layers className="w-3.5 h-3.5 text-[#F7A51C] flex-shrink-0" />
                      <span className="text-xs text-[#A6A6B0] line-clamp-2 max-w-[400px]">{item.content}</span>
                    </div>
                  </td>
                  <td className="p-3">
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#1A1A20] text-[#A6A6B0] border border-[#27272E]">
                      {item.namespace}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1.5">
                      <div className="w-8 h-1.5 bg-[#1A1A20] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#00FFB2] rounded-full"
                          style={{ width: `${item.confidence * 100}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-[#00FFB2] font-mono-data">{(item.confidence * 100).toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="p-3 text-[11px] text-[#A6A6B0]">{item.source}</td>
                  <td className="p-3"><StatusBadge status={item.redactionStatus} /></td>
                  <td className="p-3 text-[11px] text-[#595962] font-mono-data">
                    {Math.floor((Date.now() - new Date(item.createdAt).getTime()) / 3600000)}h ago
                  </td>
                </tr>
                {expandedItem === item.id && (
                  <tr>
                    <td colSpan={6} className="p-0">
                      <div className="bg-[#0A0A0C] border-t border-[#27272E] p-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div>
                            <h4 className="text-[11px] font-semibold text-[#F8F9FC] mb-2">Content</h4>
                            <p className="text-xs text-[#A6A6B0] leading-relaxed">{item.content}</p>
                          </div>
                          <div className="space-y-2">
                            <h4 className="text-[11px] font-semibold text-[#F8F9FC]">Metadata</h4>
                            {Object.entries(item.metadata).map(([key, value]) => (
                              <div key={key} className="flex items-center justify-between text-xs">
                                <span className="text-[#595962]">{key}</span>
                                <span className="text-[#A6A6B0] font-mono-data">{String(value)}</span>
                              </div>
                            ))}
                          </div>
                          <div className="space-y-2">
                            <h4 className="text-[11px] font-semibold text-[#F8F9FC]">Properties</h4>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-[#595962]">Embedding Model</span>
                              <span className="text-[#A6A6B0] font-mono-data">{item.embeddingModel}</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-[#595962]">Retention</span>
                              <span className="text-[#A6A6B0] font-mono-data">{item.retentionDays} days</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-[#595962]">Created</span>
                              <span className="text-[#A6A6B0] font-mono-data">{new Date(item.createdAt).toLocaleString()}</span>
                            </div>
                            {item.retrievedAt && (
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-[#595962]">Last Retrieved</span>
                                <span className="text-[#A6A6B0] font-mono-data">{new Date(item.retrievedAt).toLocaleString()}</span>
                              </div>
                            )}
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
      </div>
    </div>
  );
}
