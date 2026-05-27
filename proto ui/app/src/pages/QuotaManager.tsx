import { useQuotaStates } from '@/hooks/useApiData';
import { AlertTriangle, TrendingDown, Zap, Gauge, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ErrorBanner';

export default function QuotaManager() {
  const { quotas: quotaStates, error } = useQuotaStates();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#F8F9FC]">Quota Manager</h1>
          <p className="text-xs text-[#595962] mt-0.5">Provider quota tracking and burn rate analysis</p>
        </div>
      </div>

      <ErrorBanner error={error} />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Gauge className="w-4 h-4 text-[#F7A51C]" />
            <span className="text-[11px] text-[#595962]">Total Quota</span>
          </div>
          <div className="text-xl font-bold text-[#F8F9FC] font-mono-data">
            {(quotaStates.reduce((a, q) => a + q.totalQuota, 0) / 1e6).toFixed(1)}M
          </div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className="w-4 h-4 text-[#FF4D6A]" />
            <span className="text-[11px] text-[#595962]">Used</span>
          </div>
          <div className="text-xl font-bold text-[#FF4D6A] font-mono-data">
            {(quotaStates.reduce((a, q) => a + q.usedQuota, 0) / 1e6).toFixed(1)}M
          </div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-[#00FFB2]" />
            <span className="text-[11px] text-[#595962]">Remaining</span>
          </div>
          <div className="text-xl font-bold text-[#00FFB2] font-mono-data">
            {(quotaStates.reduce((a, q) => a + q.remainingQuota, 0) / 1e6).toFixed(1)}M
          </div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-[#F7A51C]" />
            <span className="text-[11px] text-[#595962]">Alerts</span>
          </div>
          <div className="text-xl font-bold text-[#F7A51C]">
            {quotaStates.reduce((a, q) => a + q.alerts.length, 0)}
          </div>
        </div>
      </div>

      {/* Quota Details */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {quotaStates.map((quota) => {
          const usagePercent = (quota.usedQuota / quota.totalQuota) * 100;
          const isWarning = usagePercent > 75;
          const isCritical = usagePercent > 90;
          return (
            <div key={quota.id} className="glass-card rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-[#F7A51C]/10 flex items-center justify-center">
                    <Gauge className="w-4 h-4 text-[#F7A51C]" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-[#F8F9FC]">{quota.providerName}</div>
                    <div className="text-[11px] text-[#595962] font-mono-data">{quota.window} window</div>
                  </div>
                </div>
                {quota.alerts.length > 0 && (
                  <div className="flex items-center gap-1 px-2 py-1 rounded bg-[#F7A51C]/10 text-[#F7A51C]">
                    <AlertTriangle className="w-3 h-3" />
                    <span className="text-[10px] font-medium">{quota.alerts.length} alert{quota.alerts.length > 1 ? 's' : ''}</span>
                  </div>
                )}
              </div>

              {/* Progress bar */}
              <div className="mb-4">
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-[#595962] font-mono-data">
                    {quota.usedQuota.toLocaleString()} / {quota.totalQuota.toLocaleString()}
                  </span>
                  <span className={cn(
                    'font-mono-data font-semibold',
                    isCritical && 'text-[#FF4D6A]',
                    isWarning && !isCritical && 'text-[#F7A51C]',
                    !isWarning && 'text-[#00FFB2]'
                  )}>
                    {usagePercent.toFixed(1)}%
                  </span>
                </div>
                <div className="w-full h-2 bg-[#1A1A20] rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      isCritical ? 'bg-[#FF4D6A]' : isWarning ? 'bg-[#F7A51C]' : 'bg-[#00FFB2]'
                    )}
                    style={{ width: `${Math.min(usagePercent, 100)}%` }}
                  />
                </div>
              </div>

              {/* Metrics */}
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="bg-[#1A1A20] rounded p-2">
                  <div className="text-[10px] text-[#595962]">Burn Rate</div>
                  <div className="text-xs font-semibold text-[#F8F9FC] font-mono-data">{quota.burnRate.toLocaleString()}/hr</div>
                </div>
                <div className="bg-[#1A1A20] rounded p-2">
                  <div className="text-[10px] text-[#595962]">Predicted Exhaustion</div>
                  <div className="text-xs font-semibold text-[#F7A51C] font-mono-data">{quota.predictedExhaustion}</div>
                </div>
              </div>

              {/* Alerts & Suggestions */}
              {(quota.alerts.length > 0 || quota.reroutingSuggestions.length > 0) && (
                <div className="space-y-1 pt-2 border-t border-[#27272E]">
                  {quota.alerts.map((alert, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[11px] text-[#F7A51C]">
                      <AlertTriangle className="w-3 h-3" />
                      <span>{alert}</span>
                    </div>
                  ))}
                  {quota.reroutingSuggestions.map((s, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[11px] text-[#00E0FF]">
                      <RefreshCw className="w-3 h-3" />
                      <span>{s}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
