import { Layers, Plus, Trash2, GripVertical, Zap, Server, Brain, Timer, ArrowUpDown } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatTile } from '@/components/primitives/StatTile';
import { toast } from '@/components/primitives/Toast';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { ApiProvider, ApiCatalogEntry } from '@/types/api';

interface FusionSlot {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
}

export function FusionPanelPage() {
  const [slots, setSlots] = React.useState<FusionSlot[]>([]);
  const [selectedProvider, setSelectedProvider] = React.useState<string>('');
  const [selectedModel, setSelectedModel] = React.useState<string>('');

  const providers = useApiData<ApiProvider[]>(() => Admin.listProviders(), [], { refetchInterval: 30000 });
  const catalog = useApiData<{ entries: ApiCatalogEntry[] }>(
    () => Admin.getCatalog(),
    [],
    { refetchInterval: 60000 }
  );

  const catalogEntries = catalog.data?.entries ?? [];
  const enabledProviders = (providers.data ?? []).filter(p => p.enabled);

  const availableModels = React.useMemo(() => {
    if (!selectedProvider) return [];
    const provider = enabledProviders.find(p => p.id === selectedProvider);
    if (!provider) return [];
    return provider.models ?? [];
  }, [selectedProvider, enabledProviders]);

  const addSlot = () => {
    if (!selectedProvider || !selectedModel) {
      toast.error('Select a provider and model');
      return;
    }
    const provider = enabledProviders.find(p => p.id === selectedProvider);
    const model = provider?.models?.find(m => m.id === selectedModel);
    if (!provider || !model) return;

    const newSlot: FusionSlot = {
      id: `${Date.now()}`,
      providerId: provider.name,
      modelId: model.id,
      displayName: `${provider.name} / ${model.id}`,
    };
    setSlots(prev => [...prev, newSlot]);
    setSelectedProvider('');
    setSelectedModel('');
    toast.success(`Added ${newSlot.displayName}`);
  };

  const removeSlot = (id: string) => {
    setSlots(prev => prev.filter(s => s.id !== id));
  };

  const moveSlot = (id: string, direction: 'up' | 'down') => {
    setSlots(prev => {
      const idx = prev.findIndex(s => s.id === id);
      if (idx < 0) return prev;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[newIdx]] = [arr[newIdx]!, arr[idx]!];
      return arr;
    });
  };

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Fusion Panel"
        description="Pick multiple models for parallel execution with diversity"
        icon={<Layers className="size-5" />}
        actions={
          <Badge tone="primary" size="md">
            {slots.length} slots configured
          </Badge>
        }
      />

      <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label="Slots"
          value={slots.length}
          icon={<Layers className="size-3.5" />}
          hint="models in fusion panel"
        />
        <StatTile
          label="Providers"
          value={new Set(slots.map(s => s.providerId)).size}
          icon={<Server className="size-3.5" />}
          tone="success"
          hint="unique providers"
        />
        <StatTile
          label="Available"
          value={enabledProviders.length}
          icon={<Zap className="size-3.5" />}
          tone="primary"
          hint="enabled providers"
        />
        <StatTile
          label="Mode"
          value="Parallel"
          icon={<ArrowUpDown className="size-3.5" />}
          tone="accent"
          hint="execution strategy"
        />
      </div>

      {/* Add Model Slot */}
      <div className="mt-4">
        <Card padding="md">
          <h3 className="text-sm font-semibold text-fg mb-3">Add Model Slot</h3>
          <div className="flex items-center gap-3">
            <Select value={selectedProvider} onValueChange={(v) => { setSelectedProvider(v); setSelectedModel(''); }}>
              <SelectTrigger className="w-48 h-9">
                <SelectValue placeholder="Select provider…" />
              </SelectTrigger>
              <SelectContent>
                {enabledProviders.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedModel} onValueChange={setSelectedModel} disabled={!selectedProvider}>
              <SelectTrigger className="w-60 h-9" disabled={!selectedProvider}>
                <SelectValue placeholder="Select model…" />
              </SelectTrigger>
              <SelectContent>
                {availableModels.map(m => (
                  <SelectItem key={m.id} value={m.id}>{m.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={addSlot} disabled={!selectedProvider || !selectedModel}>
              <Plus className="size-3" />
              Add Slot
            </Button>
          </div>
        </Card>
      </div>

      {/* Configured Slots */}
      <div className="mt-4">
        <Card padding="md">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-fg">Configured Slots</h3>
            <Badge tone="muted" size="sm">{slots.length} slots</Badge>
          </div>
          {slots.length === 0 ? (
            <EmptyState
              title="No slots configured"
              description="Add models above to create a fusion panel for diverse parallel execution."
            />
          ) : (
            <div className="space-y-2">
              {slots.map((slot, idx) => (
                <div
                  key={slot.id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border bg-surface-2/50"
                >
                  <GripVertical className="size-4 text-fg-subtle cursor-move" />
                  <div className="flex size-7 shrink-0 items-center justify-center rounded bg-primary/10 text-primary font-mono text-[10px] font-bold">
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-fg truncate">{slot.displayName}</p>
                    <p className="text-[10px] text-fg-muted">{slot.providerId} · {slot.modelId}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => moveSlot(slot.id, 'up')}
                      disabled={idx === 0}
                    >
                      ↑
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => moveSlot(slot.id, 'down')}
                      disabled={idx === slots.length - 1}
                    >
                      ↓
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => removeSlot(slot.id)}
                    >
                      <Trash2 className="size-3 text-danger" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* How It Works */}
      <div className="mt-4">
        <Card padding="md">
          <h3 className="text-sm font-semibold text-fg mb-2">How Fusion Panel Works</h3>
          <ul className="text-xs text-fg-muted space-y-1.5">
            <li>• Each slot is hard-pinned to one model — no silent substitution</li>
            <li>• Requests are distributed across slots for diversity</li>
            <li>• If a slot's model is rate-limited, it's skipped (not collapsed onto another)</li>
            <li>• Useful for A/B testing, redundancy, or ensuring model diversity</li>
            <li>• Combine with routing profiles for different fusion configurations</li>
          </ul>
        </Card>
      </div>
    </PageContainer>
  );
}
