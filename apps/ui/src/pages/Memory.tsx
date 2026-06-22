import * as React from 'react';
import { MemoryStick, Search, Trash2, Database, Sparkles, Brain, Plus, Clock, Tag } from 'lucide-react';
import { PageHeader, PageContainer } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/primitives/Card';
import { Input } from '@/components/primitives/Input';
import { Button } from '@/components/primitives/Button';
import { Badge } from '@/components/primitives/Badge';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/primitives/AlertDialog';
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription, DialogBody, DialogFooter, DialogClose,
} from '@/components/primitives/Dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Textarea } from '@/components/primitives/Textarea';
import { Skeleton } from '@/components/primitives/Skeleton';
import { EmptyState } from '@/components/primitives/EmptyState';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { toast } from '@/components/primitives/Toast';
import { formatDateTime, timeAgo } from '@/lib/formatters';
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
  const [results, setResults] = React.useState<ApiMemoryItem[]>([]);
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
      toast.success('Memory item created');
      setOpen(false);
      setContent('');
      setTenantId('');
      setNamespace('default');
      setSource('');
      setRetentionDays('30');
      items.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create memory item');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await Admin.deleteMemory(id);
      toast.success('Memory item deleted');
      setDeleteTarget(null);
      items.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete memory item');
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
          <>
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus className="size-3" />
              Create item
            </Button>
            <Badge tone="muted" size="md" icon={<Database className="size-3" />}>
              {(items.data ?? []).length} items
            </Badge>
          </>
        }
      />

      <Card padding="md" className="mt-5">
        <CardHeader className="px-0 pt-0">
          <CardTitle className="flex items-center gap-2">
            <Database className="size-3.5 text-fg-muted" />
            Memory stats
          </CardTitle>
          <p className="text-[10px] text-fg-muted mt-0.5">Retention and storage health</p>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {stats.isLoading && !stats.data ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-fg-muted uppercase tracking-wider">Total items</span>
                <span className="text-sm font-semibold text-fg tabular-nums">
                  {(stats.data?.total_items ?? (items.data ?? []).length).toLocaleString()}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-fg-muted uppercase tracking-wider flex items-center gap-1">
                  <Clock className="size-2.5" /> Oldest
                </span>
                <span className="text-sm font-medium text-fg">
                  {stats.data?.oldest_item ? timeAgo(stats.data.oldest_item) : '—'}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-fg-muted uppercase tracking-wider flex items-center gap-1">
                  <Clock className="size-2.5" /> Newest
                </span>
                <span className="text-sm font-medium text-fg">
                  {stats.data?.newest_item ? timeAgo(stats.data.newest_item) : '—'}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-fg-muted uppercase tracking-wider">Retention</span>
                <span className="text-sm font-medium text-fg tabular-nums">
                  {stats.data?.retention_days != null ? `${stats.data.retention_days}d` : '—'}
                </span>
              </div>
              {topNamespaces.length > 0 && (
                <div className="col-span-2 md:col-span-4 flex items-center gap-2 flex-wrap pt-1 border-t border-border">
                  <span className="text-[10px] text-fg-muted uppercase tracking-wider flex items-center gap-1">
                    <Tag className="size-2.5" /> Top namespaces
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
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Delete"
                    onClick={() => setDeleteTarget(m.id)}
                  >
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Create memory item</DialogTitle>
            <DialogDescription>Store a new memory in the tenant knowledge store.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Content <span className="text-danger">*</span></label>
                <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5} placeholder="Enter memory content…" />
              </div>
              <div>
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Tenant ID</label>
                <Input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="tenant-id (optional)" />
              </div>
              <div>
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Namespace</label>
                <Select value={namespace} onValueChange={setNamespace}>
                  <SelectTrigger>
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
              </div>
              <div>
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Source</label>
                <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. api, manual" />
              </div>
              <div>
                <label className="text-[10px] text-fg-muted mb-1 block uppercase tracking-wider">Retention Days</label>
                <Input type="number" value={retentionDays} onChange={(e) => setRetentionDays(e.target.value)} placeholder="30" />
              </div>
            </div>
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
