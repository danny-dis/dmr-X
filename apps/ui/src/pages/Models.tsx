import { Database, Search, ChevronRight, RefreshCw, Plus, KeyRound, Key } from 'lucide-react';
import * as React from 'react';

import { CreateModelDialog } from '@/components/domain/CreateModelDialog';
import { ModelDetailDrawer } from '@/components/domain/ModelDetailDrawer';
import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Input } from '@/components/primitives/Input';
import { Pagination } from '@/components/primitives/Pagination';
import { Skeleton } from '@/components/primitives/Skeleton';
import { useApiData } from '@/hooks/useApiData';
import { ModalityBadge } from '@/icons/Modality';
import { Admin } from '@/lib/admin';
import { formatNumber } from '@/lib/formatters';
import type { ApiModel, ApiProvider } from '@/types/api';

const CAPABILITY_TIER_LABELS: Record<string, string> = {
  orchestrator: 'Orchestrator',
  brain: 'Brain',
  thinker: 'Thinker',
  executor: 'Executor',
  specialist: 'Specialist',
  worker: 'Worker',
  temp_worker: 'Temp Worker',
};

export function ModelsPage() {
  const [query, setQuery] = React.useState('');
  const [modality, setModality] = React.useState<string | null>(null);
  const [providerFilter, setProviderFilter] = React.useState<string | null>(null);
  const [layerFilter, setLayerFilter] = React.useState<string | null>(null);
  const [capabilityFilter, setCapabilityFilter] = React.useState<string | null>(null);
  const [showUnavailable, setShowUnavailable] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [selectedModel, setSelectedModel] = React.useState<ApiModel | null>(null);
  const [createModelOpen, setCreateModelOpen] = React.useState(false);
  const pageSize = 24;

  // Fetch all models (with provider_available flag from backend)
  const models = useApiData<ApiModel[]>(() => Admin.listModels({ available_only: showUnavailable ? 'false' : 'true' }), [], { refetchInterval: 30000 });
  const providers = useApiData<ApiProvider[]>(() => Admin.listProviders(), [], { refetchInterval: 30000 });

  // Build a lookup of provider key status
  const providerKeyStatus = React.useMemo(() => {
    const map = new Map<string, boolean>();
    for (const p of providers.data ?? []) {
      map.set(p.id, p.tier !== 'inactive');
    }
    return map;
  }, [providers.data]);

  const filtered = (models.data ?? []).filter((m) => {
    if (query && !m.name.toLowerCase().includes(query.toLowerCase())) return false;
    if (modality && m.modality !== modality) return false;
    if (providerFilter && m.provider_id !== providerFilter) return false;
    if (layerFilter && m.intelligence_layer !== layerFilter) return false;
    if (capabilityFilter && m.capability_tier !== capabilityFilter) return false;
    return true;
  });

  const modalities = Array.from(new Set((models.data ?? []).map((m) => m.modality).filter(Boolean)));
  const intelligenceLayers = Array.from(new Set((models.data ?? []).map((m) => m.intelligence_layer).filter(Boolean)));
  const capabilityTiers = ['orchestrator', 'brain', 'thinker', 'executor', 'specialist', 'worker', 'temp_worker'];
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const availableCount = (models.data ?? []).filter(m => providerKeyStatus.get(m.provider_id) !== false).length;
  const unavailableCount = (models.data ?? []).length - availableCount;

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Models"
        description="Model registry — models from providers with active API keys"
        icon={<Database className="size-5" />}
        actions={
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void models.refetch()}
              leftIcon={<RefreshCw className="size-3" />}
            >
              Discover
            </Button>
            <Button
              size="sm"
              onClick={() => setCreateModelOpen(true)}
              leftIcon={<Plus className="size-3" />}
            >
              New model
            </Button>
            <Badge tone="success" size="md" icon={<KeyRound className="size-3" />}>
              {availableCount} available
            </Badge>
            {unavailableCount > 0 && (
              <Badge tone="muted" size="md" icon={<Key className="size-3" />}>
                {unavailableCount} need key
              </Badge>
            )}
          </>
        }
      />

      <Card padding="none" className="mt-5">
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
          <div className="flex-1 max-w-sm">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models…"
              prefix={<Search className="size-3.5" />}
              size="sm"
            />
          </div>
          <select
            value={providerFilter ?? ''}
            onChange={(e) => setProviderFilter(e.target.value || null)}
            className="h-7 rounded-md border border-border bg-surface-2 px-2 text-[11px] text-fg"
          >
            <option value="">All providers</option>
            {(providers.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.tier === 'inactive' ? '(no key)' : ''}
              </option>
            ))}
          </select>
          {unavailableCount > 0 && (
            <button
              onClick={() => setShowUnavailable(!showUnavailable)}
              className={`h-7 px-2.5 rounded-md text-[11px] font-medium transition-colors ${
                showUnavailable
                  ? 'bg-warning/10 text-warning border border-warning/20'
                  : 'text-fg-muted hover:bg-surface-2 border border-transparent'
              }`}
              title={showUnavailable ? 'Hide models without keys' : 'Show models without keys'}
            >
              <Key className="size-3 inline mr-1" />
              {showUnavailable ? 'Hide' : 'Show'} unavailable
            </button>
          )}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setModality(null)}
              className={`h-7 px-2.5 rounded-md text-[11px] font-medium ${
                !modality ? 'bg-primary/10 text-primary' : 'text-fg-muted hover:bg-surface-2'
              }`}
            >
              all
            </button>
            {modalities.slice(0, 6).map((m) => (
              <button
                key={m}
                onClick={() => setModality(m === modality ? null : m)}
                className={`h-7 px-2.5 rounded-md text-[11px] font-medium ${
                  modality === m
                    ? 'bg-primary/10 text-primary border border-primary/20'
                    : 'text-fg-muted hover:bg-surface-2 border border-transparent'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 ml-2 pl-2 border-l border-border">
            <button
              onClick={() => setCapabilityFilter(null)}
              className={`h-7 px-2.5 rounded-md text-[11px] font-medium ${
                !capabilityFilter ? 'bg-primary/10 text-primary' : 'text-fg-muted hover:bg-surface-2'
              }`}
            >
              all tiers
            </button>
            {capabilityTiers.map((tier) => (
              <button
                key={tier}
                onClick={() => setCapabilityFilter(tier === capabilityFilter ? null : tier)}
                className={`h-7 px-2.5 rounded-md text-[11px] font-medium ${
                  capabilityFilter === tier
                    ? 'bg-primary/10 text-primary border border-primary/20'
                    : 'text-fg-muted hover:bg-surface-2 border border-transparent'
                }`}
              >
                {CAPABILITY_TIER_LABELS[tier] ?? tier}
              </button>
            ))}
          </div>
        </div>

        {models.isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="p-4">
                <Skeleton className="h-3 w-3/4 mb-2" />
                <Skeleton className="h-2 w-1/2 mb-2" />
                <Skeleton className="h-8 w-full" />
              </div>
            ))}
          </div>
        ) : paged.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
            {paged.map((m) => {
              const hasKey = providerKeyStatus.get(m.provider_id) !== false;
              return (
                <button
                  key={m.id}
                  onClick={() => setSelectedModel(m)}
                  className={`group flex flex-col gap-2 p-4 text-left hover:bg-surface-2 transition-colors ${
                    !hasKey ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-fg font-mono truncate">{m.name}</h4>
                    <div className="flex items-center gap-1">
                      {hasKey ? (
                        <KeyRound className="size-3 text-success" />
                      ) : (
                        <Key className="size-3 text-fg-subtle" />
                      )}
                      <ChevronRight className="size-3.5 text-fg-subtle opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <Badge tone={hasKey ? 'success' : 'muted'} size="sm">
                      {m.provider ?? 'unknown'}
                    </Badge>
                    {m.modality && <ModalityBadge modality={m.modality} size={14} />}
                  </div>
                <div className="grid grid-cols-3 gap-2 text-[10px] text-fg-muted">
                  <div>
                    <div className="text-fg-subtle">Context</div>
                    <div className="text-fg tabular-nums">{formatNumber(m.context_window ?? 0, true)}</div>
                  </div>
                  <div>
                    <div className="text-fg-subtle">In/Out</div>
                    <div className="text-fg tabular-nums">
                      ${m.input_cost_per_1k?.toFixed(3) ?? '—'} / ${m.output_cost_per_1k?.toFixed(3) ?? '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-fg-subtle">Tier</div>
                    <div className="text-fg">{m.tier ?? 'standard'}</div>
                  </div>
                </div>
              </button>
            );
            })}
          </div>
        ) : (
          <EmptyState
            title="No models"
            description="Connect a provider to populate the model registry."
          />
        )}

        {filtered.length > pageSize && (
          <div className="border-t border-border px-3 py-2.5">
            <Pagination
              page={page}
              totalPages={Math.ceil(filtered.length / pageSize)}
              onPageChange={setPage}
              total={filtered.length}
              pageSize={pageSize}
            />
          </div>
        )}
      </Card>

      <ModelDetailDrawer
        model={selectedModel}
        open={selectedModel !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedModel(null);
        }}
        onChanged={() => void models.refetch()}
      />

      <CreateModelDialog
        open={createModelOpen}
        onOpenChange={setCreateModelOpen}
        onCreated={() => void models.refetch()}
      />
    </PageContainer>
  );
}
