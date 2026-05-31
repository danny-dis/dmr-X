import { useStore } from '@/store/useStore';
import { cn } from '@/lib/utils';
import { Search, Command, Cpu, Activity, Bell } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useDashboardStats, useTenants } from '@/hooks/useApiData';

export default function Topbar() {
  const { sidebarCollapsed, setCommandPaletteOpen } = useStore();
  const [time, setTime] = useState(new Date());
  const { stats } = useDashboardStats();
  const { tenants } = useTenants();

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const envLabel = import.meta.env.MODE === 'production' ? 'Production' : 'Development';
  const tenantName = tenants.length > 0 ? tenants[0].name : 'Local';

  return (
    <header
      className={cn(
        'fixed top-0 right-0 h-14 bg-[#0A0A0C]/80 backdrop-blur-xl border-b border-[#27272E] z-30 flex items-center justify-between px-4 transition-all duration-300',
        sidebarCollapsed ? 'left-[80px]' : 'left-[260px]'
      )}
    >
      {/* Left: Search */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-[#1A1A20] border border-[#27272E] rounded-md text-[#595962] hover:text-[#A6A6B0] hover:border-[#3a3a44] transition-all min-w-[280px]"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="text-xs">Search anything...</span>
          <div className="ml-auto flex items-center gap-0.5">
            <kbd className="text-[10px] bg-[#0A0A0C] px-1.5 py-0.5 rounded border border-[#27272E] font-mono-data">
              <Command className="w-2.5 h-2.5 inline" />
            </kbd>
            <kbd className="text-[10px] bg-[#0A0A0C] px-1.5 py-0.5 rounded border border-[#27272E] font-mono-data">K</kbd>
          </div>
        </button>
      </div>

      {/* Right: Status + Tenant + Time */}
      <div className="flex items-center gap-4">
        {/* API Status */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#1A1A20] rounded-md border border-[#27272E]">
          <Activity className="w-3.5 h-3.5 text-[#00FFB2]" />
          <span className="text-[11px] text-[#00FFB2] font-mono-data">API LIVE</span>
          <span className="text-[#595962] text-[11px] font-mono-data">{stats.avgLatency}ms</span>
        </div>

        {/* Environment */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#1A1A20] rounded-md border border-[#27272E]">
          <Cpu className="w-3.5 h-3.5 text-[#F7A51C]" />
          <span className="text-[11px] text-[#A6A6B0] font-medium">{envLabel}</span>
        </div>

        {/* Tenant */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#1A1A20] rounded-md border border-[#27272E]">
          <div className="w-5 h-5 rounded bg-[#F7A51C]/20 flex items-center justify-center">
            <span className="text-[10px] font-bold text-[#F7A51C]">{tenantName[0]}</span>
          </div>
          <span className="text-[11px] text-[#F8F9FC] font-medium">{tenantName}</span>
        </div>

        {/* Notifications */}
        <button className="relative p-2 text-[#A6A6B0] hover:text-[#F8F9FC] transition-colors">
          <Bell className="w-4 h-4" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-[#FF4D6A] rounded-full" />
        </button>

        {/* Clock */}
        <div className="text-[11px] text-[#595962] font-mono-data tabular-nums">
          {time.toISOString().replace('T', ' ').substring(0, 19)} UTC
        </div>
      </div>
    </header>
  );
}
