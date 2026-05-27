import { useState } from 'react';
import { useAuditEvents } from '@/hooks/useApiData';
import { cn } from '@/lib/utils';
import { ErrorBanner } from '@/components/ErrorBanner';
import { ScrollText, Search, Route, ShieldCheck, Gauge, Zap, UserCog, Settings, KeyRound } from 'lucide-react';

const eventIcons: Record<string, typeof Route> = {
  routing: Route,
  policy: ShieldCheck,
  quota: Gauge,
  provider_call: Zap,
  fallback: Zap,
  admin: UserCog,
  config: Settings,
  key_rotation: KeyRound,
};

const eventColors: Record<string, string> = {
  routing: 'text-[#00E0FF]',
  policy: 'text-[#F7A51C]',
  quota: 'text-[#F7A51C]',
  provider_call: 'text-[#00FFB2]',
  fallback: 'text-[#FF4D6A]',
  admin: 'text-[#A6A6B0]',
  config: 'text-[#595962]',
  key_rotation: 'text-[#00E0FF]',
};

const severityFilters = ['all', 'info', 'warning', 'error', 'critical'];

export default function AuditLogs() {
  const { events: auditEvents, error } = useAuditEvents();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('all');

  const filtered = auditEvents.filter((e) => {
    if (filterSeverity !== 'all' && e.severity !== filterSeverity) return false;
    if (searchQuery && !e.description.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#F8F9FC]">Audit Logs</h1>
          <p className="text-xs text-[#595962] mt-0.5">Complete audit trail of all system events</p>
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
            placeholder="Search audit log..."
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

      {/* Timeline */}
      <div className="glass-card rounded-xl overflow-hidden">
        <div className="p-3 bg-[#0A0A0C] border-b border-[#27272E] flex items-center gap-2">
          <ScrollText className="w-3.5 h-3.5 text-[#595962]" />
          <span className="text-[11px] text-[#595962] font-mono-data">{filtered.length} events</span>
        </div>
        <div className="divide-y divide-[#27272E]/20 max-h-[600px] overflow-y-auto">
          {filtered.map((event) => {
            const Icon = eventIcons[event.eventType] || ScrollText;
            return (
              <div key={event.id} className="px-4 py-3 hover:bg-[#1A1A20] transition-colors">
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-md bg-[#1A1A20] flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Icon className={cn('w-3.5 h-3.5', eventColors[event.eventType])} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs text-[#F8F9FC] font-medium">{event.description}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="text-[#595962] font-mono-data">{new Date(event.timestamp).toLocaleTimeString()}</span>
                      <span className="text-[#27272E]">|</span>
                      <span className="text-[#595962] font-mono-data uppercase">{event.eventType}</span>
                      <span className="text-[#27272E]">|</span>
                      <span className={cn(
                        'font-medium',
                        event.severity === 'critical' && 'text-[#FF4D6A]',
                        event.severity === 'error' && 'text-[#FF4D6A]',
                        event.severity === 'warning' && 'text-[#F7A51C]',
                        event.severity === 'info' && 'text-[#00FFB2]',
                      )}>{event.severity}</span>
                      <span className="text-[#27272E]">|</span>
                      <span className="text-[#595962]">{event.actor}</span>
                      {event.ipAddress && (
                        <>
                          <span className="text-[#27272E]">|</span>
                          <span className="text-[#595962] font-mono-data">{event.ipAddress}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
