import { Store, Star, Download, Search } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import { Input } from '@/components/primitives/Input';
import { interpretError } from '@/components/primitives/ErrorState';
import { toast } from '@/components/primitives/Toast';
import { useInstallMarketplaceItem, useMarketplace, type MarketplaceListing } from '@/lib/queries/agents';

// ---------------------------------------------------------------------------
// Listing Card
// ---------------------------------------------------------------------------

function ListingCard({ listing, onInstall, isInstalling }: { listing: MarketplaceListing; onInstall: (id: string) => void; isInstalling: boolean }) {
  return (
    <Card className="hover:border-primary/50 transition-colors">
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <Store className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">{listing.title}</CardTitle>
              {listing.category && (
                <Badge variant="secondary" className="mt-1 text-xs">{listing.category}</Badge>
              )}
            </div>
          </div>
          {listing.priceCents > 0 && (
            <Badge tone="primary" variant="solid">${(listing.priceCents / 100).toFixed(2)}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {listing.description && (
          <p className="text-sm text-fg-muted line-clamp-3">{listing.description}</p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {listing.tags.slice(0, 4).map(tag => (
            <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
          ))}
        </div>

        <div className="flex items-center justify-between pt-2 border-t">
          <div className="flex items-center gap-4 text-sm text-fg-muted">
            <span className="flex items-center gap-1">
              <Star className="h-3.5 w-3.5 fill-warning text-warning" />
              {listing.rating > 0 ? listing.rating.toFixed(1) : '—'}
              {listing.ratingCount > 0 && <span>({listing.ratingCount})</span>}
            </span>
            <span className="flex items-center gap-1">
              <Download className="h-3.5 w-3.5" />
              {listing.installCount}
            </span>
          </div>
          <Button size="sm" onClick={() => onInstall(listing.id)} loading={isInstalling}>
            Install
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Marketplace Page
// ---------------------------------------------------------------------------

export function MarketplacePage() {
  const [search, setSearch] = React.useState('');
  const [category, setCategory] = React.useState('');
  const installMarketplaceItem = useInstallMarketplaceItem();
  const installing = installMarketplaceItem.isPending ? (installMarketplaceItem.variables ?? null) : null;

  const { data, isLoading, error, refetch } = useMarketplace({
    search: search || undefined,
    category: category || undefined,
    limit: 50,
  });

  const handleInstall = async (id: string) => {
    try {
      await installMarketplaceItem.mutateAsync(id);
      toast.success('Agent installed', { description: 'The agent has been added to your workspace' });
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    }
  };

  const categories = [
    'Academic', 'Design', 'Engineering', 'Finance', 'Game Development', 'GIS',
    'Healthcare', 'Marketing', 'Operations', 'Paid Media', 'Product',
    'Project Management', 'Research', 'Sales', 'Security', 'Spatial Computing',
    'Specialized', 'Support', 'Testing',
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Agent Marketplace"
        description="Browse and install pre-built AI agents from the community"
      />

      <div className="flex flex-col gap-4">
        {/* Search and filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-muted" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search agents..."
              className="pl-9"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant={category === '' ? 'primary' : 'outline'}
              size="sm"
              onClick={() => setCategory('')}
            >
              All
            </Button>
            {categories.map(cat => (
              <Button
                key={cat}
                variant={category === cat ? 'primary' : 'outline'}
                size="sm"
                onClick={() => setCategory(cat === category ? '' : cat)}
              >
                {cat}
              </Button>
            ))}
          </div>
        </div>

        {/* Listings grid */}
        {/*
          `data?.items` is passed un-coalesced on purpose: DataState uses a null
          data value to tell a first load apart from a settled-but-empty result,
          so a `?? []` here would swallow the skeleton and flash "No agents
          found" during every load.
        */}
        <DataState
          data={data?.items}
          isLoading={isLoading}
          error={error}
          onRetry={refetch}
          skeletonRows={6}
          empty={{
            icon: <Store className="size-8" />,
            title: 'No agents found',
            description: search ? 'Try a different search term.' : 'The marketplace is empty. Be the first to publish an agent.',
          }}
        >
          {(items) => (
            <>
              <p className="text-sm text-fg-muted">{data?.total ?? 0} agents available</p>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {items.map(listing => (
                  <ListingCard
                    key={listing.id}
                    listing={listing}
                    onInstall={handleInstall}
                    isInstalling={installing === listing.id}
                  />
                ))}
              </div>
            </>
          )}
        </DataState>
      </div>
    </PageContainer>
  );
}
