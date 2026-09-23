import {
  Boxes,
  CheckCircle2,
  Clock,
  TriangleAlert,
  MinusCircle,
  Plus,
  XCircle,
} from 'lucide-react';
import * as React from 'react';

import { AddProviderDialog } from '@/components/domain/AddProviderDialog';
import { ProviderCard } from '@/components/domain/ProviderCard';
import { ProviderDetailDrawer } from '@/components/domain/ProviderDetailDrawer';
import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import { Input } from '@/components/primitives/Input';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatTile } from '@/components/primitives/StatTile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { toast } from '@/components/primitives/Toast';
import { Pagination } from '@/components/primitives/Pagination';
import { useUrlState } from '@/hooks';
import { Admin } from '@/lib/admin';
import { useCatalog, useProviders } from '@/lib/queries/providers';
import { formatNumber } from '@/lib/formatters';
import { useUIStore } from '@/store/useUIStore';
import type { ApiCatalogEntry, ApiProvider } from '@/types/api';

export function ProvidersPage() {
  const [query, setQuery] = useUrlState('q', '');
  const [category, setCategory] = useUrlState<'all' | 'cloud' | 'local'>('category', 'all');
  const [selectedProvider, setSelectedProvider] = React.useState<ApiProvider | null>(null);
  const [addDialogOpen, setAddDialogOpen] = React.useState(false);
  const [selectedTemplate, setSelectedTemplate] = React.useState<ApiCatalogEntry | null>(null);
  const [suggestedName, setSuggestedName] = React.useState<string | null>(null);
  const [showAllCatalog, setShowAllCatalog] = React.useState(false);
  const [currentPage, setCurrentPage] = React.useState(1);
  const debounced = React.useDeferredValue(query);
  const PAGE_SIZE = 20;

  const providers = useProviders({ refetchInterval: 30_000 });
  const catalog = useCatalog({ refetchInterval: 60_000 });
  const favorites = useUIStore((s) => s.favoriteProviders);
  const toggleFav = useUIStore((s) => s.toggleFavoriteProvider);

  const filtered = (providers.data ?? []).filter((p) => {
    if (debounced && !`${p.name} ${p.baseUrl}`.toLowerCase().includes(debounced.toLowerCase())) return false;
    if (category === 'cloud' && p.local) return false;
    if (category === 'local' && !p.local) return false;
    return true;
  });
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginatedData = React.useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage]
  );

  React.useEffect(() => { setCurrentPage(1); }, [debounced, category]);

  const onTest = async (id: string) => {
    const promise = Admin.testProvider(id);
    toast.promise(promise, {
      loading: 'Testing provider…',
      success: (r) => r.ok ? `Provider healthy · ${Math.round(r.latencyMs)}ms` : `Test failed: ${r.error}`,
      error: (e) => `Test failed: ${(e as Error).message}`,
    });
  };

  // Compute provider status counts from typed wire fields only.
  // rateLimited / quotaExhausted are always unknown (null): the providers
  // endpoint reports neither live rate-limit state nor quota consumption.
  const statusCounts = React.useMemo(
    () => computeProviderStatusCounts(providers.data),
    [providers.data],
  );

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Providers"
        description="AI provider catalog — connect, manage, and monitor all upstream services"
        icon={<Boxes className="size-5" />}
        actions={
          <>
            <Badge tone="muted" size="md" icon={<Boxes className="size-3" aria-hidden />}>
              {statusCounts.configured ?? 'N/A'} configured
            </Badge>
            <Button
              size="sm"
              onClick={() => {
                setSelectedTemplate(null);
                setAddDialogOpen(true);
              }}
            >
              <Plus className="size-3" aria-hidden />
              Add provider
            </Button>
          </>
        }
      />

      {/* Status overview KPIs */}
      <div className="mt-5 grid grid-cols-2 lg:grid-cols-6 gap-3">
        <StatTile
          label="Configured"
          value={statusCounts.configured ?? 'N/A'}
          icon={<Boxes className="size-3.5" />}
          tone="primary"
        />
        <StatTile
          label="Healthy"
          value={statusCounts.healthy ?? 'N/A'}
          icon={<CheckCircle2 className="size-3.5" />}
          tone="success"
        />
        <StatTile
          label="Degraded"
          value={statusCounts.degraded ?? 'N/A'}
          icon={<TriangleAlert className="size-3.5" />}
          tone="warning"
        />
        <StatTile
          label="Unavailable"
          value={statusCounts.unavailable ?? 'N/A'}
          icon={<XCircle className="size-3.5" />}
          tone="danger"
        />
        <StatTile
          label="Rate limited"
          value={statusCounts.rateLimited ?? 'N/A'}
          hint="no live rate-limit data"
          icon={<Clock className="size-3.5" />}
          tone="warning"
        />
        <StatTile
          label="Quota exhausted"
          value={statusCounts.quotaExhausted ?? 'N/A'}
          hint="no live quota data"
          icon={<MinusCircle className="size-3.5" />}
          tone="danger"
        />
      </div>
      <p className="mt-2 text-[10px] text-fg-muted">
        Rate-limit and quota tiles show N/A — the providers API reports neither live
        rate-limit state nor quota consumption (consecutiveFailures is an upstream
        failure count, not a 429; tier &quot;inactive&quot; means no active keys, not
        quota exhausted).
      </p>

      <div className="mt-5">
        <Tabs defaultValue="providers">
          <TabsList>
            <TabsTrigger value="providers">Providers</TabsTrigger>
          </TabsList>

          <TabsContent value="providers">

      <div className="mt-5 flex items-center gap-2">
        <div className="flex-1 max-w-md">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search providers…"
            aria-label="Search providers"
            prefix={<Boxes className="size-3.5" aria-hidden />}
          />
        </div>
        <div className="flex items-center gap-1">
          {(['all', 'cloud', 'local'] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={`h-9 px-3 rounded-lg text-xs font-medium transition-colors ${
                category === c
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'text-fg-muted hover:bg-surface-2 border border-transparent'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <DataState
          data={providers.data}
          isLoading={providers.isLoading}
          error={providers.error}
          onRetry={providers.refetch}
          loading={
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))}
            </div>
          }
          isEmpty={() => filtered.length === 0}
          empty={{
            icon: <Boxes className="size-8" />,
            title: query ? 'No providers match' : 'No providers configured',
            description: query
              ? 'Try a different search term.'
              : 'Connect your first AI provider to start routing traffic.',
            action: !query ? (
              <Button
                onClick={() => {
                  setSelectedTemplate(null);
                  setAddDialogOpen(true);
                }}
              >
                <Plus className="size-3" aria-hidden />
                Add provider
              </Button>
            ) : undefined,
          }}
        >
          {() => (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {paginatedData.map((p) => (
                <ProviderCard
                  key={p.id}
                  provider={p}
                  isFavorite={favorites.includes(p.id)}
                  onToggleFavorite={toggleFav}
                  onTest={onTest}
                  onSelect={(prov) => setSelectedProvider(prov)}
                />
              ))}
            </div>
          )}
        </DataState>
      </div>

      {totalPages > 1 && (
        <div className="mt-4">
          <Pagination
            page={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        </div>
      )}

      <div id="new" className="mt-6">
        <Card padding="md">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-fg">Available providers</h3>
              <p className="text-[10px] text-fg-muted mt-0.5">
                Pre-configured templates from the catalog
              </p>
            </div>
            <Badge tone="muted" size="sm">
              {formatNumber(catalog.data?.entries.length ?? 0)} templates
            </Badge>
          </div>
          <DataState
            data={catalog.data?.entries}
            isLoading={catalog.isLoading}
            error={catalog.error}
            onRetry={catalog.refetch}
            loading={<Skeleton className="h-24 w-full" />}
            empty={{
              title: 'No catalog templates',
              description: 'Templates will appear once the provider catalog loads.',
            }}
          >
            {(entries) => (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {(showAllCatalog ? entries : entries.slice(0, 20)).map((e) => (
                    <button
                      key={e.id ?? e.name}
                      onClick={() => {
                        setSelectedTemplate(e);
                        const base = e.id ?? e.name ?? 'provider';
                        const existing = new Set((providers.data ?? []).map((p) => p.name));
                        let suggested = base;
                        for (let n = 2; existing.has(suggested); n++) suggested = `${base}-${n}`;
                        setSuggestedName(suggested);
                        setAddDialogOpen(true);
                      }}
                      className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 hover:border-border-strong hover:bg-surface-3 transition-colors text-left"
                    >
                      <Plus className="size-3 text-fg-subtle" aria-hidden />
                      <span className="text-xs font-medium text-fg truncate flex-1">{e.name}</span>
                      <Badge tone="muted" size="sm">{e.category}</Badge>
                    </button>
                  ))}
                </div>
                {entries.length > 20 && (
                  <button
                    onClick={() => setShowAllCatalog(!showAllCatalog)}
                    className="mt-2 text-xs text-primary hover:underline"
                  >
                    {showAllCatalog ? 'Show less' : `Show all ${entries.length} templates`}
                  </button>
                )}
              </>
            )}
          </DataState>
        </Card>
      </div>

      <ProviderDetailDrawer
        provider={selectedProvider}
        open={selectedProvider !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedProvider(null);
        }}
        isFavorite={selectedProvider ? favorites.includes(selectedProvider.id) : false}
        onToggleFavorite={toggleFav}
        onChanged={() => void providers.refetch()}
      />

      <AddProviderDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        template={selectedTemplate}
        suggestedName={suggestedName}
        onCreated={() => {
          setSuggestedName(null);
          void providers.refetch();
        }}
      />

          </TabsContent>

        </Tabs>
      </div>
    </PageContainer>
  );
}

/**
 * Pure status-bucket counts for the provider overview KPIs.
 *
 * Exported for testing. Only buckets derived from typed wire fields come
 * back as numbers. `rateLimited` and `quotaExhausted` are always null —
 * the API exposes no live rate-limit state (`consecutiveFailures` counts
 * upstream failures, not 429s) and no quota-consumption state (`tier:
 * 'inactive'` means no active keys). Callers render N/A for null instead
 * of fabricating a 0.
 */
export function computeProviderStatusCounts(list: ApiProvider[] | undefined) {
  if (!list) {
    return { configured: null, healthy: null, degraded: null, unavailable: null, rateLimited: null, quotaExhausted: null };
  }
  const configured = list.length;
  const healthy = list.filter((p) => p.status === 'healthy' || p.status === 'online').length;
  const degraded = list.filter((p) => p.status === 'degraded').length;
  const unavailable = list.filter((p) => p.status === 'unavailable' || p.status === 'offline').length;
  const rateLimited = null;
  const quotaExhausted = null;
  return { configured, healthy, degraded, unavailable, rateLimited, quotaExhausted };
}
