import { useState } from 'react';
import { useTelemetryEvents } from '@/hooks/useApiData';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ErrorBanner';
import { Radio, Search, Terminal, AlertTriangle, Info, Bug } from 'lucide-react';

const levels = ['all', 'info', 'warning', 'error', 'debug'];
const services = ['all', 'router', 'gateway', 'provider', 'quota', 'memory', 'benchmark', 'scheduler', 'sandbox', 'billing', 'federation'];

export default function Telemetry() {
  const { events: telemetryEvents, error } = useTelemetryEvents();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterLevel, setFilterLevel] = useState('all');
  const [filterService, setFilterService] = useState('all');

  const filtered = telemetryEvents.filter((e) => {
    if (filterLevel !== 'all' && e.level !== filterLevel) return false;
    if (filterService !== 'all' && e.service !== filterService) return false;
    if (searchQuery && !e.message.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#F8F9FC]">Telemetry</h1>
          <p className="text-xs text-[#595962] mt-0.5">Live observability and system traces</p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1A1A20] rounded-md border border-[#27272E]">
          <Radio className="w-3.5 h-3.5 text-[#FF4D6A] animate-pulse" />
          <span className="text-[11px] text-[#FF4D6A] font-mono-data">STREAMING</span>
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
            placeholder="Search events..."
            className="bg-transparent text-xs text-[#F8F9FC] placeholder-[#595962] outline-none flex-1"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {levels.map((l) => (
            <button
              key={l}
              onClick={() => setFilterLevel(l)}
              className={cn(
                'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border capitalize',
                filterLevel === l
                  ? 'bg-[#F7A51C]/10 border-[#F7A51C]/30 text-[#F7A51C]'
                  : 'bg-[#0F0F12] border-[#27272E] text-[#595962] hover:text-[#A6A6B0]'
              )}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="flex gap-1 flex-wrap">
          {services.slice(0, 6).map((s) => (
            <button
              key={s}
              onClick={() => setFilterService(s)}
              className={cn(
                'px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border capitalize',
                filterService === s
                  ? 'bg-[#00E0FF]/10 border-[#00E0FF]/30 text-[#00E0FF]'
                  : 'bg-[#0F0F12] border-[#27272E] text-[#595962] hover:text-[#A6A6B0]'
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Terminal-like view */}
      <div className="glass-card rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2 bg-[#0A0A0C] border-b border-[#27272E]">
          <Terminal className="w-3.5 h-3.5 text-[#595962]" />
          <span className="text-[11px] text-[#595962] font-mono-data">dmrx-telemetry.log</span>
        </div>
        <div className="divide-y divide-[#27272E]/20 max-h-[600px] overflow-y-auto">
          {filtered.map((event) => (
            <div
              key={event.id}
              className={cn(
                'px-4 py-2.5 hover:bg-[#1A1A20] transition-colors',
                event.level === 'error' && 'bg-[#FF4D6A]/5',
                event.level === 'warning' && 'bg-[#F7A51C]/5',
              )}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5">
                  {event.level === 'info' && <Info className="w-3.5 h-3.5 text-[#00E0FF]" />}
                  {event.level === 'warning' && <AlertTriangle className="w-3.5 h-3.5 text-[#F7A51C]" />}
                  {event.level === 'error' && <AlertTriangle className="w-3.5 h-3.5 text-[#FF4D6A]" />}
                  {event.level === 'debug' && <Bug className="w-3.5 h-3.5 text-[#595962]" />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[11px] text-[#595962] font-mono-data">{new Date(event.timestamp).toLocaleTimeString()}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1A1A20] text-[#A6A6B0] font-mono-data uppercase">
                      {event.service}
                    </span>
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded font-mono-data uppercase font-medium',
                      event.level === 'info' && 'bg-[#00E0FF]/10 text-[#00E0FF]',
                      event.level === 'warning' && 'bg-[#F7A51C]/10 text-[#F7A51C]',
                      event.level === 'error' && 'bg-[#FF4D6A]/10 text-[#FF4D6A]',
                      event.level === 'debug' && 'bg-[#595962]/10 text-[#595962]',
                    )}>
                      {event.level}
                    </span>
                    {event.traceId && (
                      <span className="text-[10px] text-[#595962] font-mono-data">{event.traceId}</span>
                    )}
                  </div>
                  <p className="text-xs text-[#A6A6B0]">{event.message}</p>
                  {event.duration && (
                    <span className="text-[10px] text-[#595962] font-mono-data mt-0.5 block">
                      duration: {event.duration}ms
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
