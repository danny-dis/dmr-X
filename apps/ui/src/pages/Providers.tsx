import { Boxes, Plus, Search, Globe, Gift } from 'lucide-react';
import * as React from 'react';

import { AddProviderDialog } from '@/components/domain/AddProviderDialog';
import { ProviderCard } from '@/components/domain/ProviderCard';
import { ProviderDetailDrawer } from '@/components/domain/ProviderDetailDrawer';
import { PageHeader, PageContainer } from '@/components/layout';
import { BackLink } from '@/components/primitives/BackLink';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Input } from '@/components/primitives/Input';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { toast } from '@/components/primitives/Toast';
import { Pagination } from '@/components/primitives/Pagination';
import { useApiData, useUrlState } from '@/hooks';
import { Admin } from '@/lib/admin';
import { useUIStore } from '@/store/useUIStore';
import type { ApiCatalogEntry, ApiProvider } from '@/types/api';

// Lazy-load Free Tier tab content

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

  const providers = useApiData<ApiProvider[]>(() => Admin.listProviders(), [], { refetchInterval: 30000 });
  const catalog = useApiData<{ entries: ApiCatalogEntry[] }>(
    () => Admin.getCatalog(),
    [],
    { refetchInterval: 60000 }
  );
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

  return (
    <PageContainer size="wide">
      <BackLink to="/" label="Dashboard" />
      <PageHeader
        title="Providers"
        description="AI provider catalog — connect, manage, and monitor all upstream services"
        icon={<Boxes className="size-5" />}
        actions={
          <>
            <Badge tone="muted" size="md" icon={<Globe className="size-3" />}>
              {(providers.data ?? []).length} configured
            </Badge>
            <Button
              size="sm"
              onClick={() => {
                setSelectedTemplate(null);
                setAddDialogOpen(true);
              }}
            >
              <Plus className="size-3" />
              Add provider
            </Button>
          </>
        }
      />

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
            prefix={<Search className="size-3.5" />}
          />
        </div>
        <div className="flex items-center gap-1">
          {(['all', 'cloud', 'local'] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
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
        {providers.isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : filtered.length > 0 ? (
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
        ) : (
          <Card padding="none" className="border-dashed">
            <EmptyState
              title={query ? 'No providers match' : 'No providers configured'}
              description={
                query
                  ? `Try a different search term.`
                  : 'Connect your first AI provider to start routing traffic.'
              }
              action={
                <Button
                  onClick={() => {
                    setSelectedTemplate(null);
                    setAddDialogOpen(true);
                  }}
                >
                  <Plus className="size-3" />
                  Add provider
                </Button>
              }
            />
          </Card>
        )}
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
              {catalog.data?.entries.length ?? 0} templates
            </Badge>
          </div>
          {catalog.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : catalog.data && catalog.data.entries.length > 0 ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {(showAllCatalog ? catalog.data.entries : catalog.data.entries.slice(0, 20)).map((e) => (
                  <button
                    key={e.id ?? e.name}
                    onClick={() => {
                      setSelectedTemplate(e);
                      // Suggest a unique name so a second account of the same
                      // provider type becomes its OWN instance instead of
                      // upserting (and clobbering) the existing row. The
                      // activate route keys rows by `name`, so `google-2`
                      // coexists with `google`.
                      const base = e.id ?? e.name ?? 'provider';
                      const existing = new Set((providers.data ?? []).map((p) => p.name));
                      let suggested = base;
                      for (let n = 2; existing.has(suggested); n++) suggested = `${base}-${n}`;
                      setSuggestedName(suggested);
                      setAddDialogOpen(true);
                    }}
                    className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 hover:border-border-strong hover:bg-surface-3 transition-colors text-left"
                  >
                    <Plus className="size-3 text-fg-subtle" />
                    <span className="text-xs font-medium text-fg truncate flex-1">{e.name}</span>
                    <Badge tone="muted" size="sm">{e.category}</Badge>
                  </button>
                ))}
              </div>
              {catalog.data.entries.length > 20 && (
                <button
                  onClick={() => setShowAllCatalog(!showAllCatalog)}
                  className="mt-2 text-xs text-primary hover:underline"
                >
                  {showAllCatalog ? 'Show less' : `Show all ${catalog.data.entries.length} templates`}
                </button>
              )}
            </>
          ) : (
            <p className="text-fg-subtle text-xs">No catalog entries</p>
          )}
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
