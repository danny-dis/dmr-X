import * as React from 'react';
import { Database, Search, Cpu, Filter, ChevronRight, Hash, DollarSign, Zap } from 'lucide-react';
import { PageHeader, PageContainer } from '@/components/layout';
import { Card } from '@/components/primitives/Card';
import { Input } from '@/components/primitives/Input';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Skeleton } from '@/components/primitives/Skeleton';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Pagination } from '@/components/primitives/Pagination';
import { ModalityBadge } from '@/icons/Modality';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { ModelDetailDrawer } from '@/components/domain/ModelDetailDrawer';
import type { ApiModel, ApiProvider } from '@/types/api';

export function ModelsPage() {
  const [query, setQuery] = React.useState('');
  const [modality, setModality] = React.useState<string | null>(null);
  const [providerFilter, setProviderFilter] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(1);
  const [selectedModel, setSelectedModel] = React.useState<ApiModel | null>(null);
  const pageSize = 24;

  const models = useApiData<ApiModel[]>(() => Admin.listModels(), [], { refetchInterval: 60000 });
  const providers = useApiData<ApiProvider[]>(() => Admin.listProviders(), [], { refetchInterval: 60000 });

  const filtered = (models.data ?? []).filter((m) => {
    if (query && !m.name.toLowerCase().includes(query.toLowerCase())) return false;
    if (modality && m.modality !== modality) return false;
    if (providerFilter && m.providerId !== providerFilter) return false;
    return true;
  });

  const modalities = Array.from(new Set((models.data ?? []).map((m) => m.modality).filter(Boolean)));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Models"
        description="Model registry — all models available across all providers"
        icon={<Database className="size-5" />}
        actions={
          <Badge tone="muted" size="md" icon={<Cpu className="size-3" />}>
            {filtered.length} models
          </Badge>
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
                {p.name}
              </option>
            ))}
          </select>
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
            {paged.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelectedModel(m)}
                className="group flex flex-col gap-2 p-4 text-left hover:bg-surface-2 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-fg font-mono truncate">{m.name}</h4>
                  <ChevronRight className="size-3.5 text-fg-subtle opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <Badge tone="muted" size="sm">{m.provider ?? 'unknown'}</Badge>
                  {m.modality && <ModalityBadge modality={m.modality} size="sm" />}
                </div>
                <div className="grid grid-cols-3 gap-2 text-[10px] text-fg-muted">
                  <div>
                    <div className="text-fg-subtle">Context</div>
                    <div className="text-fg tabular-nums">{formatNumber(m.contextWindow ?? 0, true)}</div>
                  </div>
                  <div>
                    <div className="text-fg-subtle">In/Out</div>
                    <div className="text-fg tabular-nums">
                      ${m.inputCostPer1k?.toFixed(3) ?? '—'} / ${m.outputCostPer1k?.toFixed(3) ?? '—'}
                    </div>
                  </div>
                  <div>
                    <div className="text-fg-subtle">Tier</div>
                    <div className="text-fg">{m.tier ?? 'standard'}</div>
                  </div>
                </div>
              </button>
            ))}
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
    </PageContainer>
  );
}
