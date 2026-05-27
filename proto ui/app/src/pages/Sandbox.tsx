import { useState } from 'react';
import { useSandboxJobs } from '@/hooks/useApiData';
import StatusBadge from '@/components/StatusBadge';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ErrorBanner';
import { Box, Search, Cpu, HardDrive, RotateCcw, AlertTriangle, Construction } from 'lucide-react';

const typeFilters = ['all', 'code_execution', 'tool_run', 'sandbox_task'];
const statusFilters = ['all', 'running', 'completed', 'failed', 'queued', 'quarantined'];

export default function Sandbox() {
  const { jobs: sandboxJobs, error } = useSandboxJobs();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  const filtered = sandboxJobs.filter((j) => {
    if (filterType !== 'all' && j.type !== filterType) return false;
    if (filterStatus !== 'all' && j.status !== filterStatus) return false;
    if (searchQuery && !j.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const active = sandboxJobs.filter((j) => j.status === 'running').length;
  const failed = sandboxJobs.filter((j) => j.status === 'failed').length;
  const quarantined = sandboxJobs.filter((j) => j.status === 'quarantined').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#F8F9FC]">Sandbox</h1>
          <p className="text-xs text-[#595962] mt-0.5">Code execution environment and job management</p>
        </div>
      </div>

      <ErrorBanner error={error} />

      {/* Coming Soon Banner */}
      <div className="flex items-center gap-3 px-4 py-3 bg-[#F7A51C]/10 border border-[#F7A51C]/30 rounded-lg">
        <Construction className="w-5 h-5 text-[#F7A51C] flex-shrink-0" />
        <div>
          <div className="text-xs font-medium text-[#F7A51C]">Coming Soon</div>
          <div className="text-[11px] text-[#F7A51C]/70">Sandbox is a planned feature for isolated code execution and tool runs. This page shows mock data for preview purposes.</div>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Box className="w-4 h-4 text-[#F7A51C]" />
            <span className="text-[11px] text-[#595962]">Active Jobs</span>
          </div>
          <div className="text-xl font-bold text-[#00FFB2]">{active}</div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <RotateCcw className="w-4 h-4 text-[#00E0FF]" />
            <span className="text-[11px] text-[#595962]">Completed</span>
          </div>
          <div className="text-xl font-bold text-[#F8F9FC]">{sandboxJobs.filter((j) => j.status === 'completed').length}</div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-[#FF4D6A]" />
            <span className="text-[11px] text-[#595962]">Failed</span>
          </div>
          <div className="text-xl font-bold text-[#FF4D6A]">{failed}</div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-[#F7A51C]" />
            <span className="text-[11px] text-[#595962]">Quarantined</span>
          </div>
          <div className="text-xl font-bold text-[#F7A51C]">{quarantined}</div>
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
            placeholder="Search jobs..."
            className="bg-transparent text-xs text-[#F8F9FC] placeholder-[#595962] outline-none flex-1"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {typeFilters.map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={cn(
                'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border capitalize',
                filterType === t
                  ? 'bg-[#F7A51C]/10 border-[#F7A51C]/30 text-[#F7A51C]'
                  : 'bg-[#0F0F12] border-[#27272E] text-[#595962] hover:text-[#A6A6B0]'
              )}
            >
              {t.replace('_', ' ')}
            </button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap">
          {statusFilters.map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={cn(
                'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border capitalize',
                filterStatus === s
                  ? 'bg-[#00E0FF]/10 border-[#00E0FF]/30 text-[#00E0FF]'
                  : 'bg-[#0F0F12] border-[#27272E] text-[#595962] hover:text-[#A6A6B0]'
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Job Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filtered.map((job) => (
          <div key={job.id} className="glass-card rounded-xl p-4">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <Box className="w-4 h-4 text-[#F7A51C]" />
                <span className="text-sm font-semibold text-[#F8F9FC]">{job.name}</span>
              </div>
              <StatusBadge status={job.status} />
            </div>

            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="bg-[#1A1A20] rounded p-2">
                <div className="text-[10px] text-[#595962] flex items-center gap-1"><Cpu className="w-2.5 h-2.5" /> CPU</div>
                <div className="text-xs font-semibold text-[#F8F9FC] font-mono-data">{job.resourceUsage.cpu}%</div>
              </div>
              <div className="bg-[#1A1A20] rounded p-2">
                <div className="text-[10px] text-[#595962] flex items-center gap-1"><HardDrive className="w-2.5 h-2.5" /> Mem</div>
                <div className="text-xs font-semibold text-[#F8F9FC] font-mono-data">{job.resourceUsage.memory}%</div>
              </div>
              <div className="bg-[#1A1A20] rounded p-2">
                <div className="text-[10px] text-[#595962]">Retries</div>
                <div className="text-xs font-semibold text-[#F8F9FC] font-mono-data">{job.retries}/{job.maxRetries}</div>
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#595962] font-mono-data">{job.type.replace('_', ' ')}</span>
              <span className="text-[#595962] font-mono-data capitalize">{job.isolationLevel} isolation</span>
            </div>

            {job.output && (
              <div className="mt-2 p-2 bg-[#00FFB2]/5 rounded border border-[#00FFB2]/10">
                <span className="text-[11px] text-[#00FFB2]">{job.output}</span>
              </div>
            )}
            {job.error && (
              <div className="mt-2 p-2 bg-[#FF4D6A]/5 rounded border border-[#FF4D6A]/10">
                <span className="text-[11px] text-[#FF4D6A]">{job.error}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
