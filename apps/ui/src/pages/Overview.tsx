import { useNavigate } from 'react-router-dom';
import { useDashboardStats, useProviders, useModels, useRouteDecisions, useBenchmarkResults, useTelemetryEvents, useUsageHistory } from '@/hooks/useApiData';
import StatCard from '@/components/StatCard';
import StatusBadge from '@/components/StatusBadge';
import DataSpine from '@/components/DataSpine';
import {
  Activity, Clock, Coins, ArrowRight, Radio, Brain, ServerCrash
} from 'lucide-react';
import {
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area
} from 'recharts';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ErrorBanner';

export default function Overview() {
  const navigate = useNavigate();
  const { stats: dashboardStats, error } = useDashboardStats();
  const { providers } = useProviders();
  const { models } = useModels();
  const { decisions: routeDecisions } = useRouteDecisions();
  const { benchmarks: benchmarkResults } = useBenchmarkResults();
  const { events: telemetryEvents } = useTelemetryEvents();
  const { history: usageHistory } = useUsageHistory();
  const healthyProviders = providers.filter((p) => p.status === 'healthy').length;
  const totalProviders = providers.length;

  return (
    <div className="space-y-6">
      <ErrorBanner error={error} />
      {/* 3D Hero Section */}
      <div className="relative h-[340px] rounded-2xl overflow-hidden border border-[#27272E] -mx-6 -mt-6 mb-6">
        <DataSpine />

        {/* Overlay Content */}
        <div className="absolute inset-0 z-10 flex flex-col justify-end p-6">
          <div className="flex items-end justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-[#00FFB2] pulse-ring-amber" />
                <span className="text-[11px] text-[#00FFB2] font-mono-data tracking-wider">SYSTEM OPERATIONAL</span>
              </div>
              <h1 className="text-4xl font-black text-[#F8F9FC] tracking-tight text-glow">
                {dashboardStats.totalRequests.toLocaleString()}
              </h1>
              <p className="text-sm text-[#A6A6B0] mt-1">Total requests routed</p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-[#00FFB2]">{dashboardStats.successRate}%</div>
              <p className="text-xs text-[#A6A6B0] mt-0.5">Success rate</p>
            </div>
          </div>
        </div>

        {/* Gradient overlay at top for readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#060608]/60 via-transparent to-[#060608]/90 z-[5] pointer-events-none" />
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="cascade-item">
          <StatCard
            title="Average Latency"
            value={`${dashboardStats.avgLatency}ms`}
            subtitle="P95: 1,240ms"
            trend={{ value: 12, positive: false }}
            icon={<Clock className="w-4 h-4 text-[#F7A51C]" />}
            index={0}
          />
        </div>
        <div className="cascade-item">
          <StatCard
            title="Daily Spend"
            value={`$${dashboardStats.dailySpend.toLocaleString()}`}
            subtitle="Budget: $2,000"
            trend={{ value: 23, positive: false }}
            icon={<Coins className="w-4 h-4 text-[#F7A51C]" />}
            index={1}
          />
        </div>
        <div className="cascade-item">
          <StatCard
            title="Active Models"
            value={dashboardStats.activeModels}
            subtitle={`${models.length} registered`}
            trend={{ value: 8, positive: true }}
            icon={<Brain className="w-4 h-4 text-[#F7A51C]" />}
            index={2}
          />
        </div>
        <div className="cascade-item">
          <StatCard
            title="Fallback Rate"
            value={`${dashboardStats.fallbackRate}%`}
            subtitle="Target: < 1%"
            trend={{ value: 0.1, positive: false }}
            icon={<ServerCrash className="w-4 h-4 text-[#F7A51C]" />}
            index={3}
          />
        </div>
      </div>

      {/* Charts + Live Data Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Usage Chart */}
        <div className="lg:col-span-2 glass-card rounded-xl p-5 cascade-item" style={{ animationDelay: '0.32s' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[#F8F9FC]">Request Volume</h3>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#595962] font-mono-data">Last 12 hours</span>
              <Activity className="w-3.5 h-3.5 text-[#F7A51C]" />
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={usageHistory}>
              <defs>
                <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#F7A51C" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#F7A51C" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272E" />
              <XAxis dataKey="time" stroke="#595962" tick={{ fontSize: 11, fill: '#595962' }} />
              <YAxis stroke="#595962" tick={{ fontSize: 11, fill: '#595962' }} />
              <Tooltip
                contentStyle={{ background: '#0F0F12', border: '1px solid #27272E', borderRadius: '8px', fontSize: '12px' }}
                labelStyle={{ color: '#F8F9FC' }}
              />
              <Area type="monotone" dataKey="requests" stroke="#F7A51C" strokeWidth={2} fill="url(#colorRequests)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Live Telemetry */}
        <div className="glass-card rounded-xl p-5 cascade-item" style={{ animationDelay: '0.4s' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[#F8F9FC]">Live Events</h3>
            <div className="flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-[#FF4D6A] animate-pulse" />
              <span className="text-[11px] text-[#FF4D6A] font-mono-data">LIVE</span>
            </div>
          </div>
          <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1">
            {telemetryEvents.slice(0, 8).map((event) => (
              <div
                key={event.id}
                className={cn(
                  'flex items-start gap-2 text-[11px] font-mono-data p-1.5 rounded',
                  event.level === 'error' && 'bg-[#FF4D6A]/5',
                  event.level === 'warning' && 'bg-[#F7A51C]/5',
                )}
              >
                <span className={cn(
                  'mt-0.5',
                  event.level === 'info' && 'text-[#00FFB2]',
                  event.level === 'warning' && 'text-[#F7A51C]',
                  event.level === 'error' && 'text-[#FF4D6A]',
                  event.level === 'debug' && 'text-[#595962]',
                )}>
                  {event.level === 'info' && '●'}
                  {event.level === 'warning' && '▲'}
                  {event.level === 'error' && '●'}
                  {event.level === 'debug' && '○'}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-[#A6A6B0] truncate block">{event.message}</span>
                  <span className="text-[#595962]">{event.service}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Provider Health + Recent Routes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Provider Health */}
        <div className="glass-card rounded-xl p-5 cascade-item" style={{ animationDelay: '0.48s' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[#F8F9FC]">Provider Health</h3>
            <span className="text-[11px] text-[#00FFB2] font-mono-data">{healthyProviders}/{totalProviders} healthy</span>
          </div>
          <div className="space-y-3">
            {providers.map((provider) => (
              <div key={provider.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusBadge status={provider.status} />
                  <span className="text-xs text-[#A6A6B0]">{provider.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-[#595962] font-mono-data">{provider.avgLatency}ms</span>
                  <span className="text-[11px] text-[#595962] font-mono-data">{provider.successRate}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Routes */}
        <div className="lg:col-span-2 glass-card rounded-xl p-5 cascade-item" style={{ animationDelay: '0.56s' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[#F8F9FC]">Recent Routing Decisions</h3>
            <button
              onClick={() => navigate('/routing')}
              className="flex items-center gap-1 text-[11px] text-[#F7A51C] hover:underline"
            >
              View all <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-[10px] text-[#595962] uppercase tracking-wider">
                  <th className="text-left pb-2 font-medium">Time</th>
                  <th className="text-left pb-2 font-medium">Task</th>
                  <th className="text-left pb-2 font-medium">Model</th>
                  <th className="text-left pb-2 font-medium">Confidence</th>
                  <th className="text-left pb-2 font-medium">Latency</th>
                  <th className="text-left pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#27272E]/50">
                {routeDecisions.slice(0, 6).map((route) => (
                  <tr
                    key={route.id}
                    className="hover:bg-[#1A1A20] transition-colors cursor-pointer group"
                  >
                    <td className="py-2 text-[11px] text-[#595962] font-mono-data">
                      {new Date(route.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="py-2">
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#1A1A20] text-[#A6A6B0] border border-[#27272E]">
                        {route.taskType}
                      </span>
                    </td>
                    <td className="py-2 text-xs text-[#F8F9FC] font-medium">{route.selectedModel}</td>
                    <td className="py-2 text-[11px] text-[#F7A51C] font-mono-data">
                      {(route.confidence * 100).toFixed(0)}%
                    </td>
                    <td className="py-2 text-[11px] text-[#595962] font-mono-data">{route.latency}ms</td>
                    <td className="py-2"><StatusBadge status={route.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Benchmarks Preview */}
      <div className="glass-card rounded-xl p-5 cascade-item" style={{ animationDelay: '0.64s' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-[#F8F9FC]">Latest Benchmarks</h3>
          <button
            onClick={() => navigate('/benchmarks')}
            className="flex items-center gap-1 text-[11px] text-[#F7A51C] hover:underline"
          >
            View all <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-[10px] text-[#595962] uppercase tracking-wider">
                <th className="text-left pb-2 font-medium">Model</th>
                <th className="text-left pb-2 font-medium">Benchmark</th>
                <th className="text-left pb-2 font-medium">Score</th>
                <th className="text-left pb-2 font-medium">Previous</th>
                <th className="text-left pb-2 font-medium">Latency</th>
                <th className="text-left pb-2 font-medium">Regression</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#27272E]/50">
              {benchmarkResults.slice(0, 5).map((bm) => (
                <tr key={bm.id} className="hover:bg-[#1A1A20] transition-colors">
                  <td className="py-2 text-xs text-[#F8F9FC] font-medium">{bm.modelName}</td>
                  <td className="py-2 text-[11px] text-[#A6A6B0]">{bm.benchmarkName}</td>
                  <td className="py-2 text-[11px] text-[#00FFB2] font-mono-data font-semibold">{bm.score}%</td>
                  <td className="py-2 text-[11px] text-[#595962] font-mono-data">{bm.previousScore != null ? `${bm.previousScore}%` : '—'}</td>
                  <td className="py-2 text-[11px] text-[#595962] font-mono-data">{bm.latency}ms</td>
                  <td className="py-2">
                    {bm.regression ? (
                      <span className="text-[11px] text-[#FF4D6A] font-semibold">↓ Yes</span>
                    ) : (
                      <span className="text-[11px] text-[#00FFB2]">Stable</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
