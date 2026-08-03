import { Shield, Plus, Search, Filter, Zap, AlertCircle, ChevronRight } from 'lucide-react';
import * as React from 'react';

import { PolicyDialog } from '@/components/domain/PolicyDialog';
import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { DataState } from '@/components/primitives/DataState';
import { Input } from '@/components/primitives/Input';
import { Switch } from '@/components/primitives/Switch';
import { toast } from '@/components/primitives/Toast';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { timeAgo } from '@/lib/formatters';
import type { ApiPolicyRule } from '@/types/api';

export function PoliciesPage() {
  const [query, setQuery] = React.useState('');
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingPolicy, setEditingPolicy] = React.useState<ApiPolicyRule | null>(null);
  const [togglingId, setTogglingId] = React.useState<string | null>(null);
  const policies = useApiData<ApiPolicyRule[]>(() => Admin.listPolicies(), [], { refetchInterval: 30000 });

  const filtered = (policies.data ?? []).filter((p) =>
    query ? `${p.name} ${p.description ?? ''}`.toLowerCase().includes(query.toLowerCase()) : true
  );

  const openCreate = () => {
    setEditingPolicy(null);
    setDialogOpen(true);
  };

  const openEdit = (p: ApiPolicyRule) => {
    setEditingPolicy(p);
    setDialogOpen(true);
  };

  const toggleEnabled = async (p: ApiPolicyRule, next: boolean) => {
    setTogglingId(p.id);
    try {
      await Admin.updatePolicy(p.id, { enabled: next });
      toast.success('Policy updated', { description: `${p.name} ${next ? 'enabled' : 'disabled'}` });
      await policies.refetch();
    } catch (err) {
      toast.error('Failed to update policy', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Policies"
        description="Routing rules, access controls, and cost guards"
        icon={<Shield className="size-5" />}
        actions={
          <>
            <Badge tone="muted" size="md" icon={<Filter className="size-3" />}>
              {policies.data?.length ?? 0} active
            </Badge>
            <Button size="sm" onClick={openCreate}>
              <Plus className="size-3" />
              New policy
            </Button>
          </>
        }
      />

      <div className="mt-5 flex items-center gap-2 max-w-md">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search policies…"
          prefix={<Search className="size-3.5" />}
        />
      </div>

      <div className="mt-4">
        <DataState
          data={filtered}
          isLoading={policies.isLoading}
          error={policies.error}
          onRetry={policies.refetch}
          skeletonRows={4}
          empty={{
            title: 'No policies configured',
            description: 'Create routing, access, and cost policies to govern traffic.',
            action: (
              <Button onClick={openCreate} size="sm">
                <Plus className="size-3" />
                New policy
              </Button>
            ),
          }}
        >
          {(items) => (
            <div className="flex flex-col gap-2">
              {items.map((p) => (
                <Card
                  key={p.id}
                  padding="none"
                  interactive
                  onClick={() => openEdit(p)}
                >
                  <div className="flex items-center gap-3 p-4">
                    <div
                      className={`flex size-10 items-center justify-center rounded-xl ${
                        p.action === 'allow'
                          ? 'bg-success/10 text-success'
                          : p.action === 'deny'
                            ? 'bg-danger/10 text-danger'
                            : 'bg-warning/10 text-warning'
                      }`}
                    >
                      {p.action === 'allow' ? <Zap className="size-4" /> : p.action === 'deny' ? <AlertCircle className="size-4" /> : <Shield className="size-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-fg truncate">{p.name}</h3>
                        <Badge
                          tone={p.action === 'allow' ? 'success' : p.action === 'deny' ? 'danger' : 'warning'}
                          size="sm"
                        >
                          {p.action}
                        </Badge>
                        {p.priority != null && (
                          <Badge tone="muted" size="sm">P{p.priority}</Badge>
                        )}
                      </div>
                      {p.description && (
                        <p className="text-[11px] text-fg-muted mt-0.5 truncate">{p.description}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-fg-subtle">
                        {p.match?.model && (
                          <span className="font-mono">{p.match.model}</span>
                        )}
                        {p.match?.tenantId && (
                          <span>tenant: {p.match.tenantId}</span>
                        )}
                        {p.match?.tag && (
                          <span>tag: {p.match.tag}</span>
                        )}
                        {p.updatedAt && <span>· {timeAgo(p.updatedAt)}</span>}
                      </div>
                    </div>
                    <Switch
                      checked={p.enabled ?? true}
                      disabled={togglingId === p.id}
                      onCheckedChange={(v) => void toggleEnabled(p, v)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`${p.name} enabled`}
                    />
                    <ChevronRight className="size-3.5 text-fg-subtle" />
                  </div>
                </Card>
              ))}
            </div>
          )}
        </DataState>
      </div>

      <PolicyDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        policy={editingPolicy}
        onSaved={() => void policies.refetch()}
      />
    </PageContainer>
  );
}
