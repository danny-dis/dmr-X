import * as React from 'react';
import { Sparkles, Search } from 'lucide-react';

import { Admin } from '@/lib/admin';
import { Badge, Button, Card, Input } from '@/components/primitives';
import { cn } from '@/lib/utils';
import type { CapabilityTab } from '@/lib/playgroundCaps';

import { EmptyHint, JsonView, PanelError, PanelLoading, useAsync } from './PanelShell';

interface SkillItem {
  id: string;
  name?: string;
  description?: string;
  category?: string;
  tags?: string[];
  [k: string]: unknown;
}

export function SkillsPanel({ tab }: { tab: CapabilityTab }) {
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [selected, setSelected] = React.useState<SkillItem | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const list = useAsync<SkillItem[]>(
    () => Admin.listSkills(debounced || undefined) as Promise<SkillItem[]>,
    [debounced],
  );
  const detail = useAsync<SkillItem | null>(
    () => (selected ? Admin.getSkill(selected.id) as Promise<SkillItem> : Promise.resolve(null)),
    [selected?.id],
  );

  return (
    <div className="flex h-full gap-4">
      <div className="flex w-80 shrink-0 flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search skills…"
            className="pl-8"
          />
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-auto">
          {list.loading ? <PanelLoading /> : list.error ? <PanelError error={list.error} onRetry={list.refetch} /> : (list.data ?? []).length === 0 ? <EmptyHint>No skills match “{debounced}”.</EmptyHint> : (list.data ?? []).map((s) => (
            <button key={s.id} onClick={() => setSelected(s)} className={cn('w-full rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/40', selected?.id === s.id ? 'border-primary/50 bg-primary/5' : 'bg-surface-1')}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-fg">{s.name ?? s.id}</span>
                {s.category ? <Badge tone="muted" size="sm" variant="soft">{s.category}</Badge> : null}
              </div>
              {s.description ? <p className="mt-1 line-clamp-2 text-xs text-fg-subtle">{s.description}</p> : null}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {selected ? (
          <Card className="h-full overflow-auto p-4">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              <h3 className="text-sm font-semibold text-fg">{selected.name ?? selected.id}</h3>
              <Badge tone="muted" size="sm" variant="soft" className="font-mono">{selected.id}</Badge>
            </div>
            {selected.description ? <p className="mb-3 text-sm text-fg-muted">{selected.description}</p> : null}
            {Array.isArray(selected.tags) && selected.tags.length ? (
              <div className="mb-3 flex flex-wrap gap-1">
                {selected.tags.map((t) => <Badge key={t} tone="info" size="sm" variant="soft">{t}</Badge>)}
              </div>
            ) : null}
            {detail.loading ? <PanelLoading label="Loading skill detail…" /> : detail.error ? <PanelError error={detail.error} /> : detail.data ? <JsonView value={detail.data} /> : <EmptyHint>Skill detail unavailable.</EmptyHint>}
          </Card>
        ) : (
          <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border">
            <EmptyHint>Search and select a skill to inspect it.</EmptyHint>
          </div>
        )}
      </div>
    </div>
  );
}
