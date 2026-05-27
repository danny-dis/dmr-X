import { useState } from 'react';
import { useAlerts } from '@/hooks/useApiData';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ErrorBanner';
import { Bell, Search, AlertTriangle, Zap, TrendingUp, DollarSign, BarChart3, ShieldCheck, Box, CheckCircle } from 'lucide-react';

const alertIcons: Record<string, typeof AlertTriangle> = {
  quota: Zap,
  provider_outage: AlertTriangle,
  spend_anomaly: DollarSign,
  latency_spike: TrendingUp,
  benchmark_regression: BarChart3,
  auth_failure: ShieldCheck,
  sandbox_failure: Box,
};

const severityColors = {
  critical: 'border-l-[#FF4D6A]',
  warning: 'border-l-[#F7A51C]',
  info: 'border-l-[#00E0FF]',
};

const severityFilters = ['all', 'critical', 'warning', 'info'];

export default function Alerts() {
  const { alerts, error } = useAlerts();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('all');

  const filtered = alerts.filter((a) => {
    if (filterSeverity !== 'all' && a.severity !== filterSeverity) return false;
    if (searchQuery && !a.message.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const active = alerts.filter((a) => !a.resolved).length;
  const critical = alerts.filter((a) => a.severity === 'critical' && !a.resolved).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#F8F9FC]">Alerts</h1>
          <p className="text-xs text-[#595962] mt-0.5">{active} active alerts, {critical} critical</p>
        </div>
      </div>

      <ErrorBanner error={error} />

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Bell className="w-4 h-4 text-[#F7A51C]" />
            <span className="text-[11px] text-[#595962]">Total</span>
          </div>
          <div className="text-xl font-bold text-[#F8F9FC]">{alerts.length}</div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-[#FF4D6A]" />
            <span className="text-[11px] text-[#595962]">Active</span>
          </div>
          <div className="text-xl font-bold text-[#FF4D6A]">{active}</div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-4 h-4 text-[#00FFB2]" />
            <span className="text-[11px] text-[#595962]">Resolved</span>
          </div>
          <div className="text-xl font-bold text-[#00FFB2]">{alerts.filter((a) => a.resolved).length}</div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-[#FF4D6A]" />
            <span className="text-[11px] text-[#595962]">Critical</span>
          </div>
          <div className="text-xl font-bold text-[#FF4D6A]">{critical}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 px-3 py-2 bg-[#0F0F12] border border-[#27272E] rounded-lg flex-1 max-w-sm">
          <Search className="w-3.5 h-3.5 text-[#595962]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search alerts..."
            className="bg-transparent text-xs text-[#F8F9FC] placeholder-[#595962] outline-none flex-1"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {severityFilters.map((s) => (
            <button
              key={s}
              onClick={() => setFilterSeverity(s)}
              className={cn(
                'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border capitalize',
                filterSeverity === s
                  ? 'bg-[#FF4D6A]/10 border-[#FF4D6A]/30 text-[#FF4D6A]'
                  : 'bg-[#0F0F12] border-[#27272E] text-[#595962] hover:text-[#A6A6B0]'
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Alert Cards */}
      <div className="space-y-2">
        {filtered.map((alert) => {
          const Icon = alertIcons[alert.type] || AlertTriangle;
          return (
            <div
              key={alert.id}
              className={cn(
                'glass-card rounded-xl p-4 border-l-2 transition-all hover:bg-[#1A1A20]',
                severityColors[alert.severity as keyof typeof severityColors]
              )}
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#1A1A20] flex items-center justify-center flex-shrink-0">
                  <Icon className={cn(
                    'w-4 h-4',
                    alert.severity === 'critical' ? 'text-[#FF4D6A]' :
                    alert.severity === 'warning' ? 'text-[#F7A51C]' : 'text-[#00E0FF]'
                  )} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-[#F8F9FC]">{alert.message}</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-[#595962] font-mono-data">{new Date(alert.timestamp).toLocaleTimeString()}</span>
                    <span className={cn(
                      'px-1.5 py-0.5 rounded font-medium',
                      alert.severity === 'critical' && 'bg-[#FF4D6A]/10 text-[#FF4D6A]',
                      alert.severity === 'warning' && 'bg-[#F7A51C]/10 text-[#F7A51C]',
                      alert.severity === 'info' && 'bg-[#00E0FF]/10 text-[#00E0FF]',
                    )}>
                      {alert.severity}
                    </span>
                    <span className="text-[#595962]">{alert.source}</span>
                    {alert.acknowledged && (
                      <span className="text-[#00FFB2]">Acknowledged</span>
                    )}
                    {alert.resolved && (
                      <span className="text-[#00FFB2]">Resolved</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-sm text-[#595962]">No alerts match your filters.</div>
        )}
      </div>
    </div>
  );
}
