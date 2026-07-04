import { Users, Plus, Search, KeyRound, Mail, Calendar, Save, Trash2, Lock } from 'lucide-react';
import * as React from 'react';

import { ApiKeyCard } from '@/components/domain/ApiKeyCard';
import { CreateApiKeyDialog } from '@/components/domain/CreateApiKeyDialog';
import { CreateTenantDialog } from '@/components/domain/CreateTenantDialog';
import { PageHeader, PageContainer } from '@/components/layout';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import { Input } from '@/components/primitives/Input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/primitives/Select';
import { Pagination } from '@/components/primitives/Pagination';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Switch } from '@/components/primitives/Switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { toast } from '@/components/primitives/Toast';
import { useApiData } from '@/hooks/useApiData';
import { Admin } from '@/lib/admin';
import { formatNumber, timeAgo } from '@/lib/formatters';
import type { ApiTenant, ApiKey } from '@/types/api';

export function TenantsPage() {
  const [query, setQuery] = React.useState('');
  const [selectedTenant, setSelectedTenant] = React.useState<string | null>(null);
  const [createTenantOpen, setCreateTenantOpen] = React.useState(false);
  const [createKeyOpen, setCreateKeyOpen] = React.useState(false);
  const [currentPage, setCurrentPage] = React.useState(1);
  const PAGE_SIZE = 20;

  const tenants = useApiData<ApiTenant[]>(() => Admin.listTenants(), [], { refetchInterval: 15000 });

  const keys = useApiData<ApiKey[]>(
    () => Admin.listApiKeys().then(allKeys => allKeys.filter(k => k.tenant_id === selectedTenant)),
    [selectedTenant],
    { enabled: !!selectedTenant, refetchInterval: 15000 }
  );

  const [settingsName, setSettingsName] = React.useState('');
  const [settingsEmail, setSettingsEmail] = React.useState('');
  const [settingsTier, setSettingsTier] = React.useState('free');
  const [settingsSuspended, setSettingsSuspended] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  // Tenant delete: two-step inline confirm (mirrors ProviderDetailDrawer / ModelDetailDrawer).
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const [deletingTenant, setDeletingTenant] = React.useState(false);

  // API key revoke: two-step inline confirm + optimistic remove from the local list.
  const [confirmingRevokeId, setConfirmingRevokeId] = React.useState<string | null>(null);
  const [optimisticallyHidden, setOptimisticallyHidden] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const filtered = (tenants.data ?? []).filter((t) =>
    query ? `${t.name} ${t.email ?? ''}`.toLowerCase().includes(query.toLowerCase()) : true
  );
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginatedData = React.useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage]
  );

  React.useEffect(() => { setCurrentPage(1); }, [query]);

  const selected = (tenants.data ?? []).find((t) => t.id === selectedTenant);

  // Keys for the selected tenant, minus any that we've optimistically removed.
  const visibleKeys = React.useMemo(
    () => (keys.data ?? []).filter((k) => !optimisticallyHidden.has(k.id)),
    [keys.data, optimisticallyHidden],
  );

  // Auto-cancel the inline-confirm state after a short window so the user doesn't
  // get stuck in "Click again to confirm" if they change their mind.
  React.useEffect(() => {
    if (!confirmingDelete) return;
    const t = setTimeout(() => setConfirmingDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmingDelete]);
  React.useEffect(() => {
    if (!confirmingRevokeId) return;
    const t = setTimeout(() => setConfirmingRevokeId(null), 3000);
    return () => clearTimeout(t);
  }, [confirmingRevokeId]);
  // Reset the confirm state when the selected tenant changes (a new selection
  // shouldn't inherit a half-finished confirmation).
  React.useEffect(() => {
    setConfirmingDelete(false);
  }, [selectedTenant]);

  const handleDeleteTenant = async () => {
    if (!selected) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setConfirmingDelete(false);
    setDeletingTenant(true);
    try {
      await Admin.deleteTenant(selected.id);
      toast.success('Tenant deleted', { description: selected.name });
      if (selectedTenant === selected.id) setSelectedTenant(null);
      await tenants.refetch();
    } catch (err) {
      toast.error('Failed to delete tenant', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDeletingTenant(false);
    }
  };

  const handleRevokeKey = async (id: string) => {
    if (confirmingRevokeId !== id) {
      setConfirmingRevokeId(id);
      return;
    }
    setConfirmingRevokeId(null);
    // Optimistic remove so the card disappears immediately.
    setOptimisticallyHidden((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    try {
      await Admin.revokeApiKey(id);
      toast.success('API key revoked');
      await keys.refetch();
    } catch (err) {
      // Restore on failure.
      setOptimisticallyHidden((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast.error('Failed to revoke API key', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  React.useEffect(() => {
    if (!selectedTenant && tenants.data && tenants.data.length > 0) {
      setSelectedTenant(tenants.data[0].id);
    }
  }, [tenants.data, selectedTenant]);

  React.useEffect(() => {
    if (selected) {
      setSettingsName(selected.name ?? '');
      setSettingsEmail(selected.email ?? '');
      setSettingsTier(selected.tier ?? 'free');
      setSettingsSuspended(selected.suspended ?? false);
    }
  }, [selected]);

  const saveSettings = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await Admin.updateTenant(selected.id, {
        name: settingsName,
        email: settingsEmail || undefined,
        tier: settingsTier,
        suspended: settingsSuspended,
      });
      toast.success('Tenant updated');
      void tenants.refetch();
    } catch (err) {
      toast.error('Failed to update tenant', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Tenants"
        description="Manage tenants, API keys, and access scopes"
        icon={<Users className="size-5" />}
        actions={
          <Button size="sm" onClick={() => setCreateTenantOpen(true)}>
            <Plus className="size-3" />
            New tenant
          </Button>
        }
      />

      <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-3">
        <Card padding="none" className="lg:col-span-1">
          <div className="p-3 border-b border-border">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tenants…"
              prefix={<Search className="size-3.5" />}
              size="sm"
            />
          </div>
          <div className="p-1 max-h-[600px] overflow-y-auto">
            {tenants.isLoading ? (
              <div className="p-2 flex flex-col gap-1.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : filtered.length > 0 ? (
              paginatedData.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTenant(t.id)}
                  className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                    selectedTenant === t.id ? 'bg-primary/10' : 'hover:bg-surface-2'
                  }`}
                >
                  <div className="flex size-9 items-center justify-center rounded-lg bg-surface-2 text-fg-muted text-xs font-semibold uppercase">
                    {t.name.slice(0, 2)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-fg truncate">{t.name}</p>
<p className="text-[10px] text-fg-muted">
                       {t.tier ?? 'free'} · {formatNumber(t.tokens_used ?? 0, true)} tokens
                     </p>
                  </div>
                  <StatusPill
                    status={t.suspended ? 'offline' : 'online'}
                    size="sm"
                    showDot={false}
                  />
                </button>
              ))
            ) : (
              <p className="p-6 text-center text-fg-subtle text-xs">No tenants</p>
            )}
          </div>
          {totalPages > 1 && (
            <div className="p-3 border-t border-border">
              <Pagination
                page={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
              />
            </div>
          )}
        </Card>

        <div className="lg:col-span-2">
          {selected ? (
            <Card padding="none">
              <div className="p-5 border-b border-border">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent text-white font-semibold uppercase">
                      {selected.name.slice(0, 2)}
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold text-fg">{selected.name}</h2>
                      <p className="text-xs text-fg-muted flex items-center gap-2 mt-0.5">
                        <Badge tone="primary" size="sm">{selected.tier ?? 'free'}</Badge>
                        {selected.email && (
                          <span className="flex items-center gap-1">
                            <Mail className="size-2.5" />
                            {selected.email}
                          </span>
                        )}
                        {selected.createdAt && (
                          <span className="flex items-center gap-1">
                            <Calendar className="size-2.5" />
                            {timeAgo(selected.createdAt)}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {(() => {
                      const protectedTenant =
                        selected.name === 'default' || selected.name === 'local';
                      return (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleDeleteTenant}
                          loading={deletingTenant}
                          disabled={protectedTenant}
                          title={
                            protectedTenant
                              ? `Cannot delete the "${selected.name}" tenant`
                              : confirmingDelete
                                ? 'Click again to confirm'
                                : 'Delete tenant'
                          }
                          className={confirmingDelete ? 'border-danger/40 text-danger' : ''}
                        >
                          {protectedTenant ? (
                            <Lock className="size-3" />
                          ) : (
                            <Trash2 className="size-3" />
                          )}
                          {protectedTenant
                            ? 'Protected'
                            : confirmingDelete
                              ? 'Click again'
                              : 'Delete'}
                        </Button>
                      );
                    })()}
                  </div>
                </div>
              </div>

              <Tabs defaultValue="keys">
                <TabsList className="mx-3 mt-3">
                  <TabsTrigger value="keys">API Keys</TabsTrigger>
                  <TabsTrigger value="usage">Usage</TabsTrigger>
                  <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>
                <TabsContent value="keys" className="px-3 pb-3">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-fg">API Keys</h3>
                    <Button size="sm" onClick={() => setCreateKeyOpen(true)}>
                      <Plus className="size-3" />
                      New key
                    </Button>
                  </div>
                  {keys.isLoading ? (
                    <div className="grid grid-cols-1 gap-2">
                      {Array.from({ length: 2 }).map((_, i) => (
                        <Skeleton key={i} className="h-20 w-full" />
                      ))}
                    </div>
                  ) : visibleKeys.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {visibleKeys.map((k) => (
                        <ApiKeyCard
                          key={k.id}
                          apiKey={k}
                          revoking={confirmingRevokeId === k.id}
                          onRevoke={() => void handleRevokeKey(k.id)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border p-8 text-center">
                      <KeyRound className="size-5 text-fg-subtle mx-auto mb-2" />
                      <p className="text-sm text-fg-muted">No API keys yet</p>
                      <p className="text-[10px] text-fg-subtle mt-1">Create one to start using the gateway</p>
                    </div>
                  )}
                </TabsContent>
<TabsContent value="usage" className="px-3 pb-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-[10px] text-fg-muted uppercase tracking-wider">Tokens</p>
                      <p className="text-lg font-semibold text-fg mt-1">
                        {formatNumber(selected.tokens_used ?? 0, true)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-[10px] text-fg-muted uppercase tracking-wider">Requests</p>
                      <p className="text-lg font-semibold text-fg mt-1">
                        {formatNumber(selected.requests_used ?? 0, true)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-[10px] text-fg-muted uppercase tracking-wider">Cost</p>
                      <p className="text-lg font-semibold text-fg mt-1">
                        ${(selected.cost_used ?? 0).toFixed(2)}
                      </p>
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="settings" className="px-3 pb-3">
                  <div className="space-y-4">
                    <div>
                      <label className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider block mb-1">Name</label>
                      <Input
                        value={settingsName}
                        onChange={(e) => setSettingsName(e.target.value)}
                        placeholder="Tenant name"
                        size="sm"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider block mb-1">Email</label>
                      <Input
                        type="email"
                        value={settingsEmail}
                        onChange={(e) => setSettingsEmail(e.target.value)}
                        placeholder="tenant@example.com"
                        size="sm"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider block mb-1">Tier</label>
                      <Select value={settingsTier} onValueChange={setSettingsTier}>
                        <SelectTrigger size="sm" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="free">Free</SelectItem>
                          <SelectItem value="starter">Starter</SelectItem>
                          <SelectItem value="pro">Pro</SelectItem>
                          <SelectItem value="enterprise">Enterprise</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="rounded-lg border border-border p-3 space-y-2">
                      <p className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider">Rate limits</p>
                      <div className="grid grid-cols-3 gap-2 text-[11px]">
                        <div>
                          <p className="text-fg-subtle">Tokens</p>
                          <p className="text-fg tabular-nums">{formatNumber(selected.tokens_used ?? 0, true)} / {formatNumber(selected.tokens_limit ?? 0, true)}</p>
                        </div>
                        <div>
                          <p className="text-fg-subtle">Requests</p>
                          <p className="text-fg tabular-nums">{formatNumber(selected.requests_used ?? 0, true)} / {formatNumber(selected.requests_limit ?? 0, true)}</p>
                        </div>
                        <div>
                          <p className="text-fg-subtle">Cost</p>
                          <p className="text-fg tabular-nums">${(selected.cost_used ?? 0).toFixed(2)} / ${(selected.cost_limit ?? 0).toFixed(2)}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-fg">Suspended</p>
                        <p className="text-[10px] text-fg-muted">Block all API access for this tenant</p>
                      </div>
                      <Switch
                        checked={settingsSuspended}
                        onCheckedChange={setSettingsSuspended}
                      />
                    </div>
                    <Button onClick={saveSettings} loading={saving} leftIcon={<Save className="size-3" />}>
                      Save
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </Card>
          ) : (
            <Card padding="md">
              <p className="text-fg-muted text-sm">Select a tenant to view details</p>
            </Card>
          )}
        </div>
      </div>

      <CreateTenantDialog
        open={createTenantOpen}
        onOpenChange={setCreateTenantOpen}
        onCreated={async (tenantId) => {
          // Clear the search so the new tenant is always visible after creation.
          setQuery('');
          await tenants.refetch();
          setSelectedTenant(tenantId);
        }}
      />

      <CreateApiKeyDialog
        open={createKeyOpen}
        onOpenChange={setCreateKeyOpen}
        tenantId={selectedTenant}
        tenantName={selected?.name}
        onCreated={() => void keys.refetch()}
      />
    </PageContainer>
  );
}
