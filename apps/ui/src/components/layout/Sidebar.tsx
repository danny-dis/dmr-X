import { ChevronLeft, ChevronRight } from 'lucide-react';
import * as React from 'react';
import { NavLink, useLocation } from 'react-router';

import { Button } from '@/components/primitives/Button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/primitives/Tooltip';
import { NAV_GROUPS } from '@/constants/nav';
import { useMediaQuery } from '@/hooks/useMisc';
import { BrandMark, BrandWordmark } from '@/icons/SidebarIcons';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/store/useUIStore';

export function Sidebar() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggle = useUIStore((s) => s.toggleSidebar);
  const location = useLocation();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const expanded = !collapsed && isDesktop;

  return (
    <aside
      className={cn(
        'h-full shrink-0 flex-col border-r border-border bg-surface-1/60 backdrop-blur transition-[width] duration-200 ease-out flex',
        collapsed ? 'w-16' : 'w-16 lg:w-60'
      )}
    >
      <div className={cn('flex items-center gap-2.5 border-b border-border', expanded ? 'justify-start px-4 py-4' : 'justify-center px-2 py-4')}>
        <BrandMark size={28} className="shrink-0" />
        {expanded && <BrandWordmark height={20} className="shrink-0" />}
      </div>

      <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-2 py-3">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.label} className={cn(gi > 0 ? 'mt-3' : '', 'mb-2')}>
            {expanded && (
              <div className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
                {group.label}
              </div>
            )}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
                const link = (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === '/'}
                    className={cn(
                      'group/nav flex items-center gap-2.5 rounded-md transition-all relative text-xs',
                      expanded ? 'h-8 justify-start px-2.5' : 'h-9 justify-center px-2',
                      isActive
                        ? 'bg-primary/[0.08] text-primary'
                        : 'text-fg-muted hover:text-fg hover:bg-surface-2'
                    )}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-full bg-primary" />
                    )}
                    <item.icon className="size-4 shrink-0" />
                    {expanded && <span className="truncate">{item.label}</span>}
                    {expanded && item.badge && (
                      <span className="ml-auto text-[9px] text-fg-subtle">{item.badge}</span>
                    )}
                  </NavLink>
                );
                if (!expanded) {
                  return (
                    <li key={item.path}>
                      <Tooltip>
                        <TooltipTrigger asChild>{link}</TooltipTrigger>
                        <TooltipContent side="right">{item.label}</TooltipContent>
                      </Tooltip>
                    </li>
                  );
                }
                return <li key={item.path}>{link}</li>;
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-2">
        <Button
          size="sm"
          variant="ghost"
          className={cn('w-full', expanded ? 'justify-start' : 'justify-center')}
          onClick={toggle}
          aria-label="Toggle sidebar"
        >
          {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronLeft className="size-3.5" />}
          {expanded && <span>Collapse</span>}
        </Button>
      </div>
    </aside>
  );
}
