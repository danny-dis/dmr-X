import { Gift, Plus, Search, ExternalLink, Server, Zap, Globe, RefreshCw, KeyRound } from 'lucide-react';
import * as React from 'react';

import { AddProviderDialog } from '@/components/domain/AddProviderDialog';
import { FreeProviderCard } from '@/components/domain/FreeProviderCard';
import { FreeTierDrawer } from '@/components/domain/FreeTierDrawer';
import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Input } from '@/components/primitives/Input';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatTile } from '@/components/primitives/StatTile';
import { toast } from '@/components/primitives/Toast';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/store/useUIStore';
import type { ApiCatalogEntry, ApiProvider } from '@/types/api';

function isFreeProvider(entry: ApiCatalogEntry): boolean {
  if (!entry.models || entry.models.length === 0) return false;
  return entry.models.some((m) => (m as Record<string, unknown>).freeTier != null);
}

export function FreeTierPage() {
  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState<'all' | 'cloud' | 'local' | 'hosting'>('all');
  const [selectedProvider, setSelectedProvider] = React.useState<ApiCatalogEntry | null>(null);
  const [addDialogOpen, setAddDialogOpen] = React.useState(false);
  const [selectedTemplate, setSelectedTemplate] = React.useState<ApiCatalogEntry | null>(null);
  const debounced = React.useDeferredValue(query);

  const providers = useApiData<ApiProvider[]>(() => Admin.listProviders(), [], { refetchInterval: 30000 });
  const catalog = useApiData<{ entries: ApiCatalogEntry[] }>(
    () => Admin.getCatalog(),
    [],
    { refetchInterval: 60000 }
  );
  const favorites = useUIStore((s) => s.favoriteProviders);
  const toggleFav = useUIStore((s) => s.toggleFavoriteProvider);

  const catalogEntries = catalog.data?.entries ?? [];
  const freeCatalog = catalogEntries.filter(isFreeProvider);
  // A "connected free provider" is any provider whose server-computed
  // tier is `free` or `mixed` (the latter covers connections that
  // started free and had a paid key added on top). Mapping by `name`
  // to the catalog entry is still useful for the *browse* cards, but
  // for the "connected" list we trust the per-connection tier.
  const connectedFree = (providers.data ?? []).filter(
    (p) => p.tier === 'free' || p.tier === 'mixed',
  );
  const connectedNames = new Set(connectedFree.map((p) => p.name));
  const totalFreeModels = freeCatalog.reduce((sum, e) => sum + (e.models?.length ?? 0), 0);

  const cloudCategories = new Set(['cloud_llm', 'cloud_embedding', 'cloud_audio', 'cloud_video', 'cloud_diffusion']);

  const filtered = freeCatalog.filter((entry) => {
    if (debounced) {
      const haystack = `${entry.name} ${entry.description ?? ''} ${entry.category} ${entry.baseUrl ?? ''}`.toLowerCase();
      if (!haystack.includes(debounced.toLowerCase())) return false;
    }
    if (category === 'all') return true;
    if (category === 'cloud') return cloudCategories.has(entry.category);
    if (category === 'local') return entry.category === 'local';
    if (category === 'hosting') return entry.category === 'hosting';
    return true;
  });

  const avgRpm = (() => {
    const rpms: number[] = [];
    for (const e of freeCatalog) {
      for (const m of e.models ?? []) {
        const ft = (m as unknown as { freeTier?: { rateLimits?: { rpm?: number } } }).freeTier;
        if (ft?.rateLimits?.rpm != null) rpms.push(ft.rateLimits.rpm);
      }
    }
    if (rpms.length === 0) return '—';
    return formatNumber(Math.round(rpms.reduce((a, b) => a + b, 0) / rpms.length));
  })();

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
      <PageHeader
        title="Free Tier Providers"
        description="Connect to free-tier providers with no credit card required"
        icon={<Gift className="size-5" />}
        actions={
          <>
            <Badge tone="success" size="md" icon={<Zap className="size-3" />}>
              {freeCatalog.length} free providers
            </Badge>
            <Badge tone="muted" size="md" icon={<Server className="size-3" />}>
              {formatNumber(totalFreeModels)} free models
            </Badge>
            <Button
              size="sm"
              onClick={() => {
                setSelectedTemplate(null);
                setAddDialogOpen(true);
              }}
            >
              <Plus className="size-3" />
              Add Free Provider
            </Button>
          </>
        }
      />

      <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label="Available"
          value={freeCatalog.length}
          icon={<Globe className="size-3.5" />}
          hint="free providers in catalog"
        />
        <StatTile
          label="Connected"
          value={connectedFree.length}
          icon={<Server className="size-3.5" />}
          tone="success"
          hint="active free providers"
        />
        <StatTile
          label="Catalog Models"
          value={formatNumber(totalFreeModels)}
          icon={<Zap className="size-3.5" />}
          tone="primary"
          hint="free-tier models available"
        />
        <StatTile
          label="Avg. RPM"
          value={avgRpm}
          icon={<RefreshCw className="size-3.5" />}
          tone="accent"
          hint="average rate limit"
        />
      </div>

      <div className="mt-5">
        <Card padding="md">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-fg">Connected Free Providers</h3>
              <p className="text-[10px] text-fg-muted mt-0.5">
                Your active free-tier providers and their status
              </p>
            </div>
            <Badge tone="success" size="sm">
              {connectedFree.length} active
            </Badge>
          </div>
          {providers.isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-28 w-full" />
              ))}
            </div>
          ) : connectedFree.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {connectedFree.map((p) => (
                <FreeProviderCard
                  key={p.id}
                  provider={p}
                  isFavorite={favorites.includes(p.id)}
                  onToggleFavorite={toggleFav}
                  onTest={onTest}
                  onSelect={(prov) => {
                    const entry = freeCatalog.find((c) => c.id === prov.id);
                    if (entry) {
                      setSelectedTemplate(entry);
                      setSelectedProvider(entry);
                    }
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-xs text-fg-subtle">
              No free providers connected yet. Browse the catalog below to get started.
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card padding="md">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-fg">Available Free Providers</h3>
              <p className="text-[10px] text-fg-muted mt-0.5">
                Pre-configured free-tier templates from the catalog
              </p>
            </div>
            <Badge tone="muted" size="sm">
              {filtered.length} providers
            </Badge>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 max-w-md">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search free providers…"
                prefix={<Search className="size-3.5" />}
              />
            </div>
            <div className="flex items-center gap-1">
              {(['all', 'cloud', 'local', 'hosting'] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={cn(
                    'h-9 px-3 rounded-lg text-xs font-medium transition-colors',
                    category === c
                      ? 'bg-primary/10 text-primary border border-primary/20'
                      : 'text-fg-muted hover:bg-surface-2 border border-transparent'
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {catalog.isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-32 w-full" />
              ))}
            </div>
          ) : filtered.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((entry) => {
                const isConnected = connectedNames.has(entry.id);
                const freeModels = (entry.models ?? []).filter(
                  (m) => (m as unknown as { freeTier?: unknown }).freeTier != null
                );
                const anyRpm = freeModels.length > 0
                  ? (freeModels[0] as unknown as { freeTier: { rateLimits: { rpm: number } } }).freeTier.rateLimits.rpm
                  : 0;

                return (
                  <Card
                    key={entry.id}
                    padding="md"
                    interactive={!isConnected}
                    className={cn('group flex flex-col', isConnected && 'opacity-75')}
                    onClick={() => {
                      if (!isConnected) {
                        setSelectedTemplate(entry);
                        setAddDialogOpen(true);
                      }
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-fg-muted font-mono text-xs font-semibold uppercase">
                          {entry.name.slice(0, 2)}
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-sm font-semibold text-fg truncate">{entry.name}</h4>
                          <p className="text-[11px] text-fg-muted truncate">{entry.description ?? entry.baseUrl ?? 'Free provider'}</p>
                        </div>
                      </div>
                      {isConnected ? (
                        <Badge tone="success" size="sm">Connected</Badge>
                      ) : (
                        <Badge tone="muted" size="sm" icon={<Gift className="size-2.5" />}>
                          Free
                        </Badge>
                      )}
                    </div>

                    <div className="mt-3 flex items-center gap-3 text-[11px] text-fg-subtle">
                      <span className="flex items-center gap-1">
                        <Server className="size-3" />
                        {freeModels.length} free models
                      </span>
                      {anyRpm > 0 && (
                        <span className="flex items-center gap-1">
                          <RefreshCw className="size-3" />
                          {formatNumber(anyRpm)} RPM
                        </span>
                      )}
                      {entry.signupUrl && (
                        <span className="flex items-center gap-1 ml-auto">
                          <ExternalLink className="size-3" />
                          <a
                            href={entry.signupUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Get Key
                          </a>
                        </span>
                      )}
                    </div>

                    {isConnected && (
                      <div className="mt-3 pt-2 border-t border-border/60 flex items-center gap-2">
                        <Badge tone="muted" size="sm" icon={<KeyRound className="size-2.5" />}>
                          {entry.authMethod ?? 'api_key'}
                        </Badge>
                        {entry.category && (
                          <Badge tone="muted" size="sm">{entry.category}</Badge>
                        )}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card padding="none" className="border-dashed">
              <EmptyState
                title={query ? 'No providers match' : 'No free providers found'}
                description={
                  query
                    ? 'Try a different search term.'
                    : 'No free-tier providers match the selected filters.'
                }
              />
            </Card>
          )}
        </Card>
      </div>

      <FreeTierDrawer
        provider={selectedProvider}
        open={selectedProvider !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedProvider(null);
        }}
        onCreated={() => void providers.refetch()}
      />

      <AddProviderDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        template={selectedTemplate}
        onCreated={() => void providers.refetch()}
        forceTier="free"
      />
    </PageContainer>
  );
}
