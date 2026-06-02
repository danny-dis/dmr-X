import * as React from 'react';
import { MemoryStick, Search, Trash2, Database, Sparkles, Brain } from 'lucide-react';
import { PageHeader, PageContainer } from '@/components/layout';
import { Card } from '@/components/primitives/Card';
import { Input } from '@/components/primitives/Input';
import { Button } from '@/components/primitives/Button';
import { Badge } from '@/components/primitives/Badge';
import { Skeleton } from '@/components/primitives/Skeleton';
import { EmptyState } from '@/components/primitives/EmptyState';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { formatDateTime, timeAgo } from '@/lib/formatters';
import type { ApiMemoryItem } from '@/types/api';

export function MemoryPage() {
  const [query, setQuery] = React.useState('');
  const items = useApiData<ApiMemoryItem[]>(
    () => Admin.listMemory({ limit: 100 }),
    [],
    { refetchInterval: 30000 }
  );
  const [results, setResults] = React.useState<ApiMemoryItem[]>([]);
  const [searching, setSearching] = React.useState(false);

  const onSearch = async () => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const r = await Admin.searchMemory({ query, limit: 20 });
      setResults(r);
    } finally {
      setSearching(false);
    }
  };

  const list = query ? results : (items.data ?? []);

  return (
    <PageContainer>
      <PageHeader
        title="Memory"
        description="Tenant memory store — persistent context, embeddings, and knowledge"
        icon={<MemoryStick className="size-5" />}
        actions={
          <Badge tone="muted" size="md" icon={<Database className="size-3" />}>
            {(items.data ?? []).length} items
          </Badge>
        }
      />

      <Card padding="md" className="mt-5">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSearch()}
              placeholder="Semantic search across all tenant memory…"
              prefix={<Search className="size-3.5" />}
            />
          </div>
          <Button onClick={onSearch} loading={searching}>
            <Sparkles className="size-3" />
            Search
          </Button>
        </div>
        {query && (
          <p className="text-[10px] text-fg-muted mt-2">
            Searching semantically · {results.length} matches
          </p>
        )}
      </Card>

      <div className="mt-4">
        {items.isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : list.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {list.map((m) => (
              <Card key={m.id} padding="none" interactive>
                <div className="p-3 flex items-start gap-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Brain className="size-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-fg line-clamp-2">{m.content}</p>
                    <div className="flex items-center gap-2 mt-1.5 text-[10px] text-fg-muted">
                      <span>{m.tenantId}</span>
                      <span>·</span>
                      <span className="font-mono">{m.id.slice(0, 8)}</span>
                      {m.createdAt && (
                        <>
                          <span>·</span>
                          <span>{timeAgo(m.createdAt)}</span>
                        </>
                      )}
                      {m.score != null && (
                        <Badge tone="primary" size="sm">score {m.score.toFixed(2)}</Badge>
                      )}
                    </div>
                  </div>
                  <Button size="icon-sm" variant="ghost" aria-label="Delete">
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card padding="none" className="border-dashed">
            <EmptyState
              title="Memory is empty"
              description="Memory items are created automatically by the gateway during agentic requests."
            />
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
