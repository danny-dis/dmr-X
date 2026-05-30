import { useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '@/store/useStore';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, Route, Database, Gauge,
  CreditCard, Brain, BarChart3, Radio, Globe,
  Box, Timer, ShieldCheck, Users, ScrollText,
  Bell, Settings, Key, Layers, ChevronLeft, ChevronRight,
  MessageSquare, Sparkles
} from 'lucide-react';

const navItems = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, path: '/' },
  { id: 'routing', label: 'Routing Console', icon: Route, path: '/routing' },
  { id: 'models', label: 'Model Catalog', icon: Brain, path: '/models' },
  { id: 'providers', label: 'Provider Registry', icon: Database, path: '/providers' },
  { id: 'free-tier', label: 'Free Tier', icon: Sparkles, path: '/free-tier' },
  { id: 'quota', label: 'Quota Manager', icon: Gauge, path: '/quota' },
  { id: 'billing', label: 'Billing Center', icon: CreditCard, path: '/billing' },
  { id: 'memory', label: 'Memory Center', icon: Layers, path: '/memory' },
  { id: 'benchmarks', label: 'Benchmark Lab', icon: BarChart3, path: '/benchmarks' },
  { id: 'telemetry', label: 'Telemetry', icon: Radio, path: '/telemetry' },
  { id: 'federation', label: 'Federation', icon: Globe, path: '/federation' },
  { id: 'playground', label: 'Playground', icon: MessageSquare, path: '/playground' },
  { id: 'sandbox', label: 'Sandbox', icon: Box, path: '/sandbox' },
  { id: 'scheduler', label: 'Scheduler', icon: Timer, path: '/scheduler' },
  { id: 'policies', label: 'Policy Engine', icon: ShieldCheck, path: '/policies' },
  { id: 'tenants', label: 'Tenants', icon: Users, path: '/tenants' },
  { id: 'audit', label: 'Audit Logs', icon: ScrollText, path: '/audit' },
  { id: 'alerts', label: 'Alerts', icon: Bell, path: '/alerts' },
  { id: 'keys', label: 'Provider Keys', icon: Key, path: '/keys' },
  { id: 'settings', label: 'Settings', icon: Settings, path: '/settings' },
];

export default function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, setCurrentPage } = useStore();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-screen bg-[#0A0A0C] border-r border-[#27272E] z-40 flex flex-col transition-all duration-300 ease-[cubic-bezier(0.165,0.84,0.44,1)]',
        sidebarCollapsed ? 'w-[80px]' : 'w-[260px]'
      )}
    >
      {/* Logo */}
      <div className="h-14 flex items-center px-4 border-b border-[#27272E] relative">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-8 h-8 rounded bg-[#F7A51C] flex items-center justify-center flex-shrink-0">
            <Route className="w-4 h-4 text-[#060608]" />
          </div>
          {!sidebarCollapsed && (
            <div className="transition-opacity duration-200">
              <div className="text-[#F8F9FC] font-semibold text-sm tracking-tight">DMR-X</div>
              <div className="text-[#595962] text-[10px] font-mono-data">v2.4.1</div>
            </div>
          )}
        </div>
        <button
          onClick={toggleSidebar}
          className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-[#1A1A20] border border-[#27272E] rounded-full flex items-center justify-center hover:border-[#F7A51C] transition-colors"
        >
          {sidebarCollapsed ? (
            <ChevronRight className="w-3 h-3 text-[#A6A6B0]" />
          ) : (
            <ChevronLeft className="w-3 h-3 text-[#A6A6B0]" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        <div className="space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setCurrentPage(item.id);
                  navigate(item.path);
                }}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 group relative',
                  isActive
                    ? 'text-[#F7A51C] bg-[#F7A51C]/10'
                    : 'text-[#A6A6B0] hover:text-[#F8F9FC] hover:bg-[#1A1A20]'
                )}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-[#F7A51C] rounded-r" />
                )}
                <Icon className={cn('w-4 h-4 flex-shrink-0', isActive && 'text-[#F7A51C]')} />
                {!sidebarCollapsed && (
                  <span className="truncate transition-opacity duration-200">{item.label}</span>
                )}
                {!sidebarCollapsed && item.badge && (
                  <span className="ml-auto bg-[#FF4D6A]/20 text-[#FF4D6A] text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
                    {item.badge}
                  </span>
                )}
                {sidebarCollapsed && item.badge && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-[#FF4D6A] rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Bottom Status */}
      <div className="p-3 border-t border-[#27272E]">
        <div className={cn('flex items-center gap-2', sidebarCollapsed && 'justify-center')}>
          <div className="w-2 h-2 rounded-full bg-[#00FFB2] pulse-ring-amber" />
          {!sidebarCollapsed && (
            <span className="text-[11px] text-[#A6A6B0] font-mono-data">SYSTEM ONLINE</span>
          )}
        </div>
      </div>
    </aside>
  );
}
