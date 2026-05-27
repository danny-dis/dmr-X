import { useWorkers } from '@/hooks/useApiData';
import StatusBadge from '@/components/StatusBadge';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ErrorBanner';
import { Timer, Cpu, Zap, Activity, Construction } from 'lucide-react';

export default function Scheduler() {
  const { workers: temporaryWorkers, error } = useWorkers();
  const active = temporaryWorkers.filter((w) => w.status === 'active').length;
  const idle = temporaryWorkers.filter((w) => w.status === 'idle').length;
  const totalQueue = temporaryWorkers.reduce((a, w) => a + w.queueDepth, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#F8F9FC]">Scheduler</h1>
          <p className="text-xs text-[#595962] mt-0.5">Temporary workers and task queue management</p>
        </div>
      </div>

      <ErrorBanner error={error} />

      {/* Coming Soon Banner */}
      <div className="flex items-center gap-3 px-4 py-3 bg-[#F7A51C]/10 border border-[#F7A51C]/30 rounded-lg">
        <Construction className="w-5 h-5 text-[#F7A51C] flex-shrink-0" />
        <div>
          <div className="text-xs font-medium text-[#F7A51C]">Coming Soon</div>
          <div className="text-[11px] text-[#F7A51C]/70">Scheduler is a planned feature for temporary worker management and task queue orchestration. This page shows mock data for preview purposes.</div>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-[#F7A51C]" />
            <span className="text-[11px] text-[#595962]">Active Workers</span>
          </div>
          <div className="text-xl font-bold text-[#00FFB2]">{active}</div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Timer className="w-4 h-4 text-[#00E0FF]" />
            <span className="text-[11px] text-[#595962]">Idle Workers</span>
          </div>
          <div className="text-xl font-bold text-[#F8F9FC]">{idle}</div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-[#FF4D6A]" />
            <span className="text-[11px] text-[#595962]">Queue Depth</span>
          </div>
          <div className="text-xl font-bold text-[#FF4D6A] font-mono-data">{totalQueue}</div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Cpu className="w-4 h-4 text-[#F7A51C]" />
            <span className="text-[11px] text-[#595962]">Avg Utilization</span>
          </div>
          <div className="text-xl font-bold text-[#F7A51C]">
            {Math.round(temporaryWorkers.reduce((a, w) => a + w.cpuUsage, 0) / temporaryWorkers.length)}%
          </div>
        </div>
      </div>

      {/* Worker Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {temporaryWorkers.map((worker) => (
          <div key={worker.id} className="glass-card rounded-xl p-4">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md bg-[#F7A51C]/10 flex items-center justify-center">
                  <Timer className="w-3.5 h-3.5 text-[#F7A51C]" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-[#F8F9FC] font-mono-data">{worker.name}</div>
                  <div className="text-[10px] text-[#595962]">{worker.taskAssigned || 'No task'}</div>
                </div>
              </div>
              <StatusBadge status={worker.status} />
            </div>

            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="bg-[#1A1A20] rounded p-2">
                <div className="text-[10px] text-[#595962]">Uptime</div>
                <div className="text-xs font-semibold text-[#F8F9FC] font-mono-data">{Math.floor(worker.uptime / 60)}m</div>
              </div>
              <div className="bg-[#1A1A20] rounded p-2">
                <div className="text-[10px] text-[#595962]">Queue</div>
                <div className="text-xs font-semibold text-[#F8F9FC] font-mono-data">{worker.queueDepth}</div>
              </div>
              <div className="bg-[#1A1A20] rounded p-2">
                <div className="text-[10px] text-[#595962]">CPU</div>
                <div className="text-xs font-semibold text-[#F8F9FC] font-mono-data">{worker.cpuUsage}%</div>
              </div>
              <div className="bg-[#1A1A20] rounded p-2">
                <div className="text-[10px] text-[#595962]">Memory</div>
                <div className="text-xs font-semibold text-[#F8F9FC] font-mono-data">{worker.memoryUsage}%</div>
              </div>
            </div>

            {/* CPU bar */}
            <div className="mb-1">
              <div className="w-full h-1.5 bg-[#1A1A20] rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full',
                    worker.cpuUsage > 80 ? 'bg-[#FF4D6A]' : worker.cpuUsage > 50 ? 'bg-[#F7A51C]' : 'bg-[#00FFB2]'
                  )}
                  style={{ width: `${worker.cpuUsage}%` }}
                />
              </div>
            </div>

            {/* Memory bar */}
            <div className="mb-2">
              <div className="w-full h-1.5 bg-[#1A1A20] rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full',
                    worker.memoryUsage > 80 ? 'bg-[#FF4D6A]' : worker.memoryUsage > 50 ? 'bg-[#F7A51C]' : 'bg-[#00FFB2]'
                  )}
                  style={{ width: `${worker.memoryUsage}%` }}
                />
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px]">
              <span className={cn(
                'font-medium',
                worker.health === 'healthy' && 'text-[#00FFB2]',
                worker.health === 'degraded' && 'text-[#F7A51C]',
                worker.health === 'unhealthy' && 'text-[#FF4D6A]',
              )}>
                {worker.health}
              </span>
              <span className="text-[#595962]">
                {worker.autoTerminate ? 'Auto-terminate' : 'Persistent'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
