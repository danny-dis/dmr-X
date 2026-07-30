import { MemoryStick, Search, Trash2, Database, Sparkles, Brain, Plus, Clock, Tag } from 'lucide-react';
import * as React from 'react';

import { PageHeader, PageContainer } from '@/components/layout';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/primitives/AlertDialog';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogBody, DialogFooter, DialogClose,
} from '@/components/primitives/Dialog';
import { interpretError } from '@/components/primitives/ErrorState';
import { Field, FieldLabel } from '@/components/primitives/Field';
import { Input } from '@/components/primitives/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Textarea } from '@/components/primitives/Textarea';
import { toast } from '@/components/primitives/Toast';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { formatNumber, timeAgo } from '@/lib/formatters';
import type { ApiMemoryItem } from '@/types/api';

export function MemoryPage() {
  const [query, setQuery] = React.useState('');
  const items = useApiData<ApiMemoryItem[]>(
    () => Admin.listMemory({ limit: 100 }),
    [],
    { refetchInterval: 30000 }
  );
  const stats = useApiData<{
    total_items?: number;
    by_namespace?: Record<string, number>;
    by_source?: Record<string, number>;
    oldest_item?: string;
    newest_item?: string;
    retention_days?: number;
  }>(
    () => Admin.getMemoryStats(),
    [],
    { refetchInterval: 60000 }
  );
  const [results, setResults] = React.useState<ApiMemoryItem[] | null>(null);
  const [searchError, setSearchError] = React.useState<unknown>(null);
  const [searching, setSearching] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [content, setContent] = React.useState('');
  const [tenantId, setTenantId] = React.useState('');
  const [namespace, setNamespace] = React.useState('default');
  const [source, setSource] = React.useState('');
  const [retentionDays, setRetentionDays] = React.useState('30');
  const [submitting, setSubmitting] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<string | null>(null);

  const topNamespaces = React.useMemo(() => {
    const ns = stats.data?.by_namespace ?? {};
    return Object.entries(ns)
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .slice(0, 3);
  }, [stats.data]);

  const onSearch = async () => {
    if (!query.trim()) {
      setResults(null);
      setSearchError(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const r = await Admin.searchMemory({ query, limit: 20 });
      setResults(r);
    } catch (err) {
      setResults(null);
      setSearchError(err);
    } finally {
      setSearching(false);
    }
  };

  const handleCreate = async () => {
    if (!content.trim()) return;
    setSubmitting(true);
    try {
      await Admin.createMemory({
        content: content.trim(),
        tenantId: tenantId || undefined,
        namespace: namespace !== 'default' ? namespace : undefined,
        source: source || undefined,
        retentionDays: Number(retentionDays) || undefined,
      });
      toast.success('Memory item created', { description: 'It is now searchable in this tenant’s memory store.' });
      setOpen(false);
      setContent('');
      setTenantId('');
      setNamespace('default');
      setSource('');
      setRetentionDays('30');
      void items.refetch();
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await Admin.deleteMemory(id);
      toast.success('Memory item deleted');
      setDeleteTarget(null);
      void items.refetch();
    } catch (err) {
      const e = interpretError(err);
      toast.error(e.title, { description: e.description });
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Memory"
        description="Tenant memory store — persistent context, embeddings, and knowledge"
        icon={<MemoryStick className="size-5" />}
        actions={
          <>
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="size-3" aria-hidden />
              Create item
            </Button>
            <Badge tone="muted" size="md" icon={<Database className="size-3" />}>
              {formatNumber((items.data ?? []).length)} items
            </Badge>
          </>
        }
      />

      <Card padding="md" className="mt-5">
        <CardHeader className="px-0 pt-0">
          <CardTitle className="flex items-center gap-2">
            <Database className="size-3.5 text-fg-muted" aria-hidden />
            Memory stats
          </CardTitle>
          <p className="text-[10px] text-fg-muted mt-0.5">Retention and storage health</p>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <DataState
            data={stats.data}
            isLoading={stats.isLoading}
            error={stats.error}
            onRetry={stats.refetch}
            loading={
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            }
          >
            {(data) => (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-fg-muted uppercase tracking-wider">Total items</span>
                  <span className="text-sm font-semibold text-fg tabular-nums">
                    {formatNumber(data.total_items ?? (items.data ?? []).length)}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-fg-muted uppercase tracking-wider flex items-center gap-1">
                    <Clock className="size-2.5" aria-hidden /> Oldest
                  </span>
                  <span className="text-sm font-medium text-fg">
                    {data.oldest_item ? timeAgo(data.oldest_item) : '—'}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-fg-muted uppercase tracking-wider flex items-center gap-1">
                    <Clock className="size-2.5" aria-hidden /> Newest
                  </span>
                  <span className="text-sm font-medium text-fg">
                    {data.newest_item ? timeAgo(data.newest_item) : '—'}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-fg-muted uppercase tracking-wider">Retention</span>
                  <span className="text-sm font-medium text-fg tabular-nums">
                    {data.retention_days != null ? `${data.retention_days}d` : '—'}
                  </span>
                </div>
                {topNamespaces.length > 0 && (
                  <div className="col-span-2 md:col-span-4 flex items-center gap-2 flex-wrap pt-1 border-t border-border">
                    <span className="text-[10px] text-fg-muted uppercase tracking-wider flex items-center gap-1">
                      <Tag className="size-2.5" aria-hidden /> Top namespaces
                    </span>
                    {topNamespaces.map(([ns, count]) => (
                      <Badge key={ns} tone="muted" size="sm">
                        {ns} · {count}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
          </DataState>
        </CardContent>
      </Card>

      <Card padding="md" className="mt-5">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSearch()}
              placeholder="Semantic search across all tenant memory…"
              aria-label="Search memory"
              prefix={<Search className="size-3.5" aria-hidden />}
            />
          </div>
          <Button onClick={onSearch} loading={searching}>
            <Sparkles className="size-3" aria-hidden />
            Search
          </Button>
        </div>
        {query && (
          <p className="text-[10px] text-fg-muted mt-2" aria-live="polite">
            {searching ? 'Searching…' : `Searching semantically · ${results?.length ?? 0} matches`}
          </p>
        )}
      </Card>

      <div className="mt-4">
        {query ? (
          <DataState
            data={results}
            isLoading={searching}
            error={searchError}
            onRetry={onSearch}
            skeletonRows={4}
            empty={{
              icon: <Search className="size-8" />,
              title: 'No matches',
              description: 'Try a different search term, or clear the search to browse all items.',
            }}
          >
            {(data) => <MemoryList items={data} onDelete={setDeleteTarget} />}
          </DataState>
        ) : (
          <DataState
            data={items.data}
            isLoading={items.isLoading}
            error={items.error}
            onRetry={items.refetch}
            skeletonRows={6}
            empty={{
              icon: <MemoryStick className="size-8" />,
              title: 'Memory is empty',
              description: 'Memory items are created automatically by the gateway during agentic requests.',
            }}
          >
            {(data) => <MemoryList items={data} onDelete={setDeleteTarget} />}
          </DataState>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Create memory item</DialogTitle>
            <DialogDescription>Store a new memory in the tenant knowledge store.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="memory-content" required>Content</FieldLabel>
              <Textarea
                id="memory-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={5}
                placeholder="Enter memory content…"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="memory-tenant">Tenant ID</FieldLabel>
              <Input
                id="memory-tenant"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                placeholder="tenant-id (optional)"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="memory-namespace">Namespace</FieldLabel>
              <Select value={namespace} onValueChange={setNamespace}>
                <SelectTrigger id="memory-namespace">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">default</SelectItem>
                  <SelectItem value="agentic">agentic</SelectItem>
                  <SelectItem value="user">user</SelectItem>
                  <SelectItem value="system">system</SelectItem>
                  <SelectItem value="knowledge">knowledge</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="memory-source">Source</FieldLabel>
              <Input
                id="memory-source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="e.g. api, manual"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="memory-retention">Retention days</FieldLabel>
              <Input
                id="memory-retention"
                type="number"
                value={retentionDays}
                onChange={(e) => setRetentionDays(e.target.value)}
                placeholder="30"
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleCreate} loading={submitting} disabled={!content.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete memory item?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The memory item will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (deleteTarget) void handleDelete(deleteTarget); }}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}

/* -------------------------------------------------------------------------- */
/*  Helper components                                                         */
/* -------------------------------------------------------------------------- */

function MemoryList({
  items,
  onDelete,
}: {
  items: ApiMemoryItem[];
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((m) => (
        <Card key={m.id} padding="none" interactive>
          <div className="p-3 flex items-start gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Brain className="size-3.5" aria-hidden />
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
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Delete memory item"
              onClick={() => onDelete(m.id)}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
