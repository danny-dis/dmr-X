import { Store, Star, Download, Search } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Input } from '@/components/primitives/Input';
import { Skeleton } from '@/components/primitives/Skeleton';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MarketplaceListing {
  id: string;
  title: string;
  description: string | null;
  longDescription: string | null;
  category: string | null;
  tags: string[];
  icon: string | null;
  rating: number;
  ratingCount: number;
  installCount: number;
  priceCents: number;
  status: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Listing Card
// ---------------------------------------------------------------------------

function ListingCard({ listing, onInstall }: { listing: MarketplaceListing; onInstall: (id: string) => void }) {
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
            <Badge variant="default">${(listing.priceCents / 100).toFixed(2)}</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {listing.description && (
          <p className="text-sm text-muted-foreground line-clamp-3">{listing.description}</p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {listing.tags.slice(0, 4).map(tag => (
            <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
          ))}
        </div>

        <div className="flex items-center justify-between pt-2 border-t">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              {listing.rating > 0 ? listing.rating.toFixed(1) : '—'}
              {listing.ratingCount > 0 && <span>({listing.ratingCount})</span>}
            </span>
            <span className="flex items-center gap-1">
              <Download className="h-3.5 w-3.5" />
              {listing.installCount}
            </span>
          </div>
          <Button size="sm" onClick={() => onInstall(listing.id)}>
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
  const [installing, setInstalling] = React.useState<string | null>(null);

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (category) params.set('category', category);
    params.set('limit', '50');
    return params.toString();
  }, [search, category]);

  const { data, loading, refetch } = useApiData<{ items: MarketplaceListing[]; total: number }>(
    `/v1/marketplace?${queryParams}`
  );

  const listings = data?.items ?? [];

  const handleInstall = async (id: string) => {
    setInstalling(id);
    try {
      await Admin.fetch(`/v1/marketplace/${id}/install`, { method: 'POST' });
      refetch();
    } catch (e) {
      console.error('Install failed:', e);
    } finally {
      setInstalling(null);
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
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search agents..."
              className="pl-9"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button
              variant={category === '' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setCategory('')}
            >
              All
            </Button>
            {categories.map(cat => (
              <Button
                key={cat}
                variant={category === cat ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCategory(cat === category ? '' : cat)}
              >
                {cat}
              </Button>
            ))}
          </div>
        </div>

        {/* Listings grid */}
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-64" />)}
          </div>
        ) : listings.length === 0 ? (
          <EmptyState
            icon={<Store className="h-12 w-12" />}
            title="No agents found"
            description={search ? "Try a different search term" : "The marketplace is empty. Be the first to publish an agent!"}
          />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{data?.total ?? 0} agents available</p>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {listings.map(listing => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  onInstall={handleInstall}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </PageContainer>
  );
}
