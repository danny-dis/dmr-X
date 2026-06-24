import { Search, Bell, Sun, Moon, Activity } from 'lucide-react';
import * as React from 'react';
import { useLocation } from 'react-router';

import { Button } from '@/components/primitives/Button';
import { Kbd } from '@/components/primitives/Kbd';
import { findNavItem } from '@/constants/nav';
import { useApiData } from '@/hooks/useApiData';
import { HealthDot } from '@/icons/Status';
import { Admin } from '@/lib/admin';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/store/useUIStore';
import type { ApiHealthResponse } from '@/types/api';

export function Topbar() {
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const liveMode = useUIStore((s) => s.liveMode);
  const setLiveMode = useUIStore((s) => s.setLiveMode);
  const location = useLocation();
  const page = findNavItem(location.pathname);
  const { data: health } = useApiData<ApiHealthResponse>(
    () => Admin.health(),
    [],
    { refetchInterval: 10_000 }
  );

  const statusColor =
    health?.status === 'ok' || health?.status === 'operational'
      ? '#34D399'
      : health?.status === 'degraded'
        ? '#FBBF24'
        : '#F87171';

  return (
    <header className="flex h-14 items-center gap-2 border-b border-border bg-surface-1/40 px-3 backdrop-blur sm:gap-3 sm:px-5">
      <div className="flex min-w-0 flex-1 items-center gap-2 md:flex-none">
        {page && (
          <>
            <page.icon className="size-4 text-fg-muted shrink-0" />
            <h1 className="text-sm font-semibold text-fg truncate">{page.label}</h1>
            {page.description && (
              <span className="text-[11px] text-fg-muted hidden sm:inline truncate">· {page.description}</span>
            )}
          </>
        )}
      </div>

      <div className="mx-auto hidden max-w-md flex-1 md:block">
        <button
          onClick={() => setCommandPaletteOpen(true)}
          className={cn(
            'w-full flex items-center gap-2 h-8 px-3 rounded-lg border border-border bg-surface-2/60 text-fg-muted text-xs',
            'hover:border-border-strong hover:text-fg transition-colors'
          )}
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left truncate">Search providers, models, requests…</span>
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <button
          onClick={() => setLiveMode(!liveMode)}
          className={cn(
            'flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors',
            liveMode
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-border bg-surface-2 text-fg-muted'
          )}
        >
          <Activity className="size-3" />
          <span className="hidden sm:inline">{liveMode ? 'Live' : 'Paused'}</span>
          {liveMode && <span className="size-1.5 rounded-full bg-success animate-pulse" />}
        </button>

        <div className="hidden h-7 items-center gap-1.5 rounded-md border border-border bg-surface-2/60 px-2 sm:flex">
          <HealthDot size={6} color={statusColor} />
          <span className="text-[11px] font-mono text-fg-muted">{health?.status ?? '—'}</span>
        </div>

        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        </Button>

        <Button size="icon-sm" variant="ghost" aria-label="Notifications">
          <Bell className="size-3.5" />
        </Button>

        <div className="size-7 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-[10px] font-semibold text-white">
          DX
        </div>
      </div>
    </header>
  );
}
