import { useState } from 'react';
import { useModels, useProviders } from '@/hooks/useApiData';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ErrorBanner';
import {
  Zap, Database, ChevronRight, Loader2, Sparkles, ShieldCheck, Globe, Clock, BarChart3, MessageSquare
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function FreeTier() {
  const { models, loading: modelsLoading, error: modelsError } = useModels();
  const { providers, loading: providersLoading } = useProviders();
  const navigate = useNavigate();

  // Filter for free models
  const freeModels = models.filter((m) => m.costPerInput === 0 && m.costPerOutput === 0);

  const stats = [
    { label: 'Free Models', value: freeModels.length, icon: Sparkles, color: 'text-[#00FFB2]' },
    { label: 'Free Providers', value: providers.filter(p => p.costTier === 'low' || p.baseUrl.includes('free') || p.id === 'pollinations').length, icon: Globe, color: 'text-[#00E0FF]' },
    { label: 'Avg Latency', value: '240ms', icon: Clock, color: 'text-[#F7A51C]' },
    { label: 'Uptime', value: '99.9%', icon: ShieldCheck, color: 'text-[#00FFB2]' },
  ];

  if (modelsLoading || providersLoading) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <Loader2 className="w-8 h-8 text-[#F7A51C] animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#F8F9FC]">Free Tier Catalog</h1>
        <p className="text-xs text-[#595962] mt-0.5">High-quality models available for free with zero or low configuration</p>
      </div>

      <ErrorBanner error={modelsError} />

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <div key={i} className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-3 mb-2">
              <div className={cn('p-2 rounded-lg bg-opacity-10', stat.color.replace('text-', 'bg-'))}>
                <stat.icon className={cn('w-4 h-4', stat.color)} />
              </div>
              <span className="text-[11px] text-[#595962] font-semibold uppercase tracking-wider">{stat.label}</span>
            </div>
            <div className="text-xl font-bold text-[#F8F9FC] font-mono-data">{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-[#F8F9FC] flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#00FFB2]" />
              Available Free Models
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {freeModels.map((model) => (
              <div 
                key={`${model.providerId}-${model.id}`}
                className="glass-card rounded-xl p-4 hover:border-[#00FFB2]/30 transition-all cursor-pointer group"
                onClick={() => navigate('/playground', { state: { modelId: model.id } })}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-[#00FFB2]/10 flex items-center justify-center">
                      <Zap className="w-4 h-4 text-[#00FFB2]" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-[#F8F9FC] group-hover:text-[#00FFB2] transition-colors">{model.id}</div>
                      <div className="text-[10px] text-[#595962] font-mono-data uppercase">{model.providerId}</div>
                    </div>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#00FFB2]/10 text-[#00FFB2] border border-[#00FFB2]/20 font-bold uppercase">FREE</span>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-3">
                   <div className="bg-[#1A1A20] rounded p-2">
                    <div className="text-[10px] text-[#595962]">Context</div>
                    <div className="text-[11px] font-semibold text-[#F8F9FC] font-mono-data">{model.contextWindow?.toLocaleString() || '128k'}</div>
                  </div>
                  <div className="bg-[#1A1A20] rounded p-2">
                    <div className="text-[10px] text-[#595962]">Quality</div>
                    <div className="text-[11px] font-semibold text-[#00E0FF] font-mono-data">{(model.qualityScore * 10).toFixed(1)}/10</div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[#27272E]">
                  <div className="flex gap-1">
                    {model.capabilities.includes('streaming') && <span title="Streaming" className="w-1.5 h-1.5 rounded-full bg-[#00FFB2]" />}
                    {model.capabilities.includes('vision') && <span title="Vision" className="w-1.5 h-1.5 rounded-full bg-[#00E0FF]" />}
                    {model.capabilities.includes('tool_use') && <span title="Tools" className="w-1.5 h-1.5 rounded-full bg-[#F7A51C]" />}
                  </div>
                  <button className="text-[10px] font-bold text-[#595962] group-hover:text-[#F8F9FC] flex items-center gap-1 transition-colors">
                    <MessageSquare className="w-3 h-3" /> Test in Playground
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-sm font-bold text-[#F8F9FC] flex items-center gap-2">
            <Database className="w-4 h-4 text-[#F7A51C]" />
            Free Providers Info
          </h2>

          <div className="glass-card rounded-xl p-5 space-y-4">
            <div className="p-3 rounded-lg bg-[#00FFB2]/5 border border-[#00FFB2]/10">
              <h4 className="text-xs font-bold text-[#00FFB2] mb-1">Pollinations AI</h4>
              <p className="text-[11px] text-[#A6A6B0] leading-relaxed">
                Zero configuration required. Uses their community-powered text gateway. Supports high-quality models like DeepSeek and Mistral.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[#00E0FF]/5 border border-[#00E0FF]/10">
              <h4 className="text-xs font-bold text-[#00E0FF] mb-1">OpenRouter Free</h4>
              <p className="text-[11px] text-[#A6A6B0] leading-relaxed">
                Requires an OpenRouter API key. Provides access to 20+ free models from top providers like Google, Meta, and Alibaba.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[#F7A51C]/5 border border-[#F7A51C]/10">
              <h4 className="text-xs font-bold text-[#F7A51C] mb-1">Google AI Studio</h4>
              <p className="text-[11px] text-[#A6A6B0] leading-relaxed">
                Get a free API key from Google AI Studio. Gemini 2.0/2.5 Flash models have generous free tiers for testing.
              </p>
            </div>

            <button 
              onClick={() => navigate('/providers')}
              className="w-full py-2.5 bg-[#1A1A20] text-[#F8F9FC] rounded-lg text-xs font-bold border border-[#27272E] hover:bg-[#27272E] transition-all"
            >
              Configure Provider Keys
            </button>
          </div>

          <div className="glass-card rounded-xl p-5">
            <h4 className="text-xs font-bold text-[#F8F9FC] mb-3 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[#FF4D6A]" />
              Free Tier Comparison
            </h4>
            <div className="space-y-3">
              {[
                { name: 'Gemini 2.5 Flash', rate: '15 RPM', quality: 'Frontier' },
                { name: 'Llama 3.3 70B', rate: '20 RPM', quality: 'Frontier' },
                { name: 'Mistral Nemo', rate: 'Unlimited*', quality: 'Balanced' },
                { name: 'DeepSeek V3', rate: '10 RPM', quality: 'Frontier' },
              ].map((item, i) => (
                <div key={i} className="flex items-center justify-between text-[11px]">
                  <span className="text-[#A6A6B0]">{item.name}</span>
                  <div className="flex gap-2 font-mono-data">
                    <span className="text-[#F7A51C]">{item.rate}</span>
                    <span className="text-[#00FFB2]">{item.quality}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
