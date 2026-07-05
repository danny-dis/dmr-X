import {
  Box,
  Cpu,
  CornerDownLeft,
} from 'lucide-react';
import * as React from 'react';
import { useNavigate } from 'react-router';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/primitives/Command';
import { Dialog, DialogContent, DialogTitle } from '@/components/primitives/Dialog';
import { Kbd } from '@/components/primitives/Kbd';
import { NAV_GROUPS } from '@/constants/nav';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/store/useUIStore';
import type { ApiProvider, ApiModel } from '@/types/api';

export function CommandPalette() {
  const navigate = useNavigate();
  const open = useUIStore((s) => s.commandPaletteOpen);
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const recentPages = useUIStore((s) => s.recentPages);

  const providers = useApiData<ApiProvider[]>(
    () => Admin.listProviders(),
    [],
    { refetchInterval: 60_000, enabled: open }
  );
  const models = useApiData<ApiModel[]>(
    () => Admin.listModels(),
    [],
    { refetchInterval: 60_000, enabled: open }
  );

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!useUIStore.getState().commandPaletteOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  const go = React.useCallback(
    (path: string) => {
      setOpen(false);
      navigate(path);
    },
    [navigate, setOpen]
  );

  const recentNav = recentPages
    .filter((r) => r.path !== '/')
    .slice(0, 5)
    .map((r) => {
      const found = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.path === r.path);
      return found ? { item: found, at: r.at } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        size="2xl"
        showClose={false}
        className={cn(
          'left-1/2 top-[18vh] -translate-x-1/2 translate-y-0',
          'p-0 gap-0 overflow-hidden'
        )}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command shouldFilter label="Global navigation">
          <CommandInput placeholder="Search pages, providers, models…" autoFocus />
          <CommandList className="max-h-[60vh]">
            <CommandEmpty>No results found.</CommandEmpty>

            {recentNav.length > 0 && (
              <CommandGroup heading="Recent">
                {recentNav.map(({ item, at }) => {
                  const Icon = item.icon;
                  return (
                    <CommandItem
                      key={`recent-${item.path}`}
                      value={`recent ${item.label}`}
                      onSelect={() => go(item.path)}
                    >
                      <Icon className="size-3.5 text-fg-muted" />
                      <span className="flex-1 truncate">{item.label}</span>
                      <span className="text-[10px] text-fg-subtle">
                        {timeAgo(at)}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            <CommandGroup heading="Navigation">
              {NAV_GROUPS.flatMap((group) =>
                group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <CommandItem
                      key={item.path}
                      value={`nav ${group.label} ${item.label}`}
                      onSelect={() => go(item.path)}
                    >
                      <Icon className="size-3.5 text-fg-muted" />
                      <span className="flex-1 truncate">{item.label}</span>
                      <span className="text-[10px] text-fg-subtle truncate max-w-[200px]">
                        {item.description}
                      </span>
                    </CommandItem>
                  );
                })
              )}
            </CommandGroup>

            <CommandSeparator />

            {providers.data && providers.data.length > 0 && (
              <CommandGroup heading="Providers">
                {providers.data.slice(0, 6).map((p) => (
                  <CommandItem
                    key={p.id}
                    value={`provider ${p.name} ${p.id}`}
                    onSelect={() => go(`/providers`)}
                  >
                    <Box className="size-3.5 text-fg-muted" />
                    <span className="flex-1 truncate">{p.name}</span>
                    <span className="text-[10px] text-fg-subtle font-mono">
                      {p.id.slice(0, 8)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {models.data && models.data.length > 0 && (
              <CommandGroup heading="Models">
                {models.data.slice(0, 8).map((m) => (
                  <CommandItem
                    key={m.id}
                    value={`model ${m.name} ${m.provider ?? ''} ${m.id}`}
                    onSelect={() => go(`/models`)}
                  >
                    <Cpu className="size-3.5 text-fg-muted" />
                    <span className="flex-1 truncate font-mono">{m.name}</span>
                    <span className="text-[10px] text-fg-subtle truncate max-w-[160px]">
                      {m.provider ?? '—'}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>

          <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2 text-[10px] text-fg-subtle">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <CornerDownLeft className="size-3" />
                open
              </span>
              <span className="flex items-center gap-1">
                <Kbd>esc</Kbd>
                close
              </span>
            </div>
            <span className="flex items-center gap-1">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}
