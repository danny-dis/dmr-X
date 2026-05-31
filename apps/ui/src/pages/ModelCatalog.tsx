import { useState, useMemo } from 'react';
import { useModels, useProviders } from '@/hooks/useApiData';
import StatusBadge from '@/components/StatusBadge';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ErrorBanner';
import {
  Search, Brain, Loader2
} from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';

export default function ModelCatalog() {
  const { models, loading, error } = useModels();
  const { providers } = useProviders();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedModality, setSelectedModality] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  const allTags = useMemo(() => Array.from(new Set(models.flatMap((m) => m.tags))), [models]);
  const allModalities = useMemo(() => Array.from(new Set(models.flatMap((m) => m.modality))), [models]);

  const filtered = models.filter((m) => {
    if (searchQuery && !m.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !m.provider.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (selectedTag && !m.tags.includes(selectedTag)) return false;
    if (selectedModality && !m.modality.includes(selectedModality)) return false;
    return true;
  });

  const detailModel = models.find((m) => m.id === selectedModel);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[#F8F9FC]">Model Catalog</h1>
            {loading && <Loader2 className="w-4 h-4 text-[#F7A51C] animate-spin" />}
          </div>
          <p className="text-xs text-[#595962] mt-0.5">{models.length} models across {providers.length} providers</p>
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
            placeholder="Search models..."
            className="bg-transparent text-xs text-[#F8F9FC] placeholder-[#595962] outline-none flex-1"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
              className={cn(
                'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border',
                selectedTag === tag
                  ? 'bg-[#F7A51C]/10 border-[#F7A51C]/30 text-[#F7A51C]'
                  : 'bg-[#0F0F12] border-[#27272E] text-[#595962] hover:text-[#A6A6B0]'
              )}
            >
              {tag}
            </button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap">
          {allModalities.map((mod) => (
            <button
              key={mod}
              onClick={() => setSelectedModality(selectedModality === mod ? null : mod)}
              className={cn(
                'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border capitalize',
                selectedModality === mod
                  ? 'bg-[#00E0FF]/10 border-[#00E0FF]/30 text-[#00E0FF]'
                  : 'bg-[#0F0F12] border-[#27272E] text-[#595962] hover:text-[#A6A6B0]'
              )}
            >
              {mod}
            </button>
          ))}
        </div>
      </div>

      {/* Model Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Model List */}
        <div className="xl:col-span-2 glass-card rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-[10px] text-[#595962] uppercase tracking-wider bg-[#0A0A0C]">
                <th className="text-left p-3 font-medium">Model</th>
                <th className="text-left p-3 font-medium">Provider</th>
                <th className="text-left p-3 font-medium">Modality</th>
                <th className="text-left p-3 font-medium">Context</th>
                <th className="text-left p-3 font-medium">Quality</th>
                <th className="text-left p-3 font-medium">Speed</th>
                <th className="text-left p-3 font-medium">Status</th>
                <th className="text-left p-3 font-medium">Trend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#27272E]/30">
              {filtered.map((model) => (
                <tr
                  key={model.id}
                  className={cn(
                    'hover:bg-[#1A1A20] transition-colors cursor-pointer',
                    selectedModel === model.id && 'bg-[#1A1A20]'
                  )}
                  onClick={() => setSelectedModel(selectedModel === model.id ? null : model.id)}
                >
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <Brain className="w-3.5 h-3.5 text-[#F7A51C]" />
                      <span className="text-xs text-[#F8F9FC] font-medium">{model.name}</span>
                    </div>
                  </td>
                  <td className="p-3 text-[11px] text-[#A6A6B0]">{model.provider}</td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      {model.modality.map((m) => (
                        <span key={m} className="text-[10px] px-1.5 py-0.5 rounded bg-[#1A1A20] text-[#A6A6B0] border border-[#27272E] capitalize">
                          {m}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="p-3 text-[11px] text-[#595962] font-mono-data">
                    {model.contextWindow >= 1000000
                      ? `${(model.contextWindow / 1000000).toFixed(1)}M`
                      : `${(model.contextWindow / 1000).toFixed(0)}K`}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1.5">
                      <div className="w-12 h-1.5 bg-[#1A1A20] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#00FFB2] rounded-full"
                          style={{ width: `${model.qualityScore}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-[#00FFB2] font-mono-data">{model.qualityScore}</span>
                    </div>
                  </td>
                  <td className="p-3">
                    <span className={cn(
                      'text-[11px] px-1.5 py-0.5 rounded font-medium capitalize',
                      model.speedClass === 'fast' && 'bg-[#00FFB2]/10 text-[#00FFB2]',
                      model.speedClass === 'balanced' && 'bg-[#F7A51C]/10 text-[#F7A51C]',
                      model.speedClass === 'slow' && 'bg-[#FF4D6A]/10 text-[#FF4D6A]',
                      model.speedClass === 'batch' && 'bg-[#595962]/10 text-[#595962]',
                    )}>
                      {model.speedClass}
                    </span>
                  </td>
                  <td className="p-3"><StatusBadge status={model.status} /></td>
                  <td className="p-3">
                    <div className="w-16 h-6">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={model.benchmarkTrend.map((v, i) => ({ v, i }))}>
                          <Line type="monotone" dataKey="v" stroke={model.benchmarkTrend[model.benchmarkTrend.length - 1] >= model.benchmarkTrend[0] ? '#00FFB2' : '#FF4D6A'} strokeWidth={1.5} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="p-8 text-center text-sm text-[#595962]">No models match your filters.</div>
          )}
        </div>

        {/* Model Detail Panel */}
        <div className="glass-card rounded-xl p-5">
          {detailModel ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-base font-bold text-[#F8F9FC]">{detailModel.name}</h3>
                  <p className="text-xs text-[#595962] mt-0.5">{detailModel.provider}</p>
                </div>
                <StatusBadge status={detailModel.status} />
              </div>
              <p className="text-xs text-[#A6A6B0]">{detailModel.description}</p>

              {/* Tags */}
              <div className="flex flex-wrap gap-1.5">
                {detailModel.tags.map((tag) => (
                  <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-[#F7A51C]/10 text-[#F7A51C] border border-[#F7A51C]/20 font-medium">
                    {tag}
                  </span>
                ))}
                {detailModel.toolSupport && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#00FFB2]/10 text-[#00FFB2] border border-[#00FFB2]/20 font-medium">
                    Tools
                  </span>
                )}
                {detailModel.streamingSupport && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#00E0FF]/10 text-[#00E0FF] border border-[#00E0FF]/20 font-medium">
                    Streaming
                  </span>
                )}
              </div>

              {/* Specs */}
              <div className="space-y-2 pt-2 border-t border-[#27272E]">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#595962]">Context Window</span>
                  <span className="text-[#F8F9FC] font-mono-data">{detailModel.contextWindow.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#595962]">Input Cost</span>
                  <span className="text-[#F7A51C] font-mono-data">${(detailModel.inputCost * 1000).toFixed(2)}/1M</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#595962]">Output Cost</span>
                  <span className="text-[#F7A51C] font-mono-data">${(detailModel.outputCost * 1000).toFixed(2)}/1M</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#595962]">Quality Score</span>
                  <span className="text-[#00FFB2] font-mono-data">{detailModel.qualityScore}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#595962]">Reliability</span>
                  <span className="text-[#00FFB2] font-mono-data">{detailModel.reliability}%</span>
                </div>
              </div>

              {/* Benchmark Trend */}
              <div className="pt-2 border-t border-[#27272E]">
                <h4 className="text-[11px] font-semibold text-[#F8F9FC] mb-2">Benchmark Trend</h4>
                <div className="h-16">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={detailModel.benchmarkTrend.map((v, i) => ({ v, i }))}>
                      <Line type="monotone" dataKey="v" stroke="#F7A51C" strokeWidth={2} dot={{ r: 2, fill: '#F7A51C' }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center py-12">
              <Brain className="w-8 h-8 text-[#27272E] mb-3" />
              <p className="text-sm text-[#595962]">Select a model to view details</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
